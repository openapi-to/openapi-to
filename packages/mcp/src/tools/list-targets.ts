import { hasDiagnosticErrors, summarizeDiagnostics, type Diagnostic } from '@openapi-to/core'
import { z } from 'zod'

import { safeExecutionDiagnostic } from '../errors.ts'
import { createToolResult, diagnosticSchema, diagnosticSummarySchema, executionFailure, truncateDiagnostics } from '../result.ts'
import { mapWorkspaceDiagnostics } from './common.ts'
import { detachedHandlerExtra, loggedToolCall, type McpHandlerExtra, type ToolContext } from './context.ts'

export const listTargetsInputSchema = z.object({}).meta({ additionalProperties: false })
export const listTargetsOutputSchema = z.object({
  schemaVersion: z.literal(1),
  tool: z.literal('openapi_list_targets'),
  success: z.boolean(),
  targets: z.array(z.object({
    name: z.string(),
    sourceType: z.enum(['local', 'remote']),
    operationCount: z.number().int(),
    schemaCount: z.number().int(),
    generationAvailable: z.boolean(),
    catalogAvailable: z.boolean(),
    diagnosticSummary: diagnosticSummarySchema,
  })),
  diagnostics: z.array(diagnosticSchema),
  diagnosticSummary: diagnosticSummarySchema,
  truncated: z.object({ diagnostics: z.boolean(), totalDiagnostics: z.number().int(), returnedDiagnostics: z.number().int(), omittedDiagnostics: z.number().int() }),
})

export async function listTargetsTool(context: ToolContext, _input: z.infer<typeof listTargetsInputSchema>, extra: McpHandlerExtra = detachedHandlerExtra()) {
  const tool = 'openapi_list_targets'
  return loggedToolCall(context, tool, extra, async (execution) => {
    try {
      if (!context.targetCatalogs) throw new Error('Trusted target catalogs are unavailable.')
      const compiled = await context.targetCatalogs.list(execution.signal)
      const diagnostics: Diagnostic[] = mapWorkspaceDiagnostics(compiled.flatMap((target) => target.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: `Target ${target.target} could not be fully cataloged (${diagnostic.code}).`,
      }))))
      const bounded = truncateDiagnostics(context.options.workspaceRoot, diagnostics, context.options.limits.maxDiagnostics)
      const targets = compiled.map((target) => ({
        name: target.target,
        sourceType: target.sourceType,
        operationCount: target.catalog?.items.length ?? 0,
        schemaCount: target.schemaCount,
        generationAvailable: true,
        catalogAvailable: target.success,
        diagnosticSummary: summarizeDiagnostics(target.diagnostics),
      }))
      const success = !hasDiagnosticErrors(diagnostics)
      return createToolResult(
        tool,
        { success, targets, diagnostics: bounded.diagnostics, diagnosticSummary: bounded.summary, truncated: bounded.truncated },
        `${targets.length} trusted target(s); source locations and configuration values omitted`,
        context.options.limits,
        !success,
      )
    } catch (error) {
      return executionFailure(context.options.workspaceRoot, tool, [safeExecutionDiagnostic(error, execution)], context.options.limits, { targets: [] })
    }
  })
}
