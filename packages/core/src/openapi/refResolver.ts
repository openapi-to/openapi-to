import { sortDiagnostics, type Diagnostic } from '../diagnostics.ts'
import { throwIfAborted } from '../execution.ts'
import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import type { CompatibleOpenAPIDocument, RemoteSourceOptions } from '../types'
import { loadOpenAPIDocument, type LoadedSource, type SourceSnapshot, validateRemoteURL, sanitizedRemoteSource } from './sourceLoader.ts'

export interface ResolveReferencesOptions {
  remote?: RemoteSourceOptions
  headerOrigin?: string
  localFileRoot?: string
  cache?: Map<string, Promise<LoadedSource>>
  debug?: boolean
  signal?: AbortSignal
}

export interface ResolvedReferences {
  document: CompatibleOpenAPIDocument
  resolvedDocument: CompatibleOpenAPIDocument
  diagnostics: Diagnostic[]
  externalReferenceCount: number
  loadedSources: string[]
  sourceSnapshots: SourceSnapshot[]
}

type DocumentRecord = { document: Record<string, unknown>; baseUri: string; source: string; retrievalUri: string; headerOrigin: string }

function decodePointerToken(token: string): string {
  return decodeURIComponent(token).replace(/~1/g, '/').replace(/~0/g, '~')
}

export function resolveJSONPointer(document: unknown, fragment: string): { found: boolean; value?: unknown } {
  if (fragment === '' || fragment === '#') return { found: true, value: document }
  const pointer = fragment.startsWith('#') ? fragment.slice(1) : fragment
  if (!pointer.startsWith('/')) return { found: false }
  let current: unknown = document
  try {
    for (const rawToken of pointer.slice(1).split('/')) {
      const token = decodePointerToken(rawToken)
      if (Array.isArray(current)) {
        if (!/^(0|[1-9]\d*)$/.test(token)) return { found: false }
        current = current[Number(token)]
      } else if (typeof current === 'object' && current !== null && Object.hasOwn(current, token)) {
        current = (current as Record<string, unknown>)[token]
      } else {
        return { found: false }
      }
    }
  } catch {
    return { found: false }
  }
  return { found: current !== undefined, value: current }
}

function effectiveBaseUri(document: Record<string, unknown>, retrievalUri: string): string {
  if (typeof document.$self !== 'string') return retrievalUri
  try {
    return new URL(document.$self, retrievalUri).toString()
  } catch {
    return retrievalUri
  }
}

