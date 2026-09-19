import converter from 'do-swagger2openapi'

import { version } from '../package.json'

import { ArtifactComparisonChangedError, OutputManagedPathChangedError, OutputUnmanagedPathConflictError, acquireOutputWriteLock, compareArtifacts, formatMaterializedArtifacts, materializeArtifacts, sortGeneratedArtifacts, sourceFileToArtifact, writeArtifacts, type GenerationManifest, type GenerationResult, type OutputWriteLock } from './artifacts/index.ts'
import { DiagnosticError, hasDiagnosticErrors, sortDiagnostics, type Diagnostic } from './diagnostics.ts'
import { compileOpenAPI, loadOpenAPIDocument, type OpenAPICompilation } from './openapi/index.ts'
import { PluginManager } from './pluginManager'

import type { Logger } from './logger.ts'
import type { CLIOptions, CompatibleOpenAPIDocument, OpenAPIAllDocument, OpenAPIDocument, OpenapiToSingleConfig } from './types'
import { isOpenapiOperationCancelled, throwIfAborted } from './execution.ts'

export async function requestRemoteData(requestUrl: string): Promise<OpenAPIAllDocument | undefined> {
  const loaded = await loadOpenAPIDocument(requestUrl)
  return loaded.originalDocument ?? loaded.document
}

export async function swagger2ToOpenapi3(openapiDocument: OpenAPIAllDocument): Promise<CompatibleOpenAPIDocument | undefined> {
  if ('openapi' in openapiDocument) return openapiDocument
  const converted = await converter.convertObj(openapiDocument, { warnOnly: true })
  return converted.openapi as CompatibleOpenAPIDocument
}

export interface BuildResult {
  pluginManager: PluginManager
  compilation: OpenAPICompilation
  generationResult?: GenerationResult
  diagnostics: Diagnostic[]
  error?: Error
}

function emptyManifest(outputRoot: string): GenerationResult['manifest'] {
  return {
    outputRoot,
    entries: [],
    summary: { added: 0, modified: 0, deleted: 0, unchanged: 0 },
    outdated: false,
  }
}

export async function build(
  openapiToSingleConfig: OpenapiToSingleConfig,
  CLIOptions: CLIOptions = {},
  _logger?: Logger,
): Promise<BuildResult> {
  const compilation = await compileOpenAPI(openapiToSingleConfig.input.path, {
    cwd: openapiToSingleConfig.root,
    remote: openapiToSingleConfig.input.remote,
    localFileRoot: CLIOptions.localFileRoot,
    debug: CLIOptions.debug,
    signal: CLIOptions.signal,
  })
  return buildFromCompilation(openapiToSingleConfig, compilation, CLIOptions, _logger)
}

