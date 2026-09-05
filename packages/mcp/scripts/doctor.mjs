import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageManifest = path.join(packageRoot, 'package.json')
const bin = path.join(packageRoot, 'bin/openapi-to-mcp.js')
const builtEntrypoint = path.join(packageRoot, 'dist/cli.js')
const totalTimeoutMs = 120_000
const callTimeoutMs = 30_000
const sourceSentinel = 'doctor-source-body-sentinel'
const generatedSentinel = 'doctor-generated-body-sentinel'

const analysisTools = ['openapi_validate', 'openapi_inspect', 'openapi_diff']
const catalogTools = ['openapi_list_targets', 'openapi_search_operations', 'openapi_get_operation']
const configuredTools = [...analysisTools, ...catalogTools, 'openapi_generate_dry_run', 'openapi_check_generation']
const writeTools = [...configuredTools, 'openapi_prepare_generation', 'openapi_apply_generation']
const expectedInputProperties = {
  openapi_validate: ['failOnWarning', 'source'],
  openapi_inspect: ['includeOperations', 'source'],
  openapi_diff: ['after', 'before'],
  openapi_list_targets: [],
  openapi_search_operations: ['includeDeprecated', 'limit', 'methods', 'query', 'tags', 'target'],
  openapi_get_operation: ['detail', 'includeExamples', 'maxBytes', 'maxPropertiesPerSchema', 'maxSchemas', 'operationKey', 'schemaDepth', 'target'],
  openapi_generate_dry_run: ['includePreview', 'scope', 'targets'],
  openapi_check_generation: ['targets'],
  openapi_prepare_generation: ['includePreview', 'selection', 'targets'],
  openapi_apply_generation: ['approvedPlanHash', 'planId', 'token'],
}
const expectedRequiredProperties = {
  openapi_validate: ['source'],
  openapi_inspect: ['source'],
  openapi_diff: ['after', 'before'],
  openapi_list_targets: [],
  openapi_search_operations: ['query'],
  openapi_get_operation: ['operationKey'],
  openapi_generate_dry_run: [],
  openapi_check_generation: [],
  openapi_prepare_generation: [],
  openapi_apply_generation: ['approvedPlanHash', 'planId', 'token'],
}

const checkDefinitions = [
  ['arguments', 'Doctor arguments are valid'],
  ['node-version', 'Node.js satisfies the MCP runtime baseline'],
  ['built-binary', 'Built openapi-to-mcp entrypoint is available'],
  ['workspace-setup', 'Synthetic offline workspace is ready'],
  ['matrix-3', 'No-config server exposes the three-tool contract'],
  ['server-identity', 'Negotiated MCP server identity matches the package'],
  ['validate', 'Validate succeeds through the official SDK client'],
  ['inspect', 'Inspect returns the expected bounded shape'],
  ['diff', 'Diff reports the synthetic contract addition'],
  ['close-3', 'No-config stdio server closes cleanly'],
  ['matrix-8', 'Configured server exposes the eight-tool contract'],
  ['list-targets', 'Trusted target discovery returns bounded metadata'],
  ['search-operations', 'Operation search returns lightweight candidates'],
  ['get-operation', 'Operation contract reading returns one bounded contract'],
  ['dry-run', 'Dry-run reports artifacts without writing'],
  ['check-outdated', 'Check reports the absent output as outdated'],
  ['close-8', 'Configured stdio server closes cleanly'],
  ['read-only-no-write', 'Configured read-only tools preserve persistent workspace bytes'],
  ['matrix-10', 'Write-enabled server exposes the ten-tool contract'],
  ['selective-prepare-no-write', 'Selective Prepare binds desired selection and token without writing'],
  ['selective-apply', 'Selective Apply atomically commits generated output, ownership, and selection'],
  ['selective-replay', 'Selective Apply replay is rejected'],
  ['prepare-no-write', 'Prepare returns a plan without writing'],
  ['apply', 'Apply commits the reviewed plan exactly once'],
  ['replay', 'Apply replay is rejected'],
  ['check-current', 'Check reports applied output as current'],
  ['prepare-unchanged', 'A second Prepare reports only unchanged artifacts'],
  ['close-10', 'Write-enabled stdio server closes cleanly'],
  ['redaction', 'Tool results redact paths and bodies; logs redact plan tokens'],
  ['temporary-cleanup', 'Synthetic workspace is removed'],
  ['report-output', 'Optional JSON report output is written'],
]

class DoctorFailure extends Error {}

function assert(condition, message) {
  if (!condition) throw new DoctorFailure(message)
}

function equalValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function parseArguments(argv) {
  let json = false
  let output
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--json') {
      assert(!json, '--json may be specified only once.')
      json = true
      continue
    }
    if (argument === '--output') {
      assert(output === undefined, '--output may be specified only once.')
      const value = argv[index + 1]
      assert(typeof value === 'string' && value.length > 0 && !value.startsWith('--'), '--output requires a file path.')
      output = value
      index += 1
      continue
    }
    throw new DoctorFailure('Unknown doctor argument.')
  }
  return { json, output }
}

