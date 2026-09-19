import { createHash } from 'node:crypto'
import { lstat, open, realpath } from 'node:fs/promises'
import path from 'node:path'

import { resolveConfiguredOutputRoot } from '../config/outputRoot.ts'
import {
  hasDiagnosticErrors,
  sortDiagnostics,
  type Diagnostic,
} from '../diagnostics.ts'
import {
  DEFAULT_MAX_SELECTION_BYTES,
  DEFAULT_MAX_SELECTION_OPERATIONS,
  MAX_OPERATION_SELECTION_KEY_BYTES,
} from '../openapi/selection/types.ts'
import { stateDirectoryName } from '../stateDirectoryName.ts'
import type {
  OutputFileSnapshot,
  TransactionRecoveryContext,
  TransactionStateFile,
} from './transaction.ts'

export const GENERATION_INTENT_SCHEMA_VERSION = 1 as const
export const GENERATION_INTENT_DIRECTORY = `${stateDirectoryName}/generation-intents`
export const DEFAULT_MAX_GENERATION_INTENT_BYTES = DEFAULT_MAX_SELECTION_BYTES
export const DEFAULT_MAX_GENERATION_INTENT_OPERATIONS =
  DEFAULT_MAX_SELECTION_OPERATIONS

const encoder = new TextEncoder()

export type GenerationIntentScope =
  | { type: 'full' }
  | { type: 'operations'; operationKeys: string[] }

export interface GenerationIntentManifestV1 {
  schemaVersion: typeof GENERATION_INTENT_SCHEMA_VERSION
  target: string
  outputRoot: string
  scope: GenerationIntentScope
}

export type GenerationIntentMutation =
  | { type: 'full' }
  | {
      type: 'operations'
      strategy: 'add' | 'replace'
      operationKeys: string[]
    }

export interface GenerationIntentValidationOptions {
  expectedTarget?: string
  expectedOutputRoot?: string
  maxOperations?: number
  maxBytes?: number
}

export interface GenerationIntentParseResult {
  manifest?: GenerationIntentManifestV1
  diagnostics: Diagnostic[]
}

export type GenerationIntentErrorCode =
  | 'GENERATION_INTENT_INVALID'
  | 'GENERATION_INTENT_TOO_LARGE'
  | 'GENERATION_INTENT_TARGET_MISMATCH'
  | 'GENERATION_OUTPUT_RELOCATION_REQUIRED'
  | 'GENERATION_INTENT_REPLACE_REQUIRED'
  | 'GENERATION_INTENT_STATE_UNSAFE'

export class GenerationIntentError extends Error {
  constructor(
    readonly code: GenerationIntentErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'GenerationIntentError'
  }
}

export interface PreparedGenerationIntent {
  previous?: GenerationIntentManifestV1
  desired: GenerationIntentManifestV1
  desiredHash: string
  stateFile: TransactionStateFile
  recoveryContext: TransactionRecoveryContext
}

export interface GenerationIntentState {
  workspaceRelativePath: string
  snapshot: OutputFileSnapshot
  manifest?: GenerationIntentManifestV1
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function diagnostic(code: string, message: string): Diagnostic {
  return { code, severity: 'error', message }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function unknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): string[] {
  const accepted = new Set(allowed)
  return Object.keys(value)
    .filter((key) => !accepted.has(key))
    .sort(compareText)
}

function validIdentity(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    encoder.encode(value).byteLength <= 500
  )
}

function normalizedOperationKeys(
  values: readonly string[],
  maximum = DEFAULT_MAX_GENERATION_INTENT_OPERATIONS,
): string[] {
  if (values.length > maximum) {
    throw new GenerationIntentError(
      'GENERATION_INTENT_TOO_LARGE',
      `Generation intent exceeds the ${maximum} operation limit.`,
    )
  }
  const result = new Set<string>()
  for (const value of values) {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      encoder.encode(value).byteLength > MAX_OPERATION_SELECTION_KEY_BYTES
    ) {
      throw new GenerationIntentError(
        'GENERATION_INTENT_INVALID',
        'Every generation intent operationKey must be a non-empty bounded string.',
      )
    }
    result.add(value)
  }
  const normalized = [...result].sort(compareText)
  if (normalized.length === 0) {
    throw new GenerationIntentError(
      'GENERATION_INTENT_INVALID',
      'A persisted operations generation intent requires at least one operationKey.',
    )
  }
  return normalized
}

