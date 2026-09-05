import { z } from 'zod'
import {
  DEFAULT_MAX_SELECTION_OPERATIONS,
  MAX_OPERATION_SELECTION_KEY_BYTES,
} from '@openapi-to/core'

import { safeExecutionDiagnostic } from '../errors.ts'
import { MAX_ADD_SELECTION_OPERATIONS } from '../generation/selection-state.ts'
import { prepareGenerationWritePlan, prepareSelectiveGenerationWritePlan } from '../generation/write-plan.ts'
import { createToolResult, diagnosticSchema, diagnosticSummarySchema, executionFailure, truncateDiagnostics } from '../result.ts'
import { detachedHandlerExtra, loggedToolCall, type McpHandlerExtra, type ToolContext } from './context.ts'

const encoder = new TextEncoder()
const operationSelectionKeySchema = z.string()
  .min(1)
  .max(MAX_OPERATION_SELECTION_KEY_BYTES)
  .refine(
    (operationKey) => encoder.encode(operationKey).byteLength <= MAX_OPERATION_SELECTION_KEY_BYTES,
    `operationKey must be at most ${MAX_OPERATION_SELECTION_KEY_BYTES} UTF-8 bytes.`,
  )

export const prepareGenerationInputSchema = z.object({
  targets: z.array(z.string().min(1).max(200)).max(100).optional(),
  selection: z.union([
    z.object({
      type: z.literal('add'),
      operationKeys: z.array(operationSelectionKeySchema).max(MAX_ADD_SELECTION_OPERATIONS),
    }).strict(),
    z.object({
      type: z.literal('replace'),
      operationKeys: z.array(operationSelectionKeySchema).min(1).max(DEFAULT_MAX_SELECTION_OPERATIONS),
    }).strict(),
  ]).optional(),
  includePreview: z.boolean().optional(),
}).strict()

const preparedChangeSchema = z.object({
  outputRoot: z.string(),
  path: z.string(),
  status: z.enum(['added', 'modified', 'deleted']),
  artifactKind: z.string().optional(),
  beforeSha256: z.string().optional(),
  afterSha256: z.string().optional(),
  bytes: z.number().int().optional(),
  preview: z.string().optional(),
  previewTruncated: z.boolean().optional(),
})

export const prepareGenerationOutputSchema = z.object({
  schemaVersion: z.literal(1),
  tool: z.literal('openapi_prepare_generation'),
  success: z.boolean(),
  plan: z.object({
    kind: z.enum(['full', 'selective']),
    applySupported: z.boolean(),
    planId: z.string(),
    token: z.string().optional(),
    planHash: z.string(),
    createdAt: z.string(),
    expiresAt: z.string(),
    targets: z.array(z.string()),
    summary: z.object({
      added: z.number().int(), modified: z.number().int(), deleted: z.number().int(), unchanged: z.number().int(), totalBytesAfter: z.number().int(),
    }),
    changes: z.array(preparedChangeSchema),
    selection: z.object({
      mutationType: z.enum(['add', 'replace']),
      previousOperationKeys: z.array(z.string()),
      requestedOperationKeys: z.array(z.string()),
      newlyAddedOperationKeys: z.array(z.string()),
      alreadySelectedOperationKeys: z.array(z.string()),
      retainedOperationKeys: z.array(z.string()),
      removedOperationKeys: z.array(z.string()),
      desiredOperationKeys: z.array(z.string()),
      previousSelectionHash: z.string(),
      desiredSelectionHash: z.string(),
      previousSelectionExists: z.boolean(),
      counts: z.object({
        previous: z.number().int(),
        requested: z.number().int(),
        newlyAdded: z.number().int(),
        alreadySelected: z.number().int(),
        retained: z.number().int(),
        removed: z.number().int(),
        desired: z.number().int(),
      }),
      truncated: z.boolean(),
    }).optional(),
    projection: z.object({
      projectionHash: z.string(), operationCount: z.number().int(), pathCount: z.number().int(), schemaCount: z.number().int(),
      parameterCount: z.number().int(), requestBodyCount: z.number().int(), responseCount: z.number().int(), headerCount: z.number().int(),
      securitySchemeCount: z.number().int(), callbackCount: z.number().int(), linkCount: z.number().int(), exampleCount: z.number().int(),
    }).optional(),
    truncated: z.object({ changes: z.boolean(), returned: z.number().int(), total: z.number().int(), omitted: z.number().int(), selection: z.boolean().optional() }),
  }).optional(),
  diagnostics: z.array(diagnosticSchema),
  diagnosticSummary: diagnosticSummarySchema,
  truncated: z.object({ diagnostics: z.boolean(), totalDiagnostics: z.number().int(), returnedDiagnostics: z.number().int(), omittedDiagnostics: z.number().int() }),
})

