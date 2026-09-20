import {
  isOpenapiOperationCancelled,
  OutputCommitTimeoutError,
  OutputPreconditionChangedError,
  OutputRecoveryRequiredError,
  OutputTransactionRollbackError,
  OutputTransactionRolledBackError,
  OutputWriteLockedError,
  GenerationIntentError,
  TransactionStateFileError,
  type Diagnostic,
} from '@openapi-to/core'
import type { ToolExecutionContext } from './tools/context.ts'

export class McpToolError extends Error {
  readonly diagnostics: Diagnostic[]

  constructor(code: string, message: string, hint?: string) {
    super(message)
    this.name = 'McpToolError'
    this.diagnostics = [{ code, severity: 'error', message, ...(hint ? { hint } : {}) }]
  }
}

export function safeExecutionDiagnostic(error: unknown, execution?: ToolExecutionContext): Diagnostic {
  if (error instanceof McpToolError && error.diagnostics[0]) return error.diagnostics[0]
  if (error instanceof OutputWriteLockedError) return { code: 'MCP_WRITE_LOCKED', severity: 'error', message: 'Another CLI or MCP process currently holds the output write lock.', hint: 'Wait for that writer to finish, then prepare a new plan if output state changed.' }
  if (error instanceof TransactionStateFileError) return { code: error.code, severity: 'error', message: 'A controlled generation state file failed transaction validation or recovery.', hint: 'Preserve the transaction journal and prepare a new plan after reviewing the trusted state path and storage.' }
  if (error instanceof GenerationIntentError) return { code: error.code, severity: 'error', message: 'The Core Generation Intent state is invalid or could not be applied safely.', hint: 'Review the Generation Intent state and prepare a new plan.' }
  if (error instanceof OutputRecoveryRequiredError) return { code: 'MCP_WRITE_RECOVERY_REQUIRED', severity: 'error', message: 'An incomplete or unsafe generation transaction requires recovery before another Apply.', hint: 'Do not delete the journal manually; follow the documented recovery procedure.' }
  if (error instanceof OutputPreconditionChangedError) return { code: 'MCP_PLAN_FILE_CHANGED', severity: 'error', message: 'A planned output path changed before the transaction could commit.', hint: 'Prepare and review a new plan.' }
  if (error instanceof OutputTransactionRollbackError) return { code: 'MCP_WRITE_ROLLBACK_FAILED', severity: 'error', message: 'The write transaction failed and automatic rollback could not prove complete restoration.', hint: 'Stop writers and follow the transaction journal recovery procedure.' }
  if (error instanceof OutputTransactionRolledBackError && error.originalError instanceof OutputCommitTimeoutError) return { code: 'MCP_WRITE_COMMIT_TIMEOUT', severity: 'error', message: 'The transaction commit deadline expired and the writer restored the prior output state.', hint: 'Verify output storage health and prepare a new plan before retrying.' }
  if (error instanceof OutputTransactionRolledBackError) return { code: 'MCP_WRITE_APPLY_FAILED', severity: 'error', message: 'The Apply transaction failed after commit began and restored the prior output state.', hint: 'Review storage health and prepare a new plan before trying again.' }
  if (error instanceof OutputCommitTimeoutError) return { code: 'MCP_WRITE_COMMIT_TIMEOUT', severity: 'error', message: 'The transaction commit deadline expired and the writer rolled back the Apply.', hint: 'Verify output storage health and prepare a new plan before retrying.' }
  if (execution?.timedOut || error instanceof McpToolTimeoutError) {
    return { code: 'MCP_TOOL_TIMEOUT', severity: 'error', message: 'The MCP Server time limit expired before the tool completed.', hint: 'Narrow the request or ask the server operator to review the startup timeout policy.' }
  }
  if (execution?.signal.aborted || isOpenapiOperationCancelled(error) || error instanceof McpRequestCancelledError) {
    return { code: 'MCP_REQUEST_CANCELLED', severity: 'error', message: 'The MCP tool request was cancelled before it completed.' }
  }
  return {
    code: 'MCP_TOOL_EXECUTION_FAILED',
    severity: 'error',
    message: 'The MCP tool could not complete the requested operation.',
  }
}

export class McpRequestCancelledError extends Error {
  constructor() {
    super('MCP request cancelled.')
    this.name = 'McpRequestCancelledError'
  }
}

export class McpToolTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super('MCP tool timeout expired.')
    this.name = 'McpToolTimeoutError'
  }
}
