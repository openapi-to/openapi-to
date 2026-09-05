import { z } from 'zod'

import { safeExecutionDiagnostic } from '../errors.ts'
import { executeGeneration, generationSucceeded } from '../generation/service.ts'
import { createToolResult, diagnosticSchema, diagnosticSummarySchema, executionFailure, truncateDiagnostics } from '../result.ts'
import { detachedHandlerExtra, loggedToolCall, type McpHandlerExtra, type ToolContext } from './context.ts'

export const checkGenerationInputSchema = z.object({ targets: z.array(z.string().min(1).max(200)).max(100).optional() }).meta({ additionalProperties: false })
const changeSchema = z.object({ path: z.string(), status: z.enum(['added', 'modified', 'deleted']), expectedSha256: z.string().optional(), actualSha256: z.string().optional() })
export const checkGenerationOutputSchema = z.object({
  schemaVersion: z.literal(1), tool: z.literal('openapi_check_generation'), success: z.boolean(), mode: z.literal('check').optional(), outdated: z.boolean().optional(),
  servers: z.array(z.object({
    name: z.string(), outputRoot: z.string().optional(), outdated: z.boolean(), changes: z.array(changeSchema),
    summary: z.object({ added: z.number().int(), modified: z.number().int(), deleted: z.number().int() }),
  })).optional(),
  diagnostics: z.array(diagnosticSchema), diagnosticSummary: diagnosticSummarySchema,
  truncated: z.object({
    diagnostics: z.boolean(), totalDiagnostics: z.number().int(), returnedDiagnostics: z.number().int(), omittedDiagnostics: z.number().int(),
    changes: z.boolean().optional(), totalChanges: z.number().int().optional(), returnedChanges: z.number().int().optional(), omittedChanges: z.number().int().optional(),
  }),
})

export async function checkGenerationTool(context: ToolContext, input: z.infer<typeof checkGenerationInputSchema>, extra: McpHandlerExtra = detachedHandlerExtra()) {
  const tool = 'openapi_check_generation'
  return loggedToolCall(context, tool, extra, async (execution) => {
    try {
      return await context.generationLock.run(async () => {
        const run = await executeGeneration(context.trustedConfig, context.options, input.targets, 'check', execution)
        let totalChanges = 0
        let returnedChanges = 0
        let changeBudget = context.options.limits.maxChanges
        const servers = run.servers.map((server) => {
          const manifest = server.result.generationResult?.manifest
          const changed = (manifest?.entries ?? []).filter((entry) => entry.status !== 'unchanged')
          totalChanges += changed.length
          const changes = changed.slice(0, changeBudget).map((entry) => ({
            path: entry.path,
            status: entry.status as 'added' | 'modified' | 'deleted',
            ...(entry.hash ? { expectedSha256: entry.hash } : {}),
            ...(entry.previousHash ? { actualSha256: entry.previousHash } : {}),
          }))
          returnedChanges += changes.length
          changeBudget -= changes.length
          return {
            name: server.name,
            outputRoot: server.outputRoot,
            outdated: manifest?.outdated ?? false,
            changes,
            summary: {
              added: manifest?.summary.added ?? 0,
              modified: manifest?.summary.modified ?? 0,
              deleted: manifest?.summary.deleted ?? 0,
            },
          }
        })
        if (returnedChanges < totalChanges) run.diagnostics.push({ code: 'MCP_RESULT_TRUNCATED', severity: 'warning', message: `The result omitted ${totalChanges - returnedChanges} generation changes because it exceeded the configured limit.` })
        const finalBounded = truncateDiagnostics(context.options.workspaceRoot, run.diagnostics, context.options.limits.maxDiagnostics)
        const outdated = servers.some((server) => server.outdated)
        const success = generationSucceeded(run) && !outdated
        await execution.progress('Preparing bounded result', 95)
        const result = createToolResult(
          tool,
          {
            success,
            mode: 'check',
            outdated,
            servers,
            diagnostics: finalBounded.diagnostics,
            diagnosticSummary: finalBounded.summary,
            truncated: {
              ...finalBounded.truncated,
              changes: returnedChanges < totalChanges,
              totalChanges,
              returnedChanges,
              omittedChanges: totalChanges - returnedChanges,
            },
          },
          outdated ? `${totalChanges} outdated generated file(s); no files modified` : `${run.targets.length} target(s) are current; no files modified`,
          context.options.limits,
          !success,
        )
        await execution.progress('Complete', 100)
        return result
      }, execution.signal)
    } catch (error) {
      return executionFailure(context.options.workspaceRoot, tool, [safeExecutionDiagnostic(error, execution)], context.options.limits, { mode: 'check', outdated: false, servers: [] })
    }
  })
}
