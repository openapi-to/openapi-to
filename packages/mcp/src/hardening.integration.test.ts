import { createServer, type Server } from 'node:http'
import type { ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterEach, describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const bin = path.join(repositoryRoot, 'packages/mcp/bin/openapi-to-mcp.js')

async function connect(workspaceRoot: string, args: string[] = []) {
  const stderr: string[] = []
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin, '--workspace-root', workspaceRoot, ...args],
    stderr: 'pipe',
  })
  transport.stderr?.on('data', (chunk) => stderr.push(String(chunk)))
  const client = new Client({ name: 'openapi-to-hardening-test', version: '1.0.0' })
  await client.connect(transport)
  return { client, transport, stderr }
}

async function slowSpecificationServer(delayMs = 2_000): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/yaml' })
      response.end('openapi: 3.1.0\ninfo: { title: Slow, version: "1" }\npaths: {}\n')
    }, delayMs).unref()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to bind fixture server.')
  return { server, url: `http://127.0.0.1:${address.port}/openapi.yaml` }
}

describe('MCP cancellation and timeout hardening', { concurrent: false }, () => {
  const clients: Client[] = []
  const servers: Server[] = []
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)))
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  })

  for (const tool of ['openapi_validate', 'openapi_inspect'] as const) {
    it(`cancels a slow remote ${tool} request and keeps the stdio server usable`, async () => {
      const slow = await slowSpecificationServer()
      servers.push(slow.server)
      const connected = await connect(repositoryRoot, ['--allow-private-network', '--allow-host', '127.0.0.1'])
      clients.push(connected.client)
      const controller = new AbortController()
      const pending = connected.client.callTool({ name: tool, arguments: { source: slow.url } }, undefined, { signal: controller.signal, timeout: 5_000 })
      setTimeout(() => controller.abort(), 50).unref()
      await expect(pending).rejects.toThrow(/abort/i)
      const next = await connected.client.callTool({ name: 'openapi_validate', arguments: { source: 'packages/mcp/src/fixtures/valid.yaml' } })
      expect(next.isError).not.toBe(true)
      expect(connected.stderr.join('')).not.toContain('AbortError:')
    })
  }

  it('cancels a slow diff and distinguishes a server timeout', async () => {
    const slow = await slowSpecificationServer()
    servers.push(slow.server)
    const connected = await connect(repositoryRoot, ['--allow-private-network', '--allow-host', '127.0.0.1', '--diff-timeout-ms', '5000'])
    clients.push(connected.client)
    const controller = new AbortController()
    const pending = connected.client.callTool({ name: 'openapi_diff', arguments: { before: slow.url, after: slow.url } }, undefined, { signal: controller.signal, timeout: 5_000 })
    setTimeout(() => controller.abort(), 50).unref()
    await expect(pending).rejects.toThrow(/abort/i)

    const timed = await connect(repositoryRoot, ['--allow-private-network', '--allow-host', '127.0.0.1', '--validate-timeout-ms', '100'])
    clients.push(timed.client)
    const result = await timed.client.callTool({ name: 'openapi_validate', arguments: { source: slow.url } }, undefined, { timeout: 2_000 })
    expect(result.isError).toBe(true)
    expect((result.structuredContent as { diagnostics: Array<{ code: string }> }).diagnostics.map(({ code }) => code)).toContain('MCP_TOOL_TIMEOUT')
  })

  it('cancels CPU-heavy local inspect and diff through resolver yield checkpoints', async () => {
    const connected = await connect(repositoryRoot)
    clients.push(connected.client)
    for (const request of [
      { name: 'openapi_inspect', arguments: { source: 'packages/mcp/src/evaluation/fixtures/pathological/bounded.json', includeOperations: true } },
      { name: 'openapi_diff', arguments: { before: 'packages/mcp/src/evaluation/fixtures/large/openapi.json', after: 'packages/mcp/src/evaluation/fixtures/pathological/bounded.json' } },
    ]) {
      const controller = new AbortController()
      const pending = connected.client.callTool(request, undefined, { signal: controller.signal, timeout: 5_000 })
      setTimeout(() => controller.abort(), 5).unref()
      await expect(pending).rejects.toThrow(/abort/i)
    }
    const next = await connected.client.callTool({ name: 'openapi_validate', arguments: { source: 'packages/mcp/src/fixtures/valid.yaml' } })
    expect(next.isError).not.toBe(true)
  })

  it('cancels generation while running and while queued, then releases the instance lock', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-mcp-cancel-generation-'))
    await mkdir(path.join(root, '.openapi-to'))
    await writeFile(path.join(root, 'openapi.yaml'), 'openapi: 3.1.0\ninfo: { title: Cancel, version: "1" }\npaths: {}\n')
    await writeFile(
      path.join(root, 'openapi.config.js'),
      `module.exports = { servers: [{ name: 'main', input: { path: './openapi.yaml' }, output: { dir: 'generated' } }], plugins: [{ name: 'slow', hooks: { async buildStart(ctx) { await new Promise((resolve, reject) => { const timer = setTimeout(resolve, 300); const abort = () => { clearTimeout(timer); reject(ctx.signal.reason); }; if (ctx.signal.aborted) abort(); else ctx.signal.addEventListener('abort', abort, { once: true }); }); ctx.addArtifact({ kind: 'text', path: ctx.openapiToSingleConfig.output.dir + '/result.txt', content: 'ok\\n' }); } } }] };\n`,
    )
    const connected = await connect(root, ['--config', 'openapi.config.js', '--generation-mode', 'read-only', '--generation-timeout-ms', '5000'])
    clients.push(connected.client)
    const first = connected.client.callTool({ name: 'openapi_generate', arguments: { target: 'main', selection: { type: 'full' } } }, undefined, { timeout: 5_000 })
    const queuedController = new AbortController()
    const queued = connected.client.callTool({ name: 'openapi_check_generation', arguments: { target: 'main' } }, undefined, { signal: queuedController.signal, timeout: 5_000 })
    setTimeout(() => queuedController.abort(), 50).unref()
    await expect(queued).rejects.toThrow(/abort/i)
    expect((await first).isError).not.toBe(true)

    const runningController = new AbortController()
    const running = connected.client.callTool({ name: 'openapi_generate', arguments: { target: 'main', selection: { type: 'full' } } }, undefined, { signal: runningController.signal, timeout: 5_000 })
    setTimeout(() => runningController.abort(), 50).unref()
    await expect(running).rejects.toThrow(/abort/i)
    const after = await connected.client.callTool({ name: 'openapi_generate', arguments: { target: 'main', selection: { type: 'full' } } }, undefined, { timeout: 5_000 })
    expect(after.isError).not.toBe(true)

    const progress: number[] = []
    const withProgress = await connected.client.callTool(
      { name: 'openapi_generate', arguments: { target: 'main', selection: { type: 'full' } }, _meta: { progressToken: 'generation-progress' } },
      undefined,
      { timeout: 5_000, onprogress: (notification) => { progress.push(notification.progress) } },
    )
    expect(withProgress.isError).not.toBe(true)
    expect(progress.length).toBeGreaterThan(1)
    expect(progress).toEqual([...progress].sort((left, right) => left - right))

    const timeoutServer = await connect(root, ['--config', 'openapi.config.js', '--generation-mode', 'read-only', '--generation-timeout-ms', '100'])
    clients.push(timeoutServer.client)
    const timedCheck = await timeoutServer.client.callTool({ name: 'openapi_check_generation', arguments: { target: 'main', basis: 'configured-full' } }, undefined, { timeout: 5_000 })
    expect(timedCheck.isError).toBe(true)
    expect((timedCheck.structuredContent as { diagnostics: Array<{ code: string }> }).diagnostics.map(({ code }) => code)).toContain('MCP_TOOL_TIMEOUT')
  })

  it('cleans an active request when the Client disconnects', async () => {
    const slow = await slowSpecificationServer()
    servers.push(slow.server)
    const connected = await connect(repositoryRoot, ['--allow-private-network', '--allow-host', '127.0.0.1'])
    const pending = connected.client.callTool({ name: 'openapi_validate', arguments: { source: slow.url } }, undefined, { timeout: 5_000 })
    await new Promise((resolve) => setTimeout(resolve, 50))
    const child = (connected.transport as unknown as { _process?: ChildProcess })._process
    child?.stdin?.end()
    await expect(pending).rejects.toThrow(/closed|abort/i)
  })
})
