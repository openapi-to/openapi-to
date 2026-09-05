import { getOperationContract, hasDiagnosticErrors, type Diagnostic } from '@openapi-to/core'
import { z } from 'zod'

import { safeExecutionDiagnostic } from '../errors.ts'
import { createToolResult, diagnosticSchema, diagnosticSummarySchema, executionFailure, truncateDiagnostics } from '../result.ts'
import { mapWorkspaceDiagnostics } from './common.ts'
import { detachedHandlerExtra, loggedToolCall, type McpHandlerExtra, type ToolContext } from './context.ts'

const schemaSummarySchema: z.ZodType = z.lazy(() => z.object({
  name: z.string().optional(),
  ref: z.string().optional(),
  type: z.union([z.string(), z.array(z.string())]).optional(),
  format: z.string().optional(),
  description: z.string().optional(),
  nullable: z.boolean().optional(),
  required: z.array(z.string()).optional(),
  enum: z.array(z.unknown()).optional(),
  properties: z.array(z.object({ name: z.string(), required: z.boolean(), schema: schemaSummarySchema })).optional(),
  items: schemaSummarySchema.optional(),
  allOf: z.array(schemaSummarySchema).optional(),
  oneOf: z.array(schemaSummarySchema).optional(),
  anyOf: z.array(schemaSummarySchema).optional(),
  additionalProperties: z.union([z.boolean(), schemaSummarySchema]).optional(),
  discriminator: z.object({ propertyName: z.string().optional(), mapping: z.record(z.string(), z.string()).optional() }).optional(),
  example: z.unknown().optional(),
  circular: z.boolean().optional(),
}))

const parameterSchema = z.object({ name: z.string(), in: z.enum(['path', 'query', 'header', 'cookie']), required: z.boolean(), description: z.string().optional(), schema: schemaSummarySchema.optional(), example: z.unknown().optional() })
const contentSchema = z.object({ contentType: z.string(), schema: schemaSummarySchema.optional(), example: z.unknown().optional() })
const contractSchema = z.object({
  operationKey: z.string(),
  operationId: z.string().optional(),
  method: z.string(),
  path: z.string(),
  tags: z.array(z.string()),
  summary: z.string().optional(),
  description: z.string().optional(),
  deprecated: z.boolean(),
  requestSchemaNames: z.array(z.string()),
  responseSchemaNames: z.array(z.string()),
  parameters: z.object({ path: z.array(parameterSchema), query: z.array(parameterSchema), header: z.array(parameterSchema), cookie: z.array(parameterSchema) }).optional(),
  requestBody: z.object({ required: z.boolean(), content: z.array(contentSchema) }).optional(),
  responses: z.array(z.object({ status: z.string(), description: z.string().optional(), success: z.boolean(), content: z.array(contentSchema) })).optional(),
  securityRequirements: z.array(z.record(z.string(), z.array(z.string()))).optional(),
  schemas: z.array(schemaSummarySchema).optional(),
})

export const getOperationInputSchema = z.object({
  target: z.string().min(1).max(200).optional(),
  operationKey: z.string().min(1).max(1_000),
  detail: z.enum(['summary', 'contract']).optional(),
  schemaDepth: z.number().int().min(0).max(10).optional(),
  maxSchemas: z.number().int().min(0).max(100).optional(),
  maxPropertiesPerSchema: z.number().int().min(0).max(500).optional(),
  includeExamples: z.boolean().optional(),
  maxBytes: z.number().int().min(1_024).max(1024 * 1024).optional(),
}).meta({ additionalProperties: false })

export const getOperationOutputSchema = z.object({
  schemaVersion: z.literal(1),
  tool: z.literal('openapi_get_operation'),
  success: z.boolean(),
  target: z.string().optional(),
  found: z.boolean(),
  detail: z.enum(['summary', 'contract']),
  operation: contractSchema.optional(),
  byteLength: z.number().int().nonnegative().optional(),
  diagnostics: z.array(diagnosticSchema),
  diagnosticSummary: diagnosticSummarySchema,
  truncated: z.object({
    diagnostics: z.boolean(),
    totalDiagnostics: z.number().int(),
    returnedDiagnostics: z.number().int(),
    omittedDiagnostics: z.number().int(),
    contract: z.boolean().optional(),
    reasons: z.array(z.string()).optional(),
    unresolvedSchemaRefs: z.array(z.string()).optional(),
  }),
})

function uniqueDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const keys = new Set<string>()
  return diagnostics.filter((diagnostic) => {
    const key = JSON.stringify(diagnostic)
    if (keys.has(key)) return false
    keys.add(key)
    return true
  })
}

export async function getOperationTool(context: ToolContext, input: z.infer<typeof getOperationInputSchema>, extra: McpHandlerExtra = detachedHandlerExtra()) {
  const tool = 'openapi_get_operation'
  const detail = input.detail ?? 'contract'
  return loggedToolCall(context, tool, extra, async (execution) => {
    try {
      if (!context.targetCatalogs) throw new Error('Trusted target catalogs are unavailable.')
      const compiled = await context.targetCatalogs.get(input.target, execution.signal)
      if (!compiled.success || !compiled.catalog) {
        return executionFailure(context.options.workspaceRoot, tool, mapWorkspaceDiagnostics(compiled.diagnostics), context.options.limits, { target: compiled.target, found: false, detail })
      }
      const contract = getOperationContract(compiled.catalog, input.operationKey, {
        detail,
        schemaDepth: input.schemaDepth,
        maxSchemas: input.maxSchemas,
        maxPropertiesPerSchema: input.maxPropertiesPerSchema,
        includeExamples: input.includeExamples,
        maxBytes: Math.min(input.maxBytes ?? 128 * 1024, Math.max(1_024, Math.floor(context.options.limits.maxTextBytes * 0.75))),
      })
      const diagnostics = mapWorkspaceDiagnostics(uniqueDiagnostics([...compiled.compilation.diagnostics, ...contract.diagnostics]))
      if (contract.truncated) diagnostics.push({ code: 'MCP_RESULT_TRUNCATED', severity: 'warning', message: `The operation contract was truncated by: ${contract.truncationReasons.join(', ')}.` })
      const bounded = truncateDiagnostics(context.options.workspaceRoot, diagnostics, context.options.limits.maxDiagnostics)
      const success = contract.found && !hasDiagnosticErrors(diagnostics)
      return createToolResult(
        tool,
        {
          success,
          target: compiled.target,
          found: contract.found,
          detail,
          ...(contract.operation ? { operation: contract.operation } : {}),
          byteLength: contract.byteLength,
          diagnostics: bounded.diagnostics,
          diagnosticSummary: bounded.summary,
          truncated: {
            ...bounded.truncated,
            contract: contract.truncated,
            reasons: contract.truncationReasons,
            unresolvedSchemaRefs: contract.unresolvedSchemaRefs,
          },
        },
        contract.found ? `${detail} for ${input.operationKey}; bounded related schemas only` : `operation key not found: ${input.operationKey}`,
        context.options.limits,
        !success,
      )
    } catch (error) {
      return executionFailure(context.options.workspaceRoot, tool, [safeExecutionDiagnostic(error, execution)], context.options.limits, { ...(input.target ? { target: input.target } : {}), found: false, detail })
    }
  })
}
