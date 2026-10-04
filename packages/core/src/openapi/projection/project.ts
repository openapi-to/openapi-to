import { createHash } from 'node:crypto'

import { hasDiagnosticErrors, sortDiagnostics, type Diagnostic } from '../../diagnostics.ts'
import { throwIfAborted, type OpenapiExecutionOptions } from '../../execution.ts'
import type { CompatibleOpenAPIDocument } from '../../types/index.ts'
import type { OpenAPICompilation } from '../compiler.ts'
import type { OperationCatalog, OperationCatalogItem } from '../catalog/types.ts'
import { getOperationCatalogState, type OperationCatalogEntry } from '../catalog/internal.ts'
import { normalizeOpenAPIDocument } from '../normalizer.ts'
import {
  OPENAPI_COMPONENT_GROUPS,
  buildOpenAPIReferenceGraph,
  parseOpenAPIComponentReference,
  resolveOpenAPIComponentClosure,
} from './reference-graph.ts'
import type {
  OpenAPIComponentGroup,
  OpenAPIProjectionStats,
  OperationGenerationScope,
  ProjectOpenAPICompilationResult,
  ProjectOpenAPIDocumentResult,
} from './types.ts'

export const OPENAPI_PROJECTION_VERSION = 1

export interface ProjectOpenAPIDocumentOptions extends OpenapiExecutionOptions {
  target?: string
  sourceHash?: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function emptyIncludedComponents(): Record<OpenAPIComponentGroup, string[]> {
  return OPENAPI_COMPONENT_GROUPS.reduce<Record<OpenAPIComponentGroup, string[]>>((result, group) => {
    result[group] = []
    return result
  }, {} as Record<OpenAPIComponentGroup, string[]>)
}

function emptyStats(): OpenAPIProjectionStats {
  return {
    operationCount: 0,
    pathCount: 0,
    schemaCount: 0,
    parameterCount: 0,
    requestBodyCount: 0,
    responseCount: 0,
    headerCount: 0,
    securitySchemeCount: 0,
    callbackCount: 0,
    linkCount: 0,
    exampleCount: 0,
  }
}

function selectionDiagnostics(catalog: OperationCatalog, scope: OperationGenerationScope, target?: string): { items: OperationCatalogItem[]; requested: string[]; diagnostics: Diagnostic[] } {
  const requested = [...new Set(scope.operationKeys)].sort(compareText)
  const diagnostics: Diagnostic[] = []
  if (catalog.target && target && catalog.target !== target) {
    diagnostics.push({ code: 'OPERATION_SELECTION_TARGET_MISMATCH', severity: 'error', message: `Operation catalog target ${catalog.target} cannot be used for target ${target}.` })
  }
  if (requested.length === 0) diagnostics.push({ code: 'EMPTY_OPERATION_SELECTION', severity: 'error', message: `Selective generation requires at least one operationKey${target ? ` for target ${target}` : ''}.` })
  const byKey = new Map(catalog.items.map((item) => [item.operationKey, item]))
  const items: OperationCatalogItem[] = []
  for (const operationKey of requested) {
    const item = byKey.get(operationKey)
    if (!item) {
      diagnostics.push({ code: 'UNKNOWN_OPERATION_KEY', severity: 'error', message: `Unknown operationKey ${operationKey}${target ? ` for target ${target}` : ''}.` })
      continue
    }
    if (target && item.target && item.target !== target) {
      diagnostics.push({ code: 'OPERATION_SELECTION_TARGET_MISMATCH', severity: 'error', message: `operationKey ${operationKey} belongs to target ${item.target}, not ${target}.`, location: { path: pointerPath(item.sourcePointer) } })
      continue
    }
    if (!item.operationId) {
      diagnostics.push({
        code: 'SELECTIVE_GENERATION_OPERATION_ID_REQUIRED',
        severity: 'error',
        message: `operationKey ${operationKey} cannot be selectively generated because the operation has no operationId.`,
        location: { path: pointerPath(item.sourcePointer) },
      })
      continue
    }
    const duplicates = catalog.items.filter((candidate) => candidate.operationId === item.operationId)
    if (duplicates.length > 1) {
      diagnostics.push({
        code: 'SELECTIVE_GENERATION_DUPLICATE_OPERATION_ID',
        severity: 'error',
        message: `operationKey ${operationKey} cannot be selectively generated because operationId ${item.operationId} is duplicated.`,
        location: { path: pointerPath(item.sourcePointer) },
      })
      continue
    }
    items.push(item)
  }
  return { items: items.sort((left, right) => compareText(left.operationKey, right.operationKey)), requested, diagnostics }
}

function pointerPath(pointer: string): string[] {
  return pointer.split('/').slice(1).map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
}

function securityNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap((requirement) => Object.keys(record(requirement) ?? {})))].sort(compareText)
}

