import { realpathSync } from 'node:fs'
import path from 'node:path'

import { DEFAULT_MAX_SELECTION_BYTES } from '@openapi-to/core'

export interface OpenapiToMcpServerOptions {
  workspaceRoot: string
  configPath?: string
  /** Startup-selected MCP Generation v2 capability mode. */
  generationMode?: GenerationMode
  remote?: {
    allowedHosts?: string[]
    timeoutMs?: number
    maxResponseBytes?: number
    maxRedirects?: number
  }
  limits?: {
    maxDiagnostics?: number
    maxChanges?: number
    maxArtifacts?: number
    maxTextBytes?: number
    maxPreviewBytes?: number
  }
  timeouts?: OpenapiToMcpTimeoutOptions
  write?: OpenapiToMcpWriteOptions
  logFormat?: 'text' | 'json'
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent'
}

export interface OpenapiToMcpWriteOptions {
  planTtlMs?: number
  maxPlans?: number
  maxPlanBytes?: number
  maxTotalPlanBytes?: number
  maxFiles?: number
  maxBytes?: number
  lockWaitMs?: number
  commitTimeoutMs?: number
}

export interface OpenapiToMcpTimeoutOptions {
  validateMs?: number
  inspectMs?: number
  diffMs?: number
  generationMs?: number
}

export interface ResolvedMcpTimeouts {
  validateMs: number
  inspectMs: number
  diffMs: number
  generationMs: number
}

export interface ResolvedMcpLimits {
  maxDiagnostics: number
  maxChanges: number
  maxArtifacts: number
  maxTextBytes: number
  maxPreviewBytes: number
}

export interface ResolvedMcpWriteOptions {
  planTtlMs: number
  maxPlans: number
  maxPlanBytes: number
  maxTotalPlanBytes: number
  maxFiles: number
  maxBytes: number
  lockWaitMs: number
  commitTimeoutMs: number
}

export interface ResolvedMcpServerOptions extends Omit<OpenapiToMcpServerOptions, 'workspaceRoot' | 'limits' | 'timeouts' | 'write'> {
  workspaceRoot: string
  generationMode: GenerationMode
  limits: ResolvedMcpLimits
  timeouts: ResolvedMcpTimeouts
  write: ResolvedMcpWriteOptions
}

export type GenerationMode = 'developer' | 'read-only' | 'hardened'

const DEFAULT_LIMITS: ResolvedMcpLimits = {
  maxDiagnostics: 100,
  maxChanges: 500,
  maxArtifacts: 200,
  maxTextBytes: 256 * 1024,
  maxPreviewBytes: 32 * 1024,
}

export const DEFAULT_TIMEOUTS: ResolvedMcpTimeouts = {
  validateMs: 30_000,
  inspectMs: 30_000,
  diffMs: 45_000,
  generationMs: 60_000,
}

export const DEFAULT_WRITE_OPTIONS: ResolvedMcpWriteOptions = {
  planTtlMs: 5 * 60_000,
  maxPlans: 20,
  // A selective plan binds several complete derived sets plus the frozen
  // manifest. Keep the store bounded while allowing any legal 1 MiB selection.
  maxPlanBytes: 16 * DEFAULT_MAX_SELECTION_BYTES,
  maxTotalPlanBytes: 64 * DEFAULT_MAX_SELECTION_BYTES,
  maxFiles: 5_000,
  maxBytes: 256 * 1024 * 1024,
  lockWaitMs: 30_000,
  commitTimeoutMs: 60_000,
}

export const MIN_TOOL_TIMEOUT_MS = 100
export const MAX_TOOL_TIMEOUT_MS = 10 * 60_000

function positiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined ? fallback : Math.max(1, Math.floor(value))
}

function timeoutMilliseconds(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < MIN_TOOL_TIMEOUT_MS || value > MAX_TOOL_TIMEOUT_MS) {
    throw new RangeError(`${name} must be an integer from ${MIN_TOOL_TIMEOUT_MS} to ${MAX_TOOL_TIMEOUT_MS} milliseconds.`)
  }
  return value
}

