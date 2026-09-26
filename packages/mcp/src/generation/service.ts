import { createHash } from 'node:crypto'
import { lstat, opendir } from 'node:fs/promises'
import path from 'node:path'

import {
  buildFromCompilation,
  DEFAULT_MAX_GENERATION_INTENT_BYTES,
  DiagnosticError,
  formatMaterializedArtifacts,
  generationIntentStateRelativePath,
  hashGenerationIntent,
  hasDiagnosticErrors,
  materializeArtifacts,
  normalizeGenerationIntent,
  prepareGenerationIntent,
  preflightConfiguredTargets,
  projectOpenAPICompilation,
  serializeGenerationIntentManifest,
  stateDirectoryName,
  type Diagnostic,
  type GenerationIntentMutation,
  type GenerationManifestEntry,
  type OpenAPICompilation,
  type OpenAPIProjectionStats,
  type OperationCatalog,
  type OpenapiToConfigServer,
  type OperationGenerationScope,
  type OutputWriteLock,
  type PreparedGenerationIntent,
  type RemoteSourceOptions,
  type ResolvedConfiguredOutputRoot,
} from '@openapi-to/core'

import { McpToolError } from '../errors.ts'
import type { ResolvedMcpServerOptions } from '../options.ts'
import { sanitizeSourceDisplay } from '../security/source.ts'
import type { TrustedTargetCatalogRegistry } from '../catalog/trusted-target-registry.ts'
import type { TrustedConfigProvider } from './trusted-config.ts'

function remotePolicyIdentity(remote: RemoteSourceOptions | undefined): string {
  return JSON.stringify({
    allowedHosts: [...new Set(remote?.allowedHosts ?? [])].sort(),
    headers: Object.entries(remote?.headers ?? {}).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
    timeoutMs: remote?.timeoutMs,
    maxResponseBytes: remote?.maxResponseBytes,
    maxRedirects: remote?.maxRedirects,
  })
}

export interface GenerationExecution {
  signal?: AbortSignal
  progress?: (stage: string, progress: number, total?: number) => Promise<void>
  outputWriteLock?: OutputWriteLock
  /** @internal Core transaction fault injection for repository tests only. */
  transactionFailpoint?: import('@openapi-to/core').TransactionFailpoint
}

export type InternalGenerationRequest = {
  target: string
  mutation: GenerationIntentMutation | { type: 'ephemeral'; operationKeys: string[] }
  effectiveOutputRoot?: string
  trustedOutputRoot?: string
  enforceIntentBootstrap?: boolean
  execution: 'preview' | 'prepare' | 'commit' | 'apply-revalidate'
  mode?: 'dry-run' | 'check'
}

export const MAX_ADD_SELECTION_OPERATIONS = 500

export interface PreparedTarget {
  name: string
  server: OpenapiToConfigServer
  config: Awaited<ReturnType<typeof preflightConfiguredTargets>>[number]['config']
  output: ResolvedConfiguredOutputRoot
  compilation?: OpenAPICompilation
}

export interface GenerationSelectionSummary {
  mutationType: 'add' | 'replace' | 'ephemeral'
  previousOperationKeys: string[]
  requestedOperationKeys: string[]
  newlyAddedOperationKeys: string[]
  alreadySelectedOperationKeys: string[]
  retainedOperationKeys: string[]
  removedOperationKeys: string[]
  desiredOperationKeys: string[]
  previousSelectionExists: boolean
  previousSelectionHash: string
  desiredSelectionHash: string
  resolvedOperationKeys?: string[]
}

export interface GenerationServerRun {
  name: string
  source: string
  outputRoot: string
  /** Hash of the merged Target/operator remote policy; never expose policy headers. */
  remotePolicyHash: string
  result: Awaited<ReturnType<typeof buildFromCompilation>>
  materialized: Awaited<ReturnType<typeof formatMaterializedArtifacts>>['artifacts']
  intent: PreparedGenerationIntent
}

export interface GenerationRun {
  configPath: string
  targets: string[]
  servers: GenerationServerRun[]
  diagnostics: Diagnostic[]
  selection?: GenerationSelectionSummary
  projection?: {
    stats: OpenAPIProjectionStats
    projectionHash?: string
  }
}

