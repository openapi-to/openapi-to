import { hasDiagnosticErrors, sortDiagnostics, type Diagnostic } from '../diagnostics.ts'
import type { CompatibleOpenAPIDocument } from '../types'
import { resolveOpenAPIReferences, type ResolvedReferences } from './refResolver.ts'
import { loadOpenAPIDocument, type OpenAPIInput, type SourceLoaderOptions } from './sourceLoader.ts'
import { validateOpenAPIDocument } from './validator.ts'
import { normalizeOpenAPIDocument } from './normalizer.ts'
import { throwIfAborted } from '../execution.ts'

export interface OpenAPICompilation {
  success: boolean
  source: string
  uri: string
  version?: string
  document?: CompatibleOpenAPIDocument
  resolvedDocument?: CompatibleOpenAPIDocument
  normalizedDocument?: CompatibleOpenAPIDocument
  diagnostics: Diagnostic[]
  references?: Omit<ResolvedReferences, 'document' | 'resolvedDocument' | 'diagnostics'>
}

export async function compileOpenAPI(input: OpenAPIInput, options: SourceLoaderOptions = {}): Promise<OpenAPICompilation> {
  throwIfAborted(options.signal)
  const loaded = await loadOpenAPIDocument(input, options)
  throwIfAborted(options.signal)
  const diagnostics = [...loaded.diagnostics]
  if (!loaded.document) return { success: false, source: loaded.source, uri: loaded.uri, version: loaded.version, diagnostics: sortDiagnostics(diagnostics) }
  const references = await resolveOpenAPIReferences(loaded.document, loaded.uri, { ...options, headerOrigin: loaded.headerOrigin })
  throwIfAborted(options.signal)
  diagnostics.push(...references.diagnostics, ...validateOpenAPIDocument(loaded.document, loaded.source, options))
  throwIfAborted(options.signal)
  const sorted = sortDiagnostics(diagnostics)
  return {
    success: !hasDiagnosticErrors(sorted),
    source: loaded.source,
    uri: loaded.uri,
    version: loaded.version,
    document: loaded.document,
    resolvedDocument: references.resolvedDocument,
    normalizedDocument: normalizeOpenAPIDocument(references.resolvedDocument, options),
    diagnostics: sorted,
    references: {
      externalReferenceCount: references.externalReferenceCount,
      loadedSources: references.loadedSources,
      sourceSnapshots: [loaded.snapshot ? { ...loaded.snapshot, isRoot: true } : undefined, ...references.sourceSnapshots]
        .filter((snapshot): snapshot is NonNullable<typeof snapshot> => snapshot !== undefined)
        .filter((snapshot, index, snapshots) => snapshots.findIndex((candidate) => candidate.uri === snapshot.uri) === index)
        .sort((left, right) => left.uri.localeCompare(right.uri)),
    },
  }
}
