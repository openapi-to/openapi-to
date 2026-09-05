import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, readdir, rename, symlink, unlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { acquireOutputWriteLock, hashArtifactContent, serializeOperationSelectionManifest } from '@openapi-to/core'
import { afterEach, describe, expect, it } from 'vitest'

import { TrustedTargetCatalogRegistry } from './catalog/trusted-target-registry.ts'
import { prepareOperationSelection } from './generation/selection-state.ts'
import { TrustedConfigProvider } from './generation/trusted-config.ts'
import { resolveMcpServerOptions } from './options.ts'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const bin = path.join(repositoryRoot, 'packages/mcp/bin/openapi-to-mcp.js')
const openapiBin = path.join(repositoryRoot, 'packages/openapi/bin/openapi.js')

async function fixtureWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-mcp-controlled-write-'))
  await mkdir(path.join(root, '.openapi-to'))
  await writeFile(path.join(root, 'openapi.yaml'), `openapi: 3.1.0
info: { title: Controlled Write, version: "1" }
paths:
  /ping:
    get:
      operationId: ping
      responses: { "200": { description: ok } }
`)
  await writeFile(
    path.join(root, 'openapi.config.cjs'),
    `module.exports = {
  servers: [{ name: 'main', input: { path: './openapi.yaml' }, output: { dir: 'generated', clean: true } }],
  plugins: [{ name: 'controlled-write-fixture', hooks: { buildStart(ctx) {
    const root = ctx.openapiToSingleConfig.output.dir;
    ctx.addArtifact({ kind: 'text', path: root + '/client.txt', content: 'generated client\\n' });
    ctx.addArtifact({ kind: 'json', path: root + '/metadata.json', value: { stable: true } });
    ctx.addArtifact({ kind: 'binary', path: root + '/asset.bin', content: new Uint8Array([0, 1, 2, 3]) });
  } } }]
};
`,
  )
  return root
}

async function selectiveFixtureWorkspace(clean = true): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-mcp-selective-prepare-'))
  await mkdir(path.join(root, '.openapi-to'))
  await writeFile(path.join(root, 'openapi.yaml'), `openapi: 3.1.0
info: { title: Selective Prepare, version: "1" }
paths:
  /users/{id}:
    get:
      operationId: getUser
      responses: { "200": { description: ok, content: { application/json: { schema: { $ref: "#/components/schemas/User" } } } } }
    patch:
      operationId: updateUser
      requestBody: { content: { application/json: { schema: { $ref: "#/components/schemas/UserUpdate" } } } }
      responses: { "200": { description: ok, content: { application/json: { schema: { $ref: "#/components/schemas/User" } } } } }
components:
  schemas:
    User: { type: object, properties: { id: { type: string } } }
    UserUpdate: { type: object, properties: { name: { type: string } } }
`)
  await writeFile(path.join(root, 'openapi.config.cjs'), `module.exports = {
  servers: [{ name: 'main', input: { path: './openapi.yaml' }, output: { dir: 'generated', clean: ${clean} } }],
  plugins: [{ name: 'selective-prepare-fixture', hooks: { operation(operation, ctx) {
    const id = operation.accessor.operationId;
    ctx.addArtifact({ kind: 'text', path: ctx.openapiToSingleConfig.output.dir + '/' + id + '.txt', content: id + '\\n' });
  } } }]
};
`)
  return root
}

async function largeSelectiveFixtureWorkspace(operationCount: number): Promise<{ root: string; operationKeys: string[] }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-mcp-large-selective-prepare-'))
  await mkdir(path.join(root, '.openapi-to'))
  const operationKeys = Array.from({ length: operationCount }, (_, index) => `operation${String(index).padStart(4, '0')}`)
  const paths = Object.fromEntries(operationKeys.map((operationKey, index) => [
    `/operations/${index}`,
    { get: { operationId: operationKey, responses: { 200: { description: 'ok' } } } },
  ]))
  await writeFile(path.join(root, 'openapi.json'), JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Large Selective Prepare', version: '1' },
    paths,
  }))
  await writeFile(path.join(root, 'openapi.config.cjs'), `module.exports = {
  servers: [{ name: 'main', input: { path: './openapi.json' }, output: { dir: 'generated', clean: true } }],
  plugins: [{ name: 'large-selective-prepare-fixture', hooks: { operation(operation, ctx) {
    const id = operation.accessor.operationId;
    ctx.addArtifact({ kind: 'text', path: ctx.openapiToSingleConfig.output.dir + '/' + id + '.txt', content: id + '\\n' });
  } } }]
};
`)
  return { root, operationKeys }
}

async function seedSelection(root: string, operationKeys: string[]): Promise<{ selectionFile: string; bytes: string }> {
  const options = resolveMcpServerOptions({ workspaceRoot: root, configPath: 'openapi.config.cjs', allowWrite: true })
  const provider = new TrustedConfigProvider(options.workspaceRoot, 'openapi.config.cjs')
  const registry = new TrustedTargetCatalogRegistry(provider, options)
  const selected = await prepareOperationSelection(provider, options, registry, ['main'], { type: 'add', operationKeys })
  const bytes = serializeOperationSelectionManifest(selected.merge.manifest)
  await mkdir(path.dirname(selected.selectionFile), { recursive: true })
  await writeFile(selected.selectionFile, bytes)
  registry.clear()
  return { selectionFile: selected.selectionFile, bytes }
}

async function connect(root: string, allowWrite: boolean, extraArgs: string[] = []) {
  const stderr: string[] = []
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin, '--workspace-root', root, '--config', 'openapi.config.cjs', ...(allowWrite ? ['--allow-write'] : []), ...extraArgs],
    stderr: 'pipe',
  })
  transport.stderr?.on('data', (chunk) => stderr.push(String(chunk)))
  const client = new Client({ name: 'openapi-controlled-write-test', version: '1.0.0' })
  await client.connect(transport)
  return { client, stderr }
}

function structured(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  return result.structuredContent as Record<string, unknown>
}