function createChecks() {
  return checkDefinitions.map(([id, title]) => ({ id, title, status: 'skipped', durationMs: 0 }))
}

function failureCodeFor(id) {
  return `DOCTOR_${id.replaceAll('-', '_').toUpperCase()}_FAILED`
}

function elapsedMilliseconds(started) {
  return Math.max(0, Math.round(performance.now() - started))
}

function setCheck(checks, id, status, detail, durationMs = 0) {
  const check = checks.find((candidate) => candidate.id === id)
  if (!check) throw new Error('Unknown doctor check.')
  check.status = status
  check.durationMs = durationMs
  if (detail) check.detail = detail
  if (status === 'failed') check.failureCode = failureCodeFor(id)
}

function safeFailure(error) {
  return error instanceof DoctorFailure ? error.message : 'Unexpected runtime failure.'
}

async function runCheck(checks, id, operation) {
  const started = performance.now()
  try {
    await operation()
    setCheck(checks, id, 'passed', undefined, elapsedMilliseconds(started))
  } catch (error) {
    setCheck(checks, id, 'failed', safeFailure(error), elapsedMilliseconds(started))
    throw error
  }
}

function buildReport(checks, state) {
  const passed = checks.filter(({ status }) => status === 'passed').length
  const failed = checks.filter(({ status }) => status === 'failed').length
  const skipped = checks.filter(({ status }) => status === 'skipped').length
  return {
    schemaVersion: 1,
    product: 'openapi-to-mcp',
    nodeVersion: process.versions.node,
    packageVersion: state.packageVersion,
    serverName: state.serverName,
    serverVersion: state.serverVersion,
    toolMatrices: state.toolMatrices,
    success: failed === 0 && skipped === 0,
    summary: { passed, failed, skipped, total: checks.length },
    durations: {
      totalMs: state.totalDurationMs,
      checks: Object.fromEntries(checks.map(({ id, durationMs }) => [id, durationMs])),
    },
    failureCodes: checks.filter(({ status }) => status === 'failed').map(({ failureCode }) => failureCode),
    checks,
  }
}

