import { acquireOutputWriteLock } from '@openapi-to/core'
import { z } from 'zod'

import { McpToolError, safeExecutionDiagnostic } from '../errors.ts'
import {
  executeGenerationIntent,
  generationSucceeded,
  manifestHash,
  type GenerationRun,
  type InternalGenerationRequest,
} from '../generation/service.ts'
import { commitGenerationRun } from '../generation/write-plan.ts'
import { createToolResult, diagnosticSchema, diagnosticSummarySchema, executionFailure, truncateDiagnostics } from '../result.ts'
import { detachedHandlerExtra, loggedToolCall, type McpHandlerExtra, type ToolContext } from './context.ts'

const operationKeySchema = z.string().min(1).max(500)
const generationSelectionSchema = z.union([
  z.object({ type: z.literal('full') }).strict(),
  z.object({
    type: z.literal('operations'),
    operationKeys: z.array(operationKeySchema).min(1).max(5_000),
    strategy: z.enum(['add', 'replace', 'ephemeral']),
  }).strict(),
])

const commonInputSchema = {
  target: z.string().min(1).max(200),
  selection: generationSelectionSchema,
  output: z.object({ root: z.string().min(1).max(500) }).strict().optional(),
  includePreview: z.boolean().optional(),
}

const developerInputSchema = z.object({
  ...commonInputSchema,
  mode: z.enum(['write', 'dry-run']).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.mode !== 'dry-run' && value.selection.type === 'operations' && value.selection.strategy === 'ephemeral') {
    ctx.addIssue({ code: 'custom', path: ['selection', 'strategy'], message: 'ephemeral selection requires mode: dry-run.' })
  }
})

const previewInputSchema = z.object({
  ...commonInputSchema,
  mode: z.literal('dry-run').optional(),
}).strict()

export function generateInputSchemaForMode(mode: ToolContext['generationMode']) {
  return mode === 'developer' ? developerInputSchema : previewInputSchema
}

export const openapiGenerateInputSchema = developerInputSchema

const artifactSchema = z.object({
  path: z.string(), kind: z.string(), bytes: z.number().int(), sha256: z.string().optional(),
  status: z.enum(['added', 'modified', 'deleted', 'unchanged']), preview: z.string().optional(), previewTruncated: z.boolean().optional(),
}).strict()

export const openapiGenerateOutputSchema = z.object({
  schemaVersion: z.literal(1), tool: z.literal('openapi_generate'), success: z.boolean(), mode: z.enum(['write', 'dry-run']), effect: z.enum(['write', 'preview']),
  target: z.string(), effectiveOutputRoot: z.string().optional(),
  intent: z.object({ state: z.enum(['full', 'operations', 'ephemeral']), selectedOperationCount: z.number().int().optional(), persisted: z.boolean() }).strict().optional(),
  selection: z.object({ type: z.enum(['full', 'operations']), strategy: z.enum(['add', 'replace', 'ephemeral']).optional(), requestedOperationKeys: z.array(z.string()), resolvedOperationKeys: z.array(z.string()).optional() }).strict().optional(),
  projection: z.object({
    operationCount: z.number().int(), pathCount: z.number().int(), schemaCount: z.number().int(), parameterCount: z.number().int(),
    requestBodyCount: z.number().int(), responseCount: z.number().int(), headerCount: z.number().int(), securitySchemeCount: z.number().int(),
    callbackCount: z.number().int(), linkCount: z.number().int(), exampleCount: z.number().int(), projectionHash: z.string().optional(),
  }).strict().optional(),
  config: z.object({ path: z.string(), target: z.string() }).strict().optional(),
  servers: z.array(z.object({
    name: z.string(), source: z.string().optional(), outputRoot: z.string().optional(),
    manifest: z.object({ artifactCount: z.number().int(), totalBytes: z.number().int(), hash: z.string().optional(), artifacts: z.array(artifactSchema) }).strict(),
    summary: z.object({ added: z.number().int(), modified: z.number().int(), deleted: z.number().int(), unchanged: z.number().int() }).strict(),
  }).strict()).optional(),
  transaction: z.object({ transactionId: z.string(), summary: z.object({ added: z.number().int(), modified: z.number().int(), deleted: z.number().int(), unchanged: z.number().int() }).strict(), changedFiles: z.array(z.object({ path: z.string(), status: z.enum(['added', 'modified']) }).strict()), deletedFiles: z.array(z.string()), rollbackPerformed: z.boolean(), cancelledDuringCommit: z.boolean() }).strict().optional(),
  diagnostics: z.array(diagnosticSchema), diagnosticSummary: diagnosticSummarySchema,
  truncated: z.object({
    diagnostics: z.boolean(), totalDiagnostics: z.number().int(), returnedDiagnostics: z.number().int(), omittedDiagnostics: z.number().int(),
    artifacts: z.boolean(), totalArtifacts: z.number().int(), returnedArtifacts: z.number().int(), omittedArtifacts: z.number().int(), previews: z.boolean(), omittedPreviewBytes: z.number().int(),
  }).strict(),
}).strict()

