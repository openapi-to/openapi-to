import { readGenerationIntent, summarizeDiagnostics, type Diagnostic } from '@openapi-to/core'
import { z } from 'zod'

import { safeExecutionDiagnostic } from '../errors.ts'
import { prepareTargets } from '../generation/service.ts'
import { createToolResult, diagnosticSchema, diagnosticSummarySchema, executionFailure, truncateDiagnostics } from '../result.ts'
import { mapWorkspaceDiagnostics } from './common.ts'
import { detachedHandlerExtra, loggedToolCall, type McpHandlerExtra, type ToolContext } from './context.ts'

export const listTargetsInputSchema = z.object({}).strict()
export const listTargetsOutputSchema = z.object({
  schemaVersion: z.literal(1), tool: z.literal('openapi_list_targets'), success: z.boolean(),
  targets: z.array(z.object({
    name: z.string(), sourceType: z.enum(['local', 'remote']), operationCount: z.number().int(), schemaCount: z.number().int(), generationAvailable: z.boolean(), catalogAvailable: z.boolean(),
    configuredOutputRoot: z.string(), state: z.enum(['uninitialized', 'full', 'operations', 'drift']), persistedOutputRoot: z.string().optional(), selectedOperationCount: z.number().int().optional(), diagnosticSummary: diagnosticSummarySchema,
  }).strict()),
  diagnostics: z.array(diagnosticSchema), diagnosticSummary: diagnosticSummarySchema,
  truncated: z.object({ diagnostics: z.boolean(), totalDiagnostics: z.number().int(), returnedDiagnostics: z.number().int(), omittedDiagnostics: z.number().int() }).strict(),
}).strict()

export async function listTargetsTool(context: ToolContext, _input: z.infer<typeof listTargetsInputSchema>, extra: McpHandlerExtra = detachedHandlerExtra()) {
  const tool = 'openapi_list_targets'
  return loggedToolCall(context, tool, extra, async (execution) => {
    try {
      if (!context.targetCatalogs) throw new Error('Trusted target catalogs are unavailable.')
      const [compiled, prepared] = await Promise.all([
        context.targetCatalogs.list(execution.signal),
        prepareTargets(context.trustedConfig, context.options, undefined, execution.signal),
      ])
      const outputs = new Map(prepared.targets.map((target) => [target.name, target.output.workspaceRelativePath]))
      const diagnostics: Diagnostic[] = mapWorkspaceDiagnostics(compiled.flatMap((target) => target.diagnostics.map((diagnostic) => ({ code: diagnostic.code, severity: diagnostic.severity, message: `Target ${target.target} could not be fully cataloged (${diagnostic.code}).` }))))
      const targetResults = await Promise.all(compiled.map(async (target) => {
        const configuredOutputRoot = outputs.get(target.target) ?? '<unavailable>'
        let state: 'uninitialized' | 'full' | 'operations' | 'drift' = 'uninitialized'
        let persistedOutputRoot: string | undefined
        let selectedOperationCount: number | undefined
        const intentDiagnostics: Diagnostic[] = []
        try {
          const intent = await readGenerationIntent(context.options.workspaceRoot, target.target)
          if (intent.manifest) {
            state = intent.manifest.scope.type
            persistedOutputRoot = intent.manifest.outputRoot
            if (intent.manifest.scope.type === 'operations') selectedOperationCount = intent.manifest.scope.operationKeys.length
            if (persistedOutputRoot !== configuredOutputRoot) state = 'drift'
          }
        } catch (error) {
          state = 'drift'
          intentDiagnostics.push(safeExecutionDiagnostic(error, execution))
        }
        return {
          value: {
            name: target.target,
            sourceType: target.sourceType,
            operationCount: target.catalog?.items.length ?? 0,
            schemaCount: target.schemaCount,
            generationAvailable: true,
            catalogAvailable: target.success,
            configuredOutputRoot,
            state,
            ...(persistedOutputRoot ? { persistedOutputRoot } : {}),
            ...(selectedOperationCount === undefined ? {} : { selectedOperationCount }),
            diagnosticSummary: summarizeDiagnostics(target.diagnostics),
          },
          intentDiagnostics,
        }
      }))
      const targets = targetResults.map(({ value }) => value)
      diagnostics.push(...targetResults.flatMap(({ intentDiagnostics }) => intentDiagnostics))
      const bounded = truncateDiagnostics(context.options.workspaceRoot, diagnostics, context.options.limits.maxDiagnostics)
      const success = !targets.some((target) => target.state === 'drift') && !bounded.summary.errors
      return createToolResult(tool, { success, targets, diagnostics: bounded.diagnostics, diagnosticSummary: bounded.summary, truncated: bounded.truncated }, `${targets.length} trusted target(s); generation metadata is bounded and Workspace-relative`, context.options.limits, !success)
    } catch (error) {
      return executionFailure(context.options.workspaceRoot, tool, [safeExecutionDiagnostic(error, execution)], context.options.limits, { targets: [] })
    }
  })
}
