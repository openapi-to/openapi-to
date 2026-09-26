import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterEach, describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const bin = path.join(repositoryRoot, 'packages/mcp/bin/openapi-to-mcp.js')

interface ConnectedClient {
  client: Client
  stderr: string[]
}

async function connect(workspaceRoot: string, configPath?: string, mode?: 'developer' | 'read-only' | 'hardened'): Promise<ConnectedClient> {
  const stderr: string[] = []
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin, '--workspace-root', workspaceRoot, ...(configPath ? ['--config', configPath] : []), ...(mode ? ['--generation-mode', mode] : [])],
    stderr: 'pipe',
  })
  transport.stderr?.on('data', (chunk) => stderr.push(String(chunk)))
  const client = new Client({ name: 'openapi-to-mcp-v2-test', version: '1.0.0' })
  await client.connect(transport)
  return { client, stderr }
}

function structured(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  return result.structuredContent as Record<string, unknown>
}

async function stateSnapshot(root: string): Promise<string> {
  const base = path.join(root, '.openapi-to')
  const files: Array<[string, string]> = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      const relative = path.relative(base, absolute).split(path.sep).join('/')
      if (entry.isDirectory()) {
        files.push([relative, '<directory>'])
        await visit(absolute)
      } else if (entry.isFile()) {
        files.push([relative, (await readFile(absolute)).toString('base64')])
      } else {
        files.push([relative, '<non-file>'])
      }
    }
  }
  await visit(base)
  return JSON.stringify(files.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
}

async function fixtureWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-mcp-v2-integration-'))
  await mkdir(path.join(root, '.openapi-to'))
  await writeFile(path.join(root, 'openapi.yaml'), `openapi: 3.1.0
info: { title: Generation v2, version: "1" }
paths:
  /ping:
    get:
      operationId: ping
      responses: { "200": { description: ok } }
  /pong:
    post:
      operationId: pong
      responses: { "201": { description: created } }
`)
  await writeFile(path.join(root, 'openapi.config.cjs'), `module.exports = {
  servers: [{ name: 'main', input: { path: './openapi.yaml' }, output: { dir: 'generated', clean: true } }],
  plugins: [{ name: 'generation-v2-fixture', hooks: {
    buildStart(ctx) { ctx.addArtifact({ kind: 'text', path: ctx.openapiToSingleConfig.output.dir + '/full.txt', content: 'full\\n' }) },
    operation(operation, ctx) { ctx.addArtifact({ kind: 'text', path: ctx.openapiToSingleConfig.output.dir + '/' + operation.accessor.operationId + '.txt', content: operation.accessor.operationId + '\\n' }) },
  } }],
};
`)
  return root
}