async function waitForFile(filePath: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await access(filePath)
      return
    } catch {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path.basename(filePath)}.`)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}

async function runCliGenerate(root: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [openapiBin, 'generate', '--json'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI generate timed out while waiting for the shared writer lock.')) }, 10_000)
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)))
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') })
    })
  })
}

describe.sequential('controlled-write stdio tools', () => {
  const clients: Client[] = []
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)))
  })

  it('keeps the eight-tool matrix without the operator write grant', async () => {
    const root = await fixtureWorkspace()
    const connected = await connect(root, false)
    clients.push(connected.client)
    expect((await connected.client.listTools()).tools.map(({ name }) => name)).toEqual([
      'openapi_validate',
      'openapi_inspect',
      'openapi_diff',
      'openapi_list_targets',
      'openapi_search_operations',
      'openapi_get_operation',
      'openapi_generate_dry_run',
      'openapi_check_generation',
    ])
  })

  it('prepares without writes, then atomically applies the first selective generation', async () => {
    const root = await selectiveFixtureWorkspace()
    const connected = await connect(root, true)
    clients.push(connected.client)
    const tools = await connected.client.listTools()
    const prepare = tools.tools.find(({ name }) => name === 'openapi_prepare_generation')
    expect((prepare?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties).toHaveProperty('selection')
    const prepared = await connected.client.callTool({
      name: 'openapi_prepare_generation',
      arguments: { targets: ['main'], selection: { type: 'add', operationKeys: ['getUser'] } },
    })
    expect(prepared.isError).not.toBe(true)
    const plan = structured(prepared).plan as Record<string, unknown> & { planId: string; token: string; planHash: string }
    expect(plan).toMatchObject({
      kind: 'selective',
      applySupported: true,
      targets: ['main'],
      selection: {
        mutationType: 'add',
        previousOperationKeys: [],
        requestedOperationKeys: ['getUser'],
        newlyAddedOperationKeys: ['getUser'],
        alreadySelectedOperationKeys: [],
        retainedOperationKeys: [],
        removedOperationKeys: [],
        desiredOperationKeys: ['getUser'],
        previousSelectionExists: false,
        truncated: false,
      },
      projection: { operationCount: 1, pathCount: 1, schemaCount: 1 },
      summary: { added: 1, modified: 0, deleted: 0 },
    })
    expect(plan.token).toMatch(/^[A-Za-z0-9_-]{32,256}$/)
    expect(JSON.stringify(prepared)).not.toContain('openapi: 3.1.0')
    expect(JSON.stringify(prepared)).not.toContain(root)
    await expect(access(path.join(root, '.openapi-to/selections'))).rejects.toThrow()
    await expect(access(path.join(root, '.openapi-to/generated'))).rejects.toThrow()
    await expect(access(path.join(root, '.openapi-to/generated/.openapi-to-manifest.json'))).rejects.toThrow()
    await expect(access(path.join(root, '.openapi-to/generated/.openapi-to-write.lock'))).rejects.toThrow()
    await expect(access(path.join(root, '.openapi-to/generated/.openapi-to-transaction'))).rejects.toThrow()
    const applied = await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash },
    })
    expect(applied.isError).not.toBe(true)
    expect(structured(applied)).toMatchObject({
      success: true,
      applied: true,
      planKind: 'selective',
      target: 'main',
      selectionApplied: true,
      selectedOperationCount: 1,
      selectionHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      projectionHash: plan.projection && (plan.projection as { projectionHash: string }).projectionHash,
      summary: { added: 1, modified: 0, deleted: 0 },
    })
    expect(await readFile(path.join(root, '.openapi-to/generated/getUser.txt'), 'utf8')).toBe('getUser\n')
    const selectionFiles = await readdir(path.join(root, '.openapi-to/selections'))
    const selectionName = selectionFiles.find((name) => name.endsWith('.json'))
    expect(selectionName).toBeDefined()
    const selection = JSON.parse(await readFile(path.join(root, '.openapi-to/selections', selectionName as string), 'utf8')) as { operations: string[] }
    expect(selection.operations).toEqual(['getUser'])
    const ownership = JSON.parse(await readFile(path.join(root, '.openapi-to/generated/.openapi-to-manifest.json'), 'utf8')) as { files: Array<{ path: string }> }
    expect(ownership.files.map(({ path: ownedPath }) => ownedPath)).toEqual(['getUser.txt'])
    await expect(access(path.join(root, '.openapi-to/generated/.openapi-to-write.lock'))).rejects.toThrow()
    await expect(access(path.join(root, '.openapi-to/generated/.openapi-to-transaction.json'))).rejects.toThrow()
    await expect(access(path.join(root, '.openapi-to/generated/.openapi-to-transaction'))).rejects.toThrow()
    await expect(access(path.join(root, '.openapi-to/selections/.openapi-to-state-transaction'))).rejects.toThrow()
    const replay = await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash },
    })
    expect(replay.isError).toBe(true)
    expect((structured(replay).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_PLAN_ALREADY_USED')
    expect(connected.stderr.join('')).not.toContain(plan.token)
  })

  it('truncates a large replace summary while Apply commits the complete frozen selection', async () => {
    const { root, operationKeys } = await largeSelectiveFixtureWorkspace(501)
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await connected.client.callTool({
      name: 'openapi_prepare_generation',
      arguments: { targets: ['main'], selection: { type: 'replace', operationKeys } },
    })
    expect(prepared.isError).not.toBe(true)
    const plan = structured(prepared).plan as {
      planId: string
      token: string
      planHash: string
      selection: {
        requestedOperationKeys: string[]
        desiredOperationKeys: string[]
        counts: { requested: number; desired: number }
        truncated: boolean
      }
      truncated: { selection?: boolean }
    }
    expect(plan.selection.requestedOperationKeys).toHaveLength(50)
    expect(plan.selection.desiredOperationKeys).toHaveLength(50)
    expect(plan.selection.counts).toMatchObject({ requested: 501, desired: 501 })
    expect(plan.selection.truncated).toBe(true)
    expect(plan.truncated.selection).toBe(true)
    expect((structured(prepared).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_RESULT_TRUNCATED')
    await expect(access(path.join(root, '.openapi-to/generated'))).rejects.toThrow()
    await expect(access(path.join(root, '.openapi-to/selections'))).rejects.toThrow()

    const applied = await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash },
    })
    expect(applied.isError).not.toBe(true)
    expect(structured(applied)).toMatchObject({
      success: true,
      applied: true,
      selectionApplied: true,
      selectedOperationCount: 501,
    })
    const selectionFiles = await readdir(path.join(root, '.openapi-to/selections'))
    const selection = JSON.parse(await readFile(path.join(root, '.openapi-to/selections', selectionFiles[0] as string), 'utf8')) as { operations: string[] }
    expect(selection.operations).toEqual(operationKeys)
    expect(await readFile(path.join(root, '.openapi-to/generated/operation0000.txt'), 'utf8')).toBe('operation0000\n')
    expect(await readFile(path.join(root, '.openapi-to/generated/operation0500.txt'), 'utf8')).toBe('operation0500\n')
  }, 60_000)

  it('keeps workspace output ownership separate from managed selection state', async () => {
    const root = await selectiveFixtureWorkspace()
    const configPath = path.join(root, 'openapi.config.cjs')
    await writeFile(
      configPath,
      (await readFile(configPath, 'utf8')).replace(
        "output: { dir: 'generated', clean: true }",
        "output: { base: 'workspace', dir: 'src/api/generated/main', clean: true }",
      ),
    )
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await connected.client.callTool({
      name: 'openapi_prepare_generation',
      arguments: { targets: ['main'], selection: { type: 'add', operationKeys: ['getUser'] } },
    })
    expect(prepared.isError).not.toBe(true)
    const plan = structured(prepared).plan as { planId: string; token: string; planHash: string }
    await expect(access(path.join(root, 'src/api/generated/main'))).rejects.toThrow()
    await expect(access(path.join(root, '.openapi-to/selections'))).rejects.toThrow()

    const applied = await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash },
    })
    expect(applied.isError).not.toBe(true)
    expect(await readFile(path.join(root, 'src/api/generated/main/getUser.txt'), 'utf8')).toBe('getUser\n')
    await access(path.join(root, 'src/api/generated/main/.openapi-to-manifest.json'))
    const selectionFiles = await readdir(path.join(root, '.openapi-to/selections'))
    expect(selectionFiles.some((name) => name.endsWith('.json'))).toBe(true)
    await expect(access(path.join(root, 'src/api/generated/main/selections'))).rejects.toThrow()
  })

  it('uses previous union additions as the complete desired generation scope', async () => {
    const root = await selectiveFixtureWorkspace()
    const seeded = await seedSelection(root, ['getUser'])
    const output = path.join(root, '.openapi-to/generated')
    const existing = new TextEncoder().encode('getUser\n')
    const ownershipBytes = `${JSON.stringify({
      version: 2,
      generator: { name: 'openapi-to', version: 'test' },
      files: [{ path: 'getUser.txt', sha256: hashArtifactContent(existing), bytes: existing.byteLength, kind: 'text' }],
    }, null, 2)}\n`
    await mkdir(output)
    await writeFile(path.join(output, 'getUser.txt'), existing)
    await writeFile(path.join(output, '.openapi-to-manifest.json'), ownershipBytes)
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await connected.client.callTool({
      name: 'openapi_prepare_generation',
      arguments: { targets: ['main'], selection: { type: 'add', operationKeys: ['updateUser'] } },
    })
    const plan = structured(prepared).plan as {
      planId: string
      token: string
      planHash: string
      selection: { previousOperationKeys: string[]; requestedOperationKeys: string[]; desiredOperationKeys: string[] }
      projection: { operationCount: number }
      summary: { added: number; modified: number; deleted: number; unchanged: number }
      changes: Array<{ path: string; status: string }>
    }
    expect(plan.selection).toMatchObject({ previousOperationKeys: ['getUser'], requestedOperationKeys: ['updateUser'], desiredOperationKeys: ['getUser', 'updateUser'] })
    expect(plan.projection.operationCount).toBe(2)
    expect(plan.summary).toEqual(expect.objectContaining({ added: 1, modified: 0, deleted: 0, unchanged: 1 }))
    expect(plan.changes).toEqual([expect.objectContaining({ path: 'updateUser.txt', status: 'added' })])
    expect(await readFile(seeded.selectionFile, 'utf8')).toBe(seeded.bytes)
    expect(await readFile(path.join(output, 'getUser.txt'), 'utf8')).toBe('getUser\n')
    expect(await readFile(path.join(output, '.openapi-to-manifest.json'), 'utf8')).toBe(ownershipBytes)
    await expect(access(path.join(output, 'updateUser.txt'))).rejects.toThrow()
    const applied = await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash },
    })
    expect(applied.isError).not.toBe(true)
    expect(structured(applied)).toMatchObject({ planKind: 'selective', selectionApplied: true, selectedOperationCount: 2, summary: { added: 1, deleted: 0 } })
    expect(JSON.parse(await readFile(seeded.selectionFile, 'utf8'))).toMatchObject({ operations: ['getUser', 'updateUser'] })
    expect(await readFile(path.join(output, 'getUser.txt'), 'utf8')).toBe('getUser\n')
    expect(await readFile(path.join(output, 'updateUser.txt'), 'utf8')).toBe('updateUser\n')
    const appliedOwnership = JSON.parse(await readFile(path.join(output, '.openapi-to-manifest.json'), 'utf8')) as { files: Array<{ path: string }> }
    expect(appliedOwnership.files.map(({ path: ownedPath }) => ownedPath)).toEqual(['getUser.txt', 'updateUser.txt'])
  })

  it('replaces the complete desired selection and atomically deletes obsolete managed artifacts', async () => {
    const root = await selectiveFixtureWorkspace(false)
    const seeded = await seedSelection(root, ['updateUser', 'getUser'])
    const output = path.join(root, '.openapi-to/generated')
    const getUser = new TextEncoder().encode('getUser\n')
    const updateUser = new TextEncoder().encode('updateUser\n')
    const ownershipBytes = `${JSON.stringify({
      version: 2,
      generator: { name: 'openapi-to', version: 'test' },
      files: [
        { path: 'getUser.txt', sha256: hashArtifactContent(getUser), bytes: getUser.byteLength, kind: 'text' },
        { path: 'updateUser.txt', sha256: hashArtifactContent(updateUser), bytes: updateUser.byteLength, kind: 'text' },
      ],
    }, null, 2)}\n`
    await mkdir(output)
    await writeFile(path.join(output, 'getUser.txt'), getUser)
    await writeFile(path.join(output, 'updateUser.txt'), updateUser)
    await writeFile(path.join(output, 'user-owned.txt'), 'preserve\n')
    await writeFile(path.join(output, '.openapi-to-manifest.json'), ownershipBytes)
    const connected = await connect(root, true)
    clients.push(connected.client)

    const prepared = await connected.client.callTool({
      name: 'openapi_prepare_generation',
      arguments: { targets: ['main'], selection: { type: 'replace', operationKeys: ['updateUser', 'updateUser'] } },
    })
    expect(prepared.isError).not.toBe(true)
    const plan = structured(prepared).plan as {
      planId: string
      token: string
      planHash: string
      selection: {
        mutationType: string
        previousOperationKeys: string[]
        requestedOperationKeys: string[]
        newlyAddedOperationKeys: string[]
        alreadySelectedOperationKeys: string[]
        retainedOperationKeys: string[]
        removedOperationKeys: string[]
        desiredOperationKeys: string[]
        counts: Record<string, number>
      }
      projection: { operationCount: number }
      summary: { added: number; modified: number; deleted: number; unchanged: number }
      changes: Array<{ path: string; status: string }>
    }
    expect(plan.selection).toEqual(expect.objectContaining({
      mutationType: 'replace',
      previousOperationKeys: ['getUser', 'updateUser'],
      requestedOperationKeys: ['updateUser'],
      newlyAddedOperationKeys: [],
      alreadySelectedOperationKeys: ['updateUser'],
      retainedOperationKeys: ['updateUser'],
      removedOperationKeys: ['getUser'],
      desiredOperationKeys: ['updateUser'],
      counts: {
        previous: 2,
        requested: 1,
        newlyAdded: 0,
        alreadySelected: 1,
        retained: 1,
        removed: 1,
        desired: 1,
      },
    }))
    expect(plan.projection.operationCount).toBe(1)
    expect(plan.summary).toEqual(expect.objectContaining({ added: 0, modified: 0, deleted: 1, unchanged: 1 }))
    expect(plan.changes).toEqual([expect.objectContaining({ path: 'getUser.txt', status: 'deleted' })])
    expect(JSON.stringify(prepared.content)).toContain('managed file deletion')
    expect(await readFile(seeded.selectionFile, 'utf8')).toBe(seeded.bytes)
    expect(await readFile(path.join(output, 'getUser.txt'), 'utf8')).toBe('getUser\n')
    expect(await readFile(path.join(output, 'updateUser.txt'), 'utf8')).toBe('updateUser\n')
    expect(await readFile(path.join(output, '.openapi-to-manifest.json'), 'utf8')).toBe(ownershipBytes)

    const applied = await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash },
    })
    expect(applied.isError).not.toBe(true)
    expect(structured(applied)).toMatchObject({
      success: true,
      applied: true,
      planKind: 'selective',
      selectionApplied: true,
      selectedOperationCount: 1,
      summary: { added: 0, modified: 0, deleted: 1, unchanged: 1 },
      deletedFiles: ['getUser.txt'],
    })
    expect(JSON.parse(await readFile(seeded.selectionFile, 'utf8'))).toMatchObject({ operations: ['updateUser'] })
    await expect(access(path.join(output, 'getUser.txt'))).rejects.toThrow()
    expect(await readFile(path.join(output, 'updateUser.txt'), 'utf8')).toBe('updateUser\n')
    expect(await readFile(path.join(output, 'user-owned.txt'), 'utf8')).toBe('preserve\n')
    const ownership = JSON.parse(await readFile(path.join(output, '.openapi-to-manifest.json'), 'utf8')) as { files: Array<{ path: string }> }
    expect(ownership.files.map(({ path: ownedPath }) => ownedPath)).toEqual(['updateUser.txt'])
  })

  it('keeps repeated add byte-stable and follows the full no-op token/apply semantics', async () => {
    const root = await selectiveFixtureWorkspace()
    const connected = await connect(root, true)
    clients.push(connected.client)
    const firstPrepare = await connected.client.callTool({
      name: 'openapi_prepare_generation',
      arguments: { targets: ['main'], selection: { type: 'add', operationKeys: ['getUser'] } },
    })
    const firstPlan = structured(firstPrepare).plan as { planId: string; token: string; planHash: string }
    await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: firstPlan.planId, token: firstPlan.token, approvedPlanHash: firstPlan.planHash },
    })
    const selectionDirectory = path.join(root, '.openapi-to/selections')
    const selectionName = (await readdir(selectionDirectory)).find((name) => name.endsWith('.json')) as string
    const selectionPath = path.join(selectionDirectory, selectionName)
    const beforeSelection = await readFile(selectionPath, 'utf8')
    const beforeArtifact = await readFile(path.join(root, '.openapi-to/generated/getUser.txt'))

    const repeatedPrepare = await connected.client.callTool({
      name: 'openapi_prepare_generation',
      arguments: { targets: ['main'], selection: { type: 'add', operationKeys: ['getUser'] } },
    })
    const repeatedPlan = structured(repeatedPrepare).plan as {
      planId: string
      token: string
      planHash: string
      applySupported: boolean
      selection: { newlyAddedOperationKeys: string[]; alreadySelectedOperationKeys: string[]; desiredSelectionHash: string }
      summary: { added: number; modified: number; deleted: number; unchanged: number }
    }
    expect(repeatedPlan).toMatchObject({
      applySupported: true,
      selection: { newlyAddedOperationKeys: [], alreadySelectedOperationKeys: ['getUser'] },
      summary: { added: 0, modified: 0, deleted: 0, unchanged: 1 },
    })
    expect(repeatedPlan.token).toMatch(/^[A-Za-z0-9_-]{32,256}$/)
    const repeatedApply = await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: repeatedPlan.planId, token: repeatedPlan.token, approvedPlanHash: repeatedPlan.planHash },
    })
    expect(repeatedApply.isError).not.toBe(true)
    expect(structured(repeatedApply)).toMatchObject({ selectionApplied: true, selectedOperationCount: 1, selectionHash: repeatedPlan.selection.desiredSelectionHash })
    expect(await readFile(selectionPath, 'utf8')).toBe(beforeSelection)
    expect(await readFile(path.join(root, '.openapi-to/generated/getUser.txt'))).toEqual(beforeArtifact)
  })

  it.each([
    ['bytes', async (selectionFile: string) => writeFile(selectionFile, `${await readFile(selectionFile, 'utf8')} `)],
    ['operations', async (selectionFile: string) => {
      const manifest = JSON.parse(await readFile(selectionFile, 'utf8')) as { operations: string[] }
      manifest.operations = ['updateUser']
      await writeFile(selectionFile, `${JSON.stringify(manifest, null, 2)}\n`)
    }],
    ['identity', async (selectionFile: string) => {
      const bytes = await readFile(selectionFile)
      await unlink(selectionFile)
      await writeFile(selectionFile, bytes)
    }],
    ['deleted', async (selectionFile: string) => unlink(selectionFile)],
    ['symlink', async (selectionFile: string) => {
      const replacement = `${selectionFile}.replacement`
      await writeFile(replacement, await readFile(selectionFile))
      await unlink(selectionFile)
      await symlink(replacement, selectionFile)
    }],
  ] as const)('rejects selective Apply when selection %s drifted after Prepare', async (_caseName, mutate) => {
    const root = await selectiveFixtureWorkspace()
    const seeded = await seedSelection(root, ['getUser'])
    const output = path.join(root, '.openapi-to/generated')
    const existing = new TextEncoder().encode('getUser\n')
    await mkdir(output)
    await writeFile(path.join(output, 'getUser.txt'), existing)
    await writeFile(path.join(output, '.openapi-to-manifest.json'), `${JSON.stringify({
      version: 2,
      generator: { name: 'openapi-to', version: 'test' },
      files: [{ path: 'getUser.txt', sha256: hashArtifactContent(existing), bytes: existing.byteLength, kind: 'text' }],
    }, null, 2)}\n`)
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await connected.client.callTool({
      name: 'openapi_prepare_generation',
      arguments: { targets: ['main'], selection: { type: 'add', operationKeys: ['updateUser'] } },
    })
    const plan = structured(prepared).plan as { planId: string; token: string; planHash: string }
    await mutate(seeded.selectionFile)
    const applied = await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash },
    })
    expect(applied.isError).toBe(true)
    expect((structured(applied).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^SELECTION_(CHANGED_SINCE_PREPARE|FILE_SNAPSHOT_MISMATCH)$/),
    ]))
    await expect(access(path.join(output, 'updateUser.txt'))).rejects.toThrow()
    await expect(access(path.join(output, '.openapi-to-transaction.json'))).rejects.toThrow()
    const retried = await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash },
    })
    expect((structured(retried).diagnostics as Array<{ code: string }>).map(({ code }) => code)).not.toContain('MCP_PLAN_ALREADY_USED')
  })

  it('rejects selective Apply when an absent selection is created after Prepare', async () => {
    const root = await selectiveFixtureWorkspace()
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await connected.client.callTool({
      name: 'openapi_prepare_generation',
      arguments: { targets: ['main'], selection: { type: 'add', operationKeys: ['getUser'] } },
    })
    const plan = structured(prepared).plan as { planId: string; token: string; planHash: string }
    await seedSelection(root, ['updateUser'])
    const applied = await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash },
    })
    expect((structured(applied).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('SELECTION_FILE_SNAPSHOT_MISMATCH')
    await expect(access(path.join(root, '.openapi-to/generated'))).rejects.toThrow()
  })

  it('rejects selective Apply when the root source changed after Prepare', async () => {
    const root = await selectiveFixtureWorkspace()
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await connected.client.callTool({
      name: 'openapi_prepare_generation',
      arguments: { targets: ['main'], selection: { type: 'add', operationKeys: ['getUser'] } },
    })
    const plan = structured(prepared).plan as { planId: string; token: string; planHash: string }
    await writeFile(path.join(root, 'openapi.yaml'), (await readFile(path.join(root, 'openapi.yaml'), 'utf8')).replace('title: Selective Prepare', 'title: Selective Prepare Changed'))
    const applied = await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash },
    })
    expect((structured(applied).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_PLAN_SOURCE_CHANGED')
    await expect(access(path.join(root, '.openapi-to/generated'))).rejects.toThrow()
  })

  it('rejects selective Apply when a local reference changed after Prepare', async () => {
    const root = await selectiveFixtureWorkspace()
    const sourcePath = path.join(root, 'openapi.yaml')
    await writeFile(sourcePath, (await readFile(sourcePath, 'utf8')).replace(
      'User: { type: object, properties: { id: { type: string } } }',
      'User: { $ref: "./schemas.yaml#/User" }',
    ))
    await writeFile(path.join(root, 'schemas.yaml'), 'User: { type: object, properties: { id: { type: string } } }\n')
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await connected.client.callTool({
      name: 'openapi_prepare_generation',
      arguments: { targets: ['main'], selection: { type: 'add', operationKeys: ['getUser'] } },
    })
    const plan = structured(prepared).plan as { planId: string; token: string; planHash: string }
    await writeFile(path.join(root, 'schemas.yaml'), 'User: { type: object, properties: { id: { type: integer } } }\n')
    const applied = await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash },
    })
    expect((structured(applied).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_PLAN_REFERENCE_CHANGED')
    await expect(access(path.join(root, '.openapi-to/generated'))).rejects.toThrow()
  })

  it('rejects non-deterministic selective artifacts before starting a state transaction', async () => {
    const root = await selectiveFixtureWorkspace()
    const configPath = path.join(root, 'openapi.config.cjs')
    await writeFile(path.join(root, '.openapi-to/plugin-state.txt'), 'prepare\n')
    await writeFile(configPath, (await readFile(configPath, 'utf8')).replace(
      "content: id + '\\n'",
      "content: id + ':' + require('node:fs').readFileSync(require('node:path').join(ctx.openapiToSingleConfig.output.dir, '..', 'plugin-state.txt'), 'utf8')",
    ))
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await connected.client.callTool({
      name: 'openapi_prepare_generation',
      arguments: { targets: ['main'], selection: { type: 'add', operationKeys: ['getUser'] } },
    })
    const plan = structured(prepared).plan as { planId: string; token: string; planHash: string }
    await writeFile(path.join(root, '.openapi-to/plugin-state.txt'), 'apply\n')
    const applied = await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash },
    })
    expect((structured(applied).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('SELECTIVE_APPLY_ARTIFACT_MISMATCH')
    await expect(access(path.join(root, '.openapi-to/generated/getUser.txt'))).rejects.toThrow()
    await expect(access(path.join(root, '.openapi-to/generated/.openapi-to-transaction.json'))).rejects.toThrow()
    await expect(access(path.join(root, '.openapi-to/selections'))).rejects.toThrow()
  })

  it.each([
    ['managed artifact', 'SELECTIVE_APPLY_OUTPUT_DRIFT', async (output: string) => writeFile(path.join(output, 'getUser.txt'), 'changed\n')],
    ['ownership manifest', 'SELECTIVE_APPLY_OWNERSHIP_MISMATCH', async (output: string) => {
      const ownershipPath = path.join(output, '.openapi-to-manifest.json')
      await writeFile(ownershipPath, `${await readFile(ownershipPath, 'utf8')} `)
    }],
  ] as const)('rejects selective Apply when the %s changed after Prepare', async (_kind, expectedCode, mutate) => {
    const root = await selectiveFixtureWorkspace()
    const seeded = await seedSelection(root, ['getUser'])
    const output = path.join(root, '.openapi-to/generated')
    const existing = new TextEncoder().encode('getUser\n')
    const ownership = `${JSON.stringify({
      version: 2,
      generator: { name: 'openapi-to', version: 'test' },
      files: [{ path: 'getUser.txt', sha256: hashArtifactContent(existing), bytes: existing.byteLength, kind: 'text' }],
    }, null, 2)}\n`
    await mkdir(output)
    await writeFile(path.join(output, 'getUser.txt'), existing)
    await writeFile(path.join(output, '.openapi-to-manifest.json'), ownership)
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await connected.client.callTool({
      name: 'openapi_prepare_generation',
      arguments: { targets: ['main'], selection: { type: 'add', operationKeys: ['updateUser'] } },
    })
    const plan = structured(prepared).plan as { planId: string; token: string; planHash: string }
    await mutate(output)
    const applied = await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash },
    })
    expect((structured(applied).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain(expectedCode)
    expect(JSON.parse(await readFile(seeded.selectionFile, 'utf8'))).toMatchObject({ operations: ['getUser'] })
    await expect(access(path.join(output, 'updateUser.txt'))).rejects.toThrow()
    await expect(access(path.join(output, '.openapi-to-transaction.json'))).rejects.toThrow()
  })

  it('produces the same selective semantic plan for equivalent operation order and concurrent requests', async () => {
    const root = await selectiveFixtureWorkspace()
    const connected = await connect(root, true)
    clients.push(connected.client)
    const [left, right] = await Promise.all([
      connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'], selection: { type: 'add', operationKeys: ['getUser', 'updateUser'] } } }),
      connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'], selection: { type: 'add', operationKeys: ['updateUser', 'getUser'] } } }),
    ])
    const leftPlan = structured(left).plan as { planId: string; planHash: string }
    const rightPlan = structured(right).plan as { planId: string; planHash: string }
    expect(leftPlan.planHash).toBe(rightPlan.planHash)
    expect(leftPlan.planId).not.toBe(rightPlan.planId)
    await expect(access(path.join(root, '.openapi-to/generated'))).rejects.toThrow()
    await expect(access(path.join(root, '.openapi-to/selections'))).rejects.toThrow()
  })

  it('fails closed when a legacy ownership manifest has no selection state', async () => {
    const root = await selectiveFixtureWorkspace()
    const output = path.join(root, '.openapi-to/generated')
    await mkdir(output)
    await writeFile(path.join(output, '.openapi-to-manifest.json'), '{"version":2,"generator":{"name":"openapi-to","version":"test"},"files":[]}\n')
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await connected.client.callTool({
      name: 'openapi_prepare_generation',
      arguments: { targets: ['main'], selection: { type: 'add', operationKeys: ['getUser'] } },
    })
    expect(prepared.isError).toBe(true)
    expect((structured(prepared).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('SELECTION_BOOTSTRAP_REQUIRED')
    expect(await readFile(path.join(output, '.openapi-to-manifest.json'), 'utf8')).toContain('"version":2')
  })

  it('refuses write-enabled startup when any configured output root escapes the Workspace', async () => {
    const root = await fixtureWorkspace()
    const configPath = path.join(root, 'openapi.config.cjs')
    const config = await readFile(configPath, 'utf8')
    await writeFile(configPath, config.replace("dir: 'generated'", "dir: '../../../outside'"))
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [bin, '--workspace-root', root, '--config', 'openapi.config.cjs', '--allow-write'],
      stderr: 'pipe',
    })
    const client = new Client({ name: 'openapi-controlled-write-invalid-root', version: '1.0.0' })
    await expect(client.connect(transport)).rejects.toThrow(/closed/i)
    await client.close().catch(() => undefined)
  })

  it('rejects a multi-target write plan instead of partially applying one output root', async () => {
    const root = await fixtureWorkspace()
    await writeFile(
      path.join(root, 'openapi.config.cjs'),
      `module.exports = {
  servers: [
    { name: 'first', input: { path: './openapi.yaml' }, output: { dir: 'generated-a', clean: true } },
    { name: 'second', input: { path: './openapi.yaml' }, output: { dir: 'generated-b', clean: true } }
  ],
  plugins: [{ name: 'multi-target-fixture', hooks: { buildStart(ctx) {
    const root = ctx.openapiToSingleConfig.output.dir;
    ctx.addArtifact({ kind: 'text', path: root + '/client.txt', content: 'generated client\\n' });
  } } }]
};
`,
    )
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['first', 'second'] } })
    expect(prepared.isError).toBe(true)
    expect((structured(prepared).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_WRITE_SINGLE_TARGET_REQUIRED')
    await expect(access(path.join(root, '.openapi-to/generated-a'))).rejects.toThrow()
    await expect(access(path.join(root, '.openapi-to/generated-b'))).rejects.toThrow()
  })

  it('rejects an over-limit write plan without retaining an applyable half-plan', async () => {
    const root = await fixtureWorkspace()
    const connected = await connect(root, true, ['--max-write-files', '2'])
    clients.push(connected.client)
    const prepared = await connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'] } })
    expect(prepared.isError).toBe(true)
    expect((structured(prepared).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_WRITE_LIMIT_EXCEEDED')
    expect(structured(prepared).plan).toBeUndefined()
    await expect(access(path.join(root, '.openapi-to/generated'))).rejects.toThrow()
  })

  it('keeps the internal plan complete when the external Prepare change list is truncated', async () => {
    const root = await fixtureWorkspace()
    await writeFile(
      path.join(root, 'openapi.config.cjs'),
      `module.exports = {
  servers: [{ name: 'main', input: { path: './openapi.yaml' }, output: { dir: 'generated', clean: true } }],
  plugins: [{ name: 'truncated-plan-fixture', hooks: { buildStart(ctx) {
    const root = ctx.openapiToSingleConfig.output.dir;
    for (let index = 0; index < 501; index += 1) ctx.addArtifact({ kind: 'text', path: root + '/file-' + String(index).padStart(4, '0') + '.txt', content: String(index) + '\\n' });
  } } }]
};
`,
    )
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'] } }, undefined, { timeout: 10_000 })
    const plan = structured(prepared).plan as { planId: string; token: string; planHash: string; changes: unknown[]; truncated: { changes: boolean; total: number; returned: number } }
    expect(plan.changes).toHaveLength(500)
    expect(plan.truncated).toMatchObject({ changes: true, total: 501, returned: 500 })
    const applied = await connected.client.callTool({ name: 'openapi_apply_generation', arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash } }, undefined, { timeout: 10_000 })
    expect(structured(applied)).toMatchObject({ success: true, applied: true, summary: { added: 501 } })
    expect((await readdir(path.join(root, '.openapi-to/generated'))).filter((name) => name.endsWith('.txt'))).toHaveLength(501)
  }, 20_000)

  it('prepares without writing, applies exactly once, and leaves generation current', async () => {
    const root = await fixtureWorkspace()
    const outputRoot = path.join(root, '.openapi-to/generated')
    const connected = await connect(root, true)
    clients.push(connected.client)
    const tools = (await connected.client.listTools()).tools
    expect(tools.map(({ name }) => name)).toEqual([
      'openapi_validate',
      'openapi_inspect',
      'openapi_diff',
      'openapi_list_targets',
      'openapi_search_operations',
      'openapi_get_operation',
      'openapi_generate_dry_run',
      'openapi_check_generation',
      'openapi_prepare_generation',
      'openapi_apply_generation',
    ])
    const prepareTool = tools.find(({ name }) => name === 'openapi_prepare_generation')
    if (!prepareTool) throw new Error('Missing openapi_prepare_generation Tool')
    expect(prepareTool?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: false })
    expect(tools.find(({ name }) => name === 'openapi_apply_generation')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false })
    const selectionSchema = (prepareTool.inputSchema as {
      properties?: { selection?: { anyOf?: Array<{ additionalProperties?: boolean; properties?: { type?: { const?: string }; operationKeys?: { type?: string; minItems?: number; maxItems?: number } } }> } }
    }).properties?.selection
    expect(selectionSchema?.anyOf).toEqual([
      expect.objectContaining({
        additionalProperties: false,
        properties: expect.objectContaining({
          type: expect.objectContaining({ const: 'add' }),
          operationKeys: expect.objectContaining({ type: 'array', maxItems: 500 }),
        }),
      }),
      expect.objectContaining({
        additionalProperties: false,
        properties: expect.objectContaining({
          type: expect.objectContaining({ const: 'replace' }),
          operationKeys: expect.objectContaining({ type: 'array', minItems: 1, maxItems: 5_000 }),
        }),
      }),
    ])

    const prepared = await connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'], includePreview: true } })
    expect(prepared.isError).not.toBe(true)
    expect(JSON.stringify(prepared.content)).toContain('no files or ownership manifest were written')
    await expect(access(outputRoot)).rejects.toThrow()
    const plan = structured(prepared).plan as { planId: string; token: string; planHash: string; summary: { added: number; deleted: number } }
    expect(plan.summary).toMatchObject({ added: 3, deleted: 0 })
    const concurrentPrepared = await Promise.all([
      connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'], includePreview: true } }),
      connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'], includePreview: true } }),
    ])
    for (const repeated of concurrentPrepared) {
      const repeatedPlan = structured(repeated).plan as { planId: string; token: string; planHash: string; changes: unknown[] }
      expect(repeatedPlan.planHash).toBe(plan.planHash)
      expect(repeatedPlan.planId).not.toBe(plan.planId)
      expect(repeatedPlan.token).not.toBe(plan.token)
      expect(repeatedPlan.changes).toEqual((structured(prepared).plan as { changes: unknown[] }).changes)
    }

    const forbiddenOverride = await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash, force: true },
    })
    expect(forbiddenOverride.isError).toBe(true)
    expect(JSON.stringify(forbiddenOverride.content)).toContain('-32602')
    expect(JSON.stringify(forbiddenOverride.content)).toContain('force')

    const tampered = await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: `${plan.token.slice(0, -1)}x`, approvedPlanHash: plan.planHash },
    })
    expect(tampered.isError).toBe(true)
    expect((structured(tampered).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_PLAN_TOKEN_INVALID')
    await expect(access(outputRoot)).rejects.toThrow()

    const wrongHash = await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: 'f'.repeat(64) },
    })
    expect((structured(wrongHash).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_PLAN_HASH_MISMATCH')

    const applied = await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash },
    })
    expect(applied.isError).not.toBe(true)
    expect(structured(applied)).toMatchObject({ success: true, applied: true, summary: { added: 3, modified: 0, deleted: 0 } })
    expect(await readFile(path.join(outputRoot, 'client.txt'), 'utf8')).toBe('generated client\n')
    expect(new Uint8Array(await readFile(path.join(outputRoot, 'asset.bin')))).toEqual(new Uint8Array([0, 1, 2, 3]))
    const ownership = JSON.parse(await readFile(path.join(outputRoot, '.openapi-to-manifest.json'), 'utf8'))
    expect(ownership).toMatchObject({ version: 2, generator: { name: 'openapi-to' } })
    expect(ownership.files).toHaveLength(3)

    const replay = await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash },
    })
    expect(replay.isError).toBe(true)
    expect((structured(replay).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_PLAN_ALREADY_USED')

    const check = await connected.client.callTool({ name: 'openapi_check_generation', arguments: { targets: ['main'] } })
    expect(structured(check)).toMatchObject({ success: true, outdated: false })
    const secondPrepare = await connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'] } })
    expect((structured(secondPrepare).plan as { summary: Record<string, number> }).summary).toMatchObject({ added: 0, modified: 0, deleted: 0, unchanged: 3 })
    const secondPlan = structured(secondPrepare).plan as { planId: string; token: string; planHash: string }
    await writeFile(path.join(outputRoot, 'client.txt'), 'changed client!!\n')
    const staleFile = await connected.client.callTool({ name: 'openapi_apply_generation', arguments: { planId: secondPlan.planId, token: secondPlan.token, approvedPlanHash: secondPlan.planHash } })
    expect((structured(staleFile).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_PLAN_FILE_CHANGED')
    expect(await readFile(path.join(outputRoot, 'client.txt'), 'utf8')).toBe('changed client!!\n')
    expect(connected.stderr.join('')).not.toContain(plan.token)
  })

  it('rejects stale source changes without writing the prepared output', async () => {
    const root = await fixtureWorkspace()
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'] } })
    const plan = structured(prepared).plan as { planId: string; token: string; planHash: string }
    await writeFile(path.join(root, 'openapi.yaml'), `openapi: 3.1.0\ninfo: { title: Changed, version: "2" }\npaths: {}\n`)
    const applied = await connected.client.callTool({ name: 'openapi_apply_generation', arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash } })
    expect(applied.isError).toBe(true)
    expect((structured(applied).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_PLAN_SOURCE_CHANGED')
    await expect(access(path.join(root, '.openapi-to/generated'))).rejects.toThrow()
  })

  it('distinguishes a changed local reference from a changed entry source', async () => {
    const root = await fixtureWorkspace()
    await writeFile(path.join(root, 'schema.yaml'), 'type: object\nproperties: { value: { type: string } }\n')
    await writeFile(path.join(root, 'openapi.yaml'), `openapi: 3.1.0
