import process from 'node:process'
import { realpathSync } from 'node:fs'
import path from 'node:path'

import { McpToolError } from './errors.ts'
import { safeLogData, safeLogText } from './logger.ts'

export type StartupPhase = 'parse-arguments' | 'resolve-server' | 'config-preflight' | 'connect-transport'
export type StartupFailureCode =
  | 'MCP_STARTUP_INVALID_ARGUMENT'
  | 'MCP_STARTUP_WORKSPACE_UNAVAILABLE'
  | 'MCP_STARTUP_CONFIG_UNAVAILABLE'
  | 'MCP_STARTUP_CONNECT_FAILED'
  | 'MCP_STARTUP_FAILED'

export interface StartupDiagnosticContext {
  phase: StartupPhase
  args: string[]
  mode: 'read-only' | 'write-enabled'
  logFormat?: 'text' | 'json'
}

export interface StartupDiagnostic {
  schemaVersion: 1
  event: 'startup_failed'
  phase: StartupPhase
  code: StartupFailureCode
  exitCode: 1
  mode: 'read-only' | 'write-enabled'
  workspaceArgumentKind: 'default' | 'relative' | 'absolute' | 'none'
  configArgumentKind: 'relative' | 'absolute' | 'none'
  cwdMatchesResolvedWorkspace?: boolean
}

export class StartupPhaseError extends Error {
  constructor(
    readonly phase: StartupPhase,
    readonly cause: unknown,
  ) {
    super('MCP startup failed.')
    this.name = 'StartupPhaseError'
  }
}

export class StartupConfigPreflightError extends Error {
  constructor(readonly cause: unknown) {
    super('MCP startup configuration preflight failed.')
    this.name = 'StartupConfigPreflightError'
  }
}

function optionValue(args: string[], name: string): string | undefined {
  const prefix = `${name}=`
  const inline = args.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function pathKind(value: string | undefined): 'relative' | 'absolute' | 'none' {
  if (value === undefined || value.length === 0) return 'none'
  return path.isAbsolute(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) ? 'absolute' : 'relative'
}

function isPathResolutionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && ['EACCES', 'EINVAL', 'ELOOP', 'ENAMETOOLONG', 'ENOENT', 'ENOTDIR', 'EPERM'].includes(code)
}

function isInvalidArgument(error: unknown): boolean {
  return error instanceof RangeError || (error instanceof TypeError && typeof (error as { code?: unknown }).code === 'string' && String((error as { code?: unknown }).code).startsWith('ERR_PARSE_ARGS_'))
}

function cwdMatchesResolvedWorkspace(workspaceArgument: string | undefined): boolean | undefined {
  const candidate = workspaceArgument ?? process.cwd()
  try {
    return realpathSync.native(process.cwd()) === realpathSync.native(path.resolve(candidate))
  } catch {
    return undefined
  }
}

function failureCode(error: unknown, context: StartupDiagnosticContext): StartupFailureCode {
  if (context.phase === 'parse-arguments' || isInvalidArgument(error)) return 'MCP_STARTUP_INVALID_ARGUMENT'
  if (context.phase === 'resolve-server' && isPathResolutionError(error)) return 'MCP_STARTUP_WORKSPACE_UNAVAILABLE'
  if (context.phase === 'config-preflight') return 'MCP_STARTUP_CONFIG_UNAVAILABLE'
  if (error instanceof McpToolError && error.diagnostics[0]?.code === 'MCP_CONFIG_LOAD_FAILED') return 'MCP_STARTUP_CONFIG_UNAVAILABLE'
  if (context.phase === 'connect-transport') return 'MCP_STARTUP_CONNECT_FAILED'
  return 'MCP_STARTUP_FAILED'
}

export function classifyStartupFailure(error: unknown, context: StartupDiagnosticContext): StartupDiagnostic {
  const workspaceArgument = optionValue(context.args, '--workspace-root')
  const configArgument = optionValue(context.args, '--config')
  const diagnostic: StartupDiagnostic = {
    schemaVersion: 1,
    event: 'startup_failed',
    phase: context.phase,
    code: failureCode(error, context),
    exitCode: 1,
    mode: context.mode,
    workspaceArgumentKind: workspaceArgument === undefined ? 'default' : pathKind(workspaceArgument),
    configArgumentKind: pathKind(configArgument),
  }
  const cwdMatch = cwdMatchesResolvedWorkspace(workspaceArgument)
  if (cwdMatch !== undefined) diagnostic.cwdMatchesResolvedWorkspace = cwdMatch
  return diagnostic
}

export function writeStartupDiagnostic(error: unknown, context: StartupDiagnosticContext): void {
  const diagnostic = classifyStartupFailure(error, context)
  const safe = safeLogData(diagnostic) as Record<string, unknown>
  if (context.logFormat === 'json') {
    process.stderr.write(`${JSON.stringify({ level: 'error', ...safe })}\n`)
    return
  }
  process.stderr.write(`[openapi-to-mcp] ERROR ${safeLogText(`${diagnostic.code} during ${diagnostic.phase}`, 200)} ${JSON.stringify(safe)}\n`)
}
