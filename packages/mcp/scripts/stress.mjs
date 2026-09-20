import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  acquireOutputWriteLock,
  commitGenerationStateTransaction,
  compareArtifacts,
  generationIntentStateRelativePath,
  materializeArtifacts,
  normalizeGenerationIntent,
  OutputTransactionRolledBackError,
  serializeGenerationIntentManifest,
  snapshotOutputFile,
  writeArtifacts,
} from '@openapi-to/core'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(packageRoot, '../..')
const bin = path.join(packageRoot, 'bin/openapi-to-mcp.js')
const fixture = 'packages/mcp/src/evaluation/fixtures/small/openapi-3.1.json'
const config = 'packages/mcp/src/evaluation/fixtures/generation/openapi.config.cjs'
const transport = new StdioClientTransport({ command: process.execPath, args: [bin, '--workspace-root', repositoryRoot, '--config', config, '--log-level', 'error'], stderr: 'pipe' })
let stderrBytes = 0
transport.stderr?.on('data', (chunk) => { stderrBytes += chunk.byteLength })
const client = new Client({ name: 'openapi-to-stress', version: '1.0.0' })
await client.connect(transport)
const execFileAsync = promisify(execFile)
const rss = async () => {
  const pid = transport._process?.pid
  if (!pid) return null
  try { return Number((await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)])).stdout.trim()) * 1024 } catch { return null }
}
const rssBefore = await rss()
const started = performance.now()
const callMany = async (count, name, argumentsValue) => {
  for (let index = 0; index < count; index += 1) {
    const result = await client.callTool({ name, arguments: argumentsValue }, undefined, { timeout: 120_000 })
    if (!result.structuredContent || (result.structuredContent.success === false && name !== 'openapi_check_generation')) throw new Error(`${name} failed at iteration ${index}.`)
  }
}
await callMany(100, 'openapi_validate', { source: fixture })
await callMany(100, 'openapi_inspect', { source: fixture })
await callMany(50, 'openapi_diff', { before: fixture, after: fixture })
await callMany(100, 'openapi_search_operations', { target: 'evaluation', query: 'enterprise resource 42', limit: 8 })
await callMany(50, 'openapi_get_operation', { target: 'evaluation', operationKey: 'getEnterpriseResource42', detail: 'contract' })
await callMany(10, 'openapi_generate_dry_run', { targets: ['evaluation'] })
await callMany(10, 'openapi_check_generation', { targets: ['evaluation'] })
await Promise.all(Array.from({ length: 20 }, () => client.callTool({ name: 'openapi_validate', arguments: { source: fixture } }, undefined, { timeout: 120_000 })))
const rssAfter = await rss()
await client.close()
const selectionRoot = await mkdtemp(path.join(os.tmpdir(), 'openapi-to-selection-stress-'))
let selectivePrepareCalls = 0
let selectivePrepareOutputBytes = 0
let selectivePrepareRssGrowthBytesApprox = null
let selectiveProjectionSchemaCount
let selectiveCompileMs
let selectiveApplyMs
let selectiveTransactionMetrics
try {
  await mkdir(path.join(selectionRoot, '.openapi-to/generation-intents'), { recursive: true })
  const largeFixtureRoot = path.join(repositoryRoot, 'packages/mcp/src/evaluation/fixtures/large')
  await copyFile(path.join(largeFixtureRoot, 'openapi.json'), path.join(selectionRoot, 'openapi.json'))
  await copyFile(path.join(largeFixtureRoot, 'schemas-a.json'), path.join(selectionRoot, 'schemas-a.json'))
  await copyFile(path.join(largeFixtureRoot, 'schemas-b.json'), path.join(selectionRoot, 'schemas-b.json'))
  await writeFile(path.join(selectionRoot, 'openapi.config.cjs'), `module.exports = {
  servers: [{ name: 'large', input: { path: './openapi.json' }, output: { dir: 'generated', clean: true } }],
  plugins: [{ name: 'selection-stress', hooks: { operation(operation, ctx) {
    const id = operation.accessor.operationId;
    ctx.addArtifact({ kind: 'text', path: ctx.openapiToSingleConfig.output.dir + '/' + id + '.txt', content: id + '\\n' });
  } } }]
};
`)
  const previousOperationKeys = Array.from({ length: 100 }, (_, index) => `getEnterpriseResource${index}`).sort()
  const previousIntent = normalizeGenerationIntent('large', '.openapi-to/generated', { type: 'operations', operationKeys: previousOperationKeys })
  const selectionFile = path.join(selectionRoot, generationIntentStateRelativePath('large'))
  const selectionBytes = serializeGenerationIntentManifest(previousIntent)
  await writeFile(selectionFile, selectionBytes)
  const selectionTransport = new StdioClientTransport({
    command: process.execPath,
    args: [bin, '--workspace-root', selectionRoot, '--config', 'openapi.config.cjs', '--allow-write', '--log-level', 'error'],
    stderr: 'pipe',
  })
  selectionTransport.stderr?.on('data', (chunk) => { stderrBytes += chunk.byteLength })
  const selectionClient = new Client({ name: 'openapi-to-selection-stress', version: '1.0.0' })
  await selectionClient.connect(selectionTransport)
  const compileStarted = performance.now()
  const listed = await selectionClient.callTool({ name: 'openapi_list_targets', arguments: {} }, undefined, { timeout: 120_000 })
  if (listed.structuredContent?.success !== true || listed.structuredContent?.targets?.[0]?.operationCount !== 700) {
    throw new Error('Large selective stress target discovery did not compile the expected 700 operations.')
  }
  selectiveCompileMs = Math.round(performance.now() - compileStarted)
  const selectionRssBefore = await (async () => {
    const pid = selectionTransport._process?.pid
    if (!pid) return null
    try { return Number((await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)])).stdout.trim()) * 1024 } catch { return null }
  })()
  let stablePlanHash
  let lastPlan
  try {
    for (let index = 0; index < 100; index += 1) {
      const prepared = await selectionClient.callTool({
        name: 'openapi_prepare_generation',
        arguments: { targets: ['large'], selection: { type: 'add', operationKeys: ['getEnterpriseResource100'] } },
      }, undefined, { timeout: 120_000 })
      const value = prepared.structuredContent ?? {}
      const plan = value.plan
      if (
        value.success !== true || plan?.kind !== 'selective' || plan?.applySupported !== true || typeof plan?.token !== 'string'
        || plan?.selection?.counts?.previous !== 100 || plan?.selection?.counts?.requested !== 1 || plan?.selection?.counts?.desired !== 101
        || plan?.selection?.previousOperationKeys?.length !== 50 || plan?.selection?.desiredOperationKeys?.length !== 50 || plan?.selection?.truncated !== true
        || plan?.projection?.operationCount !== 101 || !Number.isInteger(plan?.projection?.schemaCount)
        || plan.projection.schemaCount < 1 || plan.projection.schemaCount > 301 || plan?.summary?.added !== 101
      ) {
        const actual = {
          success: value.success,
          kind: plan?.kind,
          applySupported: plan?.applySupported,
          hasToken: plan?.token !== undefined,
          selectionCounts: plan?.selection?.counts,
          previousReturned: plan?.selection?.previousOperationKeys?.length,
          desiredReturned: plan?.selection?.desiredOperationKeys?.length,
          selectionTruncated: plan?.selection?.truncated,
          projectionOperationCount: plan?.projection?.operationCount,
          summary: plan?.summary,
          diagnostics: value.diagnostics,
        }
        throw new Error(`Selective Prepare stress returned an invalid desired plan at iteration ${index}: ${JSON.stringify(actual)}`)
      }
      if (stablePlanHash === undefined) stablePlanHash = plan.planHash
      else if (plan.planHash !== stablePlanHash) throw new Error(`Selective Prepare semantic hash drifted at iteration ${index}.`)
      if (selectiveProjectionSchemaCount === undefined) selectiveProjectionSchemaCount = plan.projection.schemaCount
      else if (plan.projection.schemaCount !== selectiveProjectionSchemaCount) throw new Error(`Selective Prepare projection schema count drifted at iteration ${index}.`)
      selectivePrepareOutputBytes = Math.max(selectivePrepareOutputBytes, Buffer.byteLength(JSON.stringify(value)))
      selectivePrepareCalls += 1
      lastPlan = plan
    }
    const applyStarted = performance.now()
    const applied = await selectionClient.callTool({
      name: 'openapi_apply_generation',
      arguments: { planId: lastPlan.planId, token: lastPlan.token, approvedPlanHash: lastPlan.planHash },
    }, undefined, { timeout: 120_000 })
    const appliedValue = applied.structuredContent ?? {}
    selectiveApplyMs = Math.round(performance.now() - applyStarted)
    if (
      appliedValue.success !== true || appliedValue.planKind !== 'selective' || appliedValue.selectionApplied !== true
      || appliedValue.selectedOperationCount !== 101 || appliedValue.selectionHash !== lastPlan.selection.desiredSelectionHash
      || appliedValue.projectionHash !== lastPlan.projection.projectionHash
    ) throw new Error(`Selective Apply stress returned an invalid result: ${JSON.stringify(appliedValue)}`)
    selectiveTransactionMetrics = appliedValue.transactionMetrics
  } finally {
    const pid = selectionTransport._process?.pid
    const selectionRssAfter = pid ? await (async () => {
      try { return Number((await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)])).stdout.trim()) * 1024 } catch { return null }
    })() : null
    if (selectionRssBefore !== null && selectionRssAfter !== null) selectivePrepareRssGrowthBytesApprox = selectionRssAfter - selectionRssBefore
    await selectionClient.close()
  }
  const persistedSelection = JSON.parse(await readFile(selectionFile, 'utf8'))
  if (persistedSelection.scope?.operationKeys?.length !== 101 || !persistedSelection.scope.operationKeys.includes('getEnterpriseResource100')) throw new Error('Selective Apply stress did not persist the complete desired selection.')
  if ((await readdir(path.join(selectionRoot, '.openapi-to/generation-intents'))).length !== 1) throw new Error('Selective Prepare stress created unexpected Generation Intent state.')
  const generatedEntries = await readdir(path.join(selectionRoot, '.openapi-to/generated'))
  if (generatedEntries.length !== 102 || !generatedEntries.includes('.openapi-to-manifest.json')) throw new Error('Selective Apply stress committed an unexpected generated file set.')
  for (const internal of ['.openapi-to-write.lock', '.openapi-to-transaction.json', '.openapi-to-transaction']) {
    if (generatedEntries.includes(internal)) throw new Error(`Selective Apply stress leaked ${internal}.`)
  }
} finally {
  await rm(selectionRoot, { recursive: true, force: true })
}
const writeRoot = await mkdtemp(path.join(os.tmpdir(), 'openapi-to-write-stress-'))
let writeCalls = 0
try {
  await mkdir(path.join(writeRoot, '.openapi-to'))
  await copyFile(path.join(repositoryRoot, 'packages/mcp/src/evaluation/fixtures/generation/openapi.json'), path.join(writeRoot, 'openapi.json'))
  await writeFile(path.join(writeRoot, 'openapi.config.cjs'), `module.exports = {
  servers: [{ name: 'evaluation', input: { path: './openapi.json' }, output: { dir: 'generated', clean: true } }],
  plugins: [{ name: 'write-stress', hooks: { buildStart(ctx) {
    const root = ctx.openapiToSingleConfig.output.dir;
    ctx.addArtifact({ kind: 'text', path: root + '/client.txt', content: 'stable\\n' });
  } } }]
};
`)
  const writeTransport = new StdioClientTransport({ command: process.execPath, args: [bin, '--workspace-root', writeRoot, '--config', 'openapi.config.cjs', '--allow-write', '--log-level', 'error'], stderr: 'pipe' })
  writeTransport.stderr?.on('data', (chunk) => { stderrBytes += chunk.byteLength })
  const writeClient = new Client({ name: 'openapi-to-write-stress', version: '1.0.0' })
  await writeClient.connect(writeTransport)
  try {
    for (let index = 0; index < 20; index += 1) {
      const prepared = await writeClient.callTool({ name: 'openapi_prepare_generation', arguments: { targets: ['evaluation'] } }, undefined, { timeout: 120_000 })
      const plan = prepared.structuredContent?.plan
      if (!plan) throw new Error(`Prepare failed at write stress iteration ${index}.`)
      const applied = await writeClient.callTool({ name: 'openapi_apply_generation', arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash } }, undefined, { timeout: 120_000 })
      if (applied.structuredContent?.success !== true) throw new Error(`Apply failed at write stress iteration ${index}.`)
      writeCalls += 1
    }
  } finally {
    await writeClient.close()
  }
  for (const internal of ['.openapi-to-write.lock', '.openapi-to-transaction.json', '.openapi-to-transaction']) {
    try {
      await access(path.join(writeRoot, '.openapi-to/generated', internal))
      throw new Error(`Controlled-write stress leaked ${internal}.`)
    } catch (error) {
      if (error instanceof Error && !('code' in error && error.code === 'ENOENT')) throw error
    }
  }
} finally {
  await rm(writeRoot, { recursive: true, force: true })
}
const stateTransactionRoot = await mkdtemp(path.join(os.tmpdir(), 'openapi-to-state-transaction-stress-'))
let stateTransactionCommits = 0
let stateTransactionRollbacks = 0
let maxStateJournalBytes = 0
let maxStateStagedBytes = 0
let maxStateBackupBytes = 0
try {
  const outputRoot = path.join(stateTransactionRoot, 'generated')
  const selectionRoot = path.join(stateTransactionRoot, '.openapi-to', 'generation-intents')
  const selectionFile = path.join(selectionRoot, 'stress.json')
  await mkdir(selectionRoot, { recursive: true })
  await writeFile(selectionFile, '{"iteration":-1}\n')
  let materialized = materializeArtifacts(
    Array.from({ length: 100 }, (_, index) => ({ kind: 'text', path: `client-${index}.txt`, content: `stable-${index}\n` })),
    outputRoot,
  ).artifacts
  await writeArtifacts(materialized, await compareArtifacts(materialized, outputRoot, true), { generatorVersion: 'stress' })
  const recoveryContext = { workspaceRoot: stateTransactionRoot, allowedStateRoots: ['.openapi-to/generation-intents'] }
  for (let index = 0; index < 20; index += 1) {
    const desiredArtifacts = materializeArtifacts(
      Array.from({ length: 100 }, (_, artifactIndex) => ({ kind: 'text', path: `client-${artifactIndex}.txt`, content: `commit-${index}-${artifactIndex}\n` })),
      outputRoot,
    ).artifacts
    const desiredBytes = new TextEncoder().encode(`${JSON.stringify({ iteration: index })}\n`)
    const manifest = await compareArtifacts(desiredArtifacts, outputRoot, true)
    const lock = await acquireOutputWriteLock(outputRoot, { recoveryContext })
    try {
      const result = await commitGenerationStateTransaction(lock, desiredArtifacts, manifest, [{
        id: 'selection',
        workspaceRelativePath: '.openapi-to/generation-intents/stress.json',
        expectedBefore: await snapshotOutputFile(selectionFile),
        desiredBytes,
        desiredSha256: createHash('sha256').update(desiredBytes).digest('hex'),
        maxBytes: 4096,
      }], { recoveryContext, generatorVersion: 'stress' })
      maxStateJournalBytes = Math.max(maxStateJournalBytes, result.journalBytes)
      maxStateStagedBytes = Math.max(maxStateStagedBytes, result.stagedBytes)
      maxStateBackupBytes = Math.max(maxStateBackupBytes, result.backupBytes)
      stateTransactionCommits += 1
      materialized = desiredArtifacts
    } finally {
      await lock.release()
    }
  }
  for (let index = 0; index < 20; index += 1) {
    const desiredArtifacts = materializeArtifacts(
      Array.from({ length: 100 }, (_, artifactIndex) => ({ kind: 'text', path: `client-${artifactIndex}.txt`, content: `rollback-${index}-${artifactIndex}\n` })),
      outputRoot,
    ).artifacts
    const before = await readFile(selectionFile, 'utf8')
    const beforeArtifact = await readFile(path.join(outputRoot, 'client-0.txt'), 'utf8')
    const desiredBytes = new TextEncoder().encode(`${JSON.stringify({ rollback: index })}\n`)
    const manifest = await compareArtifacts(desiredArtifacts, outputRoot, true)
    const lock = await acquireOutputWriteLock(outputRoot, { recoveryContext })
    try {
      try {
        await commitGenerationStateTransaction(lock, desiredArtifacts, manifest, [{
          id: 'selection',
          workspaceRelativePath: '.openapi-to/generation-intents/stress.json',
          expectedBefore: await snapshotOutputFile(selectionFile),
          desiredBytes,
          desiredSha256: createHash('sha256').update(desiredBytes).digest('hex'),
          maxBytes: 4096,
        }], { recoveryContext, generatorVersion: 'stress', testFailpoint: 'state-after-rename' })
        throw new Error('State rollback stress unexpectedly committed.')
      } catch (error) {
        if (error instanceof Error && error.message === 'State rollback stress unexpectedly committed.') throw error
        if (!(error instanceof OutputTransactionRolledBackError)) throw error
      }
      if (await readFile(selectionFile, 'utf8') !== before) throw new Error(`State rollback stress changed bytes at iteration ${index}.`)
      if (await readFile(path.join(outputRoot, 'client-0.txt'), 'utf8') !== beforeArtifact) throw new Error(`Artifact rollback stress changed bytes at iteration ${index}.`)
      stateTransactionRollbacks += 1
    } finally {
      await lock.release()
    }
  }
  for (const internal of ['.openapi-to-write.lock', '.openapi-to-transaction.json', '.openapi-to-transaction']) {
    try {
      await access(path.join(outputRoot, internal))
      throw new Error(`State transaction stress leaked ${internal}.`)
    } catch (error) {
      if (error instanceof Error && !('code' in error && error.code === 'ENOENT')) throw error
    }
  }
  try {
    await access(path.join(selectionRoot, '.openapi-to-state-transaction'))
    throw new Error('State transaction stress leaked state transaction storage.')
  } catch (error) {
    if (error instanceof Error && !('code' in error && error.code === 'ENOENT')) throw error
  }
} finally {
  await rm(stateTransactionRoot, { recursive: true, force: true })
}
const rssGrowthBytesApprox = rssBefore !== null && rssAfter !== null ? rssAfter - rssBefore : null
const success = (rssGrowthBytesApprox === null || rssGrowthBytesApprox < 512 * 1024 * 1024)
  && (selectivePrepareRssGrowthBytesApprox === null || selectivePrepareRssGrowthBytesApprox < 512 * 1024 * 1024)