function annotationFor(name) {
  if (name === 'openapi_prepare_generation') {
    return { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }
  if (name === 'openapi_apply_generation') {
    return { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  }
  if (catalogTools.includes(name)) return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
}

function assertToolContracts(tools, expectedNames) {
  assert(equalValues(tools.map(({ name }) => name), expectedNames), 'Tool names or registration order changed.')
  for (const tool of tools) {
    assert(typeof tool.title === 'string' && tool.title.length > 0, 'A listed tool is missing its title.')
    assert(typeof tool.description === 'string' && tool.description.length > 0, 'A listed tool is missing its description.')
    assert(tool.inputSchema?.type === 'object' && tool.inputSchema.additionalProperties === false, 'A tool input schema is not a strict object.')
    assert(tool.outputSchema?.type === 'object' && tool.outputSchema.additionalProperties === false, 'A tool output schema is not a strict object.')
    assert(
      equalValues(Object.keys(tool.inputSchema.properties ?? {}).sort(), expectedInputProperties[tool.name]),
      'A tool input schema has an unexpected property surface.',
    )
    assert(
      equalValues([...(tool.inputSchema.required ?? [])].sort(), expectedRequiredProperties[tool.name]),
      'A tool input schema has an unexpected required-field surface.',
    )
    assert(tool.outputSchema.properties?.schemaVersion?.const === 1, 'A tool output schema is missing schemaVersion 1.')
    assert(tool.outputSchema.properties?.tool?.const === tool.name, 'A tool output schema is not bound to its tool name.')
    assert(tool.outputSchema.properties?.success?.type === 'boolean', 'A tool output schema is missing its success field.')
    assert(equalValues(tool.annotations, annotationFor(tool.name)), 'A tool annotation contract changed.')
  }
}

function assertNestedToolSchemaContracts(tools) {
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  const schemaFor = (name, side) => {
    const schema = byName.get(name)?.[side]
    assert(schema && typeof schema === 'object', `The ${name} ${side} is unavailable.`)
    return schema
  }

  for (const tool of tools) {
    assert(tool.inputSchema?.$schema === 'http://json-schema.org/draft-07/schema#', 'A tool input schema changed JSON Schema dialect.')
    assert(tool.outputSchema?.$schema === 'http://json-schema.org/draft-07/schema#', 'A tool output schema changed JSON Schema dialect.')
  }

  const searchInput = schemaFor('openapi_search_operations', 'inputSchema')
  assert(
    equalValues(searchInput.properties?.methods, {
      maxItems: 20,
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 20 },
    }),
    'Operation search changed its bounded methods array schema.',
  )
  assert(
    equalValues(searchInput.properties?.limit, { type: 'integer', minimum: 1, maximum: 50 }),
    'Operation search changed its bounded integer schema.',
  )

  const dryRunInput = schemaFor('openapi_generate_dry_run', 'inputSchema')
  const scopeBranches = dryRunInput.properties?.scope?.anyOf
  assert(Array.isArray(scopeBranches) && scopeBranches.length === 2, 'Dry-run scope is no longer the two-branch union contract.')
  assert(scopeBranches.every((branch) => branch.additionalProperties === false), 'A dry-run scope branch is not strict.')
  assert(scopeBranches[0]?.properties?.type?.const === 'full', 'Dry-run full scope changed its discriminator.')
  assert(
    scopeBranches[1]?.properties?.type?.const === 'operations'
      && scopeBranches[1]?.properties?.operationKeys?.type === 'array'
      && scopeBranches[1]?.properties?.operationKeys?.maxItems === 100,
    'Dry-run operation scope changed its bounded nested array contract.',
  )

  const prepareInput = schemaFor('openapi_prepare_generation', 'inputSchema')
  const selectionBranches = prepareInput.properties?.selection?.anyOf
  assert(Array.isArray(selectionBranches) && selectionBranches.length === 2, 'Prepare selection is no longer the two-branch union contract.')
  assert(selectionBranches.every((branch) => branch.additionalProperties === false), 'A Prepare selection branch is not strict.')
  assert(
    selectionBranches[0]?.properties?.type?.const === 'add'
      && selectionBranches[0]?.properties?.operationKeys?.type === 'array'
      && selectionBranches[0]?.properties?.operationKeys?.maxItems === 500,
    'Prepare add selection changed its bounded array contract.',
  )
  assert(
    selectionBranches[1]?.properties?.type?.const === 'replace'
      && selectionBranches[1]?.properties?.operationKeys?.minItems === 1
      && selectionBranches[1]?.properties?.operationKeys?.maxItems === 5_000,
    'Prepare replace selection changed its bounded array contract.',
  )

  const operationOutput = schemaFor('openapi_get_operation', 'outputSchema')
  const schemaSummary = operationOutput.definitions?.__schema0
  assert(schemaSummary?.type === 'object' && schemaSummary.additionalProperties === false, 'Operation schema summaries lost their recursive strict-object definition.')
  assert(
    equalValues(schemaSummary.properties?.type?.anyOf, [
      { type: 'string' },
      { type: 'array', items: { type: 'string' } },
    ]),
    'Operation schema summaries changed their string-or-array type union.',
  )
  assert(
    schemaSummary.properties?.properties?.type === 'array'
      && schemaSummary.properties?.properties?.items?.properties?.schema?.$ref === '#/definitions/__schema0',
    'Operation schema summaries lost their recursive nested-property contract.',
  )
  assert(
    schemaSummary.properties?.additionalProperties?.anyOf?.[0]?.type === 'boolean'
      && schemaSummary.properties?.additionalProperties?.anyOf?.[1]?.$ref === '#/definitions/__schema0',
    'Operation schema summaries changed their boolean-or-schema additionalProperties union.',
  )
  assert(
    schemaSummary.properties?.discriminator?.properties?.mapping?.propertyNames?.type === 'string'
      && schemaSummary.properties?.discriminator?.properties?.mapping?.additionalProperties?.type === 'string',
    'Operation schema discriminator mappings changed their string-record contract.',
  )
  assert(
    equalValues(operationOutput.properties?.byteLength, {
      type: 'integer',
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    }),
    'Operation contract byteLength changed its Zod 4 safe-integer wire bound.',
  )

  const serializedSchemas = JSON.stringify(tools.map(({ inputSchema, outputSchema }) => ({ inputSchema, outputSchema })))
  assert(!serializedSchemas.includes('"type":"null"'), 'A Tool schema unexpectedly became nullable.')
}

function structured(result, tool) {
  const value = result.structuredContent
  assert(value && typeof value === 'object' && !Array.isArray(value), 'A tool result is missing structured content.')
  assert(value.schemaVersion === 1 && value.tool === tool, 'A tool result has an unexpected envelope.')
  assert(Array.isArray(result.content) && result.content.length === 1 && result.content[0]?.type === 'text', 'A tool result is missing its single text summary.')
  return value
}

function successful(result, tool) {
  const value = structured(result, tool)
  assert(result.isError !== true && value.success === true, 'A tool call did not succeed.')
  return value
}

async function readPackageIdentity() {
  const manifest = JSON.parse(await readFile(packageManifest, 'utf8'))
  assert(manifest.name === '@openapi-to/mcp', 'The MCP package name is unexpected.')
  assert(typeof manifest.version === 'string' && manifest.version.length > 0, 'The MCP package version is unavailable.')
  return { name: manifest.name, version: manifest.version }
}

function assertServerIdentity(connection, state) {
  const identity = connection.client.getServerVersion()
  assert(identity?.name === state.packageName && identity?.version === state.packageVersion, 'Negotiated MCP server identity does not match the package.')
  if (state.serverName === 'unknown') {
    state.serverName = identity.name
    state.serverVersion = identity.version
    return
  }
  assert(identity.name === state.serverName && identity.version === state.serverVersion, 'MCP server identity changed between tool matrices.')
}

function assertNodeVersion() {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10)
  assert(Number.isInteger(major) && major >= 22, 'Node.js 22 or newer is required.')
}

