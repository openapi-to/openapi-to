import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  compareArtifacts,
  materializeArtifacts,
  OutputTransactionRolledBackError,
  writeArtifacts,
  writeArtifactsTransaction,
} from '@openapi-to/core'

const execFileAsync = promisify(execFile)
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(packageRoot, '../..')
const bin = path.join(packageRoot, 'bin/openapi-to-mcp.js')
const iterationsArg = process.argv.indexOf('--iterations')
const iterations = iterationsArg >= 0 ? Number(process.argv[iterationsArg + 1]) : 5
const check = process.argv.includes('--check')
if (!Number.isInteger(iterations) || iterations < 2 || iterations > 30) throw new Error('--iterations must be an integer from 2 to 30.')

const relative = (value) => path.relative(repositoryRoot, value).split(path.sep).join('/')
const fixtures = path.join(packageRoot, 'src/evaluation/fixtures')
const large = relative(path.join(fixtures, 'large/openapi.json'))
const medium = relative(path.join(fixtures, 'medium/openapi.json'))
const generationConfig = relative(path.join(fixtures, 'generation/openapi.config.cjs'))

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
}

function summary(values) {
  return { min: Math.min(...values), median: percentile(values, 0.5), p95: percentile(values, 0.95), max: Math.max(...values) }
}

async function rssBytes(pid) {
  if (!pid) return null
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)])
    const kib = Number(stdout.trim())
    return Number.isFinite(kib) ? kib * 1024 : null
  } catch {
    return null
  }
}

async function connect(withConfig) {
  const stderr = []
  const transport = new StdioClientTransport({ command: process.execPath, args: [bin, '--workspace-root', repositoryRoot, '--log-format', 'json', '--log-level', 'info', ...(withConfig ? ['--config', generationConfig] : [])], stderr: 'pipe' })
  transport.stderr?.on('data', (chunk) => stderr.push(Buffer.from(chunk)))
  const client = new Client({ name: 'openapi-to-benchmark', version: '1.0.0' })
  const started = performance.now()
  await client.connect(transport)
  return { client, transport, stderr, startupMs: performance.now() - started }
}

async function connectWrite(workspaceRoot) {
  const stderr = []
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin, '--workspace-root', workspaceRoot, '--config', 'openapi.config.cjs', '--generation-mode', 'hardened', '--log-format', 'json', '--log-level', 'info'],
    stderr: 'pipe',
  })
  transport.stderr?.on('data', (chunk) => stderr.push(Buffer.from(chunk)))
  const client = new Client({ name: 'openapi-to-write-benchmark', version: '1.0.0' })
  await client.connect(transport)
  return { client, transport, stderr }
}

async function createWriteWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-to-write-benchmark-'))
  await mkdir(path.join(root, '.openapi-to'))
  await copyFile(path.join(fixtures, 'generation/openapi.json'), path.join(root, 'openapi.json'))
  await writeFile(path.join(root, 'openapi.config.cjs'), `module.exports = {
  servers: [{ name: 'evaluation', input: { path: './openapi.json' }, output: { dir: 'generated', clean: true } }],
  plugins: [{ name: 'write-benchmark', hooks: { buildStart(ctx) {
    const paths = Object.keys(ctx.openAPIDocument.paths || {}).sort();
    for (const [index, apiPath] of paths.entries()) ctx.addArtifact({ kind: 'text', path: ctx.openapiToSingleConfig.output.dir + '/operation-' + String(index).padStart(4, '0') + '.txt', content: apiPath + '\\n' });
  } } }]
};
`)
  return root
}

const measurements = {}
const startup = []
const toolsList = []
for (let index = 0; index < 3; index += 1) {
  const connected = await connect(false)
  startup.push(connected.startupMs)
  const started = performance.now()
  await connected.client.listTools()
  toolsList.push(performance.now() - started)
  await connected.client.close()
}
measurements.serverStartup = { timingMs: summary(startup) }
measurements.toolsList = { timingMs: summary(toolsList) }

