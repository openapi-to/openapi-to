import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MAX_GENERATION_INTENT_BYTES,
  GENERATION_INTENT_DIRECTORY,
  GenerationIntentError,
  acquireOutputWriteLock,
  applyGenerationIntentMutation,
  commitGenerationStateTransaction,
  generationIntentStateRelativePath,
  hashGenerationIntent,
  normalizeGenerationIntent,
  parseGenerationIntentManifest,
  prepareGenerationIntent,
  serializeGenerationIntentManifest,
  type GenerationManifest,
} from './index.ts'

function emptyManifest(outputRoot: string): GenerationManifest {
  return {
    outputRoot,
    entries: [],
    summary: { added: 0, modified: 0, deleted: 0, unchanged: 0 },
    outdated: false,
  }
}

describe('generation intent', () => {
  it('normalizes operation scopes into deterministic bytes and hashes', () => {
    const first = normalizeGenerationIntent('users', 'src/generated', {
      type: 'operations',
      operationKeys: ['updateUser', 'getUser', 'getUser'],
    })
    const second = normalizeGenerationIntent('users', 'src/generated', {
      type: 'operations',
      operationKeys: ['getUser', 'updateUser'],
    })

    expect(first).toEqual(second)
    expect(first.scope).toEqual({
      type: 'operations',
      operationKeys: ['getUser', 'updateUser'],
    })
    expect(serializeGenerationIntentManifest(first)).toBe(
      `${JSON.stringify(first, null, 2)}\n`,
    )
    expect(hashGenerationIntent(first)).toBe(hashGenerationIntent(second))
    expect(
      parseGenerationIntentManifest(serializeGenerationIntentManifest(first)),
    ).toEqual({
      manifest: first,
      diagnostics: [],
    })
  })

  it('implements full, add, and replace without silently shrinking full through add', () => {
    const identity = { target: 'users', outputRoot: 'src/generated' }
    const initial = applyGenerationIntentMutation(undefined, identity, {
      type: 'operations',
      strategy: 'add',
      operationKeys: ['B', 'A'],
    })
    expect(
      applyGenerationIntentMutation(initial, identity, {
        type: 'operations',
        strategy: 'add',
        operationKeys: ['B', 'C'],
      }).scope,
    ).toEqual({ type: 'operations', operationKeys: ['A', 'B', 'C'] })
    expect(
      applyGenerationIntentMutation(initial, identity, {
        type: 'operations',
        strategy: 'replace',
        operationKeys: ['B'],
      }).scope,
    ).toEqual({ type: 'operations', operationKeys: ['B'] })

    const full = applyGenerationIntentMutation(initial, identity, {
      type: 'full',
    })
    expect(() =>
      applyGenerationIntentMutation(full, identity, {
        type: 'operations',
        strategy: 'add',
        operationKeys: ['A'],
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'GENERATION_INTENT_REPLACE_REQUIRED' }),
    )
    expect(
      applyGenerationIntentMutation(full, identity, {
        type: 'operations',
        strategy: 'replace',
        operationKeys: ['A'],
      }).scope,
    ).toEqual({ type: 'operations', operationKeys: ['A'] })
  })

  it.each([
    '/absolute',
    '../outside',
    'C:relative',
    'C:\\absolute',
    '\\\\server\\share',
    '.',
    '.git/generated',
    'node_modules/generated',
    '.openapi-to/generation-intents',
    'CON/output',
    'trailing./output',
  ])('rejects unsafe persisted output identity %s', (outputRoot) => {
    expect(() =>
      normalizeGenerationIntent('users', outputRoot, { type: 'full' }),
    ).toThrowError(GenerationIntentError)
  })

  it('uses collision-safe deterministic target state paths', () => {
    const first = generationIntentStateRelativePath('users/api')
    const second = generationIntentStateRelativePath('users api')
    expect(first).toMatch(
      /^\.openapi-to\/generation-intents\/users-api-[a-f0-9]{16}\.json$/,
    )
    expect(first).not.toBe(second)
    expect(generationIntentStateRelativePath('users/api')).toBe(first)
  })

  it('rejects corrupt, oversized, mismatched, and non-canonical manifests', () => {
    expect(parseGenerationIntentManifest('{').diagnostics[0]?.code).toBe(
      'GENERATION_INTENT_INVALID',
    )
    expect(
      parseGenerationIntentManifest('{}'.repeat(100), { maxBytes: 10 })
        .diagnostics[0]?.code,
    ).toBe('GENERATION_INTENT_TOO_LARGE')
    expect(
      parseGenerationIntentManifest(
        JSON.stringify({
          schemaVersion: 1,
          target: 'users',
          outputRoot: 'generated',
          scope: { type: 'operations', operationKeys: [] },
        }),
      ).diagnostics.map(({ code }) => code),
    ).toContain('GENERATION_INTENT_INVALID')
    expect(
      parseGenerationIntentManifest(
        JSON.stringify({
          schemaVersion: 1,
          target: 'other',
          outputRoot: 'generated',
          scope: { type: 'full' },
        }),
        { expectedTarget: 'users' },
      ).diagnostics.map(({ code }) => code),
    ).toContain('GENERATION_INTENT_TARGET_MISMATCH')
    expect(
      parseGenerationIntentManifest(
        JSON.stringify({
          schemaVersion: 1,
          target: 'users',
          outputRoot: 'generated',
          scope: { type: 'operations', operationKeys: ['B', 'A', 'A'] },
        }),
      ).diagnostics.map(({ code }) => code),
    ).toContain('GENERATION_INTENT_INVALID')
  })

  it('commits intent through the shared transaction and rejects later output relocation', async () => {
    const workspace = await mkdtemp(
      path.join(os.tmpdir(), 'openapi-intent-transaction-'),
    )
    const outputRoot = path.join(workspace, 'generated')
    const prepared = await prepareGenerationIntent(
      workspace,
      { target: 'users', outputRoot: 'generated' },
      { type: 'operations', strategy: 'replace', operationKeys: ['getUser'] },
    )
    const lock = await acquireOutputWriteLock(outputRoot, {
      recoveryContext: prepared.recoveryContext,
    })
    try {
      await commitGenerationStateTransaction(
        lock,
        [],
        emptyManifest(outputRoot),
        [prepared.stateFile],
        {
          recoveryContext: prepared.recoveryContext,
          generatorVersion: 'test',
        },
      )
    } finally {
      await lock.release()
    }

    const statePath = path.join(
      workspace,
      ...prepared.stateFile.workspaceRelativePath.split('/'),
    )
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual(
      prepared.desired,
    )
    await expect(
      prepareGenerationIntent(
        workspace,
        { target: 'users', outputRoot: 'other-generated' },
        { type: 'full' },
      ),
    ).rejects.toMatchObject({ code: 'GENERATION_OUTPUT_RELOCATION_REQUIRED' })
  })

  it('serializes the same target intent across different output roots', async () => {
    const workspace = await mkdtemp(
      path.join(os.tmpdir(), 'openapi-intent-cross-output-lock-'),
    )
    const firstOutput = path.join(workspace, 'generated-a')
    const secondOutput = path.join(workspace, 'generated-b')
    const first = await prepareGenerationIntent(
      workspace,
      { target: 'users', outputRoot: 'generated-a' },
      { type: 'full' },
    )
    const second = await prepareGenerationIntent(
      workspace,
      { target: 'users', outputRoot: 'generated-b' },
      { type: 'full' },
    )
    const firstLock = await acquireOutputWriteLock(firstOutput, {
      recoveryContext: first.recoveryContext,
    })
    let secondResolved = false
    const secondLockPromise = acquireOutputWriteLock(secondOutput, {
      recoveryContext: second.recoveryContext,
      waitTimeoutMs: 5_000,
    }).then((lock) => {
      secondResolved = true
      return lock
    })
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(secondResolved).toBe(false)
    try {
      await commitGenerationStateTransaction(
        firstLock,
        [],
        emptyManifest(firstOutput),
        [first.stateFile],
        {
          recoveryContext: first.recoveryContext,
          generatorVersion: 'test',
        },
      )
    } finally {
      await firstLock.release()
    }

    const secondLock = await secondLockPromise
    try {
      await expect(
        commitGenerationStateTransaction(
          secondLock,
          [],
          emptyManifest(secondOutput),
          [second.stateFile],
          {
            recoveryContext: second.recoveryContext,
            generatorVersion: 'test',
          },
        ),
      ).rejects.toMatchObject({ code: 'TRANSACTION_STATE_SNAPSHOT_MISMATCH' })
    } finally {
      await secondLock.release({ removeEmptyRoot: true })
    }

    const statePath = path.join(
      workspace,
      ...first.stateFile.workspaceRelativePath.split('/'),
    )
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual(first.desired)
  })

  it('rolls intent back byte-identically when a shared transaction fails after state rename', async () => {
    const workspace = await mkdtemp(
      path.join(os.tmpdir(), 'openapi-intent-rollback-'),
    )
    const outputRoot = path.join(workspace, 'generated')
    const initial = await prepareGenerationIntent(
      workspace,
      { target: 'users', outputRoot: 'generated' },
      { type: 'operations', strategy: 'replace', operationKeys: ['getUser'] },
    )
    let lock = await acquireOutputWriteLock(outputRoot, {
      recoveryContext: initial.recoveryContext,
    })
    try {
      await commitGenerationStateTransaction(
        lock,
        [],
        emptyManifest(outputRoot),
        [initial.stateFile],
        {
          recoveryContext: initial.recoveryContext,
          generatorVersion: 'test',
        },
      )
    } finally {
      await lock.release()
    }
    const statePath = path.join(
      workspace,
      ...initial.stateFile.workspaceRelativePath.split('/'),
    )
    const before = await readFile(statePath, 'utf8')
    const next = await prepareGenerationIntent(
      workspace,
      { target: 'users', outputRoot: 'generated' },
      { type: 'operations', strategy: 'add', operationKeys: ['updateUser'] },
    )
    lock = await acquireOutputWriteLock(outputRoot, {
      recoveryContext: next.recoveryContext,
    })
    try {
      await expect(
        commitGenerationStateTransaction(
          lock,
          [],
          emptyManifest(outputRoot),
          [next.stateFile],
          {
            recoveryContext: next.recoveryContext,
            generatorVersion: 'test',
            testFailpoint: 'state-after-rename',
          },
        ),
      ).rejects.toMatchObject({ name: 'OutputTransactionRolledBackError' })
    } finally {
      await lock.release()
    }
    expect(await readFile(statePath, 'utf8')).toBe(before)
    await expect(
      access(
        path.join(
          workspace,
          GENERATION_INTENT_DIRECTORY,
          '.openapi-to-state-transaction',
        ),
      ),
    ).rejects.toThrow()
  })

  it('does not replace state that appears immediately before a first intent install', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'openapi-intent-install-race-'))
    const outputRoot = path.join(workspace, 'generated')
    const prepared = await prepareGenerationIntent(
      workspace,
      { target: 'users', outputRoot: 'generated' },
      { type: 'full' },
    )
    const statePath = path.join(workspace, ...prepared.stateFile.workspaceRelativePath.split('/'))
    const lock = await acquireOutputWriteLock(outputRoot, { recoveryContext: prepared.recoveryContext })
    try {
      await expect(commitGenerationStateTransaction(lock, [], emptyManifest(outputRoot), [prepared.stateFile], {
        recoveryContext: prepared.recoveryContext,
        generatorVersion: 'test',
        onPhase: async (phase) => {
          if (phase === 'committing') await writeFile(statePath, 'user late state\n')
        },
      })).rejects.toMatchObject({
        name: 'OutputTransactionRolledBackError',
        originalError: expect.objectContaining({ code: 'TRANSACTION_STATE_COMMIT_FAILED' }),
      })
    } finally {
      await lock.release()
    }
    expect(await readFile(statePath, 'utf8')).toBe('user late state\n')
  })

  it('rejects a symlinked intent state root', async () => {
    const workspace = await mkdtemp(
      path.join(os.tmpdir(), 'openapi-intent-symlink-'),
    )
    const outside = await mkdtemp(
      path.join(os.tmpdir(), 'openapi-intent-outside-'),
    )
    await mkdir(path.join(workspace, '.openapi-to'))
    await symlink(
      outside,
      path.join(workspace, GENERATION_INTENT_DIRECTORY),
      'dir',
    )
    await expect(
      prepareGenerationIntent(
        workspace,
        { target: 'users', outputRoot: 'generated' },
        { type: 'full' },
      ),
    ).rejects.toMatchObject({ code: 'GENERATION_INTENT_STATE_UNSAFE' })
  })

  it('rejects a state-root symlink introduced after preparation and before writing', async () => {
    const workspace = await mkdtemp(
      path.join(os.tmpdir(), 'openapi-intent-symlink-race-'),
    )
    const outside = await mkdtemp(
      path.join(os.tmpdir(), 'openapi-intent-symlink-race-outside-'),
    )
    const outputRoot = path.join(workspace, 'generated')
    const prepared = await prepareGenerationIntent(
      workspace,
      { target: 'users', outputRoot: 'generated' },
      { type: 'full' },
    )
    const lock = await acquireOutputWriteLock(outputRoot, {
      recoveryContext: prepared.recoveryContext,
    })
    try {
      await expect(
        commitGenerationStateTransaction(
          lock,
          [],
          emptyManifest(outputRoot),
          [prepared.stateFile],
          {
            recoveryContext: prepared.recoveryContext,
            generatorVersion: 'test',
            onPhase: async (phase) => {
              if (phase !== 'state-pre-write') return
              await mkdir(path.join(workspace, '.openapi-to'), {
                recursive: true,
              })
              await symlink(
                outside,
                path.join(workspace, GENERATION_INTENT_DIRECTORY),
                'dir',
              )
            },
          },
        ),
      ).rejects.toMatchObject({ code: 'TRANSACTION_STATE_FILE_SYMLINK' })
    } finally {
      await lock.release({ removeEmptyRoot: true })
    }
    await expect(
      access(
        path.join(
          outside,
          path.basename(prepared.stateFile.workspaceRelativePath),
        ),
      ),
    ).rejects.toThrow()
  })

  it('fails closed on corrupt persisted intent state', async () => {
    const workspace = await mkdtemp(
      path.join(os.tmpdir(), 'openapi-intent-corrupt-'),
    )
    const relativePath = generationIntentStateRelativePath('users')
    const statePath = path.join(workspace, ...relativePath.split('/'))
    await mkdir(path.dirname(statePath), { recursive: true })
    await writeFile(statePath, '{')

    await expect(
      prepareGenerationIntent(
        workspace,
        { target: 'users', outputRoot: 'generated' },
        { type: 'full' },
      ),
    ).rejects.toMatchObject({ code: 'GENERATION_INTENT_INVALID' })
  })

  it('bounds persisted intent reads', async () => {
    const workspace = await mkdtemp(
      path.join(os.tmpdir(), 'openapi-intent-oversized-'),
    )
    const relativePath = generationIntentStateRelativePath('users')
    const statePath = path.join(workspace, ...relativePath.split('/'))
    await mkdir(path.dirname(statePath), { recursive: true })
    await writeFile(
      statePath,
      new Uint8Array(DEFAULT_MAX_GENERATION_INTENT_BYTES + 1),
    )

    await expect(
      prepareGenerationIntent(
        workspace,
        { target: 'users', outputRoot: 'generated' },
        { type: 'full' },
      ),
    ).rejects.toMatchObject({ code: 'GENERATION_INTENT_TOO_LARGE' })
  })
})