function requestForInput(input: z.infer<typeof developerInputSchema> | z.infer<typeof previewInputSchema>): InternalGenerationRequest {
  const selection = input.selection
  const mutation = selection.type === 'full'
    ? { type: 'full' as const }
    : selection.strategy === 'ephemeral'
      ? { type: 'ephemeral' as const, operationKeys: selection.operationKeys }
      : { type: 'operations' as const, strategy: selection.strategy, operationKeys: selection.operationKeys }
  return {
    target: input.target,
    mutation,
    ...(input.output ? { effectiveOutputRoot: input.output.root } : {}),
    execution: 'preview',
    mode: 'dry-run',
  }
}

function boundedServers(context: ToolContext, run: GenerationRun, includePreview: boolean) {
  let previewBytes = 0
  let omittedPreviewBytes = 0
  let totalArtifacts = 0
  let returnedArtifacts = 0
  let artifactBudget = context.options.limits.maxArtifacts
  const servers = run.servers.map((server) => {
    const manifest = server.result.generationResult?.manifest
    const entries = manifest?.entries ?? []
    totalArtifacts += entries.length
    const materialized = new Map(server.materialized.map((artifact) => [artifact.relativePath, artifact]))
    const artifacts = entries.slice(0, artifactBudget).map((entry) => {
      const artifact = materialized.get(entry.path)
      const base = {
        path: entry.path,
        kind: artifact?.kind ?? 'managed',
        bytes: entry.bytes ?? artifact?.content.byteLength ?? 0,
        ...(entry.hash ? { sha256: entry.hash } : {}),
        status: entry.status,
      }
      if (!includePreview || !artifact || artifact.kind === 'binary') return base
      const encoded = new TextEncoder().encode(new TextDecoder().decode(artifact.content))
      const remaining = Math.max(0, context.options.limits.maxPreviewBytes - previewBytes)
      const maximum = Math.min(8192, remaining)
      if (maximum === 0) {
        omittedPreviewBytes += encoded.byteLength
        return { ...base, previewTruncated: true }
      }
      const preview = new TextDecoder().decode(encoded.slice(0, maximum))
      previewBytes += Math.min(encoded.byteLength, maximum)
      omittedPreviewBytes += Math.max(0, encoded.byteLength - maximum)
      return { ...base, preview, previewTruncated: encoded.byteLength > maximum }
    })
    returnedArtifacts += artifacts.length
    artifactBudget -= artifacts.length
    return {
      name: server.name,
      source: server.source,
      outputRoot: server.outputRoot,
      manifest: {
        artifactCount: entries.length,
        totalBytes: entries.reduce((total, entry) => total + (entry.bytes ?? 0), 0),
        ...(entries.length ? { hash: manifestHash(entries) } : {}),
        artifacts,
      },
      summary: manifest?.summary ?? { added: 0, modified: 0, deleted: 0, unchanged: 0 },
    }
  })
  return { servers, totalArtifacts, returnedArtifacts, omittedPreviewBytes }
}