function operationSlot(entry: OperationCatalogEntry): { kind: 'method' | 'additional'; key: string } {
  return entry.item.sourceKind === 'additional'
    ? { kind: 'additional', key: entry.item.sourceMethod }
    : { kind: 'method', key: entry.item.sourceMethod }
}

function cloneStable(value: unknown, resolvedValue: unknown, diagnostics: Diagnostic[], path: string[], seen = new WeakMap<object, unknown>()): unknown {
  if (typeof value !== 'object' || value === null) return value
  const cached = seen.get(value)
  if (cached !== undefined) return cached
  if (Array.isArray(value)) {
    const result: unknown[] = []
    seen.set(value, result)
    const resolvedArray = Array.isArray(resolvedValue) ? resolvedValue : []
    value.forEach((item, index) => {
      result.push(cloneStable(item, resolvedArray[index], diagnostics, [...path, String(index)], seen))
    })
    return result
  }
  const object = value as Record<string, unknown>
  if (typeof object.$ref === 'string' && !parseOpenAPIComponentReference(object.$ref)) {
    const resolved = record(resolvedValue)
    if (!resolved || (resolved.$ref === object.$ref && Object.keys(resolved).length === Object.keys(object).length)) {
      diagnostics.push({
        code: object.$ref.startsWith('#') ? 'PROJECTION_UNSUPPORTED_REFERENCE' : 'PROJECTION_REFERENCE_NOT_FOUND',
        severity: 'error',
        message: `Projection could not reuse the compiled value for reference ${object.$ref}.`,
        location: { path: [...path, '$ref'] },
      })
      return Object.fromEntries(Object.keys(object).sort().map((key) => [key, cloneStable(object[key], undefined, diagnostics, [...path, key], seen)]))
    }
    return cloneStable(resolved, resolved, diagnostics, path, seen)
  }
  const result: Record<string, unknown> = {}
  seen.set(value, result)
  const resolvedObject = record(resolvedValue)
  for (const key of Object.keys(object).sort()) result[key] = cloneStable(object[key], resolvedObject?.[key], diagnostics, [...path, key], seen)
  return result
}

function selectedPathItem(entries: OperationCatalogEntry[], diagnostics: Diagnostic[], resolved: boolean): Record<string, unknown> {
  const source = (resolved ? entries[0]?.resolvedPathItem : entries[0]?.pathItem) ?? entries[0]?.pathItem ?? {}
  const original = entries[0]?.pathItem ?? {}
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(original).sort()) {
    if (['$ref', 'summary', 'description', 'servers', 'parameters'].includes(key) || key.startsWith('x-')) {
      result[key] = resolved ? cloneStable(source[key], source[key], diagnostics, ['paths', entries[0]?.item.path ?? '', key]) : cloneStable(original[key], source[key], diagnostics, ['paths', entries[0]?.item.path ?? '', key])
    }
  }
  for (const entry of entries) {
    const slot = operationSlot(entry)
    const operation = resolved ? (entry.resolvedOperation ?? entry.operation) : entry.operation
    const resolvedOperation = entry.resolvedOperation ?? entry.operation
    const cloned = resolved ? cloneStable(operation, operation, diagnostics, pointerPath(entry.item.sourcePointer)) : cloneStable(operation, resolvedOperation, diagnostics, pointerPath(entry.item.sourcePointer))
    if (slot.kind === 'method') result[slot.key] = cloned
    else {
      const additional = record(result.additionalOperations) ?? {}
      result.additionalOperations = Object.fromEntries(
        [...Object.entries(additional), [slot.key, cloned] as const].sort(([left], [right]) => compareText(left, right)),
      )
    }
  }
  return result
}