function normalizeOutputIdentity(outputRoot: string, target?: string): string {
  const normalized = outputRoot.replaceAll('\\', '/')
  const statePrefix = `${stateDirectoryName}/`
  const managed = normalized.toLowerCase().startsWith(statePrefix.toLowerCase())
  const configuredDir = managed
    ? normalized.slice(statePrefix.length)
    : normalized
  try {
    return resolveConfiguredOutputRoot({
      workspaceRoot: path.resolve('/openapi-to-workspace'),
      output: managed
        ? { base: 'managed', dir: configuredDir }
        : { base: 'workspace', dir: configuredDir },
      targetName: target,
    }).workspaceRelativePath
  } catch {
    throw new GenerationIntentError(
      'GENERATION_INTENT_INVALID',
      'Generation intent outputRoot must be a safe portable Workspace-relative output identity.',
    )
  }
}

export function normalizeGenerationIntent(
  target: string,
  outputRoot: string,
  scope: GenerationIntentScope,
  options: Pick<GenerationIntentValidationOptions, 'maxOperations'> = {},
): GenerationIntentManifestV1 {
  if (!validIdentity(target)) {
    throw new GenerationIntentError(
      'GENERATION_INTENT_INVALID',
      'Generation intent target must be a non-empty bounded string.',
    )
  }
  const normalizedOutputRoot = normalizeOutputIdentity(outputRoot, target)
  return {
    schemaVersion: GENERATION_INTENT_SCHEMA_VERSION,
    target,
    outputRoot: normalizedOutputRoot,
    scope:
      scope.type === 'full'
        ? { type: 'full' }
        : {
            type: 'operations',
            operationKeys: normalizedOperationKeys(
              scope.operationKeys,
              options.maxOperations ?? DEFAULT_MAX_GENERATION_INTENT_OPERATIONS,
            ),
          },
  }
}

