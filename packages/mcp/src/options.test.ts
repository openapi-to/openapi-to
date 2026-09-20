import { realpathSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_WRITE_OPTIONS, MAX_TOOL_TIMEOUT_MS, MIN_TOOL_TIMEOUT_MS, resolveMcpServerOptions } from './options.ts'

describe('MCP timeout options', () => {
  it('uses bounded startup-owned defaults', () => {
    const options = resolveMcpServerOptions({ workspaceRoot: process.cwd() })
    expect(options.workspaceRoot).toBe(realpathSync.native(path.resolve(process.cwd())))
    expect(options.timeouts).toEqual({ validateMs: 30_000, inspectMs: 30_000, diffMs: 45_000, generationMs: 60_000 })
    expect(options.write).toEqual(DEFAULT_WRITE_OPTIONS)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 99.5, MAX_TOOL_TIMEOUT_MS + 1])('rejects unsafe timeout %s', (value) => {
    expect(() => resolveMcpServerOptions({ workspaceRoot: process.cwd(), timeouts: { validateMs: value } })).toThrow(/milliseconds/)
  })

  it('accepts the documented timeout boundaries', () => {
    expect(resolveMcpServerOptions({ workspaceRoot: process.cwd(), timeouts: { validateMs: MIN_TOOL_TIMEOUT_MS, generationMs: MAX_TOOL_TIMEOUT_MS } }).timeouts).toMatchObject({ validateMs: MIN_TOOL_TIMEOUT_MS, generationMs: MAX_TOOL_TIMEOUT_MS })
  })

	it('uses developer by default and requires trusted config for non-developer modes', () => {
		expect(resolveMcpServerOptions({ workspaceRoot: process.cwd() }).generationMode).toBe('developer')
		expect(() => resolveMcpServerOptions({ workspaceRoot: process.cwd(), generationMode: 'read-only' })).toThrow(/configPath/)
		expect(resolveMcpServerOptions({ workspaceRoot: process.cwd(), configPath: 'package.json', generationMode: 'hardened' }).generationMode).toBe('hardened')
	})

  it('preserves operator remote upper bounds without accepting headers', () => {
    expect(
      resolveMcpServerOptions({
        workspaceRoot: process.cwd(),
        remote: {
          allowPrivateNetwork: true,
          allowedHosts: ['schemas.example.com', 'api.example.com', 'api.example.com'],
          timeoutMs: 5_000,
          maxResponseBytes: 2_000_000,
          maxRedirects: 2,
        },
      }).remote,
    ).toEqual({
      allowPrivateNetwork: true,
      allowedHosts: ['api.example.com', 'schemas.example.com'],
      timeoutMs: 5_000,
      maxResponseBytes: 2_000_000,
      maxRedirects: 2,
    })
  })

  it.each([
    { planTtlMs: 999 },
    { maxPlans: 0 },
    { maxPlanBytes: 1 },
    { maxTotalPlanBytes: Number.POSITIVE_INFINITY },
    { maxFiles: -1 },
    { maxBytes: 0 },
    { lockWaitMs: 99 },
    { commitTimeoutMs: MAX_TOOL_TIMEOUT_MS + 1 },
  ])('rejects unsafe controlled-write option $write', (write) => {
    expect(() => resolveMcpServerOptions({ workspaceRoot: process.cwd(), write })).toThrow(/must be an integer/)
  })
})