function rootDocument(document: CompatibleOpenAPIDocument, selectedTags: Set<string>, inheritSecurity: boolean): Record<string, unknown> {
  const root = document as Record<string, unknown>
  const result: Record<string, unknown> = {}
  const kept = ['openapi', 'swagger', 'info', 'jsonSchemaDialect', 'servers', 'externalDocs']
  for (const key of Object.keys(root).sort()) {
    if (kept.includes(key) || key.startsWith('x-') || (key === 'security' && inheritSecurity)) result[key] = root[key]
  }
  if (Array.isArray(root.tags)) {
    const tags = root.tags.filter((tag) => {
      const name = record(tag)?.name
      return typeof name === 'string' && selectedTags.has(name)
    })
    if (tags.length) result.tags = tags
  }
  return result
}

function projectionHash(target: string | undefined, sourceHash: string, version: unknown, operationKeys: string[], normalizedDocument: CompatibleOpenAPIDocument): string {
  return createHash('sha256')
    .update(JSON.stringify({ projectionVersion: OPENAPI_PROJECTION_VERSION, target: target ?? '', sourceHash, openapiVersion: version ?? '', operationKeys, document: normalizedDocument }))
    .digest('hex')
}

export function projectOpenAPIDocument(
  document: CompatibleOpenAPIDocument,
  resolvedDocument: CompatibleOpenAPIDocument,
  catalog: OperationCatalog,
  scope: OperationGenerationScope,
  options: ProjectOpenAPIDocumentOptions = {},
): ProjectOpenAPIDocumentResult {
  throwIfAborted(options.signal)
  const selected = selectionDiagnostics(catalog, scope, options.target)
  const graph = buildOpenAPIReferenceGraph(document, { ...options, resolvedDocument })
  const base = {
    selection: { requestedOperationKeys: selected.requested, resolvedOperationKeys: selected.items.map(({ operationKey }) => operationKey) },
    referenceGraph: graph,
  }
  if (hasDiagnosticErrors(selected.diagnostics)) {
    return { success: false, ...base, includedComponents: emptyIncludedComponents(), stats: emptyStats(), diagnostics: sortDiagnostics(selected.diagnostics) }
  }

  const state = getOperationCatalogState(catalog)
  const entries = selected.items.map((item) => state.entries.get(item.operationKey)).filter((entry): entry is OperationCatalogEntry => entry !== undefined)
  if (entries.length !== selected.items.length) {
    const diagnostics = [...selected.diagnostics, { code: 'PROJECTION_INVALID_DOCUMENT', severity: 'error' as const, message: 'The operation catalog no longer contains every selected operation.' }]
    return { success: false, ...base, includedComponents: emptyIncludedComponents(), stats: emptyStats(), diagnostics: sortDiagnostics(diagnostics) }
  }
  const originalRoot = document as Record<string, unknown>
  const selectedTags = new Set(entries.flatMap((entry) => entry.item.tags))
  const inheritsSecurity = entries.some((entry) => !Object.hasOwn(entry.operation, 'security')) && Array.isArray(originalRoot.security)
  // Keep the path-item parameters slot when collecting roots: a bare parameters
  // array loses the Media Type Object | Reference Object union position.
  const rootValues = entries.flatMap((entry) => [
    { parameters: entry.pathItem.parameters }, entry.operation,
    { parameters: entry.resolvedPathItem?.parameters }, entry.resolvedOperation,
  ])
  const selectedSecurity = entries.flatMap((entry) => securityNames(Object.hasOwn(entry.operation, 'security') ? entry.operation.security : originalRoot.security))
  const closure = resolveOpenAPIComponentClosure(graph, rootValues, selectedSecurity, { ...options, ignoreMediaReferenceSiblings: String(originalRoot.openapi).startsWith('3.2.') })
  const diagnostics = [...selected.diagnostics, ...graph.diagnostics, ...closure.diagnostics]
  const included = emptyIncludedComponents()
  for (const ref of closure.references) {
    const parsed = parseOpenAPIComponentReference(ref)
    if (parsed) included[parsed.group].push(parsed.name)
  }
  for (const group of OPENAPI_COMPONENT_GROUPS) included[group].sort(compareText)

  const projected = rootDocument(document, selectedTags, inheritsSecurity)
  const projectedResolved = rootDocument(resolvedDocument, selectedTags, inheritsSecurity)
  const grouped = new Map<string, OperationCatalogEntry[]>()
  for (const entry of entries) grouped.set(entry.item.path, [...(grouped.get(entry.item.path) ?? []), entry])
  projected.paths = Object.fromEntries([...grouped.entries()].sort(([left], [right]) => compareText(left, right)).map(([path, pathEntries]) => [path, selectedPathItem(pathEntries, diagnostics, false)]))
  projectedResolved.paths = Object.fromEntries([...grouped.entries()].sort(([left], [right]) => compareText(left, right)).map(([path, pathEntries]) => [path, selectedPathItem(pathEntries, diagnostics, true)]))

  const sourceComponents = record(originalRoot.components) ?? {}
  const resolvedComponents = record((resolvedDocument as Record<string, unknown>).components) ?? {}
  const projectedComponents: Record<string, unknown> = {}
  const projectedResolvedComponents: Record<string, unknown> = {}
  for (const group of OPENAPI_COMPONENT_GROUPS) {
    const sourceGroup = record(sourceComponents[group]) ?? {}
    const resolvedGroup = record(resolvedComponents[group]) ?? {}
    if (included[group].length === 0) continue
    projectedComponents[group] = Object.fromEntries(included[group].map((name) => [name, cloneStable(sourceGroup[name], resolvedGroup[name], diagnostics, ['components', group, name])]))
    projectedResolvedComponents[group] = Object.fromEntries(included[group].map((name) => [name, cloneStable(resolvedGroup[name], resolvedGroup[name], diagnostics, ['components', group, name])]))
  }
  if (Object.keys(projectedComponents).length) projected.components = projectedComponents
  if (Object.keys(projectedResolvedComponents).length) projectedResolved.components = projectedResolvedComponents
  const normalized = normalizeOpenAPIDocument(projectedResolved as CompatibleOpenAPIDocument, options)
  const semanticSourceHash = options.sourceHash ?? createHash('sha256').update(JSON.stringify(normalizeOpenAPIDocument(document, options))).digest('hex')
  const hash = projectionHash(options.target, semanticSourceHash, originalRoot.openapi ?? originalRoot.swagger, base.selection.resolvedOperationKeys, normalized)
  const stats: OpenAPIProjectionStats = {
    operationCount: entries.length,
    pathCount: grouped.size,
    schemaCount: included.schemas.length,
    parameterCount: included.parameters.length,
    requestBodyCount: included.requestBodies.length,
    responseCount: included.responses.length,
    headerCount: included.headers.length,
    securitySchemeCount: included.securitySchemes.length,
    callbackCount: included.callbacks.length,
    linkCount: included.links.length,
    exampleCount: included.examples.length,
  }
  return {
    success: !hasDiagnosticErrors(diagnostics),
    ...base,
    document: projected as CompatibleOpenAPIDocument,
    resolvedDocument: projectedResolved as CompatibleOpenAPIDocument,
    normalizedDocument: normalized,
    includedComponents: included,
    stats,
    projectionHash: hash,
    diagnostics: sortDiagnostics(diagnostics),
  }
}