function preflightError(error: unknown): never {
  if (error instanceof DiagnosticError) {
    const diagnostic = error.diagnostics[0]
    if (diagnostic) {
      const code =
        diagnostic.code === 'CONFIG_TARGET_UNKNOWN'
          ? 'MCP_UNKNOWN_TARGET'
          : diagnostic.code === 'CONFIG_TARGET_NAME_CONFLICT' ||
              diagnostic.code === 'CONFIG_TARGET_NAME_INVALID'
            ? 'MCP_CONFIG_LOAD_FAILED'
            : diagnostic.code
      throw new McpToolError(code, diagnostic.message, diagnostic.hint)
    }
  }
  throw error
}

export async function prepareTargets(
  provider: TrustedConfigProvider,
  options: ResolvedMcpServerOptions,
  requested: string[] | undefined,
  signal?: AbortSignal,
  compileInputs = false,
  effectiveOutputRoot?: string,
  trustedOutputRoot?: string,
): Promise<{
  configPath: string
  config: Awaited<ReturnType<TrustedConfigProvider['get']>>['config']
  targets: PreparedTarget[]
}> {
  const loaded = await provider.get(signal)
  try {
    const effectiveOutputRoots =
      effectiveOutputRoot === undefined
        ? undefined
        : new Map([[requested?.[0] ?? '', effectiveOutputRoot]])
    const targets = await preflightConfiguredTargets(loaded.config, {
      workspaceRoot: options.workspaceRoot,
      localFileRoot: options.workspaceRoot,
      remote: options.remote,
      requestedTargets: requested,
      ...(effectiveOutputRoots ? { effectiveOutputRoots } : {}),
      ...(trustedOutputRoot !== undefined ? { trustedOutputRoots: new Map([[requested?.[0] ?? '', trustedOutputRoot]]) } : {}),
      signal,
      compileInputs,
    })
    return {
      configPath: loaded.displayPath,
      config: loaded.config,
      targets: targets.map(({ name, server, config, output, compilation }) => ({
        name,
        server,
        config,
        output,
        ...(compilation ? { compilation } : {}),
      })),
    }
  } catch (error) {
    preflightError(error)
  }
}