export function validateGenerationIntentManifest(
  value: unknown,
  options: GenerationIntentValidationOptions = {},
): GenerationIntentParseResult {
  const diagnostics: Diagnostic[] = []
  const manifest = record(value)
  if (!manifest) {
    return {
      diagnostics: [
        diagnostic(
          'GENERATION_INTENT_INVALID',
          'Generation intent must be a JSON object.',
        ),
      ],
    }
  }
  const extras = unknownKeys(manifest, [
    'schemaVersion',
    'target',
    'outputRoot',
    'scope',
  ])
  if (extras.length)
    diagnostics.push(
      diagnostic(
        'GENERATION_INTENT_INVALID',
        `Generation intent contains unsupported field(s): ${extras.join(', ')}.`,
      ),
    )
  if (manifest.schemaVersion !== GENERATION_INTENT_SCHEMA_VERSION) {
    diagnostics.push(
      diagnostic(
        'GENERATION_INTENT_INVALID',
        `Generation intent schemaVersion ${String(manifest.schemaVersion)} is not supported.`,
      ),
    )
  }
  if (!validIdentity(manifest.target))
    diagnostics.push(
      diagnostic(
        'GENERATION_INTENT_INVALID',
        'Generation intent target must be a non-empty bounded string.',
      ),
    )
  if (
    options.expectedTarget !== undefined &&
    manifest.target !== options.expectedTarget
  ) {
    diagnostics.push(
      diagnostic(
        'GENERATION_INTENT_TARGET_MISMATCH',
        `Generation intent target does not match trusted target ${options.expectedTarget}.`,
      ),
    )
  }

  let normalizedOutputRoot: string | undefined
  if (typeof manifest.outputRoot !== 'string') {
    diagnostics.push(
      diagnostic(
        'GENERATION_INTENT_INVALID',
        'Generation intent outputRoot must be a string.',
      ),
    )
  } else {
    try {
      normalizedOutputRoot = normalizeOutputIdentity(
        manifest.outputRoot,
        typeof manifest.target === 'string' ? manifest.target : undefined,
      )
      if (normalizedOutputRoot !== manifest.outputRoot) {
        diagnostics.push(
          diagnostic(
            'GENERATION_INTENT_INVALID',
            'Generation intent outputRoot must already be normalized.',
          ),
        )
      }
      if (
        options.expectedOutputRoot !== undefined &&
        normalizedOutputRoot !==
          normalizeOutputIdentity(options.expectedOutputRoot)
      ) {
        diagnostics.push(
          diagnostic(
            'GENERATION_OUTPUT_RELOCATION_REQUIRED',
            'Generation intent outputRoot is already bound to a different effective output root.',
          ),
        )
      }
    } catch (error) {
      diagnostics.push(
        diagnostic(
          error instanceof GenerationIntentError
            ? error.code
            : 'GENERATION_INTENT_INVALID',
          error instanceof Error
            ? error.message
            : 'Generation intent outputRoot is invalid.',
        ),
      )
    }
  }

  const scope = record(manifest.scope)
  let normalizedScope: GenerationIntentScope | undefined
  if (!scope || (scope.type !== 'full' && scope.type !== 'operations')) {
    diagnostics.push(
      diagnostic(
        'GENERATION_INTENT_INVALID',
        'Generation intent scope must be full or operations.',
      ),
    )
  } else if (scope.type === 'full') {
    const scopeExtras = unknownKeys(scope, ['type'])
    if (scopeExtras.length)
      diagnostics.push(
        diagnostic(
          'GENERATION_INTENT_INVALID',
          `Full generation intent scope contains unsupported field(s): ${scopeExtras.join(', ')}.`,
        ),
      )
    normalizedScope = { type: 'full' }
  } else {
    const scopeExtras = unknownKeys(scope, ['type', 'operationKeys'])
    if (scopeExtras.length)
      diagnostics.push(
        diagnostic(
          'GENERATION_INTENT_INVALID',
          `Operations generation intent scope contains unsupported field(s): ${scopeExtras.join(', ')}.`,
        ),
      )
    if (!Array.isArray(scope.operationKeys)) {
      diagnostics.push(
        diagnostic(
          'GENERATION_INTENT_INVALID',
          'Generation intent operationKeys must be an array.',
        ),
      )
    } else {
      try {
        const rawOperationKeys = scope.operationKeys as unknown[]
        const operationKeys = normalizedOperationKeys(
          rawOperationKeys as string[],
          options.maxOperations ?? DEFAULT_MAX_GENERATION_INTENT_OPERATIONS,
        )
        if (
          operationKeys.length !== rawOperationKeys.length ||
          operationKeys.some((key, index) => key !== rawOperationKeys[index])
        ) {
          diagnostics.push(
            diagnostic(
              'GENERATION_INTENT_INVALID',
              'Generation intent operationKeys must be deduplicated and sorted.',
            ),
          )
        }
        normalizedScope = { type: 'operations', operationKeys }
      } catch (error) {
        diagnostics.push(
          diagnostic(
            error instanceof GenerationIntentError
              ? error.code
              : 'GENERATION_INTENT_INVALID',
            error instanceof Error
              ? error.message
              : 'Generation intent operationKeys are invalid.',
          ),
        )
      }
    }
  }

  if (
    hasDiagnosticErrors(diagnostics) ||
    !validIdentity(manifest.target) ||
    !normalizedOutputRoot ||
    !normalizedScope
  ) {
    return { diagnostics: sortDiagnostics(diagnostics) }
  }
  return {
    manifest: {
      schemaVersion: GENERATION_INTENT_SCHEMA_VERSION,
      target: manifest.target,
      outputRoot: normalizedOutputRoot,
      scope: normalizedScope,
    },
    diagnostics: [],
  }
}

export function parseGenerationIntentManifest(
  input: string | Uint8Array,
  options: GenerationIntentValidationOptions = {},
): GenerationIntentParseResult {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input
  const maximum = options.maxBytes ?? DEFAULT_MAX_GENERATION_INTENT_BYTES
  if (bytes.byteLength > maximum) {
    return {
      diagnostics: [
        diagnostic(
          'GENERATION_INTENT_TOO_LARGE',
          `Generation intent exceeds the ${maximum} byte limit.`,
        ),
      ],
    }
  }
  try {
    return validateGenerationIntentManifest(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      options,
    )
  } catch {
    return {
      diagnostics: [
        diagnostic(
          'GENERATION_INTENT_INVALID',
          'Generation intent is not valid UTF-8 JSON.',
        ),
      ],
    }
  }
}

export function serializeGenerationIntentManifest(
  manifest: GenerationIntentManifestV1,
): string {
  const normalized = normalizeGenerationIntent(
    manifest.target,
    manifest.outputRoot,
    manifest.scope,
  )
  return `${JSON.stringify(normalized, null, 2)}\n`
}

export function hashGenerationIntent(
  manifest: GenerationIntentManifestV1,
): string {
  return `sha256:${createHash('sha256').update(serializeGenerationIntentManifest(manifest)).digest('hex')}`
}

