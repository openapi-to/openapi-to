import { hasDiagnosticErrors, searchOperationCatalogWithMetadata, type Diagnostic } from '@openapi-to/core'
import { z } from 'zod'

import { safeExecutionDiagnostic } from '../errors.ts'
import { createToolResult, diagnosticSchema, diagnosticSummarySchema, executionFailure, truncateDiagnostics } from '../result.ts'
import { mapWorkspaceDiagnostics } from './common.ts'
import { detachedHandlerExtra, loggedToolCall, type McpHandlerExtra, type ToolContext } from './context.ts'

const searchItemSchema = z.object({
  operationKey: z.string(),
  operationId: z.string().optional(),
  method: z.string(),
  path: z.string(),
  tags: z.array(z.string()),
  summary: z.string().optional(),
  requestSchemaNames: z.array(z.string()),
  responseSchemaNames: z.array(z.string()),
  deprecated: z.boolean(),
  score: z.number(),
  matchReasons: z.array(z.string()),
})

export const searchOperationsInputSchema = z.object({
  target: z.string().min(1).max(200).optional(),
  query: z.string().min(1).max(2_000),
  methods: z.array(z.string().min(1).max(20)).max(20).optional(),
  tags: z.array(z.string().min(1).max(200)).max(50).optional(),
  includeDeprecated: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).meta({ additionalProperties: false })

export const searchOperationsOutputSchema = z.object({
  schemaVersion: z.literal(1),
  tool: z.literal('openapi_search_operations'),
  success: z.boolean(),
  target: z.string().optional(),
  query: z.string(),
  totalMatches: z.number().int(),
  items: z.array(searchItemSchema),
  diagnostics: z.array(diagnosticSchema),
  diagnosticSummary: diagnosticSummarySchema,
  truncated: z.object({
    diagnostics: z.boolean(),
    totalDiagnostics: z.number().int(),
    returnedDiagnostics: z.number().int(),
    omittedDiagnostics: z.number().int(),
    matches: z.boolean().optional(),
    totalMatches: z.number().int().optional(),
    returnedMatches: z.number().int().optional(),
    omittedMatches: z.number().int().optional(),
  }),
})

export async function searchOperationsTool(context: ToolContext, input: z.infer<typeof searchOperationsInputSchema>, extra: McpHandlerExtra = detachedHandlerExtra()) {
  const tool = 'openapi_search_operations'
  return loggedToolCall(context, tool, extra, async (execution) => {
    try {
      if (!context.targetCatalogs) throw new Error('Trusted target catalogs are unavailable.')
      const compiled = await context.targetCatalogs.get(input.target, execution.signal)
      const diagnostics: Diagnostic[] = mapWorkspaceDiagnostics(compiled.diagnostics)
      if (!compiled.success || !compiled.catalog) {
        return executionFailure(context.options.workspaceRoot, tool, diagnostics, context.options.limits, { target: compiled.target, query: input.query, totalMatches: 0, items: [] })
      }
      const searched = searchOperationCatalogWithMetadata(compiled.catalog, input.query, {
        limit: input.limit,
        methods: input.methods,
        tags: input.tags,
        includeDeprecated: input.includeDeprecated,
      })
      if (searched.truncated) {
        diagnostics.push({ code: 'MCP_RESULT_TRUNCATED', severity: 'warning', message: `The operation search omitted ${searched.totalMatches - searched.items.length} matches because it exceeded the requested limit.` })
      }
      const bounded = truncateDiagnostics(context.options.workspaceRoot, diagnostics, context.options.limits.maxDiagnostics)
      const items = searched.items.map(({ item, score, matchReasons }) => ({
        operationKey: item.operationKey,
        ...(item.operationId ? { operationId: item.operationId } : {}),
        method: item.method,
        path: item.path,
        tags: item.tags,
        ...(item.summary ? { summary: item.summary } : {}),
        requestSchemaNames: item.requestSchemaNames,
        responseSchemaNames: item.responseSchemaNames,
        deprecated: item.deprecated,
        score,
        matchReasons,
      }))
      const success = !hasDiagnosticErrors(diagnostics)
      return createToolResult(
        tool,
        {
          success,
          target: compiled.target,
          query: input.query,
          totalMatches: searched.totalMatches,
          items,
          diagnostics: bounded.diagnostics,
          diagnosticSummary: bounded.summary,
          truncated: {
            ...bounded.truncated,
            matches: searched.truncated,
            totalMatches: searched.totalMatches,
            returnedMatches: items.length,
            omittedMatches: searched.totalMatches - items.length,
          },
        },
        `${searched.totalMatches} match(es), ${items.length} returned; no OpenAPI document or schema body returned`,
        context.options.limits,
        !success,
      )
    } catch (error) {
      const diagnostic = safeExecutionDiagnostic(error, execution)
      return executionFailure(context.options.workspaceRoot, tool, [diagnostic], context.options.limits, { ...(input.target ? { target: input.target } : {}), query: input.query, totalMatches: 0, items: [] })
    }
  })
}