export async function resolveOpenAPIReferences(
  document: CompatibleOpenAPIDocument,
  baseUri: string,
  options: ResolveReferencesOptions = {},
): Promise<ResolvedReferences> {
  throwIfAborted(options.signal)
  const diagnostics: Diagnostic[] = []
  const diagnosticKeys = new Set<string>()
  const sourceCache = options.cache ?? new Map<string, Promise<LoadedSource>>()
  const documentCache = new Map<string, Promise<DocumentRecord | undefined>>()
  const loadedSources = new Set<string>([baseUri])
  const sourceSnapshots = new Map<string, SourceSnapshot>()
  const rootUri = new URL(baseUri)
  rootUri.hash = ''
  const rootKey = rootUri.toString()
  documentCache.set(rootKey, Promise.resolve({ document: document as Record<string, unknown>, baseUri: effectiveBaseUri(document as Record<string, unknown>, rootKey), source: ['http:', 'https:'].includes(rootUri.protocol) ? sanitizedRemoteSource(rootUri) : baseUri, retrievalUri: rootKey, headerOrigin: options.headerOrigin ?? rootUri.origin }))
  let externalReferenceCount = 0
  let visitedNodes = 0

  const addDiagnostic = (diagnostic: Diagnostic) => {
    const key = `${diagnostic.code}:${diagnostic.location?.source ?? ''}:${diagnostic.location?.path?.join('/') ?? ''}:${diagnostic.message}`
    if (!diagnosticKeys.has(key)) {
      diagnosticKeys.add(key)
      diagnostics.push(diagnostic)
    }
  }

  const loadDocument = async (uri: string, derivedFrom: string, headerOrigin: string, refPath: Array<string | number>): Promise<DocumentRecord | undefined> => {
    const normalized = new URL(uri)
    normalized.hash = ''
    const key = normalized.toString()
    if (normalized.protocol !== 'file:') {
      const blocked = validateRemoteURL(normalized, options.remote, derivedFrom)
      for (const diagnostic of blocked) addDiagnostic({ ...diagnostic, location: { ...diagnostic.location, path: refPath } })
      if (blocked.length > 0) return undefined
    }
    const cached = documentCache.get(key)
    if (cached) {
      const loaded = await cached
      if (!loaded) return undefined
      // Cached content must not restore credentials stripped along this ref path.
      const sameOrigin = normalized.origin === new URL(derivedFrom).origin
      return {
        ...loaded,
        headerOrigin: sameOrigin && loaded.headerOrigin === headerOrigin ? headerOrigin : 'null',
      }
    }
    const pending = (async () => {
      const loaded = await loadOpenAPIDocument(normalized, { remote: options.remote, derivedFrom, headerOrigin, localFileRoot: options.localFileRoot, cache: sourceCache, debug: options.debug, signal: options.signal })
      loadedSources.add(loaded.source)
      if (loaded.snapshot) sourceSnapshots.set(loaded.snapshot.uri, loaded.snapshot)
      for (const diagnostic of loaded.diagnostics) {
        addDiagnostic({ ...diagnostic, location: { ...diagnostic.location, path: refPath } })
      }
      if (!loaded.document) return undefined
      return {
        document: loaded.document as Record<string, unknown>,
        baseUri: effectiveBaseUri(loaded.document as Record<string, unknown>, loaded.uri),
        source: loaded.source,
        retrievalUri: loaded.uri,
        headerOrigin: loaded.headerOrigin ?? headerOrigin,
      }
    })()
    documentCache.set(key, pending)
    return pending
  }

  const memo = new WeakMap<object, unknown>()
  const activeObjects = new WeakSet<object>()
  const resolveNode = async (
    node: unknown,
    currentDocument: DocumentRecord,
    path: Array<string | number>,
    stack: string[],
  ): Promise<unknown> => {
    throwIfAborted(options.signal)
    visitedNodes += 1
    if (options.signal && visitedNodes % 512 === 0) {
      await yieldToEventLoop()
      throwIfAborted(options.signal)
    }
    if (Array.isArray(node)) {
      const cached = memo.get(node)
      if (cached) return cached
      const result: unknown[] = []
      memo.set(node, result)
      activeObjects.add(node)
      for (let index = 0; index < node.length; index += 1) result.push(await resolveNode(node[index], currentDocument, [...path, index], stack))
      activeObjects.delete(node)
      return result
    }
    if (typeof node !== 'object' || node === null) return node
    const record = node as Record<string, unknown>
    if (Object.hasOwn(record, '$ref')) {
      if (typeof record.$ref !== 'string' || record.$ref.length === 0) {
        addDiagnostic({ code: 'OPENAPI_REF_INVALID', severity: 'error', message: '$ref must be a non-empty string.', location: { source: currentDocument.source, path: [...path, '$ref'] } })
        return { ...record }
      }
      let targetUrl: URL
      try {
        targetUrl = new URL(record.$ref, currentDocument.baseUri)
      } catch {
        addDiagnostic({ code: 'OPENAPI_REF_INVALID', severity: 'error', message: 'Invalid reference URL.', location: { source: currentDocument.source, path: [...path, '$ref'] } })
        return { ...record }
      }
      const targetDocumentUri = new URL(targetUrl)
      const fragment = targetDocumentUri.hash
      targetDocumentUri.hash = ''
      const currentDocumentUri = new URL(currentDocument.baseUri)
      currentDocumentUri.hash = ''
      if ((['http:', 'https:'].includes(new URL(currentDocument.retrievalUri).protocol)) && targetDocumentUri.protocol !== 'http:' && targetDocumentUri.protocol !== 'https:') {
        addDiagnostic({
          code: 'REMOTE_SOURCE_BLOCKED',
          severity: 'error',
          message: `Remote documents may only reference HTTP(S) resources; ${targetDocumentUri.protocol} was blocked.`,
          location: { source: currentDocument.source, path: [...path, '$ref'] },
        })
        return { ...record }
      }
      const external = targetDocumentUri.toString() !== currentDocumentUri.toString()
      if (external) externalReferenceCount += 1
      const targetDocument = external ? await loadDocument(targetDocumentUri.toString(), currentDocument.retrievalUri, currentDocument.headerOrigin, [...path, '$ref']) : currentDocument
      if (!targetDocument) return { ...record }
      if (fragment && !fragment.startsWith('#/')) {
        addDiagnostic({ code: 'OPENAPI_REF_INVALID', severity: 'error', message: 'Only JSON Pointer fragments are currently supported.', location: { source: currentDocument.source, path: [...path, '$ref'] } })
        return { ...record }
      }
      const pointer = resolveJSONPointer(targetDocument.document, fragment)
      if (!pointer.found) {
        addDiagnostic({ code: 'OPENAPI_REF_NOT_FOUND', severity: 'error', message: 'Reference target was not found.', location: { source: currentDocument.source, path: [...path, '$ref'] } })
        return { ...record }
      }
      const canonical = `${targetDocumentUri.toString()}${fragment}`
      if (stack.includes(canonical) || (typeof pointer.value === 'object' && pointer.value !== null && activeObjects.has(pointer.value))) {
        addDiagnostic({
          code: 'OPENAPI_REF_CYCLE',
          severity: 'warning',
          message: 'Reference cycle detected; the cycle is preserved instead of recursively expanded.',
          location: { source: currentDocument.source, path: [...path, '$ref'] },
        })
        return { ...record }
      }
      const resolved = await resolveNode(pointer.value, targetDocument, path, [...stack, canonical])
      if (typeof resolved === 'object' && resolved !== null && !Array.isArray(resolved)) {
        const siblings = Object.fromEntries(Object.entries(record).filter(([key]) => key !== '$ref'))
        return { ...(resolved as Record<string, unknown>), ...siblings }
      }
      return resolved
    }
    const cached = memo.get(record)
    if (cached) return cached
    const result: Record<string, unknown> = {}
    memo.set(record, result)
    activeObjects.add(record)
    for (const key of Object.keys(record).sort()) result[key] = await resolveNode(record[key], currentDocument, [...path, key], stack)
    activeObjects.delete(record)
    return result
  }

  const rootDocumentPromise = documentCache.get(rootKey)
  if (!rootDocumentPromise) throw new Error('Internal reference resolver state is missing the root document.')
  const rootDocument = await rootDocumentPromise
  if (!rootDocument) throw new Error('Internal reference resolver could not initialize the root document.')
  const resolvedDocument = (await resolveNode(document, rootDocument, [], [])) as CompatibleOpenAPIDocument
  return {
    document,
    resolvedDocument,
    diagnostics: sortDiagnostics(diagnostics),
    externalReferenceCount,
    loadedSources: [...loadedSources].sort(),
    sourceSnapshots: [...sourceSnapshots.values()].sort((left, right) => left.uri.localeCompare(right.uri)),
  }
}