async function missing(filePath) {
  try {
    await access(filePath)
    return false
  } catch (error) {
    if (error && error.code === 'ENOENT') return true
    throw error
  }
}

async function snapshotTree(root) {
  const snapshot = []
  async function visit(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        snapshot.push({ path: `${relativePath}/`, type: 'directory' })
        await visit(fullPath, relativePath)
        continue
      }
      assert(entry.isFile(), 'Synthetic workspace contains an unexpected file type.')
      const content = await readFile(fullPath)
      snapshot.push({ path: relativePath, type: 'file', bytes: content.byteLength, sha256: createHash('sha256').update(content).digest('hex') })
    }
  }
  await visit(root)
  return snapshot
}

function createSpecification(includeHealth) {
  return `${JSON.stringify(
    {
      openapi: '3.1.0',
      info: { title: 'MCP Doctor', version: '1.0.0', description: sourceSentinel },
      paths: {
        '/pets': {
          get: {
            operationId: 'listPets',
            tags: ['pets'],
            responses: { 200: { description: 'ok' } },
          },
        },
        ...(includeHealth
          ? {
              '/health': {
                get: {
                  operationId: 'health',
                  responses: { 200: { description: 'ok' } },
                },
              },
            }
          : {}),
      },
    },
    null,
    2,
  )}\n`
}

async function createWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-to-mcp-doctor-'))
  await mkdir(path.join(root, '.openapi-to'))
  await writeFile(path.join(root, 'before.json'), createSpecification(false))
  await writeFile(path.join(root, 'after.json'), createSpecification(true))
  await writeFile(
    path.join(root, 'openapi.config.cjs'),
    `module.exports = {
  servers: [{ name: 'doctor', input: { path: './before.json' }, output: { dir: 'generated', clean: true } }],
  plugins: [{ name: 'doctor-fixture', hooks: { buildStart(ctx) {
    const root = ctx.openapiToSingleConfig.output.dir;
    ctx.addArtifact({ kind: 'text', path: root + '/client.txt', content: ${JSON.stringify(`${generatedSentinel}\n`)} });
    ctx.addArtifact({ kind: 'json', path: root + '/metadata.json', value: { stable: true } });
  } } }]
};
`,
  )
  return root
}

function remainingMilliseconds(deadline) {
  return Math.max(0, deadline - Date.now())
}