export async function validateConfiguredOutputRoots(
  provider: TrustedConfigProvider,
  options: ResolvedMcpServerOptions,
): Promise<string[]> {
  const prepared = await prepareTargets(provider, options, undefined)
  if (prepared.targets.length === 0)
    throw new McpToolError(
      'MCP_CONFIG_LOAD_FAILED',
      'Controlled write requires at least one configured generation target.',
    )
  return prepared.targets.map(({ output }) => output.absolutePath)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function operationKeys(intent: PreparedGenerationIntent): string[] {
  return intent.desired.scope.type === 'operations'
    ? intent.desired.scope.operationKeys
    : []
}

function previousOperationKeys(intent: PreparedGenerationIntent): string[] {
  return intent.previous?.scope.type === 'operations'
    ? intent.previous.scope.operationKeys
    : []
}

function validateHistoricalOperationKeys(
  catalog: OperationCatalog,
  operationKeys: readonly string[],
  target: string,
): void {
  const byKey = new Map(catalog.items.map((item) => [item.operationKey, item]))
  const operationIdCounts = new Map<string, number>()
  for (const item of catalog.items) {
    if (item.operationId) operationIdCounts.set(item.operationId, (operationIdCounts.get(item.operationId) ?? 0) + 1)
  }
  for (const operationKey of operationKeys) {
    const item = byKey.get(operationKey)
    if (!item) {
      throw new McpToolError(
        'SELECTION_OPERATION_NOT_FOUND',
        `Previously selected operationKey ${operationKey} was not found in trusted target ${target}.`,
        'Review the OpenAPI operation identity change; selection migration is not automatic.',
      )
    }
    if (!item.operationId) {
      throw new McpToolError(
        'SELECTIVE_PREPARE_OPERATION_ID_REQUIRED',
        `operationKey ${operationKey} cannot be prepared because it has no operationId.`,
      )
    }
    if ((operationIdCounts.get(item.operationId) ?? 0) > 1) {
      throw new McpToolError(
        'SELECTIVE_PREPARE_DUPLICATE_OPERATION_ID',
        `operationKey ${operationKey} cannot be prepared because operationId ${item.operationId} is duplicated.`,
      )
    }
  }
}

function selectionSummary(
  intent: PreparedGenerationIntent,
  mutation: Extract<GenerationIntentMutation, { type: 'operations' }>,
): GenerationSelectionSummary {
  const previous = previousOperationKeys(intent)
  const desired = operationKeys(intent)
  const requested = [...new Set(mutation.operationKeys)].sort(compareText)
  const previousSet = new Set(previous)
  const desiredSet = new Set(desired)
  return {
    mutationType: mutation.strategy,
    previousOperationKeys: previous,
    requestedOperationKeys: requested,
    newlyAddedOperationKeys: requested.filter((key) => !previousSet.has(key)),
    alreadySelectedOperationKeys: requested.filter((key) => previousSet.has(key)),
    retainedOperationKeys: desired.filter((key) => previousSet.has(key)),
    removedOperationKeys: previous.filter((key) => !desiredSet.has(key)),
    desiredOperationKeys: desired,
    previousSelectionExists: intent.previous !== undefined,
    previousSelectionHash: intent.previous ? hashGenerationIntent(intent.previous) : hash(''),
    desiredSelectionHash: intent.desiredHash,
  }
}

function ephemeralIntent(workspaceRoot: string, target: string, outputRoot: string, operationKeys: readonly string[]): PreparedGenerationIntent {
  const desired = normalizeGenerationIntent(target, outputRoot, { type: 'operations', operationKeys: [...operationKeys] })
  const desiredBytes = new TextEncoder().encode(serializeGenerationIntentManifest(desired))
  return {
    desired,
    desiredHash: hashGenerationIntent(desired),
    stateFile: {
      id: 'generation-intent',
      workspaceRelativePath: generationIntentStateRelativePath(target),
      expectedBefore: { exists: false },
      desiredBytes,
      desiredSha256: hash(desiredBytes),
      maxBytes: DEFAULT_MAX_GENERATION_INTENT_BYTES,
    },
    recoveryContext: { workspaceRoot, allowedStateRoots: ['.openapi-to/generation-intents'] },
  }
}

async function assertLegacySelectionStateAbsent(workspaceRoot: string): Promise<void> {
  const legacyRoot = path.join(workspaceRoot, stateDirectoryName, 'selections')
  let metadata: Awaited<ReturnType<typeof lstat>>
  try {
    metadata = await lstat(legacyRoot)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new McpToolError(
      'MCP_LEGACY_SELECTION_STATE_REQUIRES_MIGRATION',
      'Legacy operation selection state is unsafe; explicit migration is required before generation.',
    )
  }
  const directory = await opendir(legacyRoot)
  try {
    const first = await directory.read()
    if (first) {
      throw new McpToolError(
        'MCP_LEGACY_SELECTION_STATE_REQUIRES_MIGRATION',
        'Legacy operation selection state exists; explicit migration is required before Generation Intent can become authoritative.',
      )
    }
  } finally {
    await directory.close()
  }
}

async function assertIntentBootstrapSafe(outputRoot: string): Promise<void> {
  let metadata: Awaited<ReturnType<typeof lstat>>
  try {
    metadata = await lstat(outputRoot)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new McpToolError(
      'MCP_GENERATION_INTENT_BOOTSTRAP_REQUIRED',
      'Selective Generation Intent can only bootstrap an absent or empty output root.',
    )
  }
  const directory = await opendir(outputRoot)
  try {
    const first = await directory.read()
    if (first) {
      throw new McpToolError(
        'MCP_GENERATION_INTENT_BOOTSTRAP_REQUIRED',
        'Selective Generation Intent cannot infer ownership from an existing output root; explicit migration is required.',
      )
    }
  } finally {
    await directory.close()
  }
}

async function runIntent(
  provider: TrustedConfigProvider,
  options: ResolvedMcpServerOptions,
  request: InternalGenerationRequest,
  execution: GenerationExecution,
  registry?: TrustedTargetCatalogRegistry,
): Promise<GenerationRun> {
  await execution.progress?.('Loading trusted configuration', 5)
  const prepared = await prepareTargets(
    provider,
    options,
    [request.target],
    execution.signal,
    request.mutation.type === 'full',
    request.effectiveOutputRoot,
    request.trustedOutputRoot,
  )
  const target = prepared.targets[0]
  if (!target) throw new McpToolError('MCP_UNKNOWN_TARGET', `The selected trusted target was not found: ${request.target}.`)
  const operationMutation = request.mutation.type === 'operations' || request.mutation.type === 'ephemeral'
  if (request.mutation.type !== 'ephemeral') await assertLegacySelectionStateAbsent(options.workspaceRoot)
  if (operationMutation && !registry) {
    throw new McpToolError('MCP_CONFIG_LOAD_FAILED', 'Selective generation requires a startup-trusted target registry.')
  }
  const requestedOperationKeys = request.mutation.type === 'full' ? [] : request.mutation.operationKeys
  if (operationMutation && requestedOperationKeys.length === 0) {
    throw new McpToolError(
      request.execution === 'preview' ? 'EMPTY_OPERATION_SELECTION' : 'EMPTY_SELECTION_MUTATION',
      request.execution === 'preview'
        ? 'Selective generation requires at least one operationKey.'
        : 'Selective generation requires at least one operationKey.',
    )
  }

  const intent = request.mutation.type === 'ephemeral'
    ? ephemeralIntent(options.workspaceRoot, target.name, target.output.workspaceRelativePath, requestedOperationKeys)
    : await prepareGenerationIntent(
        options.workspaceRoot,
        { target: target.name, outputRoot: target.output.workspaceRelativePath },
        request.mutation,
      )
  if (request.mutation.type === 'operations' && !intent.previous && (request.execution === 'prepare' || request.enforceIntentBootstrap === true)) {
    await assertIntentBootstrapSafe(target.output.absolutePath)
  }

  let compilation = target.compilation
  let projection: GenerationRun['projection']
  let selection: GenerationSelectionSummary | undefined
  if (operationMutation) {
    const cached =
      request.execution === 'apply-revalidate'
        ? await registry?.getCurrent(target.name, execution.signal)
        : await registry?.get(target.name, execution.signal)
    if (!cached?.catalog || !cached.compilation.document || !cached.success) {
      return {
        configPath: prepared.configPath,
        targets: [target.name],
        servers: [],
        diagnostics: cached?.diagnostics ?? [],
      }
    }
    if (request.mutation.type !== 'ephemeral') validateHistoricalOperationKeys(cached.catalog, previousOperationKeys(intent), target.name)
    const desiredKeys = operationKeys(intent)
    const projected = projectOpenAPICompilation(
      cached.compilation,
      cached.catalog,
      { type: 'operations', operationKeys: desiredKeys },
      {
        target: target.name,
        sourceHash: cached.sourceHash,
        signal: execution.signal,
      },
    )
    selection = request.mutation.type === 'ephemeral'
      ? {
          mutationType: 'ephemeral',
          previousOperationKeys: [],
          requestedOperationKeys: [...new Set(request.mutation.operationKeys)].sort(compareText),
          newlyAddedOperationKeys: [...new Set(request.mutation.operationKeys)].sort(compareText),
          alreadySelectedOperationKeys: [],
          retainedOperationKeys: [],
          removedOperationKeys: [],
          desiredOperationKeys: operationKeys(intent),
          previousSelectionExists: false,
          previousSelectionHash: hash(''),
          desiredSelectionHash: intent.desiredHash,
          resolvedOperationKeys: projected.selection.resolvedOperationKeys,
        }
      : request.mutation.type === 'operations'
        ? selectionSummary(intent, request.mutation)
        : (() => { throw new McpToolError('MCP_TOOL_EXECUTION_FAILED', 'Invalid generation mutation.') })()
    selection.resolvedOperationKeys = projected.selection.resolvedOperationKeys
    projection = {
      stats: projected.stats,
      ...(projected.projectionHash ? { projectionHash: projected.projectionHash } : {}),
    }
    if (!projected.success || !projected.compilation) {
      return {
        configPath: prepared.configPath,
        targets: [target.name],
        servers: [],
        diagnostics: projected.diagnostics,
        selection,
        projection,
      }
    }
    compilation = projected.compilation
    target.config.output = {
      ...target.config.output,
      clean: request.mutation.type === 'operations' && request.mutation.strategy === 'replace',
    }
  }
  if (!compilation) throw new McpToolError('MCP_TOOL_EXECUTION_FAILED', 'Trusted target preflight did not compile the selected input.')

  await execution.progress?.('Compiling input and executing plugins', 35)
  const result = await buildFromCompilation(target.config, compilation, {
    json: true,
    dryRun: request.mode !== 'check',
    check: request.mode === 'check',
    allowManagedDrift: request.mode === 'check',
    localFileRoot: options.workspaceRoot,
    signal: execution.signal,
    outputWriteLock: execution.outputWriteLock,
  })
  const diagnostics = [...result.diagnostics]
  const generated = result.generationResult?.artifacts ?? []
  const materialized = materializeArtifacts(generated, target.output.absolutePath, { signal: execution.signal })
  diagnostics.push(...materialized.diagnostics)
  const formatted = await formatMaterializedArtifacts(
    materialized.artifacts,
    target.config.output.format,
    { signal: execution.signal },
  )
  diagnostics.push(...formatted.diagnostics)
  const server: GenerationServerRun = {
    name: target.name,
    source: sanitizeSourceDisplay(options.workspaceRoot, target.config.input.path),
    outputRoot: target.output.workspaceRelativePath,
    remotePolicyHash: createHash('sha256').update(remotePolicyIdentity(target.config.input.remote)).digest('hex'),
    result,
    materialized: formatted.artifacts,
    intent,
  }
  await execution.progress?.('Preparing artifact plan', 85)
  return {
    configPath: prepared.configPath,
    targets: [target.name],
    servers: [server],
    diagnostics,
    ...(selection ? { selection } : {}),
    ...(projection ? { projection } : {}),
  }
}

export async function executeGenerationIntent(
  provider: TrustedConfigProvider,
  options: ResolvedMcpServerOptions,
  request: InternalGenerationRequest,
  execution: GenerationExecution = {},
  registry?: TrustedTargetCatalogRegistry,
): Promise<GenerationRun> {
  return runIntent(provider, options, request, execution, registry)
}

export async function executeGeneration(
  provider: TrustedConfigProvider,
  options: ResolvedMcpServerOptions,
  requested: string[] | undefined,
  mode: 'dry-run' | 'check',
  execution: GenerationExecution = {},
): Promise<GenerationRun> {
  const names = (await prepareTargets(provider, options, requested, execution.signal)).targets.map(({ name }) => name)
  const runs: GenerationRun[] = []
  for (const target of names) {
    runs.push(await executeGenerationIntent(
      provider,
      options,
      { target, mutation: { type: 'full' }, execution: 'preview', mode },
      execution,
    ))
  }
  const first = runs[0]
  return {
    configPath: first?.configPath ?? (await provider.get(execution.signal)).displayPath,
    targets: names,
    servers: runs.flatMap(({ servers }) => servers),
    diagnostics: runs.flatMap(({ diagnostics }) => diagnostics),
  }
}

export async function executeSelectiveGeneration(
  provider: TrustedConfigProvider,
  options: ResolvedMcpServerOptions,
  registry: TrustedTargetCatalogRegistry,
  requested: string[] | undefined,
  scope: OperationGenerationScope,
  execution: GenerationExecution = {},
  purpose: 'preview' | 'prepare' | 'apply' = 'preview',
  _forceManagedCleanup = false,
  strategy: 'add' | 'replace' = 'replace',
): Promise<GenerationRun> {
  const prepared = await prepareTargets(provider, options, requested, execution.signal)
  if (prepared.targets.length !== 1) {
    throw new McpToolError(
      'SELECTIVE_GENERATION_SINGLE_TARGET_REQUIRED',
      'Selective generation requires exactly one startup-configured target.',
      'Call openapi_list_targets, then pass one target name.',
    )
  }
  const target = prepared.targets[0]
  if (!target) throw new McpToolError('MCP_UNKNOWN_TARGET', 'The selected trusted target was not found.')
  return executeGenerationIntent(
    provider,
    options,
    {
      target: target.name,
      mutation: { type: 'operations', strategy, operationKeys: scope.operationKeys },
      execution: purpose === 'apply' ? 'apply-revalidate' : purpose,
    },
    execution,
    registry,
  )
}

export function manifestHash(entries: readonly GenerationManifestEntry[]): string {
  return createHash('sha256')
    .update(JSON.stringify(entries.map(({ path, status, hash, previousHash, bytes }) => ({ path, status, hash, previousHash, bytes }))))
    .digest('hex')
}

export function generationSucceeded(run: GenerationRun): boolean {
  return !hasDiagnosticErrors(run.diagnostics) && run.servers.every(({ result }) => !result.error)
}
