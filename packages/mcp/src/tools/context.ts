import type { McpLogger } from '../logger.ts'
import type { ResolvedMcpServerOptions } from '../options.ts'
import type { GenerationLock } from '../generation/generation-lock.ts'
import type { GenerationPlanStore } from '../generation/plan-store.ts'
import type { InternalGenerationWritePlan } from '../generation/write-plan.ts'
import type { TrustedConfigProvider } from '../generation/trusted-config.ts'
import type { TrustedTargetCatalogRegistry } from '../catalog/trusted-target-registry.ts'
import { McpRequestCancelledError, McpToolTimeoutError } from '../errors.ts'

export interface McpHandlerExtra {
  signal: AbortSignal
  _meta?: { progressToken?: string | number }
  sendNotification: (notification: { method: 'notifications/progress'; params: { progressToken: string | number; progress: number; total: number; message?: string } }) => Promise<void>
}

export interface ToolExecutionContext {
  signal: AbortSignal
  timedOut: boolean
  cancelled: boolean
  progress(stage: string, progress: number, total?: number): Promise<void>
}

export function detachedHandlerExtra(): McpHandlerExtra {
  return { signal: new AbortController().signal, sendNotification: async () => undefined }
}

export interface ToolContext {
  options: ResolvedMcpServerOptions
  generationMode?: ResolvedMcpServerOptions['generationMode']
  logger: McpLogger
  trustedConfig: TrustedConfigProvider
  targetCatalogs?: TrustedTargetCatalogRegistry
  generationLock: GenerationLock
  generationPlans?: GenerationPlanStore<InternalGenerationWritePlan>
}

function timeoutForTool(context: ToolContext, tool: string): number {
  if (tool === 'openapi_validate') return context.options.timeouts.validateMs
  if (['openapi_inspect', 'openapi_list_targets', 'openapi_search_operations', 'openapi_get_operation'].includes(tool)) return context.options.timeouts.inspectMs
  if (tool === 'openapi_diff') return context.options.timeouts.diffMs
  return context.options.timeouts.generationMs
}

export async function loggedToolCall<T>(context: ToolContext, tool: string, extra: McpHandlerExtra, operation: (execution: ToolExecutionContext) => Promise<T>): Promise<T> {
  const started = performance.now()
  const timeoutMs = timeoutForTool(context, tool)
  const controller = new AbortController()
  let timedOut = false
  let cancelled = false
  const cancel = () => {
    if (controller.signal.aborted) return
    cancelled = true
    controller.abort(new McpRequestCancelledError())
  }
  if (extra.signal.aborted) cancel()
  else extra.signal.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => {
    if (controller.signal.aborted) return
    timedOut = true
    controller.abort(new McpToolTimeoutError(timeoutMs))
  }, timeoutMs)
  timer.unref()
  let lastProgress = 0
  const progressToken = extra._meta?.progressToken
  const execution: ToolExecutionContext = {
    signal: controller.signal,
    get timedOut() { return timedOut },
    get cancelled() { return cancelled },
    async progress(stage, progress, total = 100) {
      if (progressToken === undefined || controller.signal.aborted) return
      const bounded = Math.max(lastProgress, Math.min(total, progress))
      lastProgress = bounded
      try {
        await extra.sendNotification({ method: 'notifications/progress', params: { progressToken, progress: bounded, total, message: stage.slice(0, 120) } })
      } catch {
        // Progress is advisory and must never fail the tool operation.
      }
    },
  }
  try {
    const result = await operation(execution)
    const payload = (result as { structuredContent?: Record<string, unknown> }).structuredContent
    const summary = payload?.diagnosticSummary as { errors?: number; warnings?: number; infos?: number } | undefined
    const truncated = payload?.truncated as Record<string, unknown> | undefined
    const success = payload?.success !== false
    const data = {
      tool,
      success,
      durationMs: Math.round(performance.now() - started),
      cancelled,
      timedOut,
      diagnosticCount: (summary?.errors ?? 0) + (summary?.warnings ?? 0) + (summary?.infos ?? 0),
      artifactCount: truncated?.totalArtifacts,
      changeCount: truncated?.totalChanges,
      truncated: truncated ? Object.entries(truncated).some(([key, value]) => !key.startsWith('total') && !key.startsWith('returned') && !key.startsWith('omitted') && value === true) : false,
    }
    if (success) context.logger.info('tool completed', data)
    else context.logger.warn('tool completed with execution error', data)
    return result
  } catch (error) {
    context.logger.warn('tool failed', { tool, success: false, durationMs: Math.round(performance.now() - started), cancelled, timedOut, error: error instanceof Error ? error.name : 'unknown' })
    throw error
  } finally {
    clearTimeout(timer)
    extra.signal.removeEventListener('abort', cancel)
  }
}