const connected = await connect(true)
const cases = [
  ['catalogSearch', 'openapi_search_operations', { target: 'evaluation', query: 'enterprise resource 42', limit: 8 }],
  ['catalogGetOperation', 'openapi_get_operation', { target: 'evaluation', operationKey: 'getEnterpriseResource42', detail: 'contract', schemaDepth: 2 }],
  ['catalogListTargets', 'openapi_list_targets', {}],
  ['validate', 'openapi_validate', { source: large }],
  ['inspect', 'openapi_inspect', { source: large, includeOperations: true }],
  ['diff', 'openapi_diff', { before: medium, after: large }],
  ['generateDryRun', 'openapi_generate', { target: 'evaluation', selection: { type: 'full' }, mode: 'dry-run' }],
  ['check', 'openapi_check_generation', { target: 'evaluation', basis: 'configured-full' }],
]
for (const [id, name, argumentsValue] of cases) {
  const times = []
  const sizes = []
  const rss = []
  let diagnostics = 0
  let artifactsOrChanges = 0
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now()
    const result = await connected.client.callTool({ name, arguments: argumentsValue }, undefined, { timeout: 120_000 })
    times.push(performance.now() - started)
    const structured = result.structuredContent ?? {}
    sizes.push(Buffer.byteLength(JSON.stringify(structured)))
    diagnostics = structured.truncated?.totalDiagnostics ?? structured.diagnostics?.length ?? 0
    artifactsOrChanges = structured.truncated?.totalArtifacts ?? structured.truncated?.totalChanges ?? 0
    if (id === 'catalogSearch' && (structured.success !== true || structured.items?.length > 8 || JSON.stringify(structured.items).includes('properties'))) throw new Error('Catalog search benchmark returned an invalid or unbounded candidate set.')
    if (id === 'catalogGetOperation' && (structured.success !== true || structured.operation?.operationKey !== 'getEnterpriseResource42' || sizes.at(-1) > 256 * 1024)) throw new Error('Catalog contract benchmark returned an invalid or oversized result.')
    if (id === 'catalogListTargets' && (structured.success !== true || structured.targets?.length !== 1)) throw new Error('Catalog target discovery benchmark returned an unexpected result.')
    if (id === 'generateDryRun' && (structured.success !== true || artifactsOrChanges !== 250)) throw new Error('Generation benchmark did not produce the expected 250-artifact dry-run plan.')
    if (id === 'check' && (structured.outdated !== true || artifactsOrChanges !== 250)) throw new Error('Check benchmark did not report the expected 250 added artifacts.')
    const pid = connected.transport._process?.pid
    const sample = await rssBytes(pid)
    if (sample !== null) rss.push(sample)
  }
  measurements[id] = {
    timingMs: summary(times),
    structuredContentBytes: summary(sizes),
    peakRssBytesApprox: rss.length ? Math.max(...rss) : null,
    diagnostics,
    artifactsOrChanges,
  }
}
const stderrBytes = connected.stderr.reduce((total, chunk) => total + chunk.byteLength, 0)
await connected.client.close()

