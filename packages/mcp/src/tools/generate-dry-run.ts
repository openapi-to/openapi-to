import { z } from 'zod'

import { McpToolError, safeExecutionDiagnostic } from '../errors.ts'
import { executeGeneration, executeSelectiveGeneration, generationSucceeded, manifestHash } from '../generation/service.ts'
import { createToolResult, diagnosticSchema, diagnosticSummarySchema, executionFailure, truncateDiagnostics } from '../result.ts'
import { detachedHandlerExtra, loggedToolCall, type McpHandlerExtra, type ToolContext } from './context.ts'

const generationScopeSchema = z.union([
  z.object({ type: z.literal('full') }).meta({ additionalProperties: false }),
  z.object({ type: z.literal('operations'), operationKeys: z.array(z.string().min(1).max(500)).max(100) }).meta({ additionalProperties: false }),
])
export const generateDryRunInputSchema = z.object({
  targets: z.array(z.string().min(1).max(200)).max(100).optional(),
  scope: generationScopeSchema.optional(),
  includePreview: z.boolean().optional(),
}).meta({ additionalProperties: false })
const artifactSchema = z.object({
  path: z.string(), kind: z.string(), bytes: z.number().int(), sha256: z.string().optional(),
  status: z.enum(['added', 'modified', 'deleted', 'unchanged']), preview: z.string().optional(), previewTruncated: z.boolean().optional(),
})
export const generateDryRunOutputSchema = z.object({
  schemaVersion: z.literal(1), tool: z.literal('openapi_generate_dry_run'), success: z.boolean(), mode: z.literal('dry-run').optional(),
  config: z.object({ path: z.string(), targets: z.array(z.string()) }).optional(),
  scope: z.object({
    type: z.literal('operations'),
    requestedOperationKeys: z.array(z.string()),
    resolvedOperationKeys: z.array(z.string()),
  }).optional(),
  projection: z.object({
    operationCount: z.number().int(), pathCount: z.number().int(), schemaCount: z.number().int(), parameterCount: z.number().int(),
    requestBodyCount: z.number().int(), responseCount: z.number().int(), headerCount: z.number().int(), securitySchemeCount: z.number().int(),
    callbackCount: z.number().int(), linkCount: z.number().int(), exampleCount: z.number().int(), projectionHash: z.string().optional(),
  }).optional(),
  servers: z.array(z.object({
    name: z.string(), source: z.string().optional(), outputRoot: z.string().optional(),
    manifest: z.object({ artifactCount: z.number().int(), totalBytes: z.number().int(), hash: z.string().optional(), artifacts: z.array(artifactSchema) }),
    summary: z.object({ added: z.number().int(), modified: z.number().int(), deleted: z.number().int(), unchanged: z.number().int() }),
  })).optional(),
  diagnostics: z.array(diagnosticSchema), diagnosticSummary: diagnosticSummarySchema,
  truncated: z.object({
    diagnostics: z.boolean(), totalDiagnostics: z.number().int(), returnedDiagnostics: z.number().int(), omittedDiagnostics: z.number().int(),
    artifacts: z.boolean().optional(), totalArtifacts: z.number().int().optional(), returnedArtifacts: z.number().int().optional(), omittedArtifacts: z.number().int().optional(), previews: z.boolean().optional(), omittedPreviewBytes: z.number().int().optional(),
  }),
})

export async function generateDryRunTool(context: ToolContext, input: z.infer<typeof generateDryRunInputSchema>, extra: McpHandlerExtra = detachedHandlerExtra()) {
  const tool = 'openapi_generate_dry_run'
  return loggedToolCall(context, tool, extra, async (execution) => {
    try {
      return await context.generationLock.run(async () => {
        if (input.scope?.type === 'operations' && !context.targetCatalogs) {
          throw new McpToolError('MCP_CONFIG_LOAD_FAILED', 'Selective generation requires a startup-trusted target registry.')
        }
        const run = input.scope?.type === 'operations'
          ? await executeSelectiveGeneration(
              context.trustedConfig,
              context.options,
              context.targetCatalogs as NonNullable<ToolContext['targetCatalogs']>,
              input.targets,
              input.scope,
              execution,
            )
          : await executeGeneration(context.trustedConfig, context.options, input.targets, 'dry-run', execution)
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
            if (!input.includePreview || !artifact || artifact.kind === 'binary') return base
            const remaining = Math.max(0, context.options.limits.maxPreviewBytes - previewBytes)
            const perFileLimit = Math.min(8192, remaining)
            const text = new TextDecoder().decode(artifact.content)
            const encoded = new TextEncoder().encode(text)
            if (perFileLimit === 0) {
              omittedPreviewBytes += encoded.byteLength
              return { ...base, previewTruncated: true }
            }
            const preview = new TextDecoder().decode(encoded.slice(0, perFileLimit))
            previewBytes += Math.min(encoded.byteLength, perFileLimit)
            omittedPreviewBytes += Math.max(0, encoded.byteLength - perFileLimit)
            return { ...base, preview, previewTruncated: encoded.byteLength > perFileLimit }
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
        if (returnedArtifacts < totalArtifacts) run.diagnostics.push({ code: 'MCP_RESULT_TRUNCATED', severity: 'warning', message: `The result omitted ${totalArtifacts - returnedArtifacts} artifacts because it exceeded the configured limit.` })
        if (omittedPreviewBytes > 0) run.diagnostics.push({ code: 'MCP_RESULT_TRUNCATED', severity: 'warning', message: `Artifact previews omitted ${omittedPreviewBytes} bytes because they exceeded the configured preview limit.` })
        const finalBounded = truncateDiagnostics(context.options.workspaceRoot, run.diagnostics, context.options.limits.maxDiagnostics)
        const success = generationSucceeded(run)
        await execution.progress('Preparing bounded result', 95)
        const result = createToolResult(
          tool,
          {
            success,
            mode: 'dry-run',
            config: { path: run.configPath, targets: run.targets },
            ...(run.selection ? { scope: { type: 'operations' as const, ...run.selection } } : {}),
            ...(run.projection ? { projection: { ...run.projection.stats, ...(run.projection.projectionHash ? { projectionHash: run.projection.projectionHash } : {}) } } : {}),
            servers,
            diagnostics: finalBounded.diagnostics,
            diagnosticSummary: finalBounded.summary,
            truncated: {
              ...finalBounded.truncated,
              artifacts: returnedArtifacts < totalArtifacts,
              totalArtifacts,
              returnedArtifacts,
              omittedArtifacts: totalArtifacts - returnedArtifacts,
              previews: omittedPreviewBytes > 0,
              omittedPreviewBytes,
            },
          },
          `${run.targets.length} target(s), ${totalArtifacts} planned artifact change(s); no files or ownership manifest written`,
          context.options.limits,
          !success,
        )
        await execution.progress('Complete', 100)
        return result
      }, execution.signal)
    } catch (error) {
      return executionFailure(context.options.workspaceRoot, tool, [safeExecutionDiagnostic(error, execution)], context.options.limits, { mode: 'dry-run', servers: [] })
    }
  })
}
