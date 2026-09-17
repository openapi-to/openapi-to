import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const bin = path.join(repositoryRoot, 'packages/mcp/bin/openapi-to-mcp.js')

function launch(args: string[] = []) {
  return spawn(process.execPath, [bin, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
}

function exited(child: ReturnType<typeof launch>, timeoutMs = 3_000): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MCP subprocess did not exit within its lifecycle deadline.')), timeoutMs)
    child.once('exit', (code) => { clearTimeout(timer); resolve(code) })
  })
}

describe('stdio subprocess lifecycle', { concurrent: false }, () => {
  it('exits cleanly on stdin EOF without protocol stdout pollution', async () => {
    const child = launch(['--workspace-root', repositoryRoot, '--log-level', 'silent'])
    let stdout = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stdin.end()
    expect(await exited(child)).toBe(0)
    expect(stdout).toBe('')
  })

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    it(`does not remain orphaned after ${signal}`, async () => {
      const child = launch(['--workspace-root', repositoryRoot, '--log-level', 'silent'])
      await new Promise((resolve) => setTimeout(resolve, 200))
      child.kill(signal)
      await expect(exited(child)).resolves.not.toBeUndefined()
    })
  }

  it('reports invalid startup arguments as bounded stderr diagnostics', async () => {
    const child = launch(['--unknown-option'])
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.stdin.end()
    expect(await exited(child)).toBe(1)
    expect(stderr).toContain('MCP_STARTUP_INVALID_ARGUMENT')
    expect(stderr).toContain('"phase":"parse-arguments"')
    expect(stdout).toBe('')
  })

  it('reports unavailable workspaces without leaking the requested path', async () => {
    const missingRoot = path.join(repositoryRoot, '.mcp-startup-missing-workspace')
    const child = launch(['--workspace-root', missingRoot])
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.stdin.end()
    expect(await exited(child)).toBe(1)
    expect(stderr).toContain('MCP_STARTUP_WORKSPACE_UNAVAILABLE')
    expect(stderr).toContain('"workspaceArgumentKind":"absolute"')
    expect(stderr).not.toContain(missingRoot)
    expect(stdout).toBe('')
  })

  it('classifies write configuration preflight failures separately from transport failures', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-mcp-config-preflight-'))
    await writeFile(path.join(root, 'openapi.yaml'), 'openapi: 3.1.0\ninfo: { title: Preflight, version: "1" }\npaths: {}\n')
    await writeFile(path.join(root, 'openapi.config.js'), `module.exports = { servers: [{ name: 'main', input: { path: './openapi.yaml' }, output: { base: 'workspace', dir: '../escape' } }] }\n`)
    const child = launch(['--workspace-root', root, '--config', path.join(root, 'openapi.config.js'), '--allow-write', '--log-format', 'json'])
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.stdin.end()
    expect(await exited(child)).toBe(1)
    expect(stderr).toContain('MCP_STARTUP_CONFIG_UNAVAILABLE')
    expect(stderr).toContain('"phase":"config-preflight"')
    expect(stderr).not.toContain(root)
    expect(stdout).toBe('')
  })
})
