import { readGenerationIntent } from '@openapi-to/core'
import { z } from 'zod'

import { safeExecutionDiagnostic } from '../errors.ts'
import { executeGenerationIntent, generationSucceeded } from '../generation/service.ts'
import { createToolResult, diagnosticSchema, diagnosticSummarySchema, executionFailure, truncateDiagnostics } from '../result.ts'
import { detachedHandlerExtra, loggedToolCall, type McpHandlerExtra, type ToolContext } from './context.ts'

export const checkGenerationInputSchema = z.object({
  target: z.string().min(1).max(200),
  basis: z.enum(['persisted', 'configured-full']).optional(),
}).strict()

const changeSchema = z.object({ path: z.string(), status: z.enum(['added', 'modified', 'deleted']), expectedSha256: z.string().optional(), actualSha256: z.string().optional() }).strict()
export const checkGenerationOutputSchema = z.object({
  schemaVersion: z.literal(1), tool: z.literal('openapi_check_generation'), success: z.boolean(), basis: z.enum(['persisted', 'configured-full']), target: z.string(), state: z.enum(['uninitialized', 'full', 'operations']), outputRoot: z.string().optional(), outdated: z.boolean().optional(),
  changes: z.array(changeSchema), summary: z.object({ added: z.number().int(), modified: z.number().int(), deleted: z.number().int() }).strict(),
  diagnostics: z.array(diagnosticSchema), diagnosticSummary: diagnosticSummarySchema,
  truncated: z.object({ diagnostics: z.boolean(), totalDiagnostics: z.number().int(), returnedDiagnostics: z.number().int(), omittedDiagnostics: z.number().int(), changes: z.boolean(), totalChanges: z.number().int(), returnedChanges: z.number().int(), omittedChanges: z.number().int() }).strict(),
}).strict()

export async function checkGenerationTool(context: ToolContext, input: z.infer<typeof checkGenerationInputSchema>, extra: McpHandlerExtra = detachedHandlerExtra()) {
  const tool = 'openapi_check_generation'
  return loggedToolCall(context, tool, extra, async (execution) => {
    try {
      return await context.generationLock.run(async () => {
        const basis = input.basis ?? 'persisted'
        let trustedOutputRoot: string | undefined
        let state: 'uninitialized' | 'full' | 'operations' = 'full'
        let mutation: { type: 'full' } | { type: 'operations'; strategy: 'replace'; operationKeys: string[] } = { type: 'full' }
        if (basis === 'persisted') {
          const persisted = await readGenerationIntent(context.options.workspaceRoot, input.target)
          if (!persisted.manifest) {
            const diagnostic = { code: 'GENERATION_INTENT_NOT_INITIALIZED', severity: 'error' as const, message: 'No persisted Generation Intent exists for this target; configured-full was not used implicitly.' }
            const bounded = truncateDiagnostics(context.options.workspaceRoot, [diagnostic], context.options.limits.maxDiagnostics)
            return createToolResult(tool, {
              success: false, basis, target: input.target, state: 'uninitialized', changes: [], summary: { added: 0, modified: 0, deleted: 0 }, diagnostics: bounded.diagnostics, diagnosticSummary: bounded.summary,
              truncated: { ...bounded.truncated, changes: false, totalChanges: 0, returnedChanges: 0, omittedChanges: 0 },
            }, 'no persisted Generation Intent; no files modified', context.options.limits, true)
          }
          trustedOutputRoot = persisted.manifest.outputRoot
          state = persisted.manifest.scope.type
          mutation = persisted.manifest.scope.type === 'full' ? { type: 'full' } : { type: 'operations', strategy: 'replace', operationKeys: persisted.manifest.scope.operationKeys }
        }
        const run = await executeGenerationIntent(context.trustedConfig, context.options, {
          target: input.target,
          mutation,
          ...(trustedOutputRoot ? { trustedOutputRoot } : {}),
          execution: 'preview',
          mode: 'check',
        }, execution, context.targetCatalogs)
        const server = run.servers[0]
        const manifest = server?.result.generationResult?.manifest
        const changed = (manifest?.entries ?? []).filter((entry) => entry.status !== 'unchanged')
        const returned = changed.slice(0, context.options.limits.maxChanges).map((entry) => ({
          path: entry.path,
          status: entry.status as 'added' | 'modified' | 'deleted',
          ...(entry.hash ? { expectedSha256: entry.hash } : {}),
          ...(entry.previousHash ? { actualSha256: entry.previousHash } : {}),
        }))
        const diagnostics = [...run.diagnostics]
        if (returned.length < changed.length) diagnostics.push({ code: 'MCP_RESULT_TRUNCATED', severity: 'warning' as const, message: `The result omitted ${changed.length - returned.length} generation changes.` })
        const bounded = truncateDiagnostics(context.options.workspaceRoot, diagnostics, context.options.limits.maxDiagnostics)
        const success = generationSucceeded(run) && !manifest?.outdated
        return createToolResult(tool, {
          success, basis, target: input.target, state, ...(server ? { outputRoot: server.outputRoot } : {}), outdated: manifest?.outdated ?? false,
          changes: returned,
          summary: { added: manifest?.summary.added ?? 0, modified: manifest?.summary.modified ?? 0, deleted: manifest?.summary.deleted ?? 0 },
          diagnostics: bounded.diagnostics, diagnosticSummary: bounded.summary,
          truncated: { ...bounded.truncated, changes: returned.length < changed.length, totalChanges: changed.length, returnedChanges: returned.length, omittedChanges: changed.length - returned.length },
        }, success ? 'generation is current; no files modified' : `${changed.length} generated change(s) detected; no files modified`, context.options.limits, !success)
      }, execution.signal)
    } catch (error) {
      return executionFailure(
        context.options.workspaceRoot,
        tool,
        [safeExecutionDiagnostic(error, execution)],
        context.options.limits,
        { basis: input.basis ?? 'persisted', target: input.target, state: 'uninitialized', changes: [], summary: { added: 0, modified: 0, deleted: 0 }, outdated: false },
        { changes: false, totalChanges: 0, returnedChanges: 0, omittedChanges: 0 },
      )
    }
  })
}