export function applyGenerationIntentMutation(
  previous: GenerationIntentManifestV1 | undefined,
  identity: { target: string; outputRoot: string },
  mutation: GenerationIntentMutation,
): GenerationIntentManifestV1 {
  const normalizedIdentity = normalizeGenerationIntent(
    identity.target,
    identity.outputRoot,
    { type: 'full' },
  )
  if (
    previous?.target !== undefined &&
    previous.target !== normalizedIdentity.target
  ) {
    throw new GenerationIntentError(
      'GENERATION_INTENT_TARGET_MISMATCH',
      'Generation intent belongs to a different trusted target.',
    )
  }
  if (
    previous?.outputRoot !== undefined &&
    previous.outputRoot !== normalizedIdentity.outputRoot
  ) {
    throw new GenerationIntentError(
      'GENERATION_OUTPUT_RELOCATION_REQUIRED',
      'Generation intent is already bound to a different effective output root.',
    )
  }
  if (mutation.type === 'full') {
    return normalizeGenerationIntent(identity.target, identity.outputRoot, {
      type: 'full',
    })
  }
  const requested = normalizedOperationKeys(mutation.operationKeys)
  if (mutation.strategy === 'add' && previous?.scope.type === 'full') {
    throw new GenerationIntentError(
      'GENERATION_INTENT_REPLACE_REQUIRED',
      'A full generation intent can only shrink to operations through explicit replace semantics.',
    )
  }
  const previousKeys =
    previous?.scope.type === 'operations' ? previous.scope.operationKeys : []
  const desired =
    mutation.strategy === 'replace'
      ? requested
      : [...new Set([...previousKeys, ...requested])].sort(compareText)
  return normalizeGenerationIntent(identity.target, identity.outputRoot, {
    type: 'operations',
    operationKeys: desired,
  })
}

export function generationIntentStateRelativePath(target: string): string {
  if (!validIdentity(target))
    throw new GenerationIntentError(
      'GENERATION_INTENT_INVALID',
      'Generation intent target must be a non-empty bounded string.',
    )
  const prefix =
    target
      .normalize('NFKC')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'target'
  const identityHash = createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: GENERATION_INTENT_SCHEMA_VERSION,
        target,
      }),
    )
    .digest('hex')
    .slice(0, 16)
  return path.posix.join(
    GENERATION_INTENT_DIRECTORY,
    `${prefix}-${identityHash}.json`,
  )
}

async function assertSafeStatePath(
  workspaceRoot: string,
  relativePath: string,
): Promise<string> {
  const root = path.resolve(workspaceRoot)
  const rootMetadata = await lstat(root)
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new GenerationIntentError(
      'GENERATION_INTENT_STATE_UNSAFE',
      'The trusted Workspace is not a real directory.',
    )
  }
  await realpath(root)
  let current = root
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment)
    try {
      const metadata = await lstat(current)
      if (metadata.isSymbolicLink()) {
        throw new GenerationIntentError(
          'GENERATION_INTENT_STATE_UNSAFE',
          'Generation intent state cannot be accessed through a symbolic link.',
        )
      }
      if (
        current !== path.join(root, ...relativePath.split('/')) &&
        !metadata.isDirectory()
      ) {
        throw new GenerationIntentError(
          'GENERATION_INTENT_STATE_UNSAFE',
          'Generation intent state has a non-directory ancestor.',
        )
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
      throw error
    }
  }
  return path.join(root, ...relativePath.split('/'))
}

