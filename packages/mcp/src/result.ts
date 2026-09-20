import {
  sortDiagnostics,
  summarizeDiagnostics,
  type Diagnostic,
  type DiagnosticSummary,
} from '@openapi-to/core'
import { z } from 'zod'

import type { ResolvedMcpLimits } from './options.ts'
import { sanitizeSourceDisplay } from './security/source.ts'

export const diagnosticSchema = z.object({
  code: z.string(),
  severity: z.enum(['error', 'warning', 'info']),
  message: z.string(),
  location: z
    .object({
      source: z.string().optional(),
      path: z.array(z.union([z.string(), z.number()])).optional(),
      line: z.number().int().optional(),
      column: z.number().int().optional(),
    })
    .optional(),
  hint: z.string().optional(),
  plugin: z.string().optional(),
  cause: z.string().optional(),
})

export const diagnosticSummarySchema = z.object({ errors: z.number().int(), warnings: z.number().int(), infos: z.number().int() })

export interface DiagnosticTruncation {
  diagnostics: boolean
  totalDiagnostics: number
  returnedDiagnostics: number
  omittedDiagnostics: number
}

export function sanitizeDiagnostics(workspaceRoot: string, diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const safeText = (value: string, limit: number) =>
    value
      .replaceAll(workspaceRoot, '.')
      .replace(/(?:https?:\/\/)[^\s]+/g, '[redacted URL]')
      .replace(/\b(authorization|cookie|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
      .slice(0, limit)
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: safeText(diagnostic.message, 1000),
    ...(diagnostic.location
      ? {
          location: {
            ...diagnostic.location,
            ...(diagnostic.location.source ? { source: sanitizeSourceDisplay(workspaceRoot, diagnostic.location.source) } : {}),
          },
        }
      : {}),
    ...(diagnostic.hint ? { hint: safeText(diagnostic.hint, 1000) } : {}),
    ...(diagnostic.plugin ? { plugin: diagnostic.plugin } : {}),
    ...(diagnostic.cause ? { cause: safeText(diagnostic.cause, 500) } : {}),
  }))
}

export function truncateDiagnostics(
  workspaceRoot: string,
  diagnostics: readonly Diagnostic[],
  limit: number,
): { diagnostics: Diagnostic[]; summary: DiagnosticSummary; truncated: DiagnosticTruncation } {
  const sanitized = sortDiagnostics(sanitizeDiagnostics(workspaceRoot, diagnostics))
  const needsTruncation = sanitized.length > limit
  const all = needsTruncation
    ? sortDiagnostics([
        ...sanitized,
        {
          code: 'MCP_RESULT_TRUNCATED',
          severity: 'warning' as const,
          message: `The result omitted ${sanitized.length - limit + 1} diagnostics because it exceeded the configured limit.`,
        },
      ])
    : sanitized
  const returned = all.slice(0, limit)
  return {
    diagnostics: returned,
    summary: summarizeDiagnostics(all),
    truncated: {
      diagnostics: all.length > returned.length,
      totalDiagnostics: all.length,
      returnedDiagnostics: returned.length,
      omittedDiagnostics: all.length - returned.length,
    },
  }
}

export function createTextSummary(tool: string, success: boolean, detail: string): string {
  return `${tool}: ${success ? 'success' : 'error'} — ${detail}`.slice(0, 1000)
}

export function createToolResult(
  tool: string,
  payload: Record<string, unknown>,
  summary: string,
  limits: ResolvedMcpLimits,
  isError = false,
): { isError?: true; content: Array<{ type: 'text'; text: string }>; structuredContent: Record<string, unknown> } {
  const structuredContent = { schemaVersion: 1, tool, ...payload }
  if (Buffer.byteLength(JSON.stringify(structuredContent)) > limits.maxTextBytes) {
    const tooLarge = {
      schemaVersion: 1,
      tool,
      success: false,
      diagnostics: [{ code: 'MCP_RESULT_TOO_LARGE', severity: 'error', message: 'The bounded result still exceeded the configured text size limit.' }],
      diagnosticSummary: { errors: 1, warnings: 0, infos: 0 },
      truncated: { diagnostics: false, totalDiagnostics: 1, returnedDiagnostics: 1, omittedDiagnostics: 0 },
    }
    return {
      isError: true,
      content: [{ type: 'text', text: createTextSummary(tool, false, 'result exceeded the configured size limit') }],
      structuredContent: tooLarge,
    }
  }
  return {
    ...(isError ? { isError: true as const } : {}),
    content: [{ type: 'text', text: createTextSummary(tool, !isError, summary) }],
    structuredContent,
  }
}

export function executionFailure(
  workspaceRoot: string,
  tool: string,
  diagnostics: readonly Diagnostic[],
  limits: ResolvedMcpLimits,
  extra: Record<string, unknown> = {},
  truncatedExtra: Record<string, unknown> = {},
) {
  const bounded = truncateDiagnostics(workspaceRoot, diagnostics, limits.maxDiagnostics)
  return createToolResult(
    tool,
    { success: false, ...extra, diagnostics: bounded.diagnostics, diagnosticSummary: bounded.summary, truncated: { ...bounded.truncated, ...truncatedExtra } },
    `${bounded.summary.errors} error(s), ${bounded.summary.warnings} warning(s)`,
    limits,
    true,
  )
}
