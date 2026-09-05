import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterEach, describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const bin = path.join(repositoryRoot, 'packages/mcp/bin/openapi-to-mcp.js')
const MCP_GENERATION_TEST_TIMEOUT_MS = 20_000

interface ConnectedClient {
  client: Client
  stderr: string[]
}

async function connect(workspaceRoot: string, configPath?: string, extraArgs: string[] = []): Promise<ConnectedClient> {
  const stderr: string[] = []
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin, '--workspace-root', workspaceRoot, ...(configPath ? ['--config', configPath] : []), ...extraArgs],
    stderr: 'pipe',
  })
  transport.stderr?.on('data', (chunk) => stderr.push(String(chunk)))
  const client = new Client({ name: 'openapi-to-mcp-test', version: '1.0.0' })
  await client.connect(transport)
  return { client, stderr }
}

function structured(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  return result.structuredContent as Record<string, unknown>
}

type DryRunServer = { manifest: { hash?: string } }

describe.sequential('stdio MCP server', () => {
  const clients: Client[] = []
  const temporaryRoots: string[] = []
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()))
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('initializes a no-config server with exactly three bounded analysis tools', async () => {
    const connected = await connect(repositoryRoot)
    clients.push(connected.client)
    const listed = await connected.client.listTools()
    expect(listed.tools.map(({ name }) => name)).toEqual(['openapi_validate', 'openapi_inspect', 'openapi_diff'])
    for (const tool of listed.tools) {
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.outputSchema?.type).toBe('object')
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true })
    }

    const yamlSource = 'packages/mcp/src/fixtures/valid.yaml'
    const [validate, concurrentValidate, inspect] = await Promise.all([
      connected.client.callTool({ name: 'openapi_validate', arguments: { source: yamlSource } }),
      connected.client.callTool({ name: 'openapi_validate', arguments: { source: yamlSource } }),
      connected.client.callTool({ name: 'openapi_inspect', arguments: { source: yamlSource, includeOperations: true } }),
    ])
    expect(validate.isError).not.toBe(true)
    expect(structured(validate)).toMatchObject({ schemaVersion: 1, tool: 'openapi_validate', success: true, source: yamlSource })
    expect(validate.content).toHaveLength(1)
    expect(structured(inspect)).toMatchObject({ success: true, inspection: { pathCount: 1, operationCount: 1, securitySchemes: ['bearer'] } })
    expect(JSON.stringify(concurrentValidate.structuredContent)).toBe(JSON.stringify(validate.structuredContent))

    const repeated = await connected.client.callTool({ name: 'openapi_validate', arguments: { source: yamlSource } })
    expect(JSON.stringify(repeated.structuredContent)).toBe(JSON.stringify(validate.structuredContent))

    const json = await connected.client.callTool({ name: 'openapi_validate', arguments: { source: 'packages/core/mock/openapiV3.json' } })
    expect(json.isError).not.toBe(true)
    const missingRef = await connected.client.callTool({ name: 'openapi_validate', arguments: { source: 'packages/mcp/src/fixtures/missing-ref.yaml' } })
    expect((structured(missingRef).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('OPENAPI_REF_NOT_FOUND')
    const cycle = await connected.client.callTool({ name: 'openapi_validate', arguments: { source: 'packages/mcp/src/fixtures/cycle.yaml' } })
    expect((structured(cycle).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('OPENAPI_REF_CYCLE')

    for (const source of ['packages/core/mock/swagger2.0.json', 'packages/core/mock/openapiV3.json', yamlSource, 'packages/core/src/openapi/fixtures/openapi-3.2.yaml']) {
      const versionInspection = await connected.client.callTool({ name: 'openapi_inspect', arguments: { source } })
      expect(versionInspection.isError).not.toBe(true)
      expect((structured(versionInspection).inspection as { openapiVersion: string }).openapiVersion).toMatch(/^(2\.0|3\.)/)
    }
    const externalInspection = await connected.client.callTool({ name: 'openapi_inspect', arguments: { source: 'packages/mcp/src/fixtures/external-ref.yaml' } })
    expect(structured(externalInspection)).toMatchObject({ success: true, inspection: { externalReferenceCount: 1 } })

    const diff = await connected.client.callTool({ name: 'openapi_diff', arguments: { before: yamlSource, after: 'packages/mcp/src/fixtures/after.yaml' } })
    expect(structured(diff)).toMatchObject({ success: true, breaking: true, summary: { breaking: 1 } })
    expect(String(structured(diff).limitation)).toContain('不是完整的兼容性证明')
    const noChange = await connected.client.callTool({ name: 'openapi_diff', arguments: { before: yamlSource, after: yamlSource } })
    expect(structured(noChange)).toMatchObject({ breaking: false, changes: [] })
    const nonBreaking = await connected.client.callTool({ name: 'openapi_diff', arguments: { before: yamlSource, after: 'packages/mcp/src/fixtures/added.yaml' } })
    expect((structured(nonBreaking).changes as Array<{ classification: string }>).map(({ classification }) => classification)).toContain('non-breaking')
    const warning = await connected.client.callTool({ name: 'openapi_diff', arguments: { before: 'packages/mcp/src/fixtures/warning-before.yaml', after: 'packages/mcp/src/fixtures/warning-after.yaml' } })
    expect((structured(warning).changes as Array<{ classification: string }>).map(({ classification }) => classification)).toContain('warning')
    const invalidDiff = await connected.client.callTool({ name: 'openapi_diff', arguments: { before: 'packages/mcp/src/fixtures/invalid.yaml', after: yamlSource } })
    expect(invalidDiff.isError).toBe(true)
    const invalidAfterDiff = await connected.client.callTool({ name: 'openapi_diff', arguments: { before: yamlSource, after: 'packages/mcp/src/fixtures/invalid.yaml' } })
    expect(invalidAfterDiff.isError).toBe(true)

    const invalid = await connected.client.callTool({ name: 'openapi_validate', arguments: { source: 'packages/mcp/src/fixtures/invalid.yaml' } })
    expect(invalid.isError).toBe(true)
    expect(structured(invalid)).toMatchObject({ success: false })
    expect((structured(invalid).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('OPENAPI_PARSE_FAILED')

    const openapi32 = await connected.client.callTool({ name: 'openapi_validate', arguments: { source: 'packages/core/src/openapi/fixtures/openapi-3.2.yaml', failOnWarning: true } })
    expect(openapi32.isError).toBe(true)
    expect((structured(openapi32).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('OPENAPI_WARNINGS_AS_ERRORS')

    const remote = await connected.client.callTool({ name: 'openapi_validate', arguments: { source: 'http://127.0.0.1/spec.yaml', allowPrivateNetwork: true } })
    expect(remote.isError).toBe(true)
    expect((structured(remote).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('REMOTE_SOURCE_BLOCKED')

    const escaped = await connected.client.callTool({ name: 'openapi_validate', arguments: { source: '../outside.yaml' } })
    expect(escaped.isError).toBe(true)
    expect((structured(escaped).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_WORKSPACE_PATH_OUTSIDE_ROOT')

    const invalidArguments = await connected.client.callTool({ name: 'openapi_validate', arguments: { source: 123 } })
    expect(invalidArguments.isError).toBe(true)
    expect(invalidArguments.structuredContent).toBeUndefined()
    expect(JSON.stringify(invalidArguments.content)).toContain('-32602')
  })

  it('registers generation tools only for fixed trusted config and preserves stdio integrity', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-mcp-integration-'))
    temporaryRoots.push(root)
    await mkdir(path.join(root, '.openapi-to'))
    const spec = `openapi: 3.1.0
info: { title: Generation, version: "1" }
paths:
  /ping:
    get:
      operationId: ping
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PingResponse" }
  /pong:
    post:
      operationId: pong
      responses:
        "201":
          description: created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PongResponse" }
  /missing:
    get:
      responses: { "204": { description: empty } }
  /dup-a:
    get:
      operationId: duplicateFixture
      responses: { "200": { description: ok } }
  /dup-b:
    get:
      operationId: duplicateFixture
      responses: { "200": { description: ok } }
components:
  schemas:
    PingResponse:
      type: object
      properties:
        alpha: { type: string }
        beta: { type: string }
        gamma: { type: string }
    PongResponse:
      type: object
      properties:
        pong: { type: boolean }
`
    await writeFile(path.join(root, 'openapi.yaml'), spec)
    await writeFile(path.join(root, 'fail.yaml'), spec)
    await writeFile(path.join(root, 'conflict.yaml'), spec)
    await writeFile(
      path.join(root, 'openapi.config.js'),
      `let active = 0;
module.exports = {
  servers: [
    { name: 'main', input: { path: './openapi.yaml' }, output: { dir: 'generated', clean: true } },
    { name: 'second', input: { path: './openapi.yaml' }, output: { dir: 'second' } },
    { name: 'fail', input: { path: './fail.yaml' }, output: { dir: 'failed' } },
    { name: 'conflict', input: { path: './conflict.yaml' }, output: { dir: 'conflict' } }
  ],
  plugins: [{ name: 'stdio-fixture', hooks: { async buildStart(ctx) {
    const name = ctx.openapiToSingleConfig.name;
    if (name === 'fail') throw new Error('fixture plugin failed');
    if (name === 'conflict') {
      ctx.addArtifact({ kind: 'text', path: ctx.openapiToSingleConfig.output.dir + '/same.txt', content: 'one' });
      ctx.addArtifact({ kind: 'text', path: ctx.openapiToSingleConfig.output.dir + '/same.txt', content: 'two' });
      return;
    }
    active += 1;
    if (active > 1) throw new Error('generation was not serialized');
    console.log('plugin output');
    await new Promise(resolve => setTimeout(resolve, 20));
    ctx.addArtifact({ kind: 'text', path: ctx.openapiToSingleConfig.output.dir + '/hello.txt', content: 'hello\\n' });
    ctx.addArtifact({ kind: 'text', path: ctx.openapiToSingleConfig.output.dir + '/large.txt', content: 'x'.repeat(40000) });
    ctx.addArtifact({ kind: 'binary', path: ctx.openapiToSingleConfig.output.dir + '/blob.bin', content: new Uint8Array([0, 1, 2]) });
    active -= 1;
  } } }]
};
`,
    )

    const connected = await connect(root, 'openapi.config.js')
    clients.push(connected.client)
    const listed = await connected.client.listTools()
    expect(listed.tools.map(({ name }) => name)).toEqual([
      'openapi_validate',
      'openapi_inspect',
      'openapi_diff',
      'openapi_list_targets',
      'openapi_search_operations',
      'openapi_get_operation',
      'openapi_generate_dry_run',
      'openapi_check_generation',
    ])
    for (const tool of listed.tools) {
      expect(tool.inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
        $schema: 'http://json-schema.org/draft-07/schema#',
      })
      expect(tool.outputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
        $schema: 'http://json-schema.org/draft-07/schema#',
      })
    }
    const dryRunSchema = listed.tools.find(({ name }) => name === 'openapi_generate_dry_run')?.inputSchema as {
      properties?: { scope?: { anyOf?: Array<{ additionalProperties?: boolean; properties?: { type?: { const?: string }; operationKeys?: { type?: string; maxItems?: number } } }> } }
    }
    expect(dryRunSchema.properties?.scope?.anyOf).toEqual([
      expect.objectContaining({ additionalProperties: false, properties: expect.objectContaining({ type: expect.objectContaining({ const: 'full' }) }) }),
      expect.objectContaining({
        additionalProperties: false,
        properties: expect.objectContaining({
          type: expect.objectContaining({ const: 'operations' }),
          operationKeys: expect.objectContaining({ type: 'array', maxItems: 100 }),
        }),
      }),
    ])
    const operationSchema = listed.tools.find(({ name }) => name === 'openapi_get_operation')?.outputSchema as {
      definitions?: Record<string, { type?: string; additionalProperties?: boolean; properties?: Record<string, unknown> }>
      properties?: { byteLength?: unknown }
    }
    expect(operationSchema.definitions?.__schema0).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        properties: { type: 'array' },
        additionalProperties: { anyOf: [{ type: 'boolean' }, { $ref: '#/definitions/__schema0' }] },
      },
    })
    expect(operationSchema.properties?.byteLength).toEqual({ type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
    expect(JSON.stringify(listed.tools.map(({ inputSchema, outputSchema }) => ({ inputSchema, outputSchema })))).not.toContain('"type":"null"')

    const targets = await connected.client.callTool({ name: 'openapi_list_targets', arguments: {} })
    expect(targets.isError).not.toBe(true)
    expect((structured(targets).targets as Array<Record<string, unknown>>).map(({ name }) => name)).toEqual(['main', 'second', 'fail', 'conflict'])
    expect(JSON.stringify(targets)).not.toContain('openapi.yaml')

    const targetRequired = await connected.client.callTool({ name: 'openapi_search_operations', arguments: { query: 'ping' } })
    expect(targetRequired.isError).toBe(true)
    expect((structured(targetRequired).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_TARGET_REQUIRED')
    const search = await connected.client.callTool({ name: 'openapi_search_operations', arguments: { target: 'main', query: 'ping', limit: 8 } })
    expect(search.isError).not.toBe(true)
    expect(structured(search)).toMatchObject({ success: true, target: 'main', totalMatches: 1, items: [expect.objectContaining({ operationKey: 'ping', method: 'GET', path: '/ping' })] })
    expect(JSON.stringify(search)).not.toContain('"openapi"')
    const noSearchResults = await connected.client.callTool({ name: 'openapi_search_operations', arguments: { target: 'main', query: 'definitely absent' } })
    expect(structured(noSearchResults)).toMatchObject({ success: true, totalMatches: 0, items: [] })
    const contract = await connected.client.callTool({ name: 'openapi_get_operation', arguments: { target: 'main', operationKey: 'ping', detail: 'contract', schemaDepth: 1 } })
    expect(contract.isError).not.toBe(true)
    expect(structured(contract)).toMatchObject({ success: true, found: true, operation: { operationKey: 'ping', responses: [expect.objectContaining({ status: '200', success: true })] } })
    expect(JSON.stringify(contract)).not.toContain('"openapi"')
    const boundedContract = await connected.client.callTool({ name: 'openapi_get_operation', arguments: { target: 'main', operationKey: 'ping', maxPropertiesPerSchema: 1, maxSchemas: 1 } })
    expect(structured(boundedContract)).toMatchObject({ success: true, truncated: { contract: true, reasons: expect.arrayContaining(['maxPropertiesPerSchema']) } })
    expect((((structured(boundedContract).operation as { schemas: Array<{ properties: unknown[] }> }).schemas[0]?.properties) ?? [])).toHaveLength(1)
    const missingOperation = await connected.client.callTool({ name: 'openapi_get_operation', arguments: { target: 'main', operationKey: 'missing' } })
    expect(missingOperation.isError).toBe(true)
    expect((structured(missingOperation).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('OPERATION_NOT_FOUND')
    const unknownCatalogTarget = await connected.client.callTool({ name: 'openapi_search_operations', arguments: { target: 'unknown', query: 'ping' } })
    expect(unknownCatalogTarget.isError).toBe(true)
    expect((structured(unknownCatalogTarget).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_UNKNOWN_TARGET')

    const outputRoot = path.join(root, '.openapi-to/generated')
    const ownership = path.join(outputRoot, '.openapi-to-manifest.json')
    const dryRun = await connected.client.callTool({ name: 'openapi_generate_dry_run', arguments: { targets: ['main'], configPath: '../untrusted.js', allowPrivateNetwork: true } })
    expect(dryRun.isError).not.toBe(true)
    expect(structured(dryRun)).toMatchObject({ success: true, mode: 'dry-run', config: { path: 'openapi.config.js', targets: ['main'] } })
    const explicitFull = await connected.client.callTool({ name: 'openapi_generate_dry_run', arguments: { targets: ['main'], scope: { type: 'full' } } })
    expect(explicitFull.isError).not.toBe(true)
    expect((structured(explicitFull).servers as DryRunServer[])[0]?.manifest.hash).toBe((structured(dryRun).servers as DryRunServer[])[0]?.manifest.hash)
    await expect(access(outputRoot)).rejects.toThrow()
    await expect(access(ownership)).rejects.toThrow()

    const selective = await connected.client.callTool({
      name: 'openapi_generate_dry_run',
      arguments: { targets: ['main'], scope: { type: 'operations', operationKeys: ['ping'] } },
    })
    expect(selective.isError).not.toBe(true)
    expect(structured(selective)).toMatchObject({
      success: true,
      scope: { type: 'operations', requestedOperationKeys: ['ping'], resolvedOperationKeys: ['ping'] },
      projection: { operationCount: 1, pathCount: 1, schemaCount: 1, projectionHash: expect.any(String) },
    })
    expect(JSON.stringify(selective)).not.toContain('"openapi"')
    await expect(access(outputRoot)).rejects.toThrow()
    await expect(access(ownership)).rejects.toThrow()

    const reordered = await connected.client.callTool({
      name: 'openapi_generate_dry_run',
      arguments: { targets: ['main'], scope: { type: 'operations', operationKeys: ['pong', 'ping', 'ping'] } },
    })
    const sorted = await connected.client.callTool({
      name: 'openapi_generate_dry_run',
      arguments: { targets: ['main'], scope: { type: 'operations', operationKeys: ['ping', 'pong'] } },
    })
    expect(structured(reordered)).toMatchObject({ scope: { requestedOperationKeys: ['ping', 'pong'], resolvedOperationKeys: ['ping', 'pong'] }, projection: { operationCount: 2, pathCount: 2, schemaCount: 2 } })
    expect((structured(reordered).projection as { projectionHash: string }).projectionHash).toBe((structured(sorted).projection as { projectionHash: string }).projectionHash)
    expect((structured(reordered).servers as DryRunServer[])[0]?.manifest.hash).toBe((structured(sorted).servers as DryRunServer[])[0]?.manifest.hash)

    for (const [argumentsValue, code] of [
      [{ targets: ['main'], scope: { type: 'operations', operationKeys: [] } }, 'EMPTY_OPERATION_SELECTION'],
      [{ targets: ['main'], scope: { type: 'operations', operationKeys: ['unknown'] } }, 'UNKNOWN_OPERATION_KEY'],
      [{ targets: ['main', 'second'], scope: { type: 'operations', operationKeys: ['ping'] } }, 'SELECTIVE_GENERATION_SINGLE_TARGET_REQUIRED'],
      [{ targets: ['main'], scope: { type: 'operations', operationKeys: ['GET /missing'] } }, 'SELECTIVE_GENERATION_OPERATION_ID_REQUIRED'],
      [{ targets: ['main'], scope: { type: 'operations', operationKeys: ['GET /dup-a'] } }, 'SELECTIVE_GENERATION_DUPLICATE_OPERATION_ID'],
    ] as const) {
      const rejected = await connected.client.callTool({ name: 'openapi_generate_dry_run', arguments: argumentsValue })
      expect(rejected.isError).toBe(true)
      expect((structured(rejected).diagnostics as Array<{ code: string }>).map(({ code: diagnosticCode }) => diagnosticCode)).toContain(code)
    }

    const multiple = await connected.client.callTool({ name: 'openapi_generate_dry_run', arguments: { targets: ['second', 'main'] } })
    expect(structured(multiple)).toMatchObject({ success: true, config: { targets: ['main', 'second'] } })
    await expect(access(path.join(root, '.openapi-to/second'))).rejects.toThrow()

    const preview = await connected.client.callTool({ name: 'openapi_generate_dry_run', arguments: { targets: ['main'], includePreview: true } })
    const previewArtifacts = ((structured(preview).servers as Array<{ manifest: { artifacts: Array<Record<string, unknown>> } }>)[0]?.manifest.artifacts ?? [])
    expect(previewArtifacts.find(({ path }) => path === 'large.txt')).toMatchObject({ previewTruncated: true })
    expect(previewArtifacts.find(({ path }) => path === 'blob.bin')).not.toHaveProperty('preview')
    expect(connected.stderr.join('')).toContain('plugin output')

    const unknown = await connected.client.callTool({ name: 'openapi_generate_dry_run', arguments: { targets: ['unknown'] } })
    expect(unknown.isError).toBe(true)
    expect((structured(unknown).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_UNKNOWN_TARGET')

    const failed = await connected.client.callTool({ name: 'openapi_generate_dry_run', arguments: { targets: ['fail'] } })
    expect(failed.isError).toBe(true)
    const afterFailure = await connected.client.callTool({ name: 'openapi_generate_dry_run', arguments: { targets: ['main'] } })
    expect(afterFailure.isError).not.toBe(true)

    const conflict = await connected.client.callTool({ name: 'openapi_generate_dry_run', arguments: { targets: ['conflict'] } })
    expect(conflict.isError).toBe(true)
    expect((structured(conflict).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('ARTIFACT_PATH_CONFLICT')

    const concurrent = await Promise.all([
      connected.client.callTool({ name: 'openapi_generate_dry_run', arguments: { targets: ['main'] } }),
      connected.client.callTool({ name: 'openapi_check_generation', arguments: { targets: ['main'] } }),
    ])
    expect(concurrent.every((result) => (structured(result).diagnostics as Array<{ cause?: string }>).every(({ cause }) => !cause?.includes('not serialized')))).toBe(true)

    await mkdir(outputRoot, { recursive: true })
    await writeFile(path.join(outputRoot, 'hello.txt'), 'hello\n')
    await writeFile(path.join(outputRoot, 'large.txt'), 'x'.repeat(40000))
    await writeFile(path.join(outputRoot, 'blob.bin'), new Uint8Array([0, 1, 2]))
    await writeFile(path.join(outputRoot, 'user.txt'), 'unmanaged')
    await writeFile(ownership, `${JSON.stringify({ version: 1, files: ['blob.bin', 'hello.txt', 'large.txt'] }, null, 2)}\n`)
    const ownershipBefore = await readFile(ownership, 'utf8')
    const current = await connected.client.callTool({ name: 'openapi_check_generation', arguments: { targets: ['main'] } })
    expect(current.isError).not.toBe(true)
    expect(structured(current)).toMatchObject({ success: true, outdated: false })

    await writeFile(path.join(outputRoot, 'hello.txt'), 'outdated')
    await rm(path.join(outputRoot, 'blob.bin'))
    await writeFile(path.join(outputRoot, 'old.txt'), 'managed old output')
    await writeFile(ownership, `${JSON.stringify({ version: 1, files: ['blob.bin', 'hello.txt', 'large.txt', 'old.txt'] }, null, 2)}\n`)
    const staleOwnership = await readFile(ownership, 'utf8')
    const outdated = await connected.client.callTool({ name: 'openapi_check_generation', arguments: { targets: ['main'] } })
    expect(outdated.isError).toBe(true)
    expect(structured(outdated)).toMatchObject({ success: false, outdated: true })
    const statuses = ((structured(outdated).servers as Array<{ changes: Array<{ status: string }> }>)[0]?.changes ?? []).map(({ status }) => status).sort()
    expect(statuses).toEqual(['added', 'deleted', 'modified'])
    expect(await readFile(path.join(outputRoot, 'hello.txt'), 'utf8')).toBe('outdated')
    expect(await readFile(path.join(outputRoot, 'user.txt'), 'utf8')).toBe('unmanaged')
    expect(await readFile(ownership, 'utf8')).toBe(staleOwnership)
    expect(ownershipBefore).not.toBe(staleOwnership)
  }, MCP_GENERATION_TEST_TIMEOUT_MS)

  it('keeps generation tools stable when a supplied startup config fails to load', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-mcp-bad-config-'))
    await writeFile(path.join(root, 'bad.config.ts'), 'throw new Error("secret token=do-not-return")\n')
    const connected = await connect(root, 'bad.config.ts')
    clients.push(connected.client)
    expect((await connected.client.listTools()).tools).toHaveLength(8)
    const result = await connected.client.callTool({ name: 'openapi_generate_dry_run', arguments: {} })
    expect(result.isError).toBe(true)
    expect((structured(result).diagnostics as Array<{ code: string; message: string }>)).toEqual([
      expect.objectContaining({ code: 'MCP_CONFIG_LOAD_FAILED' }),
    ])
    expect(JSON.stringify(result)).not.toContain('do-not-return')
  })

  it('rejects unsafe or overlapping configured output roots before any target generation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-mcp-output-preflight-'))
    await mkdir(path.join(root, '.openapi-to'))
    await writeFile(
      path.join(root, 'openapi.yaml'),
      'openapi: 3.1.0\ninfo: { title: Output preflight, version: "1" }\npaths: {}\n',
    )
    await writeFile(
      path.join(root, 'openapi.config.js'),
      `module.exports = {
        servers: [
          { name: 'safe', input: { path: './openapi.yaml' }, output: { base: 'workspace', dir: 'src/generated' } },
          { name: 'nested', input: { path: './openapi.yaml' }, output: { base: 'workspace', dir: 'src/generated/nested' } }
        ],
        plugins: [{ name: 'must-not-run', hooks: { buildStart(ctx) { ctx.addArtifact({ kind: 'text', path: ctx.openapiToSingleConfig.output.dir + '/unexpected.txt', content: 'unexpected' }) } } }]
      }\n`,
    )
    const connected = await connect(root, 'openapi.config.js')
    clients.push(connected.client)
    const result = await connected.client.callTool({
      name: 'openapi_generate_dry_run',
      arguments: { targets: ['safe'] },
    })
    expect(result.isError).toBe(true)
    expect((structured(result).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain(
      'CONFIG_OUTPUT_OVERLAP',
    )
    await expect(access(path.join(root, 'src/generated'))).rejects.toThrow()
  })

  it('keeps trusted catalog sources inside Workspace and preserves remote and secret boundaries', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-mcp-catalog-security-'))
    await mkdir(path.join(root, '.openapi-to'))
    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.yaml`)
    await writeFile(outside, 'openapi: 3.1.0\ninfo: { title: Outside, version: "1" }\npaths: {}\n')
    await writeFile(
      path.join(root, 'openapi.config.js'),
      `module.exports = { servers: [
        { name: 'escape', input: { path: '../${path.basename(outside)}' }, output: { dir: 'escape' } },
        { name: 'private', input: { path: 'http://127.0.0.1/openapi.yaml', remote: { headers: { Authorization: 'Bearer catalog-secret-token' } } }, output: { dir: 'private' } }
      ], plugins: [] }\n`,
    )
    const connected = await connect(root, 'openapi.config.js')
    clients.push(connected.client)
    const escaped = await connected.client.callTool({ name: 'openapi_search_operations', arguments: { target: 'escape', query: 'anything' } })
    expect(escaped.isError).toBe(true)
    expect((structured(escaped).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_WORKSPACE_PATH_OUTSIDE_ROOT')
    const remote = await connected.client.callTool({ name: 'openapi_search_operations', arguments: { target: 'private', query: 'anything' } })
    expect(remote.isError).toBe(true)
    expect((structured(remote).diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('REMOTE_SOURCE_BLOCKED')
    const listed = await connected.client.callTool({ name: 'openapi_list_targets', arguments: {} })
    expect(JSON.stringify([escaped, remote, listed])).not.toContain('catalog-secret-token')
    expect(JSON.stringify(listed)).not.toContain('127.0.0.1')
  })

  it('intersects Target remote requirements with operator bounds without dropping trusted headers', async () => {
    const receivedAuthorization: Array<string | undefined> = []
    const remoteServer = createServer((request, response) => {
      receivedAuthorization.push(request.headers.authorization)
      response.end(
        '{"openapi":"3.1.0","info":{"title":"Remote target","version":"1"},"paths":{"/ping":{"get":{"operationId":"ping","responses":{"200":{"description":"ok"}}}}}}',
      )
    })
    remoteServer.listen(0, '127.0.0.1')
    await once(remoteServer, 'listening')
    try {
      const address = remoteServer.address()
      if (!address || typeof address === 'string') throw new Error('Unable to bind remote target fixture.')
      const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-mcp-remote-policy-'))
      await mkdir(path.join(root, '.openapi-to'))
      await writeFile(
        path.join(root, 'openapi.config.js'),
        `module.exports = { servers: [{
          name: 'remote',
          input: {
            path: 'http://127.0.0.1:${address.port}/openapi.yaml',
            remote: {
              allowPrivateNetwork: true,
              allowedHosts: ['127.0.0.1'],
              headers: { Authorization: 'Bearer target-only-secret' },
              timeoutMs: 10000,
              maxResponseBytes: 100000,
              maxRedirects: 3
            }
          },
          output: { dir: 'remote' }
        }], plugins: [] }\n`,
      )
      const connected = await connect(root, 'openapi.config.js', [
        '--allow-private-network',
        '--allow-host',
        '127.0.0.1',
      ])
      clients.push(connected.client)
      const searched = await connected.client.callTool({
        name: 'openapi_search_operations',
        arguments: { target: 'remote', query: 'ping' },
      })
      expect(searched.isError).not.toBe(true)
      expect(receivedAuthorization).toEqual(['Bearer target-only-secret'])
      expect(JSON.stringify(searched)).not.toContain('target-only-secret')
      expect(connected.stderr.join('')).not.toContain('target-only-secret')

      const restricted = await connect(root, 'openapi.config.js', [
        '--allow-private-network',
        '--allow-host',
        'schemas.example.com',
      ])
      clients.push(restricted.client)
      const blocked = await restricted.client.callTool({
        name: 'openapi_search_operations',
        arguments: { target: 'remote', query: 'ping' },
      })
      expect(blocked.isError).toBe(true)
      expect(
        (structured(blocked).diagnostics as Array<{ code: string }>).map(
          ({ code }) => code,
        ),
      ).toContain('CONFIG_REMOTE_POLICY_CONFLICT')
      expect(JSON.stringify(blocked)).not.toContain('target-only-secret')
    } finally {
      const closed = once(remoteServer, 'close')
      remoteServer.close()
      remoteServer.closeAllConnections()
      await closed
    }
  })
})