function boundedInteger(name: string, value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`)
  return value
}

export function resolveMcpServerOptions(options: OpenapiToMcpServerOptions): ResolvedMcpServerOptions {
  const generationMode = options.generationMode ?? 'developer'
  if (!['developer', 'read-only', 'hardened'].includes(generationMode)) throw new RangeError('generationMode must be developer, read-only, or hardened.')
  if (generationMode !== 'developer' && !options.configPath) throw new RangeError(`${generationMode} generation mode requires a trusted startup configPath.`)
  const workspaceRoot = realpathSync.native(path.resolve(options.workspaceRoot))
  return {
    ...options,
    workspaceRoot,
    generationMode,
    remote: {
      allowedHosts: [...new Set(options.remote?.allowedHosts ?? [])].sort(),
      ...(options.remote?.timeoutMs !== undefined ? { timeoutMs: options.remote.timeoutMs } : {}),
      ...(options.remote?.maxResponseBytes !== undefined ? { maxResponseBytes: options.remote.maxResponseBytes } : {}),
      ...(options.remote?.maxRedirects !== undefined ? { maxRedirects: options.remote.maxRedirects } : {}),
    },
    limits: {
      maxDiagnostics: positiveInteger(options.limits?.maxDiagnostics, DEFAULT_LIMITS.maxDiagnostics),
      maxChanges: positiveInteger(options.limits?.maxChanges, DEFAULT_LIMITS.maxChanges),
      maxArtifacts: positiveInteger(options.limits?.maxArtifacts, DEFAULT_LIMITS.maxArtifacts),
      maxTextBytes: positiveInteger(options.limits?.maxTextBytes, DEFAULT_LIMITS.maxTextBytes),
      maxPreviewBytes: positiveInteger(options.limits?.maxPreviewBytes, DEFAULT_LIMITS.maxPreviewBytes),
    },
    timeouts: {
      validateMs: timeoutMilliseconds('timeouts.validateMs', options.timeouts?.validateMs, DEFAULT_TIMEOUTS.validateMs),
      inspectMs: timeoutMilliseconds('timeouts.inspectMs', options.timeouts?.inspectMs, DEFAULT_TIMEOUTS.inspectMs),
      diffMs: timeoutMilliseconds('timeouts.diffMs', options.timeouts?.diffMs, DEFAULT_TIMEOUTS.diffMs),
      generationMs: timeoutMilliseconds('timeouts.generationMs', options.timeouts?.generationMs, DEFAULT_TIMEOUTS.generationMs),
    },
    write: {
      planTtlMs: boundedInteger('write.planTtlMs', options.write?.planTtlMs, DEFAULT_WRITE_OPTIONS.planTtlMs, 1_000, 60 * 60_000),
      maxPlans: boundedInteger('write.maxPlans', options.write?.maxPlans, DEFAULT_WRITE_OPTIONS.maxPlans, 1, 100),
      maxPlanBytes: boundedInteger('write.maxPlanBytes', options.write?.maxPlanBytes, DEFAULT_WRITE_OPTIONS.maxPlanBytes, 64 * 1024, 64 * 1024 * 1024),
      maxTotalPlanBytes: boundedInteger('write.maxTotalPlanBytes', options.write?.maxTotalPlanBytes, DEFAULT_WRITE_OPTIONS.maxTotalPlanBytes, 64 * 1024, 512 * 1024 * 1024),
      maxFiles: boundedInteger('write.maxFiles', options.write?.maxFiles, DEFAULT_WRITE_OPTIONS.maxFiles, 1, 50_000),
      maxBytes: boundedInteger('write.maxBytes', options.write?.maxBytes, DEFAULT_WRITE_OPTIONS.maxBytes, 1024, 1024 * 1024 * 1024),
      lockWaitMs: boundedInteger('write.lockWaitMs', options.write?.lockWaitMs, DEFAULT_WRITE_OPTIONS.lockWaitMs, 100, MAX_TOOL_TIMEOUT_MS),
      commitTimeoutMs: boundedInteger('write.commitTimeoutMs', options.write?.commitTimeoutMs, DEFAULT_WRITE_OPTIONS.commitTimeoutMs, 100, MAX_TOOL_TIMEOUT_MS),
    },
    logFormat: options.logFormat ?? 'text',
    logLevel: options.logLevel ?? 'info',
  }
}
