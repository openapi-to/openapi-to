import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExitCode } from '@openapi-to/core'
import { run, type CLIIO } from './index.ts'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const CLI_GENERATION_TEST_TIMEOUT_MS = 15_000

describe('CLI machine-readable commands', { concurrent: false }, () => {
  let cwd: string
  let root: string
  let spec: string
  let stdout: string[]
  let stderr: string[]
  let io: CLIIO

  beforeEach(async () => {
    cwd = process.cwd()
    root = await mkdtemp(path.join(os.tmpdir(), 'openapi-cli-'))
    spec = path.join(root, 'openapi.yaml')
    await writeFile(spec, `openapi: 3.1.0\ninfo:\n  title: CLI fixture\n  version: 1.0.0\npaths:\n  /pets:\n    get:\n      operationId: listPets\n      responses:\n        '200':\n          description: ok\n`)
    await writeFile(
      path.join(root, 'openapi.config.js'),
      `module.exports = {
        servers: [{ name: 'fixture', input: { path: './openapi.yaml' }, output: { dir: 'generated', clean: true } }],
        plugins: [{ name: 'fixture-plugin', hooks: { buildStart(ctx) { console.log('plugin progress'); ctx.addArtifact({ kind: 'text', path: ctx.openapiToSingleConfig.output.dir + '/hello.txt', content: 'hello\\n', plugin: 'fixture-plugin' }) } } }]
      }`,
    )
    process.chdir(root)
    stdout = []
    stderr = []
    io = { stdout: (message) => stdout.push(message), stderr: (message) => stderr.push(message) }
  })

  afterEach(async () => {
    process.chdir(cwd)
    process.exitCode = 0
    await rm(root, { recursive: true, force: true })
  })

  it('validates JSON/YAML, refs, cycles, 3.2 warnings, and global JSON placement', async () => {
    const validate = await run(['node', 'openapi', 'validate', spec, '--json'], io)
    const validateJSON = JSON.parse(stdout.join('\n'))
    expect(validate.exitCode).toBe(ExitCode.Success)
    expect(validateJSON).toMatchObject({ success: true, command: 'validate' })
    const jsonSpec = path.join(root, 'openapi.json')
    await writeFile(jsonSpec, JSON.stringify({ openapi: '3.1.0', info: { title: 'JSON', version: '1' }, paths: {} }))
    stdout = []
    expect((await run(['node', 'openapi', '--json', 'validate', jsonSpec], io)).exitCode).toBe(ExitCode.Success)
    expect(JSON.parse(stdout.join('\n'))).toMatchObject({ success: true, command: 'validate' })

    const missingRef = path.join(root, 'missing-ref.yaml')
    await writeFile(missingRef, 'openapi: 3.1.0\ninfo: { title: Missing, version: "1" }\npaths: {}\ncomponents:\n  schemas:\n    Missing: { $ref: "#/components/schemas/Nope" }\n')
    stdout = []
    expect((await run(['node', 'openapi', 'validate', missingRef, '--json'], io)).exitCode).toBe(ExitCode.OpenAPIError)
    expect(JSON.parse(stdout.join('\n')).diagnostics.filter((diagnostic: { code: string }) => diagnostic.code === 'OPENAPI_REF_NOT_FOUND')).toHaveLength(1)

    const cycle = path.join(root, 'cycle.yaml')
    await writeFile(cycle, 'openapi: 3.1.0\ninfo: { title: Cycle, version: "1" }\npaths: {}\ncomponents:\n  schemas:\n    Node: { type: object, properties: { next: { $ref: "#/components/schemas/Node" } } }\n')
    stdout = []
    expect((await run(['node', 'openapi', 'validate', cycle, '--json'], io)).exitCode).toBe(ExitCode.Success)
    expect(JSON.parse(stdout.join('\n')).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'OPENAPI_REF_CYCLE' })]))

    const openapi32 = path.join(repositoryRoot, 'packages/core/src/openapi/fixtures/openapi-3.2.yaml')
    stdout = []
    expect((await run(['node', 'openapi', 'validate', openapi32, '--json', '--fail-on-warning'], io)).exitCode).toBe(ExitCode.OpenAPIError)
    expect(JSON.parse(stdout.join('\n')).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'OPENAPI_WARNINGS_AS_ERRORS' })]))
  })

  it('inspects Swagger 2.0 and OpenAPI 3.0/3.1/3.2 with security and external refs', async () => {
    const inputs = [
      path.join(repositoryRoot, 'packages/core/mock/swagger2.0.json'),
      path.join(repositoryRoot, 'packages/core/mock/openapiV3.json'),
      spec,
      path.join(repositoryRoot, 'packages/core/src/openapi/fixtures/openapi-3.2.yaml'),
    ]
    for (const input of inputs) {
      stdout = []
      const result = await run(['node', 'openapi', 'inspect', input, '--json'], io)
      expect(result.exitCode).toBe(ExitCode.Success)
      expect(JSON.parse(stdout.join('\n')).inspection.openapiVersion).toMatch(/^(2\.0|3\.)/)
    }

    const inspectSpec = path.join(root, 'inspect.yaml')
    await writeFile(inspectSpec, 'openapi: 3.1.0\ninfo: { title: Inspect, version: "1" }\npaths:\n  /missing:\n    get:\n      responses: { "200": { description: ok } }\ncomponents:\n  securitySchemes:\n    bearer: { type: http, scheme: bearer }\n  schemas:\n    Pet: { $ref: "./schema.yaml#/$defs/Pet" }\n')
    await writeFile(path.join(root, 'schema.yaml'), '$defs:\n  Pet: { type: object }\n')
    stdout = []
    await run(['node', 'openapi', 'inspect', inspectSpec, '--json'], io)
    const inspection = JSON.parse(stdout.join('\n')).inspection
    expect(inspection).toMatchObject({ externalReferenceCount: 1, securitySchemes: ['bearer'] })
    expect(inspection.missingOperationIds).toHaveLength(1)
  })

  it('diff emits stable JSON and code 7 with --fail-on-breaking', async () => {
    const next = path.join(root, 'next.yaml')
    await writeFile(next, `openapi: 3.1.0\ninfo:\n  title: CLI fixture\n  version: 2.0.0\npaths: {}\n`)
    const result = await run(['node', 'openapi', 'diff', spec, next, '--json', '--fail-on-breaking'], io)
    const json = JSON.parse(stdout.join('\n'))
    expect(result.exitCode).toBe(ExitCode.BreakingChanges)
    expect(json.breaking).toBe(true)
    expect(json.changes.some((change: { code: string }) => change.code === 'PATH_REMOVED')).toBe(true)

    stdout = []
    expect((await run(['node', 'openapi', 'diff', spec, spec, '--json'], io)).exitCode).toBe(ExitCode.Success)
    expect(JSON.parse(stdout.join('\n')).changes).toEqual([])

    const added = path.join(root, 'added.yaml')
    await writeFile(added, `${await readFile(spec, 'utf8')}\n  /owners:\n    get:\n      responses: { '200': { description: ok } }\n`)
    stdout = []
    await run(['node', 'openapi', 'diff', spec, added, '--json'], io)
    expect(JSON.parse(stdout.join('\n')).changes).toEqual(expect.arrayContaining([expect.objectContaining({ classification: 'non-breaking', code: 'PATH_ADDED' })]))

    const warningBefore = path.join(root, 'warning-before.yaml')
    const warningAfter = path.join(root, 'warning-after.yaml')
    await writeFile(warningBefore, 'openapi: 3.1.0\ninfo: { title: W, version: "1" }\npaths: {}\ncomponents:\n  schemas:\n    Value: { type: string, minLength: 1 }\n')
    await writeFile(warningAfter, 'openapi: 3.1.0\ninfo: { title: W, version: "1" }\npaths: {}\ncomponents:\n  schemas:\n    Value: { type: string, minLength: 2 }\n')
    stdout = []
    await run(['node', 'openapi', 'diff', warningBefore, warningAfter, '--json'], io)
    expect(JSON.parse(stdout.join('\n')).changes).toEqual(expect.arrayContaining([expect.objectContaining({ classification: 'warning', code: 'SCHEMA_CONSTRAINT_CHANGED' })]))

    const invalidBreaking = path.join(root, 'invalid-breaking.yaml')
    await writeFile(invalidBreaking, 'openapi: 3.1.0\ninfo: { version: "1" }\npaths:\n  /pets:\n    get:\n      responses: { "200": { description: ok } }\n')
    stdout = []
    expect((await run(['node', 'openapi', 'diff', invalidBreaking, next, '--json', '--fail-on-breaking'], io)).exitCode).toBe(ExitCode.OpenAPIError)
  })

  it('dry-run and check never write, while write and a following check agree', async () => {
    const outputFile = path.join(root, '.openapi-to/generated/hello.txt')
    const ownershipManifest = path.join(root, '.openapi-to/generated/.openapi-to-manifest.json')
    let result = await run(['node', 'openapi', 'generate', '--dry-run', '--json'], io)
    let json = JSON.parse(stdout.join('\n'))
    expect(result.exitCode).toBe(ExitCode.Success)
    expect(json.servers[0].manifest.summary.added).toBe(1)
    await expect(access(outputFile)).rejects.toThrow()
    await expect(access(ownershipManifest)).rejects.toThrow()

    stdout = []
    result = await run(['node', 'openapi', 'generate', '--check', '--json'], io)
    expect(result.exitCode).toBe(ExitCode.GeneratedOutputOutdated)
    await expect(access(outputFile)).rejects.toThrow()
    await expect(access(ownershipManifest)).rejects.toThrow()

    stdout = []
    result = await run(['node', 'openapi', 'generate', '--json'], io)
    expect(result.exitCode).toBe(ExitCode.Success)
    expect(await readFile(outputFile, 'utf8')).toBe('hello\n')
    expect(stderr).toContain('plugin progress')

    const userFile = path.join(root, '.openapi-to/generated/user.txt')
    await writeFile(userFile, 'owned by user')
    await writeFile(outputFile, 'outdated')
    stdout = []
    result = await run(['node', 'openapi', 'generate', '--check', '--json'], io)
    expect(result.exitCode).toBe(ExitCode.GeneratedOutputOutdated)
    expect(await readFile(outputFile, 'utf8')).toBe('outdated')
    expect(await readFile(userFile, 'utf8')).toBe('owned by user')

    stdout = []
    await run(['node', 'openapi', 'generate', '--json'], io)
    expect(await readFile(userFile, 'utf8')).toBe('owned by user')

    await rm(outputFile)
    stdout = []
    result = await run(['node', 'openapi', 'generate', '--check', '--json'], io)
    expect(result.exitCode).toBe(ExitCode.GeneratedOutputOutdated)
    await expect(access(outputFile)).rejects.toThrow()

    stdout = []
    result = await run(['node', 'openapi', 'generate', '--json'], io)
    expect(result.exitCode).toBe(ExitCode.Success)
    stdout = []
    result = await run(['node', 'openapi', 'generate', '--check', '--json'], io)
    json = JSON.parse(stdout.join('\n'))
    expect(result.exitCode).toBe(ExitCode.Success)
    expect(json.servers[0].manifest.summary.unchanged).toBe(1)

    const firstCheck = stdout.join('\n')
    stdout = []
    result = await run(['node', 'openapi', 'generate', '--check', '--json'], io)
    expect(result.exitCode).toBe(ExitCode.Success)
    expect(stdout.join('\n')).toBe(firstCheck)
  }, CLI_GENERATION_TEST_TIMEOUT_MS)

  it('discovers the nearest root configuration from a nested invocation directory', async () => {
    const nested = path.join(root, 'packages', 'client', 'src')
    await mkdir(nested, { recursive: true })
    process.chdir(nested)

    const result = await run(['node', 'openapi', 'generate', '--dry-run', '--json'], io)
    expect(result.exitCode).toBe(ExitCode.Success)
    expect(JSON.parse(stdout.join('\n'))).toMatchObject({
      success: true,
      mode: 'dry-run',
      servers: [{ output: '.openapi-to/generated', success: true }],
    })
    await expect(access(path.join(root, '.openapi-to'))).rejects.toThrow()
  })

  it('reports ambiguous root configuration before execution and honors an explicit --config selection', async () => {
    const marker = path.join(root, 'ambiguous-config-executed.txt')
    await writeFile(
      path.join(root, 'openapi.config.ts'),
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed'); export default { servers: [], plugins: [] };\n`,
    )
    let result = await run(['node', 'openapi', 'generate', '--json'], io)
    expect(result.exitCode).toBe(ExitCode.ConfigError)
    expect(JSON.parse(stdout.join('\n'))).toMatchObject({
      success: false,
      diagnostics: [{ code: 'OPENAPI_CONFIG_AMBIGUOUS' }],
      servers: [],
    })
    await expect(access(marker)).rejects.toThrow()

    stdout = []
    result = await run(
      ['node', 'openapi', 'generate', '--config', './openapi.config.js', '--dry-run', '--json'],
      io,
    )
    expect(result.exitCode).toBe(ExitCode.Success)
    expect(JSON.parse(stdout.join('\n'))).toMatchObject({
      success: true,
      mode: 'dry-run',
    })
    await expect(access(marker)).rejects.toThrow()
  })

  it('does not auto-discover the former .OpenAPI configuration location', async () => {
    await rm(path.join(root, 'openapi.config.js'))
    await mkdir(path.join(root, '.OpenAPI'))
    await writeFile(
      path.join(root, '.OpenAPI', 'openapi.config.js'),
      'module.exports = { servers: [], plugins: [] }\n',
    )
    const result = await run(['node', 'openapi', 'generate', '--json'], io)
    expect(result.exitCode).toBe(ExitCode.ConfigError)
    expect(JSON.parse(stdout.join('\n'))).toMatchObject({
      success: false,
      diagnostics: [{ code: 'CONFIG_LOAD_FAILED' }],
      servers: [],
    })
    await expect(access(path.join(root, '.openapi-to'))).rejects.toThrow()
  })

  it('selects named microservice targets in config order across workspace and managed outputs', async () => {
    const fixtures = path.join(repositoryRoot, 'packages/cli/mock/microservices')
    await Promise.all([
      writeFile(path.join(root, 'user-service.json'), await readFile(path.join(fixtures, 'user-service.json'))),
      writeFile(path.join(root, 'order-service.yaml'), await readFile(path.join(fixtures, 'order-service.yaml'))),
      writeFile(path.join(root, 'payment-service.yml'), await readFile(path.join(fixtures, 'payment-service.yml'))),
    ])
    await writeFile(
      path.join(root, 'openapi.config.js'),
      `module.exports = {
        servers: [
          { name: 'user-service', input: { path: './user-service.json' }, output: { base: 'workspace', dir: 'src/api/generated/user', clean: true } },
          { name: 'order-service', input: { path: './order-service.yaml' }, output: { base: 'workspace', dir: 'src/api/generated/order', clean: true } },
          { name: 'payment-service', input: { path: './payment-service.yml' }, output: { dir: 'payment', clean: true } }
        ],
        plugins: [{
          name: 'target-fixture',
          hooks: {
            buildStart(ctx) {
              const name = ctx.openapiToSingleConfig.name
              ctx.addArtifact({
                kind: 'text',
                path: ctx.openapiToSingleConfig.output.dir + '/target.txt',
                content: name + ':' + ctx.openAPIDocument.info.title + '\\n',
                plugin: 'target-fixture'
              })
            }
          }
        }]
      }`,
    )
    const userFile = path.join(root, 'src/api/generated/user/target.txt')
    const orderFile = path.join(root, 'src/api/generated/order/target.txt')
    const paymentFile = path.join(root, '.openapi-to/payment/target.txt')

    let result = await run(
      ['node', 'openapi', 'generate', '--target', 'order-service', '--target', 'user-service', '--dry-run', '--json'],
      io,
    )
    expect(result.exitCode).toBe(ExitCode.Success)
    expect(JSON.parse(stdout.join('\n')).servers).toEqual([
      expect.objectContaining({ name: 'user-service', output: 'src/api/generated/user' }),
      expect.objectContaining({ name: 'order-service', output: 'src/api/generated/order' }),
    ])
    await expect(access(path.join(root, 'src/api/generated'))).rejects.toThrow()
    await expect(access(path.join(root, '.openapi-to/payment'))).rejects.toThrow()

    stdout = []
    result = await run(['node', 'openapi', 'generate', '--json'], io)
    expect(result.exitCode).toBe(ExitCode.Success)
    expect(JSON.parse(stdout.join('\n')).servers.map((server: { name: string }) => server.name)).toEqual([
      'user-service',
      'order-service',
      'payment-service',
    ])
    expect(await readFile(userFile, 'utf8')).toBe('user-service:User Service\n')
    expect(await readFile(orderFile, 'utf8')).toBe('order-service:Order Service\n')
    expect(await readFile(paymentFile, 'utf8')).toBe('payment-service:Payment Service\n')
    await Promise.all([
      access(path.join(root, 'src/api/generated/user/.openapi-to-manifest.json')),
      access(path.join(root, 'src/api/generated/order/.openapi-to-manifest.json')),
      access(path.join(root, '.openapi-to/payment/.openapi-to-manifest.json')),
    ])

    await writeFile(orderFile, 'order-sentinel\n')
    await writeFile(paymentFile, 'payment-sentinel\n')
    stdout = []
    result = await run(
      ['node', 'openapi', 'generate', '--target', 'user-service', '--target', 'user-service', '--json'],
      io,
    )
    expect(result.exitCode).toBe(ExitCode.Success)
    expect(JSON.parse(stdout.join('\n')).servers).toEqual([
      expect.objectContaining({ name: 'user-service', output: 'src/api/generated/user' }),
    ])
    expect(await readFile(orderFile, 'utf8')).toBe('order-sentinel\n')
    expect(await readFile(paymentFile, 'utf8')).toBe('payment-sentinel\n')

    stdout = []
    result = await run(
      ['node', 'openapi', 'generate', '--target', 'order-service', '--target', 'user-service', '--json'],
      io,
    )
    expect(result.exitCode).toBe(ExitCode.Success)
    expect(JSON.parse(stdout.join('\n')).servers.map((server: { name: string }) => server.name)).toEqual([
      'user-service',
      'order-service',
    ])
    expect(await readFile(paymentFile, 'utf8')).toBe('payment-sentinel\n')

    await writeFile(orderFile, 'outdated-order\n')
    stdout = []
    result = await run(['node', 'openapi', 'generate', '--target', 'user-service', '--check', '--json'], io)
    expect(result.exitCode).toBe(ExitCode.Success)
    expect(JSON.parse(stdout.join('\n')).servers).toHaveLength(1)

    const userBeforeUnknown = await readFile(userFile, 'utf8')
    stdout = []
    result = await run(
      ['node', 'openapi', 'generate', '--target', 'user-service', '--target', 'missing-service', '--json'],
      io,
    )
    expect(result.exitCode).toBe(ExitCode.ConfigError)
    expect(JSON.parse(stdout.join('\n'))).toMatchObject({
      success: false,
      diagnostics: [{ code: 'CONFIG_TARGET_UNKNOWN' }],
      servers: [],
    })
    expect(await readFile(userFile, 'utf8')).toBe(userBeforeUnknown)
    expect(await readFile(orderFile, 'utf8')).toBe('outdated-order\n')
  }, CLI_GENERATION_TEST_TIMEOUT_MS)

  it('preflights every configured output and every selected input before any target write', async () => {
    await writeFile(
      path.join(root, 'openapi.config.js'),
      `module.exports = {
        servers: [
          { name: 'valid', input: { path: './openapi.yaml' }, output: { base: 'workspace', dir: 'src/generated/valid' } },
          { name: 'overlap', input: { path: './openapi.yaml' }, output: { base: 'workspace', dir: 'src/generated/valid/nested' } }
        ],
        plugins: [{ name: 'should-not-run', hooks: { buildStart(ctx) { ctx.addArtifact({ kind: 'text', path: ctx.openapiToSingleConfig.output.dir + '/unexpected.txt', content: 'unexpected', plugin: 'should-not-run' }) } } }]
      }`,
    )
    let result = await run(['node', 'openapi', 'generate', '--target', 'valid', '--json'], io)
    expect(result.exitCode).toBe(ExitCode.ConfigError)
    expect(JSON.parse(stdout.join('\n')).diagnostics[0].code).toBe('CONFIG_OUTPUT_OVERLAP')
    await expect(access(path.join(root, 'src/generated/valid'))).rejects.toThrow()

    await writeFile(
      path.join(root, 'openapi.config.js'),
      `module.exports = {
        servers: [
          { name: 'valid', input: { path: './openapi.yaml' }, output: { base: 'workspace', dir: 'src/generated/valid' } },
          { name: 'invalid', input: { path: './missing.yaml' }, output: { base: 'workspace', dir: 'src/generated/invalid' } }
        ],
        plugins: [{ name: 'should-not-run', hooks: { buildStart(ctx) { ctx.addArtifact({ kind: 'text', path: ctx.openapiToSingleConfig.output.dir + '/unexpected.txt', content: 'unexpected', plugin: 'should-not-run' }) } } }]
      }`,
    )
    stdout = []
    result = await run(
      ['node', 'openapi', 'generate', '--target', 'valid', '--target', 'invalid', '--json'],
      io,
    )
    expect(result.exitCode).toBe(ExitCode.InputError)
    await expect(access(path.join(root, 'src/generated/valid'))).rejects.toThrow()
    await expect(access(path.join(root, 'src/generated/invalid'))).rejects.toThrow()
  })

  it('maps input, validation, and plugin failures to stable exit codes', async () => {
    let result = await run(['node', 'openapi', 'validate', '--json'], io)
    expect(result.exitCode).toBe(ExitCode.GeneralError)
    expect(JSON.parse(stdout.join('\n'))).toMatchObject({ success: false, diagnostics: [{ code: 'CLI_EXECUTION_FAILED' }] })

    stdout = []
    result = await run(['node', 'openapi', 'validate', path.join(root, 'missing.yaml'), '--json'], io)
    expect(result.exitCode).toBe(ExitCode.InputError)

    const invalid = path.join(root, 'invalid.yaml')
    await writeFile(invalid, 'openapi: [')
    stdout = []
    result = await run(['node', 'openapi', 'validate', invalid, '--json'], io)
    expect(result.exitCode).toBe(ExitCode.OpenAPIError)

    await writeFile(
      path.join(root, 'openapi.config.js'),
      `module.exports = {
        servers: [{ input: { path: './openapi.yaml' }, output: { dir: 'generated' } }],
        plugins: [{ name: 'broken', hooks: { buildStart() { throw new Error('broken plugin') } } }]
      }`,
    )
    stdout = []
    result = await run(['node', 'openapi', 'generate', '--json'], io)
    expect(result.exitCode).toBe(ExitCode.PluginError)
    expect(JSON.parse(stdout.join('\n')).diagnostics[0].code).toBe('PLUGIN_EXECUTION_FAILED')
  })
})