const prepareTimes = []
const applyTimes = []
const prepareSizes = []
const applySizes = []
const planBytes = []
const writeRss = []
const stagingTimes = []
const commitTimes = []
let writeStderrBytes = 0
for (let index = 0; index < iterations; index += 1) {
  const root = await createWriteWorkspace()
  try {
    const write = await connectWrite(root)
    const prepareStarted = performance.now()
    const prepared = await write.client.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['evaluation'] } }, undefined, { timeout: 120_000 })
    prepareTimes.push(performance.now() - prepareStarted)
    const preparedStructured = prepared.structuredContent ?? {}
    prepareSizes.push(Buffer.byteLength(JSON.stringify(preparedStructured)))
    const plan = preparedStructured.plan
    if (preparedStructured.success !== true || !plan || plan.summary?.added !== 250) throw new Error('Write benchmark Prepare did not produce the expected 250-file plan.')
    planBytes.push(Buffer.byteLength(JSON.stringify(plan)))
    const applyStarted = performance.now()
    const applied = await write.client.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash },
    }, undefined, { timeout: 120_000 })
    applyTimes.push(performance.now() - applyStarted)
    const appliedStructured = applied.structuredContent ?? {}
    applySizes.push(Buffer.byteLength(JSON.stringify(appliedStructured)))
    if (appliedStructured.success !== true || appliedStructured.summary?.added !== 250) throw new Error('Write benchmark Apply did not commit the expected 250 files.')
    const sample = await rssBytes(write.transport._process?.pid)
    if (sample !== null) writeRss.push(sample)
    await write.client.close()
    const logText = Buffer.concat(write.stderr).toString('utf8')
    writeStderrBytes += Buffer.byteLength(logText)
    for (const line of logText.split(/\r?\n/).filter(Boolean)) {
      try {
        const event = JSON.parse(line)
        if (event.event === 'generation_apply_succeeded') {
          if (Number.isFinite(event.stagingMs)) stagingTimes.push(event.stagingMs)
          if (Number.isFinite(event.commitMs)) commitTimes.push(event.commitMs)
        }
      } catch {
        throw new Error('Write benchmark stderr contained a non-JSON operational log line.')
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
measurements.prepareGeneration = {
  timingMs: summary(prepareTimes),
  structuredContentBytes: summary(prepareSizes),
  planBytes: summary(planBytes),
  peakRssBytesApprox: writeRss.length ? Math.max(...writeRss) : null,
  artifactsOrChanges: 250,
}
measurements.applyGeneration = {
  timingMs: summary(applyTimes),
  structuredContentBytes: summary(applySizes),
  peakRssBytesApprox: writeRss.length ? Math.max(...writeRss) : null,
  artifactsOrChanges: 250,
  stagingMs: stagingTimes.length ? summary(stagingTimes) : null,
  commitMs: commitTimes.length ? summary(commitTimes) : null,
}

const rollbackTimes = []
const rollbackOnlyTimes = []
for (let index = 0; index < iterations; index += 1) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-to-rollback-benchmark-'))
  try {
    const before = materializeArtifacts(
      Array.from({ length: 50 }, (_, artifactIndex) => ({ kind: 'text', path: `file-${String(artifactIndex).padStart(3, '0')}.txt`, content: `before ${artifactIndex}\n` })),
      root,
    )
    await writeArtifacts(before.artifacts, await compareArtifacts(before.artifacts, root, true), { generatorVersion: 'benchmark' })
    const after = materializeArtifacts(
      Array.from({ length: 50 }, (_, artifactIndex) => ({ kind: 'text', path: `file-${String(artifactIndex).padStart(3, '0')}.txt`, content: `after ${artifactIndex}\n` })),
      root,
    )
    const afterManifest = await compareArtifacts(after.artifacts, root, true)
    const started = performance.now()
    try {
      await writeArtifactsTransaction(after.artifacts, afterManifest, { generatorVersion: 'benchmark', testFailpoint: 'rename-middle' })
      throw new Error('Rollback benchmark failpoint unexpectedly committed.')
    } catch (error) {
      if (!(error instanceof OutputTransactionRolledBackError)) throw error
      rollbackTimes.push(performance.now() - started)
      rollbackOnlyTimes.push(error.rollbackMs)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
measurements.rollbackGeneration = {
  timingMs: summary(rollbackTimes),
  rollbackMs: summary(rollbackOnlyTimes),
  structuredContentBytes: { min: 0, median: 0, p95: 0, max: 0 },
  peakRssBytesApprox: null,
  artifactsOrChanges: 50,
}

const report = {
  schemaVersion: 1,
  runtime: { nodeMajor: Number(process.versions.node.split('.')[0]), cpuTime: { available: false, reason: 'Portable child-process CPU accounting is not reliable across supported platforms.' } },
  corpus: { largeInputBytes: (await stat(path.join(fixtures, 'large/openapi.json'))).size, largeOperations: 700, largeSchemas: 301, generationOperations: 250 },
  iterations,
  measurements,
  stderrBytes: stderrBytes + writeStderrBytes,
}

if (check) {
  const baseline = JSON.parse(await readFile(path.join(packageRoot, 'src/evaluation/performance-baseline.json'), 'utf8'))
  const violations = []
  for (const [id, limit] of Object.entries(baseline.thresholds)) {
    const measured = measurements[id]
    if (!measured) continue
    if (measured.timingMs.p95 > limit.maxP95Ms) violations.push(`${id} p95 ${Math.round(measured.timingMs.p95)}ms exceeds ${limit.maxP95Ms}ms`)
    if (measured.structuredContentBytes?.max > limit.maxStructuredContentBytes) violations.push(`${id} output exceeds ${limit.maxStructuredContentBytes} bytes`)
    if (measured.peakRssBytesApprox && measured.peakRssBytesApprox > baseline.maxPeakRssBytesApprox) violations.push(`${id} RSS exceeds ${baseline.maxPeakRssBytesApprox} bytes`)
  }
  report.regressionCheck = { success: violations.length === 0, violations }
  if (violations.length) process.exitCode = 1
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
for (const [id, value] of Object.entries(measurements)) process.stderr.write(`${id}: median ${Math.round(value.timingMs.median)}ms, p95 ${Math.round(value.timingMs.p95)}ms${value.structuredContentBytes ? `, max output ${value.structuredContentBytes.max} bytes` : ''}\n`)
