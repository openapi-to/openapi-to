import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { access, link, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import {
  acquireOutputWriteLock,
  ARTIFACT_MANIFEST_FILENAME,
  commitGenerationStateTransaction,
  compareArtifacts,
  DEFAULT_MAX_TRANSACTION_STATE_FILE_BYTES,
  materializeArtifacts,
  OUTPUT_TRANSACTION_JOURNAL,
  snapshotOutputFile,
  STATE_TRANSACTION_DIRECTORY,
  TransactionStateFileError,
  writeArtifacts,
  type TransactionFailpoint,
  type TransactionRecoveryContext,
  type TransactionStateFile,
} from './index.ts'

const encoder = new TextEncoder()
const crossDeviceRoot = '/dev/shm'
const crossDeviceAvailable = (() => {
  try {
    return statSync(crossDeviceRoot).dev !== statSync(os.tmpdir()).dev
  } catch {
    return false
  }
})()

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function missing(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return false
  } catch {
    return true
  }
}

async function prepareStateTransaction(options: { stateExists?: boolean; stateCount?: number; stateRootExists?: boolean } = {}) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'openapi-generation-state-'))
  const outputRoot = path.join(workspace, 'generated')
  const stateRoot = path.join(workspace, '.openapi-to', 'selections')
  const stateRootExisted = options.stateRootExists !== false || options.stateExists !== false
  if (stateRootExisted) await mkdir(stateRoot, { recursive: true })
  const beforeArtifacts = materializeArtifacts([
    { kind: 'text', path: 'existing.txt', content: 'before\n' },
    { kind: 'text', path: 'deleted.txt', content: 'delete\n' },
  ], outputRoot)
  await writeArtifacts(beforeArtifacts.artifacts, await compareArtifacts(beforeArtifacts.artifacts, outputRoot, true), { generatorVersion: 'test' })

  const stateCount = options.stateCount ?? 1
  const statePaths = Array.from({ length: stateCount }, (_, index) => path.join(stateRoot, `target-${index}.json`))
  if (options.stateExists !== false) {
    for (const [index, statePath] of statePaths.entries()) await writeFile(statePath, `{"version":"before-${index}"}\n`)
  }
  const beforeOutput = {
    existing: await readFile(path.join(outputRoot, 'existing.txt'), 'utf8'),
    deleted: await readFile(path.join(outputRoot, 'deleted.txt'), 'utf8'),
    ownership: await readFile(path.join(outputRoot, ARTIFACT_MANIFEST_FILENAME), 'utf8'),
  }
  const beforeState = await Promise.all(statePaths.map(async (statePath) => options.stateExists === false ? undefined : readFile(statePath, 'utf8')))
  const afterArtifacts = materializeArtifacts([
    { kind: 'text', path: 'existing.txt', content: 'after\n' },
    { kind: 'text', path: 'added.txt', content: 'added\n' },
  ], outputRoot)
  const manifest = await compareArtifacts(afterArtifacts.artifacts, outputRoot, true)
  const stateFiles: TransactionStateFile[] = []
  for (const [index, statePath] of statePaths.entries()) {
    const desiredBytes = encoder.encode(`{"version":"after-${index}"}\n`)
    stateFiles.push({
      id: `selection-${index}`,
      workspaceRelativePath: path.posix.join('.openapi-to', 'selections', `target-${index}.json`),
      expectedBefore: await snapshotOutputFile(statePath),
      desiredBytes,
      desiredSha256: sha256(desiredBytes),
      maxBytes: 1024,
    })
  }
  const recoveryContext: TransactionRecoveryContext = {
    workspaceRoot: workspace,
    allowedStateRoots: [path.posix.join('.openapi-to', 'selections')],
  }
  return { workspace, outputRoot, stateRoot, stateRootExisted, statePaths, beforeOutput, beforeState, artifacts: afterArtifacts.artifacts, manifest, stateFiles, recoveryContext }
}