describe('stdio MCP Generation v2 server', { concurrent: false }, () => {
  const clients: Client[] = []
  const temporaryRoots: string[] = []

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)))
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('exposes exactly three no-config analysis Tools', async () => {
    const connected = await connect(repositoryRoot)
    clients.push(connected.client)
    const listed = await connected.client.listTools()
    expect(listed.tools.map(({ name }) => name)).toEqual(['openapi_validate', 'openapi_inspect', 'openapi_diff'])
    for (const tool of listed.tools) expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true })
  })

  it('loads caller-authorized HTTP roots through configured discovery and all analysis Tools', async () => {
    const root = await fixtureWorkspace()
    temporaryRoots.push(root)
    const document = await readFile(path.join(root, 'openapi.yaml'), 'utf8')
    const server = createServer((_request, response) => response.end(document))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/openapi.yaml?token=must-not-leak`
    try {
      const configFile = path.join(root, 'openapi.config.cjs')
      const config = await readFile(configFile, 'utf8')
      await writeFile(configFile, config.replace("path: './openapi.yaml'", `path: '${url}', remote: { allowedHosts: ['schemas.example.com'] }`))
      const connected = await connect(root, 'openapi.config.cjs')
      clients.push(connected.client)
      const targets = await connected.client.callTool({ name: 'openapi_list_targets', arguments: {} })
      expect(structured(targets)).toMatchObject({ success: true, targets: [{ name: 'main' }] })
      const search = await connected.client.callTool({ name: 'openapi_search_operations', arguments: { target: 'main', query: 'ping' } })
      expect(structured(search)).toMatchObject({ success: true, items: [expect.objectContaining({ operationId: 'ping' })] })
      const contract = await connected.client.callTool({ name: 'openapi_get_operation', arguments: { target: 'main', operationKey: 'ping' } })
      expect(structured(contract)).toMatchObject({ success: true, found: true })
      for (const name of ['openapi_validate', 'openapi_inspect'] as const) {
        const result = await connected.client.callTool({ name, arguments: { source: url } })
        expect(structured(result).success).toBe(true)
        expect(JSON.stringify(result)).not.toContain('must-not-leak')
      }
      const diff = await connected.client.callTool({ name: 'openapi_diff', arguments: { before: url, after: 'openapi.yaml' } })
      expect(structured(diff).success).toBe(true)
      expect(JSON.stringify(diff)).not.toContain('must-not-leak')
      expect(connected.stderr.join('')).not.toContain('must-not-leak')
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it.each([
    ['developer', undefined, 8, true],
    ['read-only', 'read-only', 8, false],
    ['hardened', 'hardened', 10, false],
  ] as const)('registers the %s configured Tool surface with the correct capability annotations', async (_label, mode, expectedCount, developerWrites) => {
    const root = await fixtureWorkspace()
    temporaryRoots.push(root)
    const connected = await connect(root, 'openapi.config.cjs', mode)
    clients.push(connected.client)
    const listed = await connected.client.listTools()
    expect(listed.tools).toHaveLength(expectedCount)
    expect(listed.tools.map(({ name }) => name)).toContain('openapi_generate')
    expect(listed.tools.map(({ name }) => name)).not.toContain('openapi_generate_dry_run')
    expect(listed.tools.find(({ name }) => name === 'openapi_generate')?.annotations).toMatchObject(developerWrites
      ? { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
      : { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false })
    if (mode === 'hardened') {
      expect(listed.tools.map(({ name }) => name)).toContain('openapi_prepare_generation')
      expect(listed.tools.map(({ name }) => name)).toContain('openapi_apply_generation')
    }
  })

  it('rejects the removed allow-write flag and keeps read-only generation write-free', async () => {
    const root = await fixtureWorkspace()
    temporaryRoots.push(root)
    const transport = new StdioClientTransport({ command: process.execPath, args: [bin, '--workspace-root', root, '--config', 'openapi.config.cjs', '--allow-write'], stderr: 'pipe' })
    const client = new Client({ name: 'openapi-to-mcp-removed-flag-test', version: '1.0.0' })
    await expect(client.connect(transport)).rejects.toThrow(/closed/i)
    await client.close().catch(() => undefined)

    const connected = await connect(root, 'openapi.config.cjs', 'read-only')
    clients.push(connected.client)
    const result = await connected.client.callTool({ name: 'openapi_generate', arguments: { target: 'main', selection: { type: 'full' } } })
    expect(result.isError).not.toBe(true)
    expect(structured(result)).toMatchObject({ success: true, mode: 'dry-run', effect: 'preview', target: 'main' })
    await expect(access(path.join(root, '.openapi-to/generated'))).rejects.toThrow()
    await expect(access(path.join(root, '.openapi-to/generation-intents'))).rejects.toThrow()
  })

  it('persists one developer full generation and uses the same public Tool for dry-run', async () => {
    const root = await fixtureWorkspace()
    temporaryRoots.push(root)
    const connected = await connect(root, 'openapi.config.cjs')
    clients.push(connected.client)
    const outputRoot = path.join(root, '.openapi-to/generated')
    const first = await connected.client.callTool({ name: 'openapi_generate', arguments: { target: 'main', selection: { type: 'full' } } })
    expect(first.isError).not.toBe(true)
    expect(structured(first)).toMatchObject({ success: true, mode: 'write', effect: 'write', intent: { state: 'full', persisted: true }, transaction: { summary: { added: 3 } } })
    expect(await readFile(path.join(outputRoot, 'full.txt'), 'utf8')).toBe('full\n')
    await access(path.join(root, '.openapi-to/generation-intents'))

    const preview = await connected.client.callTool({ name: 'openapi_generate', arguments: { target: 'main', selection: { type: 'full' }, mode: 'dry-run', includePreview: true } })
    expect(preview.isError).not.toBe(true)
    expect(structured(preview)).toMatchObject({ success: true, mode: 'dry-run', effect: 'preview', intent: { state: 'full', persisted: true } })
    expect(JSON.stringify(preview)).not.toContain('openapi: 3.1.0')

    const checked = await connected.client.callTool({ name: 'openapi_check_generation', arguments: { target: 'main', basis: 'persisted' } })
    expect(checked.isError).not.toBe(true)
    expect(structured(checked)).toMatchObject({ success: true, state: 'full', outdated: false, changes: [], summary: { added: 0, modified: 0, deleted: 0 } })
  })

  it('checks a persisted selective intent at its managed output root', async () => {
    const root = await fixtureWorkspace()
    temporaryRoots.push(root)
    const connected = await connect(root, 'openapi.config.cjs')
    clients.push(connected.client)

    const generated = await connected.client.callTool({ name: 'openapi_generate', arguments: {
      target: 'main', selection: { type: 'operations', operationKeys: ['ping'], strategy: 'add' },
    } })
    expect(generated.isError).not.toBe(true)
    expect(structured(generated)).toMatchObject({ success: true, mode: 'write', intent: { state: 'operations', persisted: true } })

    const explicit = await connected.client.callTool({ name: 'openapi_check_generation', arguments: { target: 'main', basis: 'persisted' } })
    const implicit = await connected.client.callTool({ name: 'openapi_check_generation', arguments: { target: 'main' } })
    for (const result of [explicit, implicit]) {
      expect(result.isError).not.toBe(true)
      expect(structured(result)).toMatchObject({
        success: true, basis: 'persisted', target: 'main', state: 'operations', outdated: false,
        changes: [], summary: { added: 0, modified: 0, deleted: 0 },
      })
      expect((structured(result).diagnostics as Array<{ code: string }>).map(({ code }) => code)).not.toContain('CONFIG_OUTPUT_PROTECTED_PATH')
    }

    const repeated = await connected.client.callTool({ name: 'openapi_generate', arguments: {
      target: 'main', selection: { type: 'operations', operationKeys: ['ping'], strategy: 'add' },
    } })
    expect(structured(repeated)).toMatchObject({
      success: true, mode: 'write', transaction: { summary: { added: 0, modified: 0, deleted: 0, unchanged: 2 } },
    })

    await writeFile(path.join(root, '.openapi-to/generated/ping.txt'), 'edited\n')
    const drifted = await connected.client.callTool({ name: 'openapi_check_generation', arguments: { target: 'main', basis: 'persisted' } })
    expect(drifted.isError).toBe(true)
    expect(structured(drifted)).toMatchObject({ success: false, basis: 'persisted', state: 'operations', outdated: true, changes: [{ path: 'ping.txt', status: 'modified' }], summary: { added: 0, modified: 1, deleted: 0 } })

    const configuredFull = await connected.client.callTool({ name: 'openapi_check_generation', arguments: { target: 'main', basis: 'configured-full' } })
    expect(configuredFull.isError).toBe(true)
    expect(structured(configuredFull)).toMatchObject({ success: false, basis: 'configured-full', outdated: true })
  })

  it('keeps persisted checks read-only across generated and intent state', async () => {
    const root = await fixtureWorkspace()
    temporaryRoots.push(root)
    const connected = await connect(root, 'openapi.config.cjs')
    clients.push(connected.client)
    const generated = await connected.client.callTool({ name: 'openapi_generate', arguments: {
      target: 'main', selection: { type: 'operations', operationKeys: ['ping'], strategy: 'add' },
    } })
    expect(structured(generated).success).toBe(true)

    const before = await stateSnapshot(root)
    const checked = await connected.client.callTool({ name: 'openapi_check_generation', arguments: { target: 'main', basis: 'persisted' } })
    expect(structured(checked)).toMatchObject({ success: true, outdated: false })
    expect(await stateSnapshot(root)).toBe(before)
  })

  it('reports trusted input drift after the documented server restart boundary', async () => {
    const root = await fixtureWorkspace()
    temporaryRoots.push(root)
    const connected = await connect(root, 'openapi.config.cjs')
    clients.push(connected.client)
    const generated = await connected.client.callTool({ name: 'openapi_generate', arguments: {
      target: 'main', selection: { type: 'operations', operationKeys: ['ping'], strategy: 'add' },
    } })
    expect(structured(generated).success).toBe(true)
    await connected.client.close()

    const input = await readFile(path.join(root, 'openapi.yaml'), 'utf8')
    await writeFile(path.join(root, 'openapi.yaml'), input.replace('operationId: ping', 'operationId: renamedPing'))
    const restarted = await connect(root, 'openapi.config.cjs')
    clients.push(restarted.client)
    const checked = await restarted.client.callTool({ name: 'openapi_check_generation', arguments: { target: 'main', basis: 'persisted' } })
    expect(checked.isError).toBe(true)
    expect((structured(checked).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('SELECTION_OPERATION_NOT_FOUND')
    expect((structured(checked).diagnostics as Array<{ code: string }>).map(({ code }) => code)).not.toContain('CONFIG_OUTPUT_PROTECTED_PATH')
  })

  it('supports one-target add, replace, and ephemeral selection semantics', async () => {
    const root = await fixtureWorkspace()
    temporaryRoots.push(root)
    const connected = await connect(root, 'openapi.config.cjs')
    clients.push(connected.client)
    const generate = (selection: Record<string, unknown>, mode?: 'dry-run') => connected.client.callTool({ name: 'openapi_generate', arguments: { target: 'main', selection, ...(mode ? { mode } : {}) } })

    const add = await generate({ type: 'operations', operationKeys: ['ping'], strategy: 'add' })
    expect(structured(add)).toMatchObject({ success: true, mode: 'write', selection: { type: 'operations', strategy: 'add', resolvedOperationKeys: ['ping'] } })
    expect(await readFile(path.join(root, '.openapi-to/generated/ping.txt'), 'utf8')).toBe('ping\n')

    const replace = await generate({ type: 'operations', operationKeys: ['pong'], strategy: 'replace' })
    expect(structured(replace)).toMatchObject({ success: true, mode: 'write', intent: { state: 'operations', persisted: true }, selection: { strategy: 'replace', resolvedOperationKeys: ['pong'] } })
    await expect(access(path.join(root, '.openapi-to/generated/ping.txt'))).rejects.toThrow()
    expect(await readFile(path.join(root, '.openapi-to/generated/pong.txt'), 'utf8')).toBe('pong\n')

    const ephemeral = await generate({ type: 'operations', operationKeys: ['ping'], strategy: 'ephemeral' }, 'dry-run')
    expect(structured(ephemeral)).toMatchObject({ success: true, mode: 'dry-run', intent: { state: 'ephemeral', persisted: false }, selection: { strategy: 'ephemeral', resolvedOperationKeys: ['ping'] } })
    expect(await readFile(path.join(root, '.openapi-to/generated/pong.txt'), 'utf8')).toBe('pong\n')
    expect(JSON.stringify(ephemeral)).not.toContain('generation-intents')

    const invalid = await connected.client.callTool({ name: 'openapi_generate', arguments: { target: 'main', selection: { type: 'operations', operationKeys: ['ping'], strategy: 'ephemeral' } } })
    expect(invalid.isError).toBe(true)
  })

  it('fails closed before direct selective write can infer ownership from an existing output', async () => {
    const root = await fixtureWorkspace()
    temporaryRoots.push(root)
    const outputRoot = path.join(root, '.openapi-to/generated')
    await mkdir(outputRoot, { recursive: true })
    await writeFile(path.join(outputRoot, 'legacy.txt'), 'legacy\n')
    const connected = await connect(root, 'openapi.config.cjs')
    clients.push(connected.client)

    const result = await connected.client.callTool({ name: 'openapi_generate', arguments: { target: 'main', selection: { type: 'operations', operationKeys: ['ping'], strategy: 'replace' } } })
    expect(result.isError).toBe(true)
    expect((structured(result).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_GENERATION_INTENT_BOOTSTRAP_REQUIRED')
    expect(await readFile(path.join(outputRoot, 'legacy.txt'), 'utf8')).toBe('legacy\n')
    await expect(access(path.join(root, '.openapi-to/generation-intents'))).rejects.toThrow()
  })

  it('does not commit a developer write when plugin execution reports an error', async () => {
    const root = await fixtureWorkspace()
    temporaryRoots.push(root)
    await writeFile(path.join(root, 'openapi.config.cjs'), `module.exports = {
  servers: [{ name: 'main', input: { path: './openapi.yaml' }, output: { dir: 'generated', clean: true } }],
  plugins: [{ name: 'failing-generation-v2-fixture', hooks: { buildStart() { throw new Error('fixture generation failure') } } }],
};
`)
    const connected = await connect(root, 'openapi.config.cjs')
    clients.push(connected.client)

    const result = await connected.client.callTool({ name: 'openapi_generate', arguments: { target: 'main', selection: { type: 'full' } } })
    expect(result.isError).toBe(true)
    expect(structured(result)).toMatchObject({ success: false, mode: 'write', effect: 'write' })
    await expect(access(path.join(root, '.openapi-to/generated'))).rejects.toThrow()
    await expect(access(path.join(root, '.openapi-to/generation-intents'))).rejects.toThrow()
  })

  it('uses Core validation for an initial dynamic output root and rejects persistent relocation', async () => {
    const root = await fixtureWorkspace()
    temporaryRoots.push(root)
    const connected = await connect(root, 'openapi.config.cjs')
    clients.push(connected.client)
    const initial = await connected.client.callTool({ name: 'openapi_generate', arguments: { target: 'main', output: { root: 'custom-output' }, selection: { type: 'full' } } })
    expect(structured(initial)).toMatchObject({ success: true, effectiveOutputRoot: 'custom-output' })
    await access(path.join(root, 'custom-output/full.txt'))
    const checked = await connected.client.callTool({ name: 'openapi_check_generation', arguments: { target: 'main', basis: 'persisted' } })
    expect(checked.isError).not.toBe(true)
    expect(structured(checked)).toMatchObject({ success: true, basis: 'persisted', state: 'full', outdated: false, changes: [], summary: { added: 0, modified: 0, deleted: 0 } })
    const relocated = await connected.client.callTool({ name: 'openapi_generate', arguments: { target: 'main', output: { root: 'generated' }, selection: { type: 'full' } } })
    expect(relocated.isError).toBe(true)
    expect((structured(relocated).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('GENERATION_OUTPUT_RELOCATION_REQUIRED')
  })

  it('reports relocation when a persisted managed identity differs from current config', async () => {
    const root = await fixtureWorkspace()
    temporaryRoots.push(root)
    const connected = await connect(root, 'openapi.config.cjs')
    clients.push(connected.client)
    const generated = await connected.client.callTool({ name: 'openapi_generate', arguments: { target: 'main', selection: { type: 'full' } } })
    expect(structured(generated).success).toBe(true)
    await connected.client.close()

    const config = await readFile(path.join(root, 'openapi.config.cjs'), 'utf8')
    await writeFile(path.join(root, 'openapi.config.cjs'), config.replace("dir: 'generated'", "dir: 'moved'"))
    const restarted = await connect(root, 'openapi.config.cjs')
    clients.push(restarted.client)
    const checked = await restarted.client.callTool({ name: 'openapi_check_generation', arguments: { target: 'main', basis: 'persisted' } })
    expect(checked.isError).toBe(true)
    expect((structured(checked).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('GENERATION_OUTPUT_RELOCATION_REQUIRED')
    expect((structured(checked).diagnostics as Array<{ code: string }>).map(({ code }) => code)).not.toContain('CONFIG_OUTPUT_PROTECTED_PATH')
    await expect(access(path.join(root, '.openapi-to/moved'))).rejects.toThrow()
    await access(path.join(root, '.openapi-to/generated/full.txt'))
  })

  it('keeps Hardened generation preview-only while Prepare/Apply retains exact plan binding', async () => {
    const root = await fixtureWorkspace()
    temporaryRoots.push(root)
    const connected = await connect(root, 'openapi.config.cjs', 'hardened')
    clients.push(connected.client)
    const preview = await connected.client.callTool({ name: 'openapi_generate', arguments: { target: 'main', selection: { type: 'full' } } })
    expect(structured(preview)).toMatchObject({ success: true, mode: 'dry-run', effect: 'preview' })
    await expect(access(path.join(root, '.openapi-to/generated'))).rejects.toThrow()
    const prepared = await connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'] } })
    expect(prepared.isError).not.toBe(true)
    const plan = structured(prepared).plan as { planId: string; token: string; planHash: string }
    const applied = await connected.client.callTool({ name: 'openapi_apply_generation', arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash } })
    expect(structured(applied)).toMatchObject({ success: true, applied: true })
    await access(path.join(root, '.openapi-to/generated/full.txt'))
  })
})