export async function openapiGenerateTool(
  context: ToolContext,
  input: z.infer<typeof developerInputSchema> | z.infer<typeof previewInputSchema>,
  extra: McpHandlerExtra = detachedHandlerExtra(),
) {
  const tool = 'openapi_generate'
  return loggedToolCall(context, tool, extra, async (execution) => {
    try {
      return await context.generationLock.run(async () => {
        const generationMode = context.generationMode ?? context.options.generationMode
        const mode: 'write' | 'dry-run' = generationMode === 'developer' && input.mode !== 'dry-run' ? 'write' : 'dry-run'
        if (mode === 'write' && input.selection.type === 'operations' && input.selection.strategy === 'ephemeral') {
          throw new McpToolError('GENERATION_EPHEMERAL_REQUIRES_DRY_RUN', 'ephemeral selection is preview-only and cannot be persisted.')
        }
        const request = { ...requestForInput(input), ...(mode === 'write' ? { enforceIntentBootstrap: true } : {}) }
        const registry = context.targetCatalogs
        if (request.mutation.type !== 'full' && !registry) throw new McpToolError('MCP_CONFIG_LOAD_FAILED', 'Selective generation requires a startup-trusted target registry.')
        let run = await executeGenerationIntent(context.trustedConfig, context.options, request, execution, registry)
        let transaction: Awaited<ReturnType<typeof commitGenerationRun>> | undefined
        if (mode === 'write' && generationSucceeded(run)) {
          const server = run.servers[0]
          if (!server?.result.generationResult) throw new McpToolError('MCP_TOOL_EXECUTION_FAILED', 'Generation did not produce a complete artifact plan.')
          const lock = await acquireOutputWriteLock(server.result.generationResult.manifest.outputRoot, {
            signal: execution.signal,
            waitTimeoutMs: context.options.write.lockWaitMs,
            recoveryContext: server.intent.recoveryContext,
          })
          try {
            run = await executeGenerationIntent(context.trustedConfig, context.options, { ...request, execution: 'apply-revalidate', enforceIntentBootstrap: false }, { ...execution, outputWriteLock: lock }, registry)
            if (generationSucceeded(run)) transaction = await commitGenerationRun(lock, run, context.options, context.logger, execution)
          } finally {
            await lock.release({ removeEmptyRoot: transaction === undefined })
          }
        }
        const effect = mode === 'write' ? 'write' as const : 'preview' as const
        const bounded = boundedServers(context, run, input.includePreview === true)
        if (bounded.returnedArtifacts < bounded.totalArtifacts) run.diagnostics.push({ code: 'MCP_RESULT_TRUNCATED', severity: 'warning', message: `The result omitted ${bounded.totalArtifacts - bounded.returnedArtifacts} artifacts because it exceeded the configured limit.` })
        if (bounded.omittedPreviewBytes > 0) run.diagnostics.push({ code: 'MCP_RESULT_TRUNCATED', severity: 'warning', message: `Artifact previews omitted ${bounded.omittedPreviewBytes} bytes because they exceeded the configured preview limit.` })
        const finalBounded = truncateDiagnostics(context.options.workspaceRoot, run.diagnostics, context.options.limits.maxDiagnostics)
        const success = generationSucceeded(run) && (mode === 'dry-run' || transaction !== undefined)
        const server = run.servers[0]
        const selection = run.selection
        const result = createToolResult(
          tool,
          {
            success,
            mode,
            effect,
            target: input.target,
            ...(server ? { effectiveOutputRoot: server.outputRoot } : {}),
            ...(server ? { intent: { state: server.intent.desired.scope.type === 'full' ? 'full' as const : selection?.mutationType === 'ephemeral' ? 'ephemeral' as const : 'operations' as const, ...(server.intent.desired.scope.type === 'operations' ? { selectedOperationCount: server.intent.desired.scope.operationKeys.length } : {}), persisted: selection?.mutationType !== 'ephemeral' } } : {}),
            selection: {
              type: input.selection.type,
              ...(input.selection.type === 'operations' ? { strategy: input.selection.strategy, requestedOperationKeys: [...new Set(input.selection.operationKeys)].sort(), resolvedOperationKeys: selection?.resolvedOperationKeys } : { requestedOperationKeys: [] }),
            },
            ...(run.projection ? { projection: { ...run.projection.stats, ...(run.projection.projectionHash ? { projectionHash: run.projection.projectionHash } : {}) } } : {}),
            config: { path: run.configPath, target: input.target },
            servers: bounded.servers,
            ...(transaction ? { transaction: { transactionId: transaction.transactionId, summary: transaction.summary, changedFiles: transaction.changedFiles.slice(0, context.options.limits.maxChanges), deletedFiles: transaction.deletedFiles.slice(0, context.options.limits.maxChanges), rollbackPerformed: transaction.rollbackPerformed, cancelledDuringCommit: transaction.cancelledDuringCommit } } : {}),
            diagnostics: finalBounded.diagnostics,
            diagnosticSummary: finalBounded.summary,
            truncated: {
              ...finalBounded.truncated,
              artifacts: bounded.returnedArtifacts < bounded.totalArtifacts,
              totalArtifacts: bounded.totalArtifacts,
              returnedArtifacts: bounded.returnedArtifacts,
              omittedArtifacts: bounded.totalArtifacts - bounded.returnedArtifacts,
              previews: bounded.omittedPreviewBytes > 0,
              omittedPreviewBytes: bounded.omittedPreviewBytes,
            },
          },
          mode === 'write' ? `${run.targets.length} target generated and committed atomically` : `${run.targets.length} target preview; no persistent state written`,
          context.options.limits,
          !success,
        )
        await execution.progress('Complete', 100)
        return result
      }, execution.signal)
    } catch (error) {
      return executionFailure(
        context.options.workspaceRoot,
        tool,
        [safeExecutionDiagnostic(error, execution)],
        context.options.limits,
        { mode: (context.generationMode ?? context.options.generationMode) === 'developer' && input.mode !== 'dry-run' ? 'write' : 'dry-run', effect: 'preview', target: input.target },
        { artifacts: false, totalArtifacts: 0, returnedArtifacts: 0, omittedArtifacts: 0, previews: false, omittedPreviewBytes: 0 },
      )
    }
  })
}