async function readStableIntentFile(
  filePath: string,
): Promise<{ bytes?: Uint8Array; snapshot: OutputFileSnapshot }> {
  let before: Awaited<ReturnType<typeof lstat>>
  try {
    before = await lstat(filePath, { bigint: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { snapshot: { exists: false } }
    throw error
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink > 1n) {
    throw new GenerationIntentError(
      'GENERATION_INTENT_STATE_UNSAFE',
      'Generation intent state is not a safe regular file.',
    )
  }
  if (before.size > BigInt(DEFAULT_MAX_GENERATION_INTENT_BYTES)) {
    throw new GenerationIntentError(
      'GENERATION_INTENT_TOO_LARGE',
      `Generation intent exceeds the ${DEFAULT_MAX_GENERATION_INTENT_BYTES} byte limit.`,
    )
  }
  const handle = await open(filePath, 'r')
  try {
    const opened = await handle.stat({ bigint: true })
    if (opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new GenerationIntentError(
        'GENERATION_INTENT_STATE_UNSAFE',
        'Generation intent state changed while it was opened.',
      )
    }
    const buffer = new Uint8Array(DEFAULT_MAX_GENERATION_INTENT_BYTES + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0)
    if (bytesRead > DEFAULT_MAX_GENERATION_INTENT_BYTES) {
      throw new GenerationIntentError(
        'GENERATION_INTENT_TOO_LARGE',
        `Generation intent exceeds the ${DEFAULT_MAX_GENERATION_INTENT_BYTES} byte limit.`,
      )
    }
    const bytes = buffer.slice(0, bytesRead)
    const after = await lstat(filePath, { bigint: true })
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeNs !== opened.mtimeNs
    ) {
      throw new GenerationIntentError(
        'GENERATION_INTENT_STATE_UNSAFE',
        'Generation intent state changed while it was read.',
      )
    }
    return {
      bytes,
      snapshot: {
        exists: true,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.byteLength,
        identity: {
          device: opened.dev.toString(),
          inode: opened.ino.toString(),
          size: opened.size.toString(),
          modifiedNanoseconds: opened.mtimeNs.toString(),
        },
      },
    }
  } finally {
    await handle.close()
  }
}

export async function readGenerationIntent(
  workspaceRoot: string,
  target: string,
  expectedOutputRoot?: string,
): Promise<GenerationIntentState> {
  const workspaceRelativePath = generationIntentStateRelativePath(target)
  const absolutePath = await assertSafeStatePath(
    workspaceRoot,
    workspaceRelativePath,
  )
  const current = await readStableIntentFile(absolutePath)
  if (!current.bytes) {
    return { workspaceRelativePath, snapshot: current.snapshot }
  }
  const parsed = parseGenerationIntentManifest(current.bytes, {
    expectedTarget: target,
    ...(expectedOutputRoot === undefined ? {} : { expectedOutputRoot }),
  })
  const firstError = parsed.diagnostics.find(
    ({ severity }) => severity === 'error',
  )
  if (!parsed.manifest || firstError) {
    const code =
      firstError?.code === 'GENERATION_OUTPUT_RELOCATION_REQUIRED'
        ? 'GENERATION_OUTPUT_RELOCATION_REQUIRED'
        : firstError?.code === 'GENERATION_INTENT_TARGET_MISMATCH'
          ? 'GENERATION_INTENT_TARGET_MISMATCH'
          : firstError?.code === 'GENERATION_INTENT_TOO_LARGE'
            ? 'GENERATION_INTENT_TOO_LARGE'
            : 'GENERATION_INTENT_INVALID'
    throw new GenerationIntentError(
      code,
      firstError?.message ?? 'Generation intent state is invalid.',
    )
  }
  return {
    workspaceRelativePath,
    snapshot: current.snapshot,
    manifest: parsed.manifest,
  }
}

export async function prepareGenerationIntent(
  workspaceRoot: string,
  identity: { target: string; outputRoot: string },
  mutation: GenerationIntentMutation,
): Promise<PreparedGenerationIntent> {
  const current = await readGenerationIntent(
    workspaceRoot,
    identity.target,
    identity.outputRoot,
  )
  const previous = current.manifest
  const desired = applyGenerationIntentMutation(previous, identity, mutation)
  const desiredBytes = encoder.encode(
    serializeGenerationIntentManifest(desired),
  )
  if (desiredBytes.byteLength > DEFAULT_MAX_GENERATION_INTENT_BYTES) {
    throw new GenerationIntentError(
      'GENERATION_INTENT_TOO_LARGE',
      `Generation intent exceeds the ${DEFAULT_MAX_GENERATION_INTENT_BYTES} byte limit.`,
    )
  }
  const desiredSha256 = createHash('sha256').update(desiredBytes).digest('hex')
  return {
    ...(previous ? { previous } : {}),
    desired,
    desiredHash: `sha256:${desiredSha256}`,
    stateFile: {
      id: 'generation-intent',
      workspaceRelativePath: current.workspaceRelativePath,
      expectedBefore: current.snapshot,
      desiredBytes,
      desiredSha256,
      maxBytes: DEFAULT_MAX_GENERATION_INTENT_BYTES,
    },
    recoveryContext: {
      workspaceRoot: path.resolve(workspaceRoot),
      allowedStateRoots: [GENERATION_INTENT_DIRECTORY],
    },
  }
}