info: { title: Controlled Ref, version: "1" }
paths: {}
components:
  schemas:
    Value:
      $ref: ./schema.yaml
`)
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'] } })
    const plan = structured(prepared).plan as { planId: string; token: string; planHash: string }
    await writeFile(path.join(root, 'schema.yaml'), 'type: object\nproperties: { value: { type: number } }\n')
    const applied = await connected.client.callTool({ name: 'openapi_apply_generation', arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash } })
    expect((structured(applied).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_PLAN_REFERENCE_CHANGED')
  })

  it('binds the prepared plan to the exact remote response bytes', async () => {
    let remoteDocument = 'openapi: 3.1.0\ninfo: { title: Remote One, version: "1" }\npaths: {}\n'
    const remote = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/yaml' })
      response.end(remoteDocument)
    })
    await new Promise<void>((resolve) => remote.listen(0, '127.0.0.1', resolve))
    try {
      const address = remote.address()
      if (!address || typeof address === 'string') throw new Error('Unable to bind remote fixture.')
      const root = await fixtureWorkspace()
      const configPath = path.join(root, 'openapi.config.cjs')
      const config = await readFile(configPath, 'utf8')
      await writeFile(configPath, config.replace("input: { path: './openapi.yaml' }", `input: { path: 'http://127.0.0.1:${address.port}/openapi.yaml', remote: { allowPrivateNetwork: true, allowedHosts: ['127.0.0.1'] } }`))
      const connected = await connect(root, true, ['--allow-private-network', '--allow-host', '127.0.0.1'])
      clients.push(connected.client)
      const prepared = await connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'] } })
      const plan = structured(prepared).plan as { planId: string; token: string; planHash: string }
      remoteDocument = 'openapi: 3.1.0\ninfo: { title: Remote Two, version: "2" }\npaths: {}\n'
      const applied = await connected.client.callTool({ name: 'openapi_apply_generation', arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash } })
      expect((structured(applied).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_PLAN_SOURCE_CHANGED')
      await expect(access(path.join(root, '.openapi-to/generated/client.txt'))).rejects.toThrow()
    } finally {
      await new Promise<void>((resolve) => remote.close(() => resolve()))
    }
  })

  it('refuses to overwrite a user file that appears at a prepared added path', async () => {
    const root = await fixtureWorkspace()
    const outputRoot = path.join(root, '.openapi-to/generated')
    await mkdir(outputRoot, { recursive: true })
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'] } })
    const plan = structured(prepared).plan as { planId: string; token: string; planHash: string }
    await writeFile(path.join(outputRoot, 'client.txt'), 'user appeared\n')
    const applied = await connected.client.callTool({ name: 'openapi_apply_generation', arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash } })
    expect((structured(applied).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_PLAN_FILE_CHANGED')
    expect(await readFile(path.join(outputRoot, 'client.txt'), 'utf8')).toBe('user appeared\n')
  })

  it.runIf(process.platform !== 'win32')('fails closed when the prepared output root is replaced by a symlink', async () => {
    const root = await fixtureWorkspace()
    const outputRoot = path.join(root, '.openapi-to/generated')
    const movedRoot = path.join(root, '.openapi-to/generated-before-replacement')
    const outside = await mkdtemp(path.join(os.tmpdir(), 'openapi-mcp-output-replacement-'))
    await mkdir(outputRoot, { recursive: true })
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'] } })
    const plan = structured(prepared).plan as { planId: string; token: string; planHash: string }
    await rename(outputRoot, movedRoot)
    await symlink(outside, outputRoot, 'dir')
    const applied = await connected.client.callTool({ name: 'openapi_apply_generation', arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash } })
    expect((structured(applied).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_WRITE_RECOVERY_REQUIRED')
    await expect(access(path.join(outside, 'client.txt'))).rejects.toThrow()
  })

  it('does not consume a selective plan when Apply is cancelled while waiting for the shared output lock', async () => {
    const root = await selectiveFixtureWorkspace()
    const outputRoot = path.join(root, '.openapi-to/generated')
    await mkdir(outputRoot, { recursive: true })
    const connected = await connect(root, true, ['--write-lock-wait-ms', '5000'])
    clients.push(connected.client)
    const prepared = await connected.client.callTool({
      name: 'openapi_prepare_generation',
      arguments: { targets: ['main'], selection: { type: 'add', operationKeys: ['getUser'] } },
    })
    const plan = structured(prepared).plan as { planId: string; token: string; planHash: string }
    const competingWriter = await acquireOutputWriteLock(outputRoot)
    const controller = new AbortController()
    const pending = connected.client.callTool(
      { name: 'openapi_apply_generation', arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash } },
      undefined,
      { signal: controller.signal, timeout: 5_000 },
    )
    setTimeout(() => controller.abort(), 50).unref()
    await expect(pending).rejects.toThrow(/abort/i)
    await competingWriter.release()
    await new Promise((resolve) => setTimeout(resolve, 100))
    const retry = await connected.client.callTool({ name: 'openapi_apply_generation', arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash } })
    expect(structured(retry)).toMatchObject({ success: true, applied: true, planKind: 'selective', selectionApplied: true })
    const selectionDirectory = path.join(root, '.openapi-to/selections')
    const selectionFiles = await readdir(selectionDirectory)
    expect(selectionFiles).toHaveLength(1)
    expect(JSON.parse(await readFile(path.join(selectionDirectory, selectionFiles[0] as string), 'utf8'))).toMatchObject({ operations: ['getUser'] })
  })

  it('defers a real Client cancellation received after the commit critical section begins', async () => {
    const root = await fixtureWorkspace()
    await writeFile(
      path.join(root, 'openapi.config.cjs'),
      `module.exports = {
  servers: [{ name: 'main', input: { path: './openapi.yaml' }, output: { dir: 'generated', clean: true } }],
  plugins: [{ name: 'commit-cancellation-fixture', hooks: { buildStart(ctx) {
    const root = ctx.openapiToSingleConfig.output.dir;
    for (let index = 0; index < 501; index += 1) ctx.addArtifact({ kind: 'text', path: root + '/file-' + String(index).padStart(4, '0') + '.txt', content: String(index) + '\\n' });
  } } }]
};
`,
    )
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await connected.client.callTool(
      { name: 'openapi_prepare_generation', arguments: { targets: ['main'] } },
      undefined,
      { timeout: 15_000 },
    )
    const plan = structured(prepared).plan as { planId: string; token: string; planHash: string }
    const controller = new AbortController()
    const pending = connected.client.callTool(
      {
        name: 'openapi_apply_generation',
        arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash },
        _meta: { progressToken: 'commit-cancellation' },
      },
      undefined,
      {
        signal: controller.signal,
        timeout: 15_000,
        onprogress: (notification) => {
          if (notification.progress >= 90) controller.abort()
        },
      },
    )
    await expect(pending).rejects.toThrow(/abort/i)
    await waitForFile(path.join(root, '.openapi-to/generated/.openapi-to-manifest.json'), 10_000)
    const check = await connected.client.callTool(
      { name: 'openapi_check_generation', arguments: { targets: ['main'] } },
      undefined,
      { timeout: 15_000 },
    )
    expect(structured(check)).toMatchObject({ success: true, outdated: false })
    const replay = await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash },
    })
    expect((structured(replay).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_PLAN_ALREADY_USED')
  }, 30_000)

  it('serializes an actual CLI generate process behind MCP Apply on the same output root', async () => {
    const root = await fixtureWorkspace()
    const configPath = path.join(root, 'openapi.config.cjs')
    const config = await readFile(configPath, 'utf8')
    await writeFile(configPath, config.replace("buildStart(ctx) {", "async buildStart(ctx) { await new Promise((resolve) => setTimeout(resolve, 250));"))
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'] } })
    const plan = structured(prepared).plan as { planId: string; token: string; planHash: string }
    const applying = connected.client.callTool({ name: 'openapi_apply_generation', arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash } }, undefined, { timeout: 5_000 })
    await waitForFile(path.join(root, '.openapi-to/generated/.openapi-to-write.lock'))
    const cli = runCliGenerate(root)
    expect(structured(await applying)).toMatchObject({ success: true, applied: true })
    const cliResult = await cli
    expect(cliResult.code, cliResult.stderr).toBe(0)
    expect(JSON.parse(cliResult.stdout)).toMatchObject({ success: true, mode: 'write' })
    expect(await readFile(path.join(root, '.openapi-to/generated/client.txt'), 'utf8')).toBe('generated client\n')
  }, 15_000)

  it('serializes two Apply calls for one root and allows only the still-current plan to commit', async () => {
    const root = await fixtureWorkspace()
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await Promise.all([
      connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'] } }),
      connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'] } }),
    ])
    const plans = prepared.map((result) => structured(result).plan as { planId: string; token: string; planHash: string })
    const results = await Promise.all(plans.map((plan) => connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash },
    })))
    expect(results.filter((result) => structured(result).success === true)).toHaveLength(1)
    expect(results.filter((result) => result.isError === true)).toHaveLength(1)
    expect(await readFile(path.join(root, '.openapi-to/generated/client.txt'), 'utf8')).toBe('generated client\n')
  })

  it('applies independently prepared targets with different output roots without mixing plans', async () => {
    const root = await fixtureWorkspace()
    await writeFile(
      path.join(root, 'openapi.config.cjs'),
      `module.exports = {
  servers: [
    { name: 'first', input: { path: './openapi.yaml' }, output: { dir: 'generated-a', clean: true } },
    { name: 'second', input: { path: './openapi.yaml' }, output: { dir: 'generated-b', clean: true } }
  ],
  plugins: [{ name: 'independent-roots', hooks: { buildStart(ctx) {
    const root = ctx.openapiToSingleConfig.output.dir;
    ctx.addArtifact({ kind: 'text', path: root + '/client.txt', content: ctx.openapiToSingleConfig.name + '\\n' });
  } } }]
};
`,
    )
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await Promise.all(['first', 'second'].map((target) => connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: [target] } })))
    const plans = prepared.map((result) => structured(result).plan as { planId: string; token: string; planHash: string })
    const applied = await Promise.all(plans.map((plan) => connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash },
    })))
    expect(applied.every((result) => structured(result).success === true)).toBe(true)
    expect(await readFile(path.join(root, '.openapi-to/generated-a/client.txt'), 'utf8')).toBe('first\n')
    expect(await readFile(path.join(root, '.openapi-to/generated-b/client.txt'), 'utf8')).toBe('second\n')
  })

  it('rejects expired and cross-Server plans', async () => {
    const root = await fixtureWorkspace()
    const first = await connect(root, true, ['--plan-ttl-ms', '1000'])
    const second = await connect(root, true)
    clients.push(first.client, second.client)
    const prepared = await first.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'] } })
    const plan = structured(prepared).plan as { planId: string; token: string; planHash: string }
    let otherServer: Awaited<ReturnType<Client['callTool']>>
    try {
      otherServer = await second.client.callTool({ name: 'openapi_apply_generation', arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash } })
    } catch (error) {
      throw new Error(`Cross-Server call failed: ${String(error)}\nfirst stderr: ${first.stderr.join('')}\nsecond stderr: ${second.stderr.join('')}`)
    }
    expect((structured(otherServer).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_PLAN_NOT_FOUND')
    await new Promise((resolve) => setTimeout(resolve, 1100))
    let expired: Awaited<ReturnType<Client['callTool']>>
    try {
      expired = await first.client.callTool({ name: 'openapi_apply_generation', arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash } })
    } catch (error) {
      throw new Error(`Expired-plan call failed: ${String(error)}\nfirst stderr: ${first.stderr.join('')}\nsecond stderr: ${second.stderr.join('')}`)
    }
    expect((structured(expired).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_PLAN_EXPIRED')
  })

  it('expires selective tokens with the same in-memory TTL semantics as full plans', async () => {
    const root = await selectiveFixtureWorkspace()
    const connected = await connect(root, true, ['--plan-ttl-ms', '1000'])
    clients.push(connected.client)
    const prepared = await connected.client.callTool({
      name: 'openapi_prepare_generation',
      arguments: { targets: ['main'], selection: { type: 'add', operationKeys: ['getUser'] } },
    })
    const plan = structured(prepared).plan as { planId: string; token: string; planHash: string }
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const expired = await connected.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash },
    })
    expect((structured(expired).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_PLAN_EXPIRED')
    await expect(access(path.join(root, '.openapi-to/generated'))).rejects.toThrow()
    await expect(access(path.join(root, '.openapi-to/selections'))).rejects.toThrow()
  })

  it('rejects stale config and ownership manifest changes', async () => {
    const root = await fixtureWorkspace()
    const configPath = path.join(root, 'openapi.config.cjs')
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'] } })
    const plan = structured(prepared).plan as { planId: string; token: string; planHash: string }
    const originalConfig = await readFile(configPath, 'utf8')
    await writeFile(configPath, `${originalConfig}\n`)
    const configChanged = await connected.client.callTool({ name: 'openapi_apply_generation', arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash } })
    expect((structured(configChanged).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_PLAN_CONFIG_CHANGED')
    await writeFile(configPath, originalConfig)

    const fresh = await connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'] } })
    const freshPlan = structured(fresh).plan as { planId: string; token: string; planHash: string }
    await connected.client.callTool({ name: 'openapi_apply_generation', arguments: { planId: freshPlan.planId, token: freshPlan.token, approvedPlanHash: freshPlan.planHash } })
    const unchanged = await connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'] } })
    const unchangedPlan = structured(unchanged).plan as { planId: string; token: string; planHash: string }
    const ownershipPath = path.join(root, '.openapi-to/generated/.openapi-to-manifest.json')
    await writeFile(ownershipPath, `${await readFile(ownershipPath, 'utf8')} `)
    const manifestChanged = await connected.client.callTool({ name: 'openapi_apply_generation', arguments: { planId: unchangedPlan.planId, token: unchangedPlan.token, approvedPlanHash: unchangedPlan.planHash } })
    expect((structured(manifestChanged).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_PLAN_MANIFEST_CHANGED')
  })

  it('deletes only unchanged ownership-managed files and preserves unmanaged files', async () => {
    const root = await fixtureWorkspace()
    const outputRoot = path.join(root, '.openapi-to/generated')
    await mkdir(outputRoot, { recursive: true })
    await writeFile(path.join(outputRoot, 'old-managed.txt'), 'old managed\n')
    await writeFile(path.join(outputRoot, 'user.txt'), 'user owned\n')
    await writeFile(path.join(outputRoot, '.openapi-to-manifest.json'), `${JSON.stringify({ version: 1, files: ['old-managed.txt'] }, null, 2)}\n`)
    const connected = await connect(root, true)
    clients.push(connected.client)
    const prepared = await connected.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['main'] } })
    const plan = structured(prepared).plan as { planId: string; token: string; planHash: string; summary: { deleted: number } }
    expect(plan.summary.deleted).toBe(1)
    expect(JSON.stringify(prepared.content)).toContain('managed file deletion')
    const applied = await connected.client.callTool({ name: 'openapi_apply_generation', arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash } })
    expect(structured(applied)).toMatchObject({ success: true, applied: true, summary: { deleted: 1 } })
    await expect(access(path.join(outputRoot, 'old-managed.txt'))).rejects.toThrow()
    expect(await readFile(path.join(outputRoot, 'user.txt'), 'utf8')).toBe('user owned\n')
  })
})