async function withTimeout(promise, timeoutMs, message) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new DoctorFailure(message)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function runDoctor(checks, state) {
  const activeConnections = new Set()
  const payloads = []
  const stderrChunks = []
  const planTokens = []
  const deadline = Date.now() + totalTimeoutMs
  const controller = new AbortController()
  const totalTimer = setTimeout(() => controller.abort(new DoctorFailure('The MCP doctor exceeded its total deadline.')), totalTimeoutMs)
  totalTimer.unref()
  let workspaceRoot

  const bounded = async (promise, message) => {
    const remaining = remainingMilliseconds(deadline)
    assert(remaining > 0 && !controller.signal.aborted, 'The MCP doctor exceeded its total deadline.')
    return withTimeout(promise, Math.min(callTimeoutMs, remaining), message)
  }

  const connect = async ({ config = false, allowWrite = false } = {}) => {
    const stderr = []
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        bin,
        '--workspace-root',
        workspaceRoot,
        ...(config ? ['--config', 'openapi.config.cjs'] : []),
        ...(allowWrite ? ['--allow-write'] : []),
        '--log-format',
        'json',
        '--log-level',
        'info',
      ],
      stderr: 'pipe',
    })
    transport.stderr?.on('data', (chunk) => stderr.push(Buffer.from(chunk)))
    const client = new Client({ name: 'openapi-to-mcp-doctor', version: '1.0.0' })
    const connection = { client, transport, stderr, closed: false }
    activeConnections.add(connection)
    await bounded(client.connect(transport), 'MCP stdio initialization timed out.')
    return connection
  }

  const closeConnection = async (connection) => {
    if (connection.closed) return
    const child = connection.transport._process
    let failure
    try {
      await withTimeout(connection.client.close(), 6_000, 'MCP stdio shutdown timed out.')
      if (child && child.exitCode === null && child.signalCode === null) {
        await withTimeout(
          new Promise((resolve) => child.once('close', resolve)),
          1_000,
          'MCP subprocess did not exit after shutdown.',
        )
      }
      assert(!child || (child.exitCode === 0 && child.signalCode === null), 'MCP subprocess did not exit cleanly.')
    } catch (error) {
      failure = error
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
        try {
          await withTimeout(new Promise((resolve) => child.once('close', resolve)), 1_000, 'MCP subprocess ignored termination.')
        } catch {
          child.kill('SIGKILL')
        }
      }
    } finally {
      connection.closed = true
      activeConnections.delete(connection)
      stderrChunks.push(...connection.stderr)
    }
    if (failure) throw failure
  }

  const listTools = async (connection) => {
    const listed = await bounded(
      connection.client.listTools(undefined, { signal: controller.signal, timeout: Math.min(callTimeoutMs, remainingMilliseconds(deadline)) }),
      'Tool discovery timed out.',
    )
    payloads.push(listed)
    return listed.tools
  }

  const callTool = async (connection, name, argumentsValue) => {
    const result = await bounded(
      connection.client.callTool(
        { name, arguments: argumentsValue },
        undefined,
        { signal: controller.signal, timeout: Math.min(callTimeoutMs, remainingMilliseconds(deadline)) },
      ),
      'MCP tool execution timed out.',
    )
    payloads.push(result)
    return result
  }

  try {
    await runCheck(checks, 'built-binary', async () => {
      assert(state.packageMetadataValid, 'The MCP package metadata is unavailable.')
      assert(!(await missing(builtEntrypoint)) && !(await missing(bin)), 'The built MCP binary is unavailable; build @openapi-to/mcp first.')
    })
    await runCheck(checks, 'workspace-setup', async () => {
      workspaceRoot = await createWorkspace()
      assert(!(await missing(path.join(workspaceRoot, 'openapi.config.cjs'))), 'Synthetic workspace setup failed.')
    })

    let noConfig
    await runCheck(checks, 'matrix-3', async () => {
      noConfig = await connect()
      const tools = await listTools(noConfig)
      state.toolMatrices.noConfig = tools.length
      assertToolContracts(tools, analysisTools)
    })
    await runCheck(checks, 'server-identity', async () => assertServerIdentity(noConfig, state))
    await runCheck(checks, 'validate', async () => {
      const value = successful(await callTool(noConfig, 'openapi_validate', { source: 'before.json' }), 'openapi_validate')
      assert(value.openapiVersion === '3.1.0' && value.diagnosticSummary?.errors === 0, 'Validate returned an unexpected result.')
    })
    await runCheck(checks, 'inspect', async () => {
      const value = successful(await callTool(noConfig, 'openapi_inspect', { source: 'before.json', includeOperations: true }), 'openapi_inspect')
      assert(value.inspection?.pathCount === 1 && value.inspection?.operationCount === 1, 'Inspect returned unexpected operation counts.')
      assert(Array.isArray(value.inspection?.operations) && value.inspection.operations.length === 1, 'Inspect omitted the requested bounded operations.')
    })
    await runCheck(checks, 'diff', async () => {
      const value = successful(await callTool(noConfig, 'openapi_diff', { before: 'before.json', after: 'after.json' }), 'openapi_diff')
      assert(value.breaking === false && Array.isArray(value.changes) && value.changes.length > 0, 'Diff did not report the synthetic addition.')
    })
    await runCheck(checks, 'close-3', () => closeConnection(noConfig))

    let readOnlyBefore
    let configured
    await runCheck(checks, 'matrix-8', async () => {
      readOnlyBefore = await snapshotTree(workspaceRoot)
      configured = await connect({ config: true })
      assertServerIdentity(configured, state)
      const tools = await listTools(configured)
      state.toolMatrices.configured = tools.length
      assertToolContracts(tools, configuredTools)
    })
    await runCheck(checks, 'list-targets', async () => {
      const value = successful(await callTool(configured, 'openapi_list_targets', {}), 'openapi_list_targets')
      assert(value.targets?.length === 1 && value.targets[0]?.name === 'doctor' && value.targets[0]?.operationCount === 1, 'Target discovery returned unexpected bounded metadata.')
    })
    await runCheck(checks, 'search-operations', async () => {
      const value = successful(await callTool(configured, 'openapi_search_operations', { target: 'doctor', query: 'list pets' }), 'openapi_search_operations')
      assert(value.items?.length === 1 && value.items[0]?.operationKey === 'listPets' && value.items[0]?.path === '/pets', 'Operation search returned unexpected candidates.')
      assert(!JSON.stringify(value).includes(sourceSentinel), 'Operation search leaked the OpenAPI document body.')
    })
    await runCheck(checks, 'get-operation', async () => {
      const value = successful(await callTool(configured, 'openapi_get_operation', { target: 'doctor', operationKey: 'listPets', detail: 'contract' }), 'openapi_get_operation')
      assert(value.found === true && value.operation?.responses?.[0]?.status === '200', 'Operation contract lookup returned an unexpected result.')
      assert(!JSON.stringify(value).includes(sourceSentinel), 'Operation contract lookup leaked the OpenAPI document body.')
    })
    await runCheck(checks, 'dry-run', async () => {
      const value = successful(await callTool(configured, 'openapi_generate_dry_run', { targets: ['doctor'] }), 'openapi_generate_dry_run')
      assert(value.mode === 'dry-run' && value.truncated?.totalArtifacts === 2, 'Dry-run returned an unexpected artifact plan.')
      assert(value.servers?.[0]?.summary?.added === 2, 'Dry-run returned an unexpected change summary.')
      const selective = successful(
        await callTool(configured, 'openapi_generate_dry_run', {
          targets: ['doctor'],
          scope: { type: 'operations', operationKeys: ['listPets'] },
        }),
        'openapi_generate_dry_run',
      )
      assert(selective.scope?.resolvedOperationKeys?.[0] === 'listPets', 'Selective dry-run did not resolve the requested operation.')
      assert(selective.projection?.operationCount === 1 && typeof selective.projection?.projectionHash === 'string', 'Selective dry-run omitted its bounded projection summary.')
      assert(!JSON.stringify(selective).includes(sourceSentinel), 'Selective dry-run leaked the OpenAPI document body.')
    })
    await runCheck(checks, 'check-outdated', async () => {
      const result = await callTool(configured, 'openapi_check_generation', { targets: ['doctor'] })
      const value = structured(result, 'openapi_check_generation')
      assert(result.isError === true && value.success === false && value.outdated === true, 'Check did not report absent generated output as outdated.')
      assert(value.truncated?.totalChanges === 2, 'Check returned an unexpected change count.')
    })
    await runCheck(checks, 'close-8', () => closeConnection(configured))
    await runCheck(checks, 'read-only-no-write', async () => {
      assert(equalValues(await snapshotTree(workspaceRoot), readOnlyBefore), 'A configured read-only tool modified the workspace.')
      assert(await missing(path.join(workspaceRoot, '.openapi-to/generated')), 'A configured read-only tool created the output root.')
    })

    let writeEnabled
    await runCheck(checks, 'matrix-10', async () => {
      writeEnabled = await connect({ config: true, allowWrite: true })
      assertServerIdentity(writeEnabled, state)
      const tools = await listTools(writeEnabled)
      state.toolMatrices.writeEnabled = tools.length
      assertToolContracts(tools, writeTools)
      assertNestedToolSchemaContracts(tools)
    })
    let selectivePlan
    await runCheck(checks, 'selective-prepare-no-write', async () => {
      const beforePrepare = await snapshotTree(workspaceRoot)
      const value = successful(
        await callTool(writeEnabled, 'openapi_prepare_generation', {
          targets: ['doctor'],
          selection: { type: 'add', operationKeys: ['listPets'] },
        }),
        'openapi_prepare_generation',
      )
      selectivePlan = value.plan
      assert(selectivePlan?.kind === 'selective' && selectivePlan?.applySupported === true, 'Selective Prepare did not return an applyable plan.')
      assert(typeof selectivePlan?.token === 'string' && typeof selectivePlan?.planHash === 'string', 'Selective Prepare omitted its Apply binding.')
      planTokens.push(selectivePlan.token)
      assert(
        value.plan?.selection?.mutationType === 'add'
          && value.plan?.selection?.desiredOperationKeys?.[0] === 'listPets'
          && value.plan?.selection?.retainedOperationKeys?.length === 0
          && value.plan?.selection?.removedOperationKeys?.length === 0,
        'Selective Prepare omitted the complete additive selection summary.',
      )
      assert(value.plan?.projection?.operationCount === 1 && typeof value.plan?.projection?.projectionHash === 'string', 'Selective Prepare omitted projection binding.')
      assert(equalValues(await snapshotTree(workspaceRoot), beforePrepare), 'Selective Prepare modified workspace bytes.')
      assert(await missing(path.join(workspaceRoot, '.openapi-to/generated')), 'Selective Prepare created the output root.')
      assert(await missing(path.join(workspaceRoot, '.openapi-to/selections')), 'Selective Prepare created the selection directory.')
    })
    await runCheck(checks, 'selective-apply', async () => {
      const value = successful(
        await callTool(writeEnabled, 'openapi_apply_generation', {
          planId: selectivePlan.planId,
          token: selectivePlan.token,
          approvedPlanHash: selectivePlan.planHash,
        }),
        'openapi_apply_generation',
      )
      assert(value.applied === true && value.planKind === 'selective' && value.selectionApplied === true, 'Selective Apply omitted its committed state result.')
      assert(value.selectedOperationCount === 1 && value.selectionHash === selectivePlan.selection.desiredSelectionHash, 'Selective Apply returned an unexpected selection identity.')
      assert(value.projectionHash === selectivePlan.projection.projectionHash, 'Selective Apply returned an unexpected projection identity.')
      const outputRoot = path.join(workspaceRoot, '.openapi-to/generated')
      const selectionDirectory = path.join(workspaceRoot, '.openapi-to/selections')
      const selectionFiles = await readdir(selectionDirectory)
      assert(selectionFiles.length === 1, 'Selective Apply did not commit exactly one derived selection manifest.')
      const selection = JSON.parse(await readFile(path.join(selectionDirectory, selectionFiles[0]), 'utf8'))
      assert(equalValues(selection.operations, ['listPets']), 'Selective Apply committed unexpected selection operations.')
      const ownership = JSON.parse(await readFile(path.join(outputRoot, '.openapi-to-manifest.json'), 'utf8'))
      assert(ownership.files?.length === 2, 'Selective Apply committed an unexpected ownership manifest.')
      assert((await readFile(path.join(outputRoot, 'client.txt'), 'utf8')) === `${generatedSentinel}\n`, 'Selective Apply committed unexpected generated bytes.')
      assert(
        equalValues((await readdir(outputRoot)).sort(), ['.openapi-to-manifest.json', 'client.txt', 'metadata.json']),
        'Selective Apply left transaction internals or unexpected files in the output root.',
      )
    })
    await runCheck(checks, 'selective-replay', async () => {
      const result = await callTool(writeEnabled, 'openapi_apply_generation', {
        planId: selectivePlan.planId,
        token: selectivePlan.token,
        approvedPlanHash: selectivePlan.planHash,
      })
      const value = structured(result, 'openapi_apply_generation')
      assert(result.isError === true && value.diagnostics?.some(({ code }) => code === 'MCP_PLAN_ALREADY_USED'), 'Selective Apply replay was not rejected as already used.')
    })
    let plan
    await runCheck(checks, 'prepare-no-write', async () => {
      const beforePrepare = await snapshotTree(workspaceRoot)
      const result = await callTool(writeEnabled, 'openapi_prepare_generation', { targets: ['doctor'] })
      const value = successful(result, 'openapi_prepare_generation')
      plan = value.plan
      assert(plan?.summary?.added === 0 && plan?.summary?.modified === 0 && plan?.summary?.deleted === 0 && plan?.summary?.unchanged === 2, 'Full Prepare changed after selective output became current.')
      assert(typeof plan.planId === 'string' && typeof plan.token === 'string' && typeof plan.planHash === 'string', 'Prepare omitted plan binding fields.')
      planTokens.push(plan.token)
      assert(equalValues(await snapshotTree(workspaceRoot), beforePrepare), 'Full Prepare changed the selectively applied workspace.')
    })
    await runCheck(checks, 'apply', async () => {
      const value = successful(
        await callTool(writeEnabled, 'openapi_apply_generation', {
          planId: plan.planId,
          token: plan.token,
          approvedPlanHash: plan.planHash,
        }),
        'openapi_apply_generation',
      )
      assert(value.applied === true && value.planKind === 'full' && value.summary?.added === 0 && value.summary?.modified === 0 && value.summary?.deleted === 0 && value.summary?.unchanged === 2, 'Full Apply no-op returned an unexpected transaction summary.')
      const outputRoot = path.join(workspaceRoot, '.openapi-to/generated')
      assert((await readFile(path.join(outputRoot, 'client.txt'), 'utf8')) === `${generatedSentinel}\n`, 'Apply wrote unexpected generated bytes.')
      assert(equalValues(JSON.parse(await readFile(path.join(outputRoot, 'metadata.json'), 'utf8')), { stable: true }), 'Apply wrote unexpected JSON bytes.')
      const ownership = JSON.parse(await readFile(path.join(outputRoot, '.openapi-to-manifest.json'), 'utf8'))
      assert(ownership.version === 2 && ownership.generator?.name === 'openapi-to' && ownership.files?.length === 2, 'Apply wrote an unexpected ownership manifest.')
      assert(
        equalValues((await readdir(outputRoot)).sort(), ['.openapi-to-manifest.json', 'client.txt', 'metadata.json']),
        'Apply left transaction internals or unexpected files in the output root.',
      )
    })
    await runCheck(checks, 'replay', async () => {
      const result = await callTool(writeEnabled, 'openapi_apply_generation', {
        planId: plan.planId,
        token: plan.token,
        approvedPlanHash: plan.planHash,
      })
      const value = structured(result, 'openapi_apply_generation')
      assert(result.isError === true && value.success === false && value.applied === false, 'Apply replay was not rejected.')
      assert(value.diagnostics?.some(({ code }) => code === 'MCP_PLAN_ALREADY_USED'), 'Apply replay returned the wrong diagnostic.')
    })
    await runCheck(checks, 'check-current', async () => {
      const value = successful(await callTool(writeEnabled, 'openapi_check_generation', { targets: ['doctor'] }), 'openapi_check_generation')
      assert(value.outdated === false && value.truncated?.totalChanges === 0, 'Applied output is not current.')
    })
    await runCheck(checks, 'prepare-unchanged', async () => {
      const value = successful(await callTool(writeEnabled, 'openapi_prepare_generation', { targets: ['doctor'] }), 'openapi_prepare_generation')
      assert(
        value.plan?.summary?.added === 0 && value.plan?.summary?.modified === 0 && value.plan?.summary?.deleted === 0 && value.plan?.summary?.unchanged === 2,
        'Second Prepare did not report the generated artifacts as unchanged.',
      )
      planTokens.push(value.plan.token)
    })
    await runCheck(checks, 'close-10', () => closeConnection(writeEnabled))
    await runCheck(checks, 'redaction', async () => {
      const serializedPayloads = JSON.stringify(payloads)
      const serializedLogs = Buffer.concat(stderrChunks).toString('utf8')
      assert(!serializedPayloads.includes(workspaceRoot), 'A Tool result exposed the temporary absolute workspace path.')
      assert(!serializedPayloads.includes(sourceSentinel) && !serializedPayloads.includes(generatedSentinel), 'A Tool result exposed source or generated body content.')
      assert(!serializedLogs.includes(workspaceRoot), 'Operational logs exposed the temporary absolute workspace path.')
      assert(!serializedLogs.includes(sourceSentinel) && !serializedLogs.includes(generatedSentinel), 'Operational logs exposed source or generated body content.')
      assert(planTokens.every((token) => !serializedLogs.includes(token)), 'Operational logs exposed a controlled-write plan token.')
      assert(Buffer.byteLength(serializedLogs) <= 256 * 1024, 'Operational logs exceeded the doctor bound.')
    })
  } finally {
    clearTimeout(totalTimer)
    controller.abort()
    for (const connection of activeConnections) {
      try {
        await closeConnection(connection)
      } catch {
        // The phase-specific close check reports clean-shutdown failures. This fallback only prevents an orphan.
      }
    }
    const cleanupStarted = performance.now()
    try {
      if (workspaceRoot) {
        await rm(workspaceRoot, { recursive: true, force: true })
        assert(await missing(workspaceRoot), 'Synthetic workspace cleanup failed.')
      }
      setCheck(checks, 'temporary-cleanup', 'passed', undefined, elapsedMilliseconds(cleanupStarted))
    } catch (error) {
      setCheck(checks, 'temporary-cleanup', 'failed', safeFailure(error), elapsedMilliseconds(cleanupStarted))
    }
  }
}