/** Execute the existing plugin/artifact pipeline with an already compiled in-memory document. */
export async function buildFromCompilation(
  openapiToSingleConfig: OpenapiToSingleConfig,
  compilation: OpenAPICompilation,
  CLIOptions: CLIOptions = {},
  _logger?: Logger,
): Promise<BuildResult> {
  const placeholderDocument = (compilation.document ?? { openapi: '3.1.0', info: { title: 'invalid', version: '0' }, paths: {} }) as OpenAPIDocument
  const pluginManager = new PluginManager(openapiToSingleConfig, placeholderDocument, CLIOptions.signal)
  let diagnostics = [...compilation.diagnostics]
  if (!compilation.document || hasDiagnosticErrors(diagnostics)) {
    const error = new DiagnosticError('OpenAPI compilation failed.', diagnostics)
    return { pluginManager, compilation, diagnostics: sortDiagnostics(diagnostics), error }
  }

  let execution: Awaited<ReturnType<PluginManager['execute']>>
  try {
    execution = await pluginManager.execute()
  } catch (error) {
    if (isOpenapiOperationCancelled(error)) throw error
    diagnostics.push({ code: 'PLUGIN_EXECUTION_FAILED', severity: 'error', message: 'Plugin execution failed.', cause: error instanceof Error ? error.message : undefined })
    const diagnosticError = new DiagnosticError('Plugin execution failed.', diagnostics)
    return { pluginManager, compilation, diagnostics: sortDiagnostics(diagnostics), error: diagnosticError }
  }
  diagnostics.push(...execution.diagnostics)
  const artifacts = sortGeneratedArtifacts([...execution.sourceFiles.map((sourceFile) => sourceFileToArtifact(sourceFile)), ...execution.artifacts])
  throwIfAborted(CLIOptions.signal)
  const materialized = materializeArtifacts(artifacts, openapiToSingleConfig.output.dir, { signal: CLIOptions.signal })
  diagnostics.push(...materialized.diagnostics)
  if (hasDiagnosticErrors(diagnostics)) {
    const error = new DiagnosticError('Generation failed.', diagnostics)
    return {
      pluginManager,
      compilation,
      diagnostics: sortDiagnostics(diagnostics),
      generationResult: { artifacts, diagnostics: sortDiagnostics(diagnostics), manifest: emptyManifest(openapiToSingleConfig.output.dir), written: false },
      error,
    }
  }

  const formatted = await formatMaterializedArtifacts(materialized.artifacts, openapiToSingleConfig.output.format, { signal: CLIOptions.signal })
  diagnostics.push(...formatted.diagnostics)
  let manifest: GenerationManifest
  const writing = !CLIOptions.dryRun && !CLIOptions.check
  let outputWriteLock: OutputWriteLock | undefined = CLIOptions.outputWriteLock
  let ownsOutputWriteLock = false
  try {
    if (writing && !outputWriteLock) {
      outputWriteLock = await acquireOutputWriteLock(openapiToSingleConfig.output.dir, { signal: CLIOptions.signal })
      ownsOutputWriteLock = true
    }
    manifest = await compareArtifacts(formatted.artifacts, openapiToSingleConfig.output.dir, openapiToSingleConfig.output.clean === true, {
      signal: CLIOptions.signal,
      outputWriteLock,
    })
  } catch (error) {
    if (isOpenapiOperationCancelled(error)) throw error
    const code = error instanceof OutputUnmanagedPathConflictError ? error.code : error instanceof OutputManagedPathChangedError ? error.code : error instanceof ArtifactComparisonChangedError ? 'OUTPUT_CHANGED_DURING_COMPARE' : 'OUTPUT_COMPARE_FAILED'
    const message = error instanceof OutputUnmanagedPathConflictError ? `Generated output would overwrite unmanaged path ${error.relativePath}.` : error instanceof OutputManagedPathChangedError ? `Managed generated path ${error.relativePath} changed outside openapi-to and will not be overwritten or deleted.` : error instanceof ArtifactComparisonChangedError ? 'Generated output changed during comparison; the check result was discarded.' : 'Unable to compare generated artifacts with existing output.'
    diagnostics.push({ code, severity: 'error', message, location: { source: openapiToSingleConfig.output.dir }, cause: error instanceof Error ? error.message : undefined })
    const diagnosticError = new DiagnosticError('Output comparison failed.', diagnostics)
    if (ownsOutputWriteLock) await outputWriteLock?.release({ removeEmptyRoot: true }).catch(() => undefined)
    return { pluginManager, compilation, diagnostics: sortDiagnostics(diagnostics), error: diagnosticError }
  }

  let written = false
  if (CLIOptions.check && manifest.outdated) {
    diagnostics.push({ code: 'GENERATED_OUTPUT_OUTDATED', severity: 'error', message: 'Generated output is not up to date.', location: { source: openapiToSingleConfig.output.dir }, hint: 'Run openapi generate to update generated files.' })
  } else if (!CLIOptions.dryRun && !CLIOptions.check) {
    try {
      await writeArtifacts(formatted.artifacts, manifest, { signal: CLIOptions.signal, lock: outputWriteLock, generatorVersion: version })
      written = true
    } catch (error) {
      const code = error instanceof OutputUnmanagedPathConflictError || error instanceof OutputManagedPathChangedError ? error.code : 'OUTPUT_WRITE_FAILED'
      const message = error instanceof OutputUnmanagedPathConflictError ? `Generated output would overwrite unmanaged path ${error.relativePath}.` : error instanceof OutputManagedPathChangedError ? `Managed generated path ${error.relativePath} changed outside openapi-to and will not be overwritten or deleted.` : 'Unable to write generated artifacts.'
      diagnostics.push({ code, severity: 'error', message, location: { source: openapiToSingleConfig.output.dir }, cause: error instanceof Error ? error.message : undefined })
    }
  }
  if (ownsOutputWriteLock) await outputWriteLock?.release({ removeEmptyRoot: !written })
  pluginManager.filesCreated = materialized.artifacts.length
  diagnostics = sortDiagnostics(diagnostics)
  const generationResult: GenerationResult = { artifacts, diagnostics, manifest, written }
  const error = hasDiagnosticErrors(diagnostics) ? new DiagnosticError('Generation failed.', diagnostics) : undefined
  return { pluginManager, compilation, generationResult, diagnostics, error }
}