export function projectOpenAPICompilation(
  compilation: OpenAPICompilation,
  catalog: OperationCatalog,
  scope: OperationGenerationScope,
  options: ProjectOpenAPIDocumentOptions = {},
): ProjectOpenAPICompilationResult {
  if (!compilation.document || !compilation.resolvedDocument) {
    const diagnostics = sortDiagnostics([...compilation.diagnostics, { code: 'PROJECTION_INVALID_DOCUMENT', severity: 'error' as const, message: 'A successful OpenAPI compilation is required for projection.' }])
    return {
      success: false,
      selection: { requestedOperationKeys: [...new Set(scope.operationKeys)].sort(compareText), resolvedOperationKeys: [] },
      referenceGraph: { nodes: [], edges: {}, diagnostics: [] },
      includedComponents: emptyIncludedComponents(),
      stats: emptyStats(),
      diagnostics,
    }
  }
  const sourceHash = options.sourceHash ?? compilation.references?.sourceSnapshots.find((snapshot) => snapshot.isRoot)?.sha256
  const projected = projectOpenAPIDocument(compilation.document, compilation.resolvedDocument, catalog, scope, { ...options, sourceHash })
  if (!projected.document || !projected.resolvedDocument || !projected.normalizedDocument) return projected
  return {
    ...projected,
    compilation: {
      ...compilation,
      success: projected.success,
      document: projected.document,
      resolvedDocument: projected.resolvedDocument,
      normalizedDocument: projected.normalizedDocument,
      diagnostics: sortDiagnostics([...compilation.diagnostics, ...projected.diagnostics]),
    },
  }
}
