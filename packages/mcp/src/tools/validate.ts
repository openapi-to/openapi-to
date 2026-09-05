import { compileOpenAPI, hasDiagnosticErrors, type Diagnostic } from '@openapi-to/core'
import { z } from 'zod'

import { safeExecutionDiagnostic } from '../errors.ts'
import { createToolResult, diagnosticSchema, diagnosticSummarySchema, executionFailure, truncateDiagnostics } from '../result.ts'
import { resolveToolSource, sanitizeSourceDisplay } from '../security/source.ts'
import { mapWorkspaceDiagnostics } from './common.ts'
import { detachedHandlerExtra, loggedToolCall, type McpHandlerExtra, type ToolContext } from './context.ts'

export const validateInputSchema = z.object({ source: z.string().min(1).max(4096), failOnWarning: z.boolean().optional() }).meta({ additionalProperties: false })
export const validateOutputSchema = z.object({
  schemaVersion: z.literal(1),
  tool: z.literal('openapi_validate'),
  success: z.boolean(),
  source: z.string().optional(),
  openapiVersion: z.string().optional(),
  diagnostics: z.array(diagnosticSchema),
  diagnosticSummary: diagnosticSummarySchema,
  truncated: z.object({ diagnostics: z.boolean(), totalDiagnostics: z.number().int(), returnedDiagnostics: z.number().int(), omittedDiagnostics: z.number().int() }),
})

export async function validateTool(context: ToolContext, input: z.infer<typeof validateInputSchema>, extra: McpHandlerExtra = detachedHandlerExtra()) {
  const tool = 'openapi_validate'
  return loggedToolCall(context, tool, extra, async (execution) => {
    let display = sanitizeSourceDisplay(context.options.workspaceRoot, input.source)
    try {
      const source = await resolveToolSource(context.options.workspaceRoot, input.source)
      display = source.display
      const compilation = await compileOpenAPI(source.value, {
        cwd: context.options.workspaceRoot,
        localFileRoot: context.options.workspaceRoot,
        remote: context.options.remote,
        signal: execution.signal,
      })
      const diagnostics: Diagnostic[] = mapWorkspaceDiagnostics(compilation.diagnostics)
      if (input.failOnWarning && diagnostics.some((diagnostic) => diagnostic.severity === 'warning')) {
        diagnostics.push({ code: 'OPENAPI_WARNINGS_AS_ERRORS', severity: 'error', message: 'Validation warnings were treated as errors because failOnWarning was enabled.' })
      }
      const bounded = truncateDiagnostics(context.options.workspaceRoot, diagnostics, context.options.limits.maxDiagnostics)
      const success = !hasDiagnosticErrors(diagnostics)
      return createToolResult(
        tool,
        {
          success,
          source: display,
          ...(compilation.version ? { openapiVersion: compilation.version } : {}),
          diagnostics: bounded.diagnostics,
          diagnosticSummary: bounded.summary,
          truncated: bounded.truncated,
        },
        `${bounded.summary.errors} error(s), ${bounded.summary.warnings} warning(s), ${bounded.summary.infos} info message(s); no files modified`,
        context.options.limits,
        !success,
      )
    } catch (error) {
      return executionFailure(context.options.workspaceRoot, tool, [safeExecutionDiagnostic(error, execution)], context.options.limits, { source: display })
    }
  })
}
