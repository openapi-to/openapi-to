import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(packageRoot, '../..')

const unitFiles = [
  'packages/mcp/src/catalog/trusted-target-registry.test.ts',
  'packages/mcp/src/consumer-skill-contract.test.ts',
  'packages/mcp/src/generation/generation-lock.test.ts',
  'packages/mcp/src/generation/plan-store.test.ts',
  'packages/mcp/src/generation/selection-state.test.ts',
  'packages/mcp/src/generation/trusted-config.test.ts',
  'packages/mcp/src/logger.test.ts',
  'packages/mcp/src/options.test.ts',
  'packages/mcp/src/result.test.ts',
  'packages/mcp/src/security/workspace.test.ts',
  'packages/mcp/src/tools/limits.test.ts',
  'packages/mcp/src/tools/schema.test.ts',
]

const integrationFiles = [
  'packages/mcp/src/controlled-write.integration.test.ts',
  'packages/mcp/src/hardening.integration.test.ts',
  'packages/mcp/src/lifecycle.integration.test.ts',
  'packages/mcp/src/server.integration.test.ts',
]

const stdioFiles = [
  'packages/mcp/src/controlled-write.integration.test.ts',
  'packages/mcp/src/lifecycle.integration.test.ts',
  'packages/mcp/src/server.integration.test.ts',
]

const smokeFiles = ['packages/mcp/src/server.integration.test.ts']
const writeFiles = ['packages/mcp/src/controlled-write.integration.test.ts']
const recoveryFiles = [
  'packages/core/src/artifacts/generation-state-transaction.test.ts',
  'packages/core/src/artifacts/transaction.test.ts',
  'packages/mcp/src/controlled-write.integration.test.ts',
  'packages/mcp/src/generation/selection-state.test.ts',
  'packages/mcp/src/hardening.integration.test.ts',
]
const coreRecoveryFiles = [
  'packages/core/src/artifacts/generation-state-transaction.test.ts',
  'packages/core/src/artifacts/transaction.test.ts',
]
const performanceScripts = [
  { file: 'packages/mcp/scripts/benchmark.mjs', args: ['--iterations', '2', '--check'] },
  { file: 'packages/mcp/scripts/stress.mjs', args: [] },
]
const crossPlatformSmokeScripts = [
  { file: 'packages/mcp/scripts/cross-platform-smoke.mjs', args: [] },
]

function unique(files) {
  return [...new Set(files)]
}

const allMcpFiles = [...unitFiles, ...integrationFiles]
const e2eFiles = unique([...integrationFiles, ...coreRecoveryFiles])
const allVitestFiles = unique([...allMcpFiles, ...coreRecoveryFiles])

const groups = {
  test: { build: 'write', files: allMcpFiles, expectedTests: 137, timeoutMs: 300_000 },
  unit: { build: 'core', files: unitFiles, expectedTests: 83, timeoutMs: 120_000 },
  integration: { build: 'write', files: integrationFiles, expectedTests: 54, timeoutMs: 240_000 },
  smoke: { build: 'write', files: smokeFiles, expectedTests: 6, scripts: crossPlatformSmokeScripts, timeoutMs: 120_000 },
  stdio: { build: 'write', files: stdioFiles, expectedTests: 48, timeoutMs: 240_000 },
  write: { build: 'write', files: writeFiles, expectedTests: 39, timeoutMs: 180_000 },
  recovery: { build: 'write', files: recoveryFiles, expectedTests: 125, timeoutMs: 360_000 },
  performance: { build: 'mcp', files: [], expectedTests: 0, scripts: performanceScripts, timeoutMs: 360_000 },
  e2e: { build: 'write', files: e2eFiles, expectedTests: 108, scripts: crossPlatformSmokeScripts, timeoutMs: 480_000 },
  all: { build: 'write', files: allVitestFiles, expectedTests: 191, scripts: [...crossPlatformSmokeScripts, ...performanceScripts], timeoutMs: 600_000 },
}

function fail(message) {
  process.stderr.write(`[mcp-tests] ${message}\n`)
  process.exitCode = 1
}