async function expectPriorState(prepared: Awaited<ReturnType<typeof prepareStateTransaction>>): Promise<void> {
  expect(await readFile(path.join(prepared.outputRoot, 'existing.txt'), 'utf8')).toBe(prepared.beforeOutput.existing)
  expect(await readFile(path.join(prepared.outputRoot, 'deleted.txt'), 'utf8')).toBe(prepared.beforeOutput.deleted)
  expect(await readFile(path.join(prepared.outputRoot, ARTIFACT_MANIFEST_FILENAME), 'utf8')).toBe(prepared.beforeOutput.ownership)
  expect(await missing(path.join(prepared.outputRoot, 'added.txt'))).toBe(true)
  for (const [index, statePath] of prepared.statePaths.entries()) {
    const before = prepared.beforeState[index]
    if (before === undefined) expect(await missing(statePath)).toBe(true)
    else expect(await readFile(statePath, 'utf8')).toBe(before)
  }
  expect(await missing(path.join(prepared.outputRoot, OUTPUT_TRANSACTION_JOURNAL))).toBe(true)
  expect(await missing(path.join(prepared.stateRoot, STATE_TRANSACTION_DIRECTORY))).toBe(true)
  if (!prepared.stateRootExisted) expect(await missing(prepared.stateRoot)).toBe(true)
}