export async function prepareGenerationTool(context: ToolContext, input: z.infer<typeof prepareGenerationInputSchema>, extra: McpHandlerExtra = detachedHandlerExtra()) {
  const tool = 'openapi_prepare_generation'
  return loggedToolCall(context, tool, extra, async (execution) => {
    try {
      if (!context.generationPlans) throw new Error('Controlled write plan storage is unavailable.')
      return await context.generationLock.run(async () => {
        await execution.progress('Preparing generation plan', 5)
        if (input.selection && !context.targetCatalogs) throw new Error('Selective Prepare requires a startup-trusted target registry.')
        const selectivePrepared = input.selection
          ? await prepareSelectiveGenerationWritePlan(
              context.trustedConfig,
              context.generationPlans as NonNullable<ToolContext['generationPlans']>,
              context.options,
              context.targetCatalogs as NonNullable<ToolContext['targetCatalogs']>,
              input.targets,
              input.selection,
              execution,
            )
          : undefined
        const prepared = selectivePrepared
          ?? await prepareGenerationWritePlan(context.trustedConfig, context.generationPlans as NonNullable<ToolContext['generationPlans']>, context.options, input.targets, execution)
        const server = prepared.run.servers[0]
        const manifest = server?.result.generationResult?.manifest
        if (!server || !manifest) throw new Error('Prepared generation plan is incomplete.')
        const materialized = new Map(server.materialized.map((artifact) => [artifact.relativePath, artifact]))
        const allChanges = manifest.entries.filter((entry) => entry.status !== 'unchanged')
        const returnedEntries = allChanges.slice(0, context.options.limits.maxChanges)
        let previewBytes = 0
        const changes = returnedEntries.map((entry) => {
          const artifact = materialized.get(entry.path)
          const base = {
            outputRoot: server.outputRoot,
            path: entry.path,
            status: entry.status as 'added' | 'modified' | 'deleted',
            ...(artifact ? { artifactKind: artifact.kind } : {}),
            ...(entry.previousHash ? { beforeSha256: entry.previousHash } : {}),
            ...(entry.hash ? { afterSha256: entry.hash } : {}),
            ...(entry.bytes !== undefined ? { bytes: entry.bytes } : {}),
          }
          if (!input.includePreview || !artifact || artifact.kind === 'binary') return base
          const remaining = Math.max(0, context.options.limits.maxPreviewBytes - previewBytes)
          const maximum = Math.min(8192, remaining)
          const selected = artifact.content.slice(0, maximum)
          previewBytes += selected.byteLength
          return {
            ...base,
            ...(selected.byteLength ? { preview: new TextDecoder().decode(selected) } : {}),
            previewTruncated: selected.byteLength < artifact.content.byteLength,
          }
        })
        const diagnostics = [...prepared.run.diagnostics]
        if (changes.length < allChanges.length) diagnostics.push({ code: 'MCP_RESULT_TRUNCATED', severity: 'warning', message: `The plan summary omitted ${allChanges.length - changes.length} changes; the complete internal plan remains applyable.` })
        const selective = selectivePrepared?.selection
        const selectionLimit = Math.min(50, context.options.limits.maxChanges)
        const boundedSelection = selective
          ? {
              mutationType: selective.merge.mutationType,
              previousOperationKeys: selective.merge.previousOperationKeys.slice(0, selectionLimit),
              requestedOperationKeys: selective.merge.requestedOperationKeys.slice(0, selectionLimit),
              newlyAddedOperationKeys: selective.merge.newlyAddedOperationKeys.slice(0, selectionLimit),
              alreadySelectedOperationKeys: selective.merge.alreadySelectedOperationKeys.slice(0, selectionLimit),
              retainedOperationKeys: selective.merge.retainedOperationKeys.slice(0, selectionLimit),
              removedOperationKeys: selective.merge.removedOperationKeys.slice(0, selectionLimit),
              desiredOperationKeys: selective.merge.desiredOperationKeys.slice(0, selectionLimit),
              previousSelectionHash: selective.previousSelectionHash,
              desiredSelectionHash: selective.desiredSelectionHash,
              previousSelectionExists: selective.previousSelectionExists,
              counts: {
                previous: selective.merge.previousOperationKeys.length,
                requested: selective.merge.requestedOperationKeys.length,
                newlyAdded: selective.merge.newlyAddedOperationKeys.length,
                alreadySelected: selective.merge.alreadySelectedOperationKeys.length,
                retained: selective.merge.retainedOperationKeys.length,
                removed: selective.merge.removedOperationKeys.length,
                desired: selective.merge.desiredOperationKeys.length,
              },
              truncated: [
                selective.merge.previousOperationKeys,
                selective.merge.requestedOperationKeys,
                selective.merge.newlyAddedOperationKeys,
                selective.merge.alreadySelectedOperationKeys,
                selective.merge.retainedOperationKeys,
                selective.merge.removedOperationKeys,
                selective.merge.desiredOperationKeys,
              ].some((items) => items.length > selectionLimit),
            }
          : undefined
        if (boundedSelection?.truncated) diagnostics.push({ code: 'MCP_RESULT_TRUNCATED', severity: 'warning', message: 'The external selection summary was truncated; the complete desired selection remains bound in the internal applyable plan.' })
        const bounded = truncateDiagnostics(context.options.workspaceRoot, diagnostics, context.options.limits.maxDiagnostics)
        context.logger.info('generation_plan_created', {
          planId: prepared.stored.planId,
          planHashPrefix: prepared.stored.planHash.slice(0, 12),
          targetCount: 1,
          added: manifest.summary.added,
          modified: manifest.summary.modified,
          deleted: manifest.summary.deleted,
          bytes: server.materialized.reduce((total, artifact) => total + artifact.content.byteLength, 0),
        })
        const deletionNotice = manifest.summary.deleted ? ` The plan includes ${manifest.summary.deleted} managed file deletion(s).` : ''
        await execution.progress('Plan ready for explicit review', 100)
        return createToolResult(
          tool,
          {
            success: true,
            plan: {
              kind: selective ? 'selective' as const : 'full' as const,
              applySupported: true,
              planId: prepared.stored.planId,
              token: prepared.token,
              planHash: prepared.stored.planHash,
              createdAt: new Date(prepared.stored.createdAt).toISOString(),
              expiresAt: new Date(prepared.stored.expiresAt).toISOString(),
              targets: [prepared.stored.target],
              summary: {
                ...manifest.summary,
                totalBytesAfter: server.materialized.reduce((total, artifact) => total + artifact.content.byteLength, 0),
              },
              changes,
              ...(boundedSelection ? { selection: boundedSelection } : {}),
              ...(selective && prepared.run.projection?.projectionHash
                ? { projection: { projectionHash: prepared.run.projection.projectionHash, ...prepared.run.projection.stats } }
                : {}),
              truncated: {
                changes: changes.length < allChanges.length,
                returned: changes.length,
                total: allChanges.length,
                omitted: allChanges.length - changes.length,
                ...(boundedSelection ? { selection: boundedSelection.truncated } : {}),
              },
            },
            diagnostics: bounded.diagnostics,
            diagnosticSummary: bounded.summary,
            truncated: bounded.truncated,
          },
          selective
            ? `selective plan created for ${allChanges.length} change(s); no selection, generated file, or ownership manifest was written before explicit Apply approval.${deletionNotice}`
            : `plan created for ${allChanges.length} change(s); no files or ownership manifest were written.${deletionNotice}`,
          context.options.limits,
        )
      }, execution.signal)
    } catch (error) {
      return executionFailure(context.options.workspaceRoot, tool, [safeExecutionDiagnostic(error, execution)], context.options.limits)
    }
  })
}
