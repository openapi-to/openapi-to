import { compileOpenAPI, hasDiagnosticErrors, inspectOpenAPIDocument } from '@openapi-to/core'
import { z } from 'zod'

import { safeExecutionDiagnostic } from '../errors.ts'
import { createToolResult, diagnosticSchema, diagnosticSummarySchema, executionFailure, truncateDiagnostics } from '../result.ts'
import { resolveToolSource, sanitizeSourceDisplay } from '../security/source.ts'
import { HTTP_METHODS, mapWorkspaceDiagnostics, record } from './common.ts'
import { detachedHandlerExtra, loggedToolCall, type McpHandlerExtra, type ToolContext } from './context.ts'

const operationSchema = z.object({ method: z.string(), path: z.string(), operationId: z.string().optional(), tags: z.array(z.string()), deprecated: z.boolean() })
export const inspectInputSchema = z.object({ source: z.string().min(1).max(4096), includeOperations: z.boolean().optional() }).meta({ additionalProperties: false })
export const inspectOutputSchema = z.object({
  schemaVersion: z.literal(1),
  tool: z.literal('openapi_inspect'),
  success: z.boolean(),
  source: z.string().optional(),
  inspection: z
    .object({
      openapiVersion: z.string().optional(),
      title: z.string().optional(),
      apiVersion: z.string().optional(),
      pathCount: z.number().int(),
      operationCount: z.number().int(),
      schemaCount: z.number().int(),
      tags: z.array(z.object({ name: z.string(), operationCount: z.number().int() })),
      methods: z.record(z.string(), z.number().int()),
      securitySchemes: z.array(z.string()),
      missingOperationIds: z.array(z.string()),
      deprecatedOperations: z.array(z.string()),
      externalReferenceCount: z.number().int(),
      supportClassification: z.object({ complete: z.array(z.string()), compatibleRead: z.array(z.string()), acceptedNotGenerated: z.array(z.string()), unsupported: z.array(z.string()) }).optional(),
      operations: z.array(operationSchema).optional(),
    })
    .optional(),
  diagnostics: z.array(diagnosticSchema),
  diagnosticSummary: diagnosticSummarySchema,
  truncated: z.object({
    diagnostics: z.boolean(),
    totalDiagnostics: z.number().int(),
    returnedDiagnostics: z.number().int(),
    omittedDiagnostics: z.number().int(),
    operations: z.boolean().optional(),
    totalOperations: z.number().int().optional(),
    returnedOperations: z.number().int().optional(),
    omittedOperations: z.number().int().optional(),
  }),
})

function operations(document: Record<string, unknown>, signal?: AbortSignal) {
  const result: Array<{ method: string; path: string; operationId?: string; tags: string[]; deprecated: boolean }> = []
  const paths = record(document.paths) ?? {}
  for (const pathName of Object.keys(paths).sort()) {
    if (signal?.aborted) throw signal.reason
    const pathItem = record(paths[pathName]) ?? {}
    for (const method of HTTP_METHODS) {
      const operation = record(pathItem[method])
      if (!operation) continue
      const tags = Array.isArray(operation.tags) ? operation.tags.filter((tag): tag is string => typeof tag === 'string').sort() : []
      result.push({
        method: method.toUpperCase(),
        path: pathName,
        ...(typeof operation.operationId === 'string' ? { operationId: operation.operationId } : {}),
        tags,
        deprecated: operation.deprecated === true,
      })
    }
  }
  const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)
  return result.sort((left, right) => compareText(left.path, right.path) || compareText(left.method, right.method) || compareText(left.operationId ?? '', right.operationId ?? ''))
}

function supportClassification(version: string | undefined) {
  return {
    complete: version?.startsWith('2.') || version?.startsWith('3.0') || version?.startsWith('3.1') ? ['load', 'parse', 'resolve', 'validate', 'inspect'] : [],
    compatibleRead: version?.startsWith('3.2') ? ['OpenAPI 3.2 load, parse, resolve, validate, normalize, and inspect'] : [],
    acceptedNotGenerated: version?.startsWith('3.2') ? ['Some OpenAPI 3.2 constructs may not participate in every generator plugin'] : [],
    unsupported: [],
  }
}

export async function inspectTool(context: ToolContext, input: z.infer<typeof inspectInputSchema>, extra: McpHandlerExtra = detachedHandlerExtra()) {
  const tool = 'openapi_inspect'
  return loggedToolCall(context, tool, extra, async (execution) => {
    let display = sanitizeSourceDisplay(context.options.workspaceRoot, input.source)
    try {
      const source = await resolveToolSource(context.options.workspaceRoot, input.source)
      display = source.display
      const compilation = await compileOpenAPI(source.value, { cwd: context.options.workspaceRoot, localFileRoot: context.options.workspaceRoot, remote: context.options.remote, signal: execution.signal })
      const diagnostics = mapWorkspaceDiagnostics(compilation.diagnostics)
      if (!compilation.document) return executionFailure(context.options.workspaceRoot, tool, diagnostics, context.options.limits, { source: display })
      const core = inspectOpenAPIDocument(compilation.document, compilation.references?.externalReferenceCount ?? 0, diagnostics, { signal: execution.signal })
      const allOperations = operations(compilation.document as Record<string, unknown>, execution.signal)
      const returnedOperations = input.includeOperations ? allOperations.slice(0, context.options.limits.maxChanges) : undefined
      if (returnedOperations && returnedOperations.length < allOperations.length) {
        diagnostics.push({ code: 'MCP_RESULT_TRUNCATED', severity: 'warning', message: `The result omitted ${allOperations.length - returnedOperations.length} operations because it exceeded the configured limit.` })
      }
      const finalBounded = truncateDiagnostics(context.options.workspaceRoot, diagnostics, context.options.limits.maxDiagnostics)
      const inspection = {
        openapiVersion: compilation.version ?? core.openapiVersion,
        ...(core.title ? { title: core.title } : {}),
        ...(core.apiVersion ? { apiVersion: core.apiVersion } : {}),
        pathCount: core.pathCount,
        operationCount: core.operationCount,
        schemaCount: core.schemaCount,
        tags: core.tags.map((tag) => ({ name: tag.name, operationCount: tag.operations })),
        methods: core.methodDistribution,
        securitySchemes: core.securitySchemes,
        missingOperationIds: core.missingOperationIds.map((operation) => `${operation.method} ${operation.path}`),
        deprecatedOperations: core.deprecatedOperations.map((operation) => `${operation.method} ${operation.path}${operation.operationId ? ` (${operation.operationId})` : ''}`),
        externalReferenceCount: core.externalReferenceCount,
        supportClassification: supportClassification(compilation.version),
        ...(returnedOperations ? { operations: returnedOperations } : {}),
      }
      const success = !hasDiagnosticErrors(diagnostics)
      return createToolResult(
        tool,
        {
          success,
          source: display,
          inspection,
          diagnostics: finalBounded.diagnostics,
          diagnosticSummary: finalBounded.summary,
          truncated: {
            ...finalBounded.truncated,
            ...(returnedOperations
              ? {
                  operations: returnedOperations.length < allOperations.length,
                  totalOperations: allOperations.length,
                  returnedOperations: returnedOperations.length,
                  omittedOperations: allOperations.length - returnedOperations.length,
                }
              : {}),
          },
        },
        `${core.pathCount} path(s), ${core.operationCount} operation(s), ${core.schemaCount} schema(s); no document body returned`,
        context.options.limits,
        !success,
      )
    } catch (error) {
      return executionFailure(context.options.workspaceRoot, tool, [safeExecutionDiagnostic(error, execution)], context.options.limits, { source: display })
    }
  })
}
