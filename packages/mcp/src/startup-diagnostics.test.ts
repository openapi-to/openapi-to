import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { McpToolError } from './errors.ts'
import { classifyStartupFailure, writeStartupDiagnostic } from './startup-diagnostics.ts'

describe('MCP startup diagnostics', () => {
  afterEach(() => vi.restoreAllMocks())

  it('classifies argument, workspace, config, and transport failures without raw error data', () => {
    const common = { args: ['--workspace-root', 'consumer', '--config', 'openapi.config.ts'], mode: 'read-only' as const }
    expect(classifyStartupFailure(new TypeError('unknown option'), { ...common, phase: 'parse-arguments' })).toMatchObject({
      code: 'MCP_STARTUP_INVALID_ARGUMENT',
      phase: 'parse-arguments',
      workspaceArgumentKind: 'relative',
      configArgumentKind: 'relative',
    })
    expect(classifyStartupFailure(Object.assign(new Error('missing'), { code: 'ENOENT' }), { ...common, phase: 'resolve-server' })).toMatchObject({
      code: 'MCP_STARTUP_WORKSPACE_UNAVAILABLE',
      phase: 'resolve-server',
    })
	expect(classifyStartupFailure(new McpToolError('MCP_CONFIG_LOAD_FAILED', 'do not expose this'), { ...common, phase: 'config-preflight', mode: 'hardened' })).toMatchObject({
      code: 'MCP_STARTUP_CONFIG_UNAVAILABLE',
      phase: 'config-preflight',
		mode: 'hardened',
    })
    expect(classifyStartupFailure(new Error('token=secret /Users/alice/project'), { ...common, phase: 'connect-transport' })).toMatchObject({
      code: 'MCP_STARTUP_CONNECT_FAILED',
    })
  })

  it('emits bounded sanitized stderr diagnostics and never writes stdout', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    writeStartupDiagnostic(new Error('authorization=secret token=secret /Users/alice/project?token=secret'), {
      phase: 'connect-transport',
      args: ['--workspace-root', '/Users/alice/project', '--config', '/Users/alice/project/openapi.config.ts', '--log-format', 'json'],
      mode: 'read-only',
      logFormat: 'json',
    })
    const output = String(stderr.mock.calls[0]?.[0])
    expect(() => JSON.parse(output)).not.toThrow()
    expect(output).toContain('MCP_STARTUP_CONNECT_FAILED')
    expect(output).not.toContain('authorization=secret')
    expect(output).not.toContain('/Users/alice/project')
    expect(stdout).not.toHaveBeenCalled()
    expect(output.length).toBeLessThan(1_000)
  })
})