async function run(command, args, timeoutMs = 300_000) {
  await new Promise((resolve, reject) => {
    const signal = AbortSignal.timeout(timeoutMs)
    const child = spawn(command, args, { cwd: repositoryRoot, stdio: 'inherit', signal })
    child.once('error', (error) => {
      if (error?.name === 'AbortError') reject(new Error(`${command} ${args.join(' ')} exceeded its ${timeoutMs} ms deadline.`))
      else reject(error)
    })
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} failed${signal ? ` with ${signal}` : ` with exit code ${code ?? 'unknown'}`}.`))
    })
  })
}

function pnpmInvocation(args) {
  const entrypoint = process.env.npm_execpath
  if (entrypoint && /\.(?:c|m)?js$/i.test(entrypoint)) {
    return { command: process.execPath, args: [entrypoint, ...args] }
  }
  return { command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args }
}

async function findMcpTests(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await findMcpTests(entryPath))
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) files.push(path.relative(repositoryRoot, entryPath).split(path.sep).join('/'))
  }
  return files.sort()
}

function compareInventory(label, actual, expected) {
  const actualSet = new Set(actual)
  const expectedSet = new Set(expected)
  const missing = expected.filter((file) => !actualSet.has(file))
  const unclassified = actual.filter((file) => !expectedSet.has(file))
  if (missing.length || unclassified.length) {
    throw new Error(`${label} inventory drifted.${missing.length ? ` Missing: ${missing.join(', ')}.` : ''}${unclassified.length ? ` Unclassified: ${unclassified.join(', ')}.` : ''}`)
  }
}

async function validateInventory(group) {
  if (unitFiles.length === 0 || integrationFiles.length === 0) throw new Error('The authoritative MCP unit/integration inventory cannot be empty.')
  if (new Set(allMcpFiles).size !== allMcpFiles.length) throw new Error('The authoritative MCP test inventory contains duplicate files.')
  if (unitFiles.some((file) => file.endsWith('.integration.test.ts'))) throw new Error('An integration test was classified as a unit test.')
  if (integrationFiles.some((file) => !file.endsWith('.integration.test.ts'))) throw new Error('An integration test entry does not follow the .integration.test.ts rule.')

  const discovered = await findMcpTests(path.join(packageRoot, 'src'))
  if (discovered.length === 0) throw new Error('No MCP test files were discovered.')
  compareInventory('MCP test', discovered, allMcpFiles)

  const selected = [...group.files, ...(group.scripts ?? []).map(({ file }) => file)]
  if (selected.length === 0) throw new Error('The selected group contains no test files or executable test scripts.')
  for (const relativePath of selected) {
    const details = await stat(path.join(repositoryRoot, relativePath)).catch(() => undefined)
    if (!details?.isFile() || details.size === 0) throw new Error(`Selected test input is missing or empty: ${relativePath}`)
  }
}

async function build(profile) {
  const filters = profile === 'core'
    ? ['--filter=@openapi-to/core']
    : profile === 'mcp'
      ? ['--filter=@openapi-to/mcp']
      : ['--filter=@openapi-to/mcp', '--filter=openapi-to']
  const invocation = pnpmInvocation(['exec', 'turbo', 'run', 'build', ...filters])
  process.stdout.write(`[mcp-tests] build profile=${profile} (one cached dependency-aware build)\n`)
  await run(invocation.command, invocation.args, 300_000)
}

async function main() {
  const [name, ...options] = process.argv.slice(2)
  const listOnly = options.length === 1 && options[0] === '--list'
  if (!name || !Object.hasOwn(groups, name) || (options.length > 0 && !listOnly)) {
    throw new Error(`Usage: node ./scripts/run-test-group.mjs <${Object.keys(groups).join('|')}> [--list]`)
  }

  const group = groups[name]
  const requestedArtifactDirectory = process.env.MCP_TEST_ARTIFACT_DIR
  const artifactDirectory = requestedArtifactDirectory
    ? path.resolve(requestedArtifactDirectory)
    : undefined
  if (artifactDirectory) {
    await mkdir(artifactDirectory, { recursive: true })
    await writeFile(path.join(artifactDirectory, 'runner.json'), `${JSON.stringify({
      group: name,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      pnpmEntrypoint: process.env.npm_execpath ? path.basename(process.env.npm_execpath) : null,
      files: group.files,
      expectedTests: group.expectedTests,
      scripts: (group.scripts ?? []).map(({ file, args }) => ({ file, args })),
    }, null, 2)}\n`)
  }
  await validateInventory(group)
  process.stdout.write(`[mcp-tests] group=${name} vitestFiles=${group.files.length} expectedVitestTests=${group.expectedTests} scripts=${group.scripts?.length ?? 0}\n`)
  for (const file of group.files) process.stdout.write(`[mcp-tests] vitest ${file}\n`)
  for (const { file, args } of group.scripts ?? []) process.stdout.write(`[mcp-tests] script ${file}${args.length ? ` ${args.join(' ')}` : ''}\n`)
  if (listOnly) return

  await build(group.build)
  if (group.files.length > 0) {
    const reportDirectory = artifactDirectory ?? await mkdtemp(path.join(os.tmpdir(), 'openapi-to-mcp-vitest-'))
    const reportPath = path.join(reportDirectory, 'results.json')
    const invocation = pnpmInvocation([
      'exec',
      'vitest',
      'run',
      '--config',
      'configs/vitest.config.ts',
      ...group.files,
      '--reporter=default',
      '--reporter=json',
      `--outputFile=${reportPath}`,
    ])
    process.stdout.write('[mcp-tests] Vitest output below is the authoritative collected test count; zero collected tests fail.\n')
    try {
      await run(invocation.command, invocation.args, group.timeoutMs)
      const report = JSON.parse(await readFile(reportPath, 'utf8'))
      const actualFiles = Array.isArray(report.testResults) ? report.testResults.length : 0
      const actualTests = Number(report.numTotalTests)
      if (actualFiles !== group.files.length || actualTests !== group.expectedTests || report.success !== true) {
        throw new Error(
          `Collected test inventory changed: expected ${group.files.length} files/${group.expectedTests} tests, received ${actualFiles} files/${actualTests} tests.`,
        )
      }
      process.stdout.write(`[mcp-tests] verified actualVitestFiles=${actualFiles} actualVitestTests=${actualTests}\n`)
    } finally {
      if (!artifactDirectory) await rm(reportDirectory, { recursive: true, force: true })
    }
  }
  for (const { file, args } of group.scripts ?? []) await run(process.execPath, [path.join(repositoryRoot, file), ...args], group.timeoutMs)
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