describe('generation and controlled state transaction', { concurrent: false }, () => {
  it('commits artifacts, ownership, and one controlled state file together', async () => {
    const prepared = await prepareStateTransaction({ stateExists: false, stateRootExists: false })
    const lock = await acquireOutputWriteLock(prepared.outputRoot, { recoveryContext: prepared.recoveryContext })
    try {
      const result = await commitGenerationStateTransaction(lock, prepared.artifacts, prepared.manifest, prepared.stateFiles, {
        recoveryContext: prepared.recoveryContext,
        generatorVersion: 'test',
      })
      expect(result).toMatchObject({ stateFiles: 1, stateBytes: prepared.stateFiles[0]?.desiredBytes.byteLength })
      expect(result.stagedBytes).toBeGreaterThan(result.stateBytes)
      expect(result.journalBytes).toBeGreaterThan(0)
    } finally {
      await lock.release()
    }
    expect(await readFile(path.join(prepared.outputRoot, 'existing.txt'), 'utf8')).toBe('after\n')
    expect(await readFile(path.join(prepared.outputRoot, 'added.txt'), 'utf8')).toBe('added\n')
    expect(await missing(path.join(prepared.outputRoot, 'deleted.txt'))).toBe(true)
    expect(await readFile(prepared.statePaths[0] as string, 'utf8')).toBe('{"version":"after-0"}\n')
  })

  it('commits multiple controlled state files deterministically', async () => {
    const prepared = await prepareStateTransaction({ stateCount: 3 })
    await writeFile(prepared.statePaths[0] as string, '')
    prepared.stateFiles[0] = { ...prepared.stateFiles[0] as TransactionStateFile, expectedBefore: await snapshotOutputFile(prepared.statePaths[0] as string) }
    const lock = await acquireOutputWriteLock(prepared.outputRoot, { recoveryContext: prepared.recoveryContext })
    try {
      const result = await commitGenerationStateTransaction(lock, prepared.artifacts, prepared.manifest, prepared.stateFiles, {
        recoveryContext: prepared.recoveryContext,
        generatorVersion: 'test',
      })
      expect(result.stateFiles).toBe(3)
      expect(result.stateBytes).toBe(prepared.stateFiles.reduce((total, item) => total + item.desiredBytes.byteLength, 0))
    } finally {
      await lock.release()
    }
    await expect(Promise.all(prepared.statePaths.map((filePath) => readFile(filePath, 'utf8')))).resolves.toEqual([
      '{"version":"after-0"}\n',
      '{"version":"after-1"}\n',
      '{"version":"after-2"}\n',
    ])
  })

  const stateFailpoints: TransactionFailpoint[] = [
    'staging-first',
    'staging-middle',
    'staging-complete',
    'backup-first',
    'rename-first',
    'rename-middle',
    'delete-first',
    'manifest-temp',
    'manifest-backup',
    'manifest-rename',
    'install-after-link',
    'state-stage',
    'state-after-stage',
    'state-backup',
    'state-after-backup',
    'state-rename',
    'state-after-rename',
    'state-verify',
    'state-cleanup',
    'cleanup',
  ]

  it.each(stateFailpoints)('rolls back artifacts, ownership, and state byte-identically at %s', async (failpoint) => {
    const prepared = await prepareStateTransaction()
    const lock = await acquireOutputWriteLock(prepared.outputRoot, { recoveryContext: prepared.recoveryContext })
    try {
      await expect(commitGenerationStateTransaction(lock, prepared.artifacts, prepared.manifest, prepared.stateFiles, {
        recoveryContext: prepared.recoveryContext,
        generatorVersion: 'test',
        testFailpoint: failpoint,
      })).rejects.toThrow()
    } finally {
      await lock.release()
    }
    await expectPriorState(prepared)
  })

  it('rejects missing recovery authority, traversal, hash mismatch, and oversized state', async () => {
    const prepared = await prepareStateTransaction()
    let lock = await acquireOutputWriteLock(prepared.outputRoot)
    try {
      await expect(commitGenerationStateTransaction(lock, prepared.artifacts, prepared.manifest, prepared.stateFiles)).rejects.toMatchObject({ code: 'TRANSACTION_RECOVERY_CONTEXT_REQUIRED' })
      await expect(commitGenerationStateTransaction(lock, prepared.artifacts, prepared.manifest, prepared.stateFiles, { recoveryContext: prepared.recoveryContext })).rejects.toMatchObject({ code: 'TRANSACTION_RECOVERY_CONTEXT_REQUIRED' })
    } finally {
      await lock.release()
    }

    const otherWorkspace = await mkdtemp(path.join(os.tmpdir(), 'openapi-state-other-workspace-'))
    lock = await acquireOutputWriteLock(prepared.outputRoot, { recoveryContext: prepared.recoveryContext })
    try {
      await expect(commitGenerationStateTransaction(lock, prepared.artifacts, prepared.manifest, prepared.stateFiles, {
        recoveryContext: { ...prepared.recoveryContext, workspaceRoot: otherWorkspace },
      })).rejects.toMatchObject({ code: 'TRANSACTION_RECOVERY_CONTEXT_REQUIRED' })
      await expect(commitGenerationStateTransaction(lock, prepared.artifacts, prepared.manifest, prepared.stateFiles, {
        recoveryContext: { ...prepared.recoveryContext, allowedStateRoots: ['.openapi-to/other-state'] },
      })).rejects.toMatchObject({ code: 'TRANSACTION_RECOVERY_CONTEXT_REQUIRED' })
      const traversal = [{ ...prepared.stateFiles[0] as TransactionStateFile, workspaceRelativePath: '../escape.json' }]
      await expect(commitGenerationStateTransaction(lock, prepared.artifacts, prepared.manifest, traversal, { recoveryContext: prepared.recoveryContext })).rejects.toMatchObject({ code: 'TRANSACTION_STATE_FILE_INVALID' })
      const absolute = [{ ...prepared.stateFiles[0] as TransactionStateFile, workspaceRelativePath: path.join(prepared.workspace, 'absolute.json') }]
      await expect(commitGenerationStateTransaction(lock, prepared.artifacts, prepared.manifest, absolute, { recoveryContext: prepared.recoveryContext })).rejects.toMatchObject({ code: 'TRANSACTION_STATE_FILE_INVALID' })
      const badHash = [{ ...prepared.stateFiles[0] as TransactionStateFile, desiredSha256: '0'.repeat(64) }]
      await expect(commitGenerationStateTransaction(lock, prepared.artifacts, prepared.manifest, badHash, { recoveryContext: prepared.recoveryContext })).rejects.toMatchObject({ code: 'TRANSACTION_STATE_FILE_INVALID' })
      const hugeBytes = new Uint8Array(DEFAULT_MAX_TRANSACTION_STATE_FILE_BYTES + 1)
      const tooLarge = [{ ...prepared.stateFiles[0] as TransactionStateFile, desiredBytes: hugeBytes, desiredSha256: sha256(hugeBytes), maxBytes: hugeBytes.byteLength }]
      await expect(commitGenerationStateTransaction(lock, prepared.artifacts, prepared.manifest, tooLarge, { recoveryContext: prepared.recoveryContext })).rejects.toMatchObject({ code: 'TRANSACTION_STATE_FILE_TOO_LARGE' })
    } finally {
      await lock.release()
    }
  })

  it('rejects state snapshot changes and symlink paths', async () => {
    const prepared = await prepareStateTransaction()
    await writeFile(prepared.statePaths[0] as string, 'changed after snapshot\n')
    const lock = await acquireOutputWriteLock(prepared.outputRoot, { recoveryContext: prepared.recoveryContext })
    try {
      await expect(commitGenerationStateTransaction(lock, prepared.artifacts, prepared.manifest, prepared.stateFiles, { recoveryContext: prepared.recoveryContext })).rejects.toMatchObject({ code: 'TRANSACTION_STATE_SNAPSHOT_MISMATCH' })
    } finally {
      await lock.release()
    }

    const nonRegular = await prepareStateTransaction()
    const directoryRelativePath = '.openapi-to/selections/directory.json'
    await mkdir(path.join(nonRegular.workspace, ...directoryRelativePath.split('/')))
    const directoryLock = await acquireOutputWriteLock(nonRegular.outputRoot, { recoveryContext: nonRegular.recoveryContext })
    try {
      await expect(commitGenerationStateTransaction(directoryLock, nonRegular.artifacts, nonRegular.manifest, [{
        ...nonRegular.stateFiles[0] as TransactionStateFile,
        id: 'directory-state',
        workspaceRelativePath: directoryRelativePath,
        expectedBefore: { exists: false },
      }], { recoveryContext: nonRegular.recoveryContext })).rejects.toMatchObject({ code: 'TRANSACTION_STATE_FILE_INVALID' })
    } finally {
      await directoryLock.release()
    }

    const symlinkWorkspace = await mkdtemp(path.join(os.tmpdir(), 'openapi-state-symlink-'))
    const outside = await mkdtemp(path.join(os.tmpdir(), 'openapi-state-outside-'))
    const outputRoot = path.join(symlinkWorkspace, 'generated')
    await mkdir(outputRoot)
    await mkdir(path.join(symlinkWorkspace, '.openapi-to'))
    await symlink(outside, path.join(symlinkWorkspace, '.openapi-to', 'selections'), 'dir')
    const symlinkRecoveryContext = { workspaceRoot: symlinkWorkspace, allowedStateRoots: ['.openapi-to/selections'] }
    const symlinkLock = await acquireOutputWriteLock(outputRoot, { recoveryContext: symlinkRecoveryContext })
    const desiredBytes = encoder.encode('{}\n')
    try {
      await expect(commitGenerationStateTransaction(symlinkLock, [], { outputRoot, entries: [], summary: { added: 0, modified: 0, deleted: 0, unchanged: 0 }, outdated: false }, [{
        id: 'selection',
        workspaceRelativePath: '.openapi-to/selections/state.json',
        expectedBefore: { exists: false },
        desiredBytes,
        desiredSha256: sha256(desiredBytes),
        maxBytes: 100,
      }], { recoveryContext: symlinkRecoveryContext })).rejects.toMatchObject({ code: 'TRANSACTION_STATE_FILE_SYMLINK' })
    } finally {
      await symlinkLock.release()
    }
  })

  it.runIf(process.platform !== 'win32')('rejects hard-linked controlled state files', async () => {
    const prepared = await prepareStateTransaction()
    const linked = path.join(prepared.stateRoot, 'linked.json')
    await link(prepared.statePaths[0] as string, linked)
    const lock = await acquireOutputWriteLock(prepared.outputRoot, { recoveryContext: prepared.recoveryContext })
    try {
      await expect(commitGenerationStateTransaction(lock, prepared.artifacts, prepared.manifest, prepared.stateFiles, { recoveryContext: prepared.recoveryContext })).rejects.toBeInstanceOf(TransactionStateFileError)
    } finally {
      await lock.release()
    }
  })

  it.runIf(crossDeviceAvailable)('fails closed when output and controlled state are on different filesystems', async () => {
    const workspace = await mkdtemp(path.join(crossDeviceRoot, 'openapi-state-device-'))
    const stateRoot = path.join(workspace, 'selections')
    const statePath = path.join(stateRoot, 'state.json')
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'openapi-output-device-'))
    await mkdir(stateRoot)
    const desiredBytes = encoder.encode('{}\n')
    const recoveryContext = { workspaceRoot: workspace, allowedStateRoots: ['selections'] }
    const lock = await acquireOutputWriteLock(outputRoot, { recoveryContext })
    try {
      await expect(commitGenerationStateTransaction(lock, [], { outputRoot, entries: [], summary: { added: 0, modified: 0, deleted: 0, unchanged: 0 }, outdated: false }, [{
        id: 'selection',
        workspaceRelativePath: 'selections/state.json',
        expectedBefore: await snapshotOutputFile(statePath),
        desiredBytes,
        desiredSha256: sha256(desiredBytes),
        maxBytes: 100,
      }], { recoveryContext })).rejects.toMatchObject({ code: 'SELECTIVE_STATE_CROSS_DEVICE_UNSUPPORTED' })
    } finally {
      await lock.release()
    }
  })

  const crashPoints = ['state-after-stage', 'state-after-backup', 'install-after-link', 'state-after-rename', 'committed'] as const
  it.each(crashPoints)('recovers a subprocess crash at %s', async (crashPoint) => {
    const prepared = await prepareStateTransaction()
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
    const fixture = path.join(repositoryRoot, 'scripts/transaction-state-crash-fixture.mjs')
    const result = await new Promise<{ signal: NodeJS.Signals | null }>((resolve, reject) => {
      const child = spawn(process.execPath, [fixture, prepared.workspace, prepared.outputRoot, crashPoint], { stdio: ['ignore', 'pipe', 'pipe'] })
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('State crash fixture timed out.')) }, 10_000)
      child.once('error', reject)
      child.once('exit', (_code, signal) => { clearTimeout(timer); resolve({ signal }) })
    })
    expect(result.signal).toBe('SIGKILL')
    const journalText = await readFile(path.join(prepared.outputRoot, OUTPUT_TRANSACTION_JOURNAL), 'utf8')
    const journal = JSON.parse(journalText) as Record<string, unknown>
    expect(journal.schemaVersion).toBe(2)
    expect(journal.checksum).toMatch(/^[a-f0-9]{64}$/)
    expect(journalText).not.toContain(prepared.workspace)
    expect(journalText).not.toContain('{"version":"after-0"}')
    const lock = await acquireOutputWriteLock(prepared.outputRoot, { staleLockMs: 0, recoveryContext: prepared.recoveryContext })
    await lock.release()
    if (crashPoint === 'committed') {
      expect(await readFile(path.join(prepared.outputRoot, 'existing.txt'), 'utf8')).toBe('after crash\n')
      expect(await readFile(prepared.statePaths[0] as string, 'utf8')).toBe('{"version":"crash-after"}\n')
    } else {
      await expectPriorState(prepared)
    }
  }, 20_000)

  it('requires the owning output root to recover a stale Workspace state lock before another output can proceed', async () => {
    const prepared = await prepareStateTransaction()
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
    const fixture = path.join(repositoryRoot, 'scripts/transaction-state-crash-fixture.mjs')
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [fixture, prepared.workspace, prepared.outputRoot, 'state-after-backup'], { stdio: ['ignore', 'pipe', 'pipe'] })
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Cross-output crash fixture timed out.')) }, 10_000)
      child.once('error', reject)
      child.once('exit', (_code, signal) => {
        clearTimeout(timer)
        if (signal !== 'SIGKILL') reject(new Error(`Expected SIGKILL, received ${signal ?? 'no signal'}.`))
        else resolve()
      })
    })

    const otherOutputRoot = path.join(prepared.workspace, 'other-generated')
    await expect(acquireOutputWriteLock(otherOutputRoot, {
      staleLockMs: 0,
      recoveryContext: prepared.recoveryContext,
    })).rejects.toThrow(/different output root owns an incomplete controlled-state transaction/i)

    const recoveryLock = await acquireOutputWriteLock(prepared.outputRoot, {
      staleLockMs: 0,
      recoveryContext: prepared.recoveryContext,
    })
    await recoveryLock.release()
    await expectPriorState(prepared)
  }, 20_000)

  it('removes a newly created selection when a pre-commit crash is recovered', async () => {
    const prepared = await prepareStateTransaction({ stateExists: false, stateRootExists: false })
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
    const fixture = path.join(repositoryRoot, 'scripts/transaction-state-crash-fixture.mjs')
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [fixture, prepared.workspace, prepared.outputRoot, 'state-after-rename'], { stdio: ['ignore', 'pipe', 'pipe'] })
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('First-create crash fixture timed out.')) }, 10_000)
      child.once('error', reject)
      child.once('exit', (_code, signal) => {
        clearTimeout(timer)
        if (signal !== 'SIGKILL') reject(new Error(`Expected SIGKILL, received ${signal ?? 'no signal'}.`))
        else resolve()
      })
    })
    const lock = await acquireOutputWriteLock(prepared.outputRoot, { staleLockMs: 0, recoveryContext: prepared.recoveryContext })
    await lock.release()
    await expectPriorState(prepared)
  }, 20_000)

  it('preserves committed journal evidence when controlled state no longer matches', async () => {
    const prepared = await prepareStateTransaction()
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
    const fixture = path.join(repositoryRoot, 'scripts/transaction-state-crash-fixture.mjs')
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [fixture, prepared.workspace, prepared.outputRoot, 'committed'], { stdio: ['ignore', 'pipe', 'pipe'] })
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Committed crash fixture timed out.')) }, 10_000)
      child.once('error', reject)
      child.once('exit', (_code, signal) => {
        clearTimeout(timer)
        if (signal !== 'SIGKILL') reject(new Error(`Expected SIGKILL, received ${signal ?? 'no signal'}.`))
        else resolve()
      })
    })
    await writeFile(prepared.statePaths[0] as string, 'tampered after committed journal\n')
    const journalPath = path.join(prepared.outputRoot, OUTPUT_TRANSACTION_JOURNAL)
    await expect(acquireOutputWriteLock(prepared.outputRoot, { staleLockMs: 0, recoveryContext: prepared.recoveryContext })).rejects.toMatchObject({ code: 'TRANSACTION_STATE_VERIFY_FAILED' })
    await expect(access(journalPath)).resolves.toBeUndefined()
    await expect(access(path.join(prepared.stateRoot, STATE_TRANSACTION_DIRECTORY))).resolves.toBeUndefined()
  }, 20_000)

  it('preserves a committed transaction for automatic cleanup when post-commit work fails', async () => {
    const prepared = await prepareStateTransaction()
    const lock = await acquireOutputWriteLock(prepared.outputRoot, { recoveryContext: prepared.recoveryContext })
    try {
      await expect(commitGenerationStateTransaction(lock, prepared.artifacts, prepared.manifest, prepared.stateFiles, {
        recoveryContext: prepared.recoveryContext,
        generatorVersion: 'test',
        onPhase(phase) {
          if (phase === 'committed') throw new Error('post-commit failure')
        },
      })).rejects.toThrow(/requires cleanup recovery/)
    } finally {
      await lock.release()
    }
    await expect(access(path.join(prepared.outputRoot, OUTPUT_TRANSACTION_JOURNAL))).resolves.toBeUndefined()
    const recoveryLock = await acquireOutputWriteLock(prepared.outputRoot, { recoveryContext: prepared.recoveryContext })
    await recoveryLock.release()
    expect(await readFile(path.join(prepared.outputRoot, 'existing.txt'), 'utf8')).toBe('after\n')
    expect(await readFile(prepared.statePaths[0] as string, 'utf8')).toBe('{"version":"after-0"}\n')
    expect(await missing(path.join(prepared.outputRoot, OUTPUT_TRANSACTION_JOURNAL))).toBe(true)
  })

  it('rejects a corrupted journal v2 checksum and preserves the journal', async () => {
    const prepared = await prepareStateTransaction()
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
    const fixture = path.join(repositoryRoot, 'scripts/transaction-state-crash-fixture.mjs')
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [fixture, prepared.workspace, prepared.outputRoot, 'state-after-stage'], { stdio: ['ignore', 'pipe', 'pipe'] })
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Journal corruption fixture timed out.')) }, 10_000)
      child.once('error', reject)
      child.once('exit', (_code, signal) => {
        clearTimeout(timer)
        if (signal !== 'SIGKILL') reject(new Error(`Expected SIGKILL, received ${signal ?? 'no signal'}.`))
        else resolve()
      })
    })
    const journalPath = path.join(prepared.outputRoot, OUTPUT_TRANSACTION_JOURNAL)
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as Record<string, unknown>
    await writeFile(journalPath, `${JSON.stringify({ ...journal, checksum: '0'.repeat(64) })}\n`)
    await expect(acquireOutputWriteLock(prepared.outputRoot, { staleLockMs: 0, recoveryContext: prepared.recoveryContext })).rejects.toThrow(/integrity/i)
    await expect(access(journalPath)).resolves.toBeUndefined()
  }, 20_000)

  it('fails closed on an unknown journal schema version without deleting evidence', async () => {
    const prepared = await prepareStateTransaction()
    const journalPath = path.join(prepared.outputRoot, OUTPUT_TRANSACTION_JOURNAL)
    await writeFile(journalPath, '{"schemaVersion":999}\n')
    await expect(acquireOutputWriteLock(prepared.outputRoot, { recoveryContext: prepared.recoveryContext, waitTimeoutMs: 1 })).rejects.toMatchObject({ code: 'TRANSACTION_JOURNAL_VERSION_UNSUPPORTED' })
    await expect(access(journalPath)).resolves.toBeUndefined()
  })
})