async function main() {
  const doctorStarted = performance.now()
  const checks = createChecks()
  const state = {
    packageName: '@openapi-to/mcp',
    packageVersion: 'unknown',
    packageMetadataValid: false,
    serverName: 'unknown',
    serverVersion: 'unknown',
    toolMatrices: { noConfig: 0, configured: 0, writeEnabled: 0 },
    totalDurationMs: 0,
  }
  try {
    const identity = await readPackageIdentity()
    state.packageName = identity.name
    state.packageVersion = identity.version
    state.packageMetadataValid = true
  } catch {
    // The built-binary check reports unavailable or invalid package metadata without exposing file content.
  }

  let options = { json: process.argv.slice(2).includes('--json'), output: undefined }
  const argumentStarted = performance.now()
  try {
    options = parseArguments(process.argv.slice(2))
    setCheck(checks, 'arguments', 'passed', undefined, elapsedMilliseconds(argumentStarted))
    await runCheck(checks, 'node-version', async () => assertNodeVersion())
    await runDoctor(checks, state)
  } catch (error) {
    if (checks.find(({ id }) => id === 'arguments')?.status === 'skipped') {
      setCheck(checks, 'arguments', 'failed', safeFailure(error), elapsedMilliseconds(argumentStarted))
    } else if (!checks.some(({ status }) => status === 'failed')) {
      const interrupted = checks.find(({ status, id }) => status === 'skipped' && id !== 'report-output')
      if (interrupted) setCheck(checks, interrupted.id, 'failed', safeFailure(error))
    }
  }

  setCheck(checks, 'report-output', 'passed')
  state.totalDurationMs = elapsedMilliseconds(doctorStarted)
  if (options.output) {
    try {
      await writeFile(options.output, `${JSON.stringify(buildReport(checks, state), null, 2)}\n`)
    } catch {
      setCheck(checks, 'report-output', 'failed', 'Unable to write the requested JSON report.')
    }
  }

  const report = buildReport(checks, state)
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`)
  } else {
    process.stdout.write(`openapi-to MCP doctor: ${report.success ? 'PASS' : 'FAIL'}\n`)
    for (const check of report.checks) {
      const marker = check.status === 'passed' ? 'PASS' : check.status === 'failed' ? 'FAIL' : 'SKIP'
      process.stdout.write(`[${marker}] ${check.title}${check.detail ? ` — ${check.detail}` : ''}\n`)
    }
    process.stdout.write(`${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.skipped} skipped\n`)
  }
  if (!report.success) process.exitCode = 1
}

await main()
