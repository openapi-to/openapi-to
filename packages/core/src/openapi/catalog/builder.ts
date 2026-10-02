import { sortDiagnostics, type Diagnostic } from '../../diagnostics.ts'
import { throwIfAborted, type OpenapiExecutionOptions } from '../../execution.ts'
import type { CompatibleOpenAPIDocument } from '../../types/index.ts'
import { enumerateOpenAPIOperations } from '../operations.ts'
import { assignOperationIdentities } from './identity.ts'
import { setOperationCatalogState, type OperationCatalogEntry } from './internal.ts'
import type { OperationCatalog, OperationCatalogItem } from './types.ts'

export interface BuildOperationCatalogOptions extends OpenapiExecutionOptions {
  target?: string
  resolvedDocument?: CompatibleOpenAPIDocument
  diagnostics?: Diagnostic[]
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function text(value: unknown, limit = 4_000): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : undefined
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))].sort() : []
}

function schemaName(ref: string): string | undefined {
  const match = /#\/components\/schemas\/([^/]+)$/.exec(ref)
  return match?.[1] ? decodeURIComponent(match[1].replaceAll('~1', '/').replaceAll('~0', '~')) : undefined
}

function collectSchemaNames(value: unknown, names = new Set<string>(), seen = new WeakSet<object>()): Set<string> {
  if (typeof value !== 'object' || value === null) return names
  if (seen.has(value)) return names
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaNames(item, names, seen)
    return names
  }
  const object = value as Record<string, unknown>
  if (typeof object.$ref === 'string') {
    const name = schemaName(object.$ref)
    if (name) names.add(name)
  }
  for (const key of Object.keys(object).sort()) collectSchemaNames(object[key], names, seen)
  return names
}

function collectPropertyNames(value: unknown, names = new Set<string>(), seen = new WeakSet<object>(), depth = 0): Set<string> {
  if (depth > 8 || typeof value !== 'object' || value === null || seen.has(value)) return names
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) collectPropertyNames(item, names, seen, depth + 1)
    return names
  }
  const object = value as Record<string, unknown>
  const properties = record(object.properties)
  if (properties) for (const name of Object.keys(properties).sort().slice(0, 500)) names.add(name)
  for (const key of ['items', 'allOf', 'oneOf', 'anyOf']) collectPropertyNames(object[key], names, seen, depth + 1)
  return names
}

function parameterNames(pathItem: Record<string, unknown>, operation: Record<string, unknown>): string[] {
  const names = new Set<string>()
  for (const value of [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])]) {
    const parameter = record(value)
    if (typeof parameter?.name === 'string') names.add(parameter.name)
  }
  return [...names].sort()
}

function requestSchemas(operation: Record<string, unknown>): Set<string> {
  return collectSchemaNames(record(operation.requestBody)?.content)
}

function responseSchemas(operation: Record<string, unknown>): Set<string> {
  return collectSchemaNames(operation.responses)
}

interface FoundOperation {
  path: string
  method: string
  wireMethod: string
  sourceKind: 'fixed' | 'additional'
  sourceMethod: string
  sourcePath: Array<string | number>
  operationKind: 'query' | 'mutation' | 'unknown'
  sourcePointer: string
  pathItem: Record<string, unknown>
  operation: Record<string, unknown>
  resolvedPathItem?: Record<string, unknown>
  resolvedOperation?: Record<string, unknown>
}

function findOperations(document: CompatibleOpenAPIDocument, resolvedDocument: CompatibleOpenAPIDocument, signal?: AbortSignal): FoundOperation[] {
  const resolvedRoot = resolvedDocument as Record<string, unknown>
  const valueAt = (path: Array<string | number>): unknown => {
    let current: unknown = resolvedRoot
    for (const part of path) current = record(current)?.[String(part)]
    return current
  }
  return enumerateOpenAPIOperations(document).map((source) => {
    throwIfAborted(signal)
    return {
      ...source,
      method: source.wireMethod,
      resolvedPathItem: record(valueAt(['paths', source.path])),
      resolvedOperation: record(valueAt(source.sourcePath)),
    }
  })
}

export function buildOperationCatalog(document: CompatibleOpenAPIDocument, options: BuildOperationCatalogOptions = {}): OperationCatalog {
  const resolvedDocument = options.resolvedDocument ?? document
  const operations = findOperations(document, resolvedDocument, options.signal)
  const identity = assignOperationIdentities(
    operations.map(({ method, path, operation, sourcePointer }) => ({ method, path, sourcePointer, operationId: text(operation.operationId, 500) })),
    options.target,
  )
  const items: OperationCatalogItem[] = []
  const entries = new Map<string, OperationCatalogEntry>()
  operations.forEach((found, index) => {
    throwIfAborted(options.signal)
    const assigned = identity.identities[index]
    if (!assigned) throw new Error('Operation identity assignment did not preserve operation cardinality.')
    const resolvedOperation = found.resolvedOperation ?? found.operation
    const requestSchemaNames = [...requestSchemas(found.operation)].sort()
    const responseSchemaNames = [...responseSchemas(found.operation)].sort()
    const responsePropertyNames = [...collectPropertyNames(resolvedOperation.responses)].sort()
    const item: OperationCatalogItem = {
      ...(options.target ? { target: options.target } : {}),
      operationKey: assigned.operationKey,
      ...(assigned.operationId ? { operationId: assigned.operationId } : {}),
      method: found.method,
      wireMethod: found.wireMethod,
      sourceKind: found.sourceKind,
      sourceMethod: found.sourceMethod,
      sourcePath: found.sourcePath,
      operationKind: found.operationKind,
      path: found.path,
      tags: strings(found.operation.tags),
      ...(text(found.operation.summary, 1_000) ? { summary: text(found.operation.summary, 1_000) } : {}),
      ...(text(found.operation.description) ? { description: text(found.operation.description) } : {}),
      parameterNames: parameterNames(found.pathItem, found.operation),
      requestSchemaNames,
      responseSchemaNames,
      responsePropertyNames,
      deprecated: found.operation.deprecated === true,
      sourcePointer: found.sourcePointer,
    }
    items.push(item)
    entries.set(item.operationKey, { item, pathItem: found.pathItem, operation: found.operation, resolvedPathItem: found.resolvedPathItem, resolvedOperation: found.resolvedOperation })
  })
  items.sort((left, right) => compareText(left.operationKey, right.operationKey) || compareText(left.method, right.method) || compareText(left.path, right.path))
  const catalog: OperationCatalog = {
    ...(options.target ? { target: options.target } : {}),
    items,
    diagnostics: sortDiagnostics([...(options.diagnostics ?? []), ...identity.diagnostics]),
  }
  setOperationCatalogState(catalog, { document, resolvedDocument, entries })
  return catalog
}
