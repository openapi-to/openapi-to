import { compileOpenAPI, diffOpenAPIDocuments, hasDiagnosticErrors } from '@openapi-to/core'
import { z } from 'zod'

import { safeExecutionDiagnostic } from '../errors.ts'
import { createToolResult, diagnosticSchema, diagnosticSummarySchema, executionFailure, truncateDiagnostics } from '../result.ts'
import { resolveToolSource, sanitizeSourceDisplay } from '../security/source.ts'
import { mapWorkspaceDiagnostics } from './common.ts'
import { detachedHandlerExtra, loggedToolCall, type McpHandlerExtra, type ToolContext } from './context.ts'

const LIMITATION = '当前是第一阶段 OpenAPI diff 规则集，不是完整的兼容性证明或 breaking-change oracle。'
export const diffInputSchema = z.object({ before: z.string().min(1).max(4096), after: z.string().min(1).max(4096) }).meta({ additionalProperties: false })
export const diffOutputSchema = z.object({
  schemaVersion: z.literal(1),
  tool: z.literal('openapi_diff'),
  success: z.boolean(),
  before: z.string().optional(),
  after: z.string().optional(),
  breaking: z.boolean().optional(),
  changes: z
    .array(
      z.object({
        classification: z.enum(['breaking', 'non-breaking', 'warning', 'informational']),
        code: z.string(),
        path: z.array(z.union([z.string(), z.number()])).optional(),
        message: z.string(),
      }),
    )
    .optional(),
  summary: z.object({ breaking: z.number().int(), nonBreaking: z.number().int(), warnings: z.number().int(), informational: z.number().int() }).optional(),
  diagnostics: z.array(diagnosticSchema),
  diagnosticSummary: diagnosticSummarySchema,
  truncated: z.object({
    diagnostics: z.boolean(), totalDiagnostics: z.number().int(), returnedDiagnostics: z.number().int(), omittedDiagnostics: z.number().int(),
    changes: z.boolean().optional(), totalChanges: z.number().int().optional(), returnedChanges: z.number().int().optional(), omittedChanges: z.number().int().optional(),
  }),
  limitation: z.string().optional(),
})

export async function diffTool(context: ToolContext, input: z.infer<typeof diffInputSchema>, extra: McpHandlerExtra = detachedHandlerExtra()) {
  const tool = 'openapi_diff'
  return loggedToolCall(context, tool, extra, async (execution) => {
    let beforeDisplay = sanitizeSourceDisplay(context.options.workspaceRoot, input.before)
    let afterDisplay = sanitizeSourceDisplay(context.options.workspaceRoot, input.after)
    try {
      const [beforeSource, afterSource] = await Promise.all([
        resolveToolSource(context.options.workspaceRoot, input.before),
        resolveToolSource(context.options.workspaceRoot, input.after),
      ])
      beforeDisplay = beforeSource.display
      afterDisplay = afterSource.display
      await execution.progress('Compiling both OpenAPI inputs', 10)
      const compileOptions = { cwd: context.options.workspaceRoot, localFileRoot: context.options.workspaceRoot, remote: context.options.remote, signal: execution.signal }
      const [before, after] = await Promise.all([compileOpenAPI(beforeSource.value, compileOptions), compileOpenAPI(afterSource.value, compileOptions)])
      const diagnostics = mapWorkspaceDiagnostics([...before.diagnostics, ...after.diagnostics])
      if (!before.normalizedDocument || !after.normalizedDocument || hasDiagnosticErrors(diagnostics)) {
        return executionFailure(context.options.workspaceRoot, tool, diagnostics, context.options.limits, { before: beforeDisplay, after: afterDisplay, breaking: false, changes: [], summary: { breaking: 0, nonBreaking: 0, warnings: 0, informational: 0 }, limitation: LIMITATION })
      }
      await execution.progress('Comparing API contracts', 70)
      const difference = diffOpenAPIDocuments(before.normalizedDocument, after.normalizedDocument, { signal: execution.signal })
      const priority = { breaking: 0, warning: 1, 'non-breaking': 2, informational: 3 } as const
      const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)
      const orderedChanges = [...difference.changes].sort((left, right) => priority[left.classification] - priority[right.classification] || compareText(left.path.map(String).join('\u0000'), right.path.map(String).join('\u0000')) || compareText(left.code, right.code))
      const changes = orderedChanges.slice(0, context.options.limits.maxChanges).map(({ classification, code, path, message }) => ({ classification, code, path, message }))
      if (changes.length < difference.changes.length) diagnostics.push({ code: 'MCP_RESULT_TRUNCATED', severity: 'warning', message: `The result omitted ${difference.changes.length - changes.length} changes because it exceeded the configured limit.` })
      const bounded = truncateDiagnostics(context.options.workspaceRoot, diagnostics, context.options.limits.maxDiagnostics)
      await execution.progress('Preparing bounded result', 95)
      const result = createToolResult(
        tool,
        {
          success: true,
          before: beforeDisplay,
          after: afterDisplay,
          breaking: difference.breaking,
          changes,
          summary: difference.summary,
          diagnostics: bounded.diagnostics,
          diagnosticSummary: bounded.summary,
          truncated: {
            ...bounded.truncated,
            changes: changes.length < difference.changes.length,
            totalChanges: difference.changes.length,
            returnedChanges: changes.length,
            omittedChanges: difference.changes.length - changes.length,
          },
          limitation: LIMITATION,
        },
        `${difference.summary.breaking} breaking and ${difference.summary.nonBreaking} non-breaking change(s); first-stage rules only`,
        context.options.limits,
      )
      await execution.progress('Complete', 100)
      return result
    } catch (error) {
      return executionFailure(context.options.workspaceRoot, tool, [safeExecutionDiagnostic(error, execution)], context.options.limits, { before: beforeDisplay, after: afterDisplay, breaking: false, changes: [], summary: { breaking: 0, nonBreaking: 0, warnings: 0, informational: 0 }, limitation: LIMITATION })
    }
  })
}
