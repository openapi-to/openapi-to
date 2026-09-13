import { spawn } from 'node:child_process'
import { access, link, mkdir, mkdtemp, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'
import {
  acquireOutputWriteLock,
  ARTIFACT_MANIFEST_FILENAME,
  compareArtifacts,
  materializeArtifacts,
  OUTPUT_TRANSACTION_JOURNAL,
  OUTPUT_WRITE_LOCK_DIRECTORY,
  OutputPreconditionChangedError,
  OutputRecoveryRequiredError,
  OutputTransactionRolledBackError,
  snapshotOutputFile,
  STATE_TRANSACTION_DIRECTORY,
  writeArtifacts,
  writeArtifactsTransaction,
  type TransactionFailpoint,
} from './index.ts'

const lockLstatRace = vi.hoisted(() => ({
  armed: false,
  observed: undefined as (() => void) | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    async lstat(candidate: Parameters<typeof actual.lstat>[0], ...options: unknown[]) {
      if (lockLstatRace.armed && String(candidate).endsWith(`/${OUTPUT_WRITE_LOCK_DIRECTORY}`)) {
        lockLstatRace.armed = false
        lockLstatRace.observed?.()
        const error = new Error(`ENOENT: no such file or directory, lstat '${String(candidate)}'`) as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      }
      return Reflect.apply(actual.lstat, actual, [candidate, ...options])
    },
  }
})

async function fileState(root: string): Promise<Record<string, string>> {
  const state: Record<string, string> = {}
  for (const relativePath of ['existing.txt', 'deleted.txt', 'user.txt', ARTIFACT_MANIFEST_FILENAME]) {
    try {
      state[relativePath] = Buffer.from(await readFile(path.join(root, relativePath))).toString('base64')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return state
}

async function preparedMixedTransaction() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-transaction-failpoint-'))
  await writeFile(path.join(root, 'user.txt'), 'unmanaged\n')
  const beforeArtifacts = materializeArtifacts([
    { kind: 'text', path: 'existing.txt', content: 'before\n' },
    { kind: 'text', path: 'deleted.txt', content: 'delete me\n' },
  ], root)
  await writeArtifacts(beforeArtifacts.artifacts, await compareArtifacts(beforeArtifacts.artifacts, root, true), { generatorVersion: 'test' })
  const before = await fileState(root)
  const afterArtifacts = materializeArtifacts([
    { kind: 'text', path: 'existing.txt', content: 'after\n' },
    { kind: 'text', path: 'added.txt', content: 'added\n' },
  ], root)
  const manifest = await compareArtifacts(afterArtifacts.artifacts, root, true)
  return { root, before, artifacts: afterArtifacts.artifacts, manifest }
}

describe('transactional artifact writer', { concurrent: false }, () => {
  const failpoints: TransactionFailpoint[] = [
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
    'cleanup',
  ]

  it.each(failpoints)('rolls back byte-identically at %s', async (failpoint) => {
    const prepared = await preparedMixedTransaction()
    await expect(writeArtifactsTransaction(prepared.artifacts, prepared.manifest, { generatorVersion: 'test', testFailpoint: failpoint })).rejects.toThrow(/Injected transaction failure|rolled back completely/)
    expect(await fileState(prepared.root)).toEqual(prepared.before)
    await expect(access(path.join(prepared.root, 'added.txt'))).rejects.toThrow()
    await expect(access(path.join(prepared.root, OUTPUT_TRANSACTION_JOURNAL))).rejects.toThrow()
    await expect(access(path.join(prepared.root, OUTPUT_WRITE_LOCK_DIRECTORY))).rejects.toThrow()
  })

  it('commits a mixed transaction and preserves unmanaged files', async () => {
    const prepared = await preparedMixedTransaction()
    await writeArtifactsTransaction(prepared.artifacts, prepared.manifest, { generatorVersion: 'test' })
    expect(await readFile(path.join(prepared.root, 'existing.txt'), 'utf8')).toBe('after\n')
    expect(await readFile(path.join(prepared.root, 'added.txt'), 'utf8')).toBe('added\n')
    expect(await readFile(path.join(prepared.root, 'user.txt'), 'utf8')).toBe('unmanaged\n')
    await expect(access(path.join(prepared.root, 'deleted.txt'))).rejects.toThrow()
    await expect(access(path.join(prepared.root, STATE_TRANSACTION_DIRECTORY))).rejects.toThrow()
  })

  it('defers cancellation after commit starts and completes a consistent transaction', async () => {
    const prepared = await preparedMixedTransaction()
    const controller = new AbortController()
    const result = await writeArtifactsTransaction(prepared.artifacts, prepared.manifest, {
      generatorVersion: 'test',
      signal: controller.signal,
      onPhase(phase) {
        if (phase === 'committing') controller.abort(new Error('cancel during commit'))
      },
    })
    expect(result.cancelledDuringCommit).toBe(true)
    expect(await readFile(path.join(prepared.root, 'existing.txt'), 'utf8')).toBe('after\n')
    expect(await readFile(path.join(prepared.root, 'added.txt'), 'utf8')).toBe('added\n')
    await expect(access(path.join(prepared.root, 'deleted.txt'))).rejects.toThrow()
  })

  it('uses an independent commit deadline and restores the prior state on expiry', async () => {
    const prepared = await preparedMixedTransaction()
    await expect(writeArtifactsTransaction(prepared.artifacts, prepared.manifest, {
      generatorVersion: 'test',
      commitTimeoutMs: 20,
      async onPhase(phase) {
        if (phase === 'backup') await new Promise((resolve) => setTimeout(resolve, 30))
      },
    })).rejects.toBeInstanceOf(OutputTransactionRolledBackError)
    expect(await fileState(prepared.root)).toEqual(prepared.before)
  })

  it('recovers a real subprocess crash in the middle of commit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-transaction-crash-'))
    await mkdir(root, { recursive: true })
    const beforeArtifacts = materializeArtifacts([{ kind: 'text', path: 'existing.txt', content: 'before crash\n' }], root)
    await writeArtifacts(beforeArtifacts.artifacts, await compareArtifacts(beforeArtifacts.artifacts, root, true), { generatorVersion: 'test' })
    const before = await fileState(root)
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
    const fixture = path.join(repositoryRoot, 'scripts/transaction-crash-fixture.mjs')
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      const child = spawn(process.execPath, [fixture, root], { stdio: ['ignore', 'pipe', 'pipe'] })
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Crash fixture timed out.')) }, 10_000)
      child.once('error', reject)
      child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }) })
    })
    expect(result.signal).toBe('SIGKILL')
    await expect(access(path.join(root, OUTPUT_TRANSACTION_JOURNAL))).resolves.toBeUndefined()
    expect(JSON.parse(await readFile(path.join(root, OUTPUT_TRANSACTION_JOURNAL), 'utf8'))).toMatchObject({ schemaVersion: 1 })
    const lock = await acquireOutputWriteLock(root, { staleLockMs: 0 })
    await lock.release()
    expect(await fileState(root)).toEqual(before)
    await expect(access(path.join(root, 'new.txt'))).rejects.toThrow()
    await expect(access(path.join(root, OUTPUT_TRANSACTION_JOURNAL))).rejects.toThrow()
    await expect(access(path.join(root, OUTPUT_WRITE_LOCK_DIRECTORY))).rejects.toThrow()
  }, 20_000)

  it('retries when a released lock disappears before stale-lock inspection', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-transaction-lock-handoff-'))
    const owner = await acquireOutputWriteLock(root)
    let contenderLock: Awaited<ReturnType<typeof acquireOutputWriteLock>> | undefined
    try {
      const observed = new Promise<void>((resolve) => {
        lockLstatRace.observed = resolve
      })
      lockLstatRace.armed = true
      const contender = acquireOutputWriteLock(root, {
        pollIntervalMs: 1,
        waitTimeoutMs: 1_000,
      }).then(
        (lock) => ({ lock }),
        (error: Error) => ({ error }),
      )

      await observed
      await owner.release()
      const outcome = await contender
      expect(outcome).not.toHaveProperty('error')
      if ('error' in outcome) throw outcome.error
      contenderLock = outcome.lock
    } finally {
      lockLstatRace.armed = false
      lockLstatRace.observed = undefined
      await owner.release()
      await contenderLock?.release()
    }
    await expect(access(path.join(root, OUTPUT_WRITE_LOCK_DIRECTORY))).rejects.toThrow()
  })

  it('fails closed when the lock path is a symlink', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-transaction-lock-symlink-'))
    const outside = await mkdtemp(path.join(os.tmpdir(), 'openapi-transaction-lock-outside-'))
    await symlink(outside, path.join(root, OUTPUT_WRITE_LOCK_DIRECTORY), 'dir')
    await expect(acquireOutputWriteLock(root, { waitTimeoutMs: 1 })).rejects.toBeInstanceOf(OutputRecoveryRequiredError)
  })

  it('detects output-root replacement after the lock is acquired', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'openapi-transaction-root-replace-'))
    const root = path.join(parent, 'output')
    const moved = path.join(parent, 'moved-output')
    await mkdir(root)
    const lock = await acquireOutputWriteLock(root)
    await rename(root, moved)
    await mkdir(root)
    await expect(lock.assertStable()).rejects.toBeInstanceOf(OutputRecoveryRequiredError)
  })

  it('rejects a tampered recovery journal before another writer starts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-transaction-journal-tamper-'))
    await writeFile(
      path.join(root, OUTPUT_TRANSACTION_JOURNAL),
      `${JSON.stringify({ schemaVersion: 1, transactionId: '00000000-0000-0000-0000-000000000000', phase: 'committing', operations: [], createdDirectories: [], checksum: 'tampered' })}\n`,
    )
    await expect(acquireOutputWriteLock(root, { waitTimeoutMs: 1 })).rejects.toBeInstanceOf(OutputRecoveryRequiredError)
  })

  it.runIf(process.platform !== 'win32')('rejects hard-linked output files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-transaction-hardlink-'))
    const original = path.join(root, 'original.txt')
    const linked = path.join(root, 'linked.txt')
    await writeFile(original, 'shared inode\n')
    await link(original, linked)
    await expect(snapshotOutputFile(linked)).rejects.toBeInstanceOf(OutputPreconditionChangedError)
  })
})