process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  success,
  calls: { validate: 120, inspect: 100, diff: 50, searchOperations: 100, getOperation: 50, dryRun: 10, check: 10, selectivePrepare: selectivePrepareCalls, selectiveApply: 1, prepare: writeCalls, apply: writeCalls + 1 },
  selectivePrepare: {
    documentOperations: 700,
    documentSchemas: 301,
    previousSelection: 100,
    requestedAdditions: 1,
    desiredSelection: 101,
    projectionOperations: 101,
    projectionSchemas: selectiveProjectionSchemaCount,
    artifactCount: 101,
    maxStructuredContentBytes: selectivePrepareOutputBytes,
    rssGrowthBytesApprox: selectivePrepareRssGrowthBytesApprox,
    repeatedPlanHashStable: selectivePrepareCalls === 100,
    compileMs: selectiveCompileMs,
    applyMs: selectiveApplyMs,
    transactionMetrics: selectiveTransactionMetrics,
    filesystemWrites: 1,
  },
  stateTransaction: {
    artifactCount: 100,
    commits: stateTransactionCommits,
    rollbacks: stateTransactionRollbacks,
    maxJournalBytes: maxStateJournalBytes,
    maxStagedBytes: maxStateStagedBytes,
    maxBackupBytes: maxStateBackupBytes,
  },
  durationMs: Math.round(performance.now() - started), stderrBytes, rssBefore, rssAfter, rssGrowthBytesApprox,
})}\n`)
if (!success) process.exitCode = 1
