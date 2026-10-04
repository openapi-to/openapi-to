import { sortDiagnostics, type Diagnostic } from '../../diagnostics.ts'
import { throwIfAborted, type OpenapiExecutionOptions } from '../../execution.ts'
import type { CompatibleOpenAPIDocument } from '../../types/index.ts'
import { isMediaTypeReferencePosition } from '../mediaTypeSemantics.ts'
import type { OpenAPIComponentGroup, OpenAPIReferenceGraph, OpenAPIReferenceKey } from './types.ts'

export const OPENAPI_COMPONENT_GROUPS: readonly OpenAPIComponentGroup[] = [
  'schemas',
  'mediaTypes',
  'parameters',
  'requestBodies',
  'responses',
  'headers',
  'securitySchemes',
  'callbacks',
  'links',
  'examples',
] as const

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function decodePointerToken(value: string): string {
  return decodeURIComponent(value).replaceAll('~1', '/').replaceAll('~0', '~')
}

function encodePointerToken(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

export function componentReferenceKey(group: OpenAPIComponentGroup, name: string): string {
  return `#/components/${group}/${encodePointerToken(name)}`
}

export function parseOpenAPIComponentReference(ref: string): OpenAPIReferenceKey | undefined {
  const match = /^#\/components\/([^/]+)\/([^/]+)$/.exec(ref)
  if (!match?.[1] || !match[2]) return undefined
  try {
    const group = decodePointerToken(match[1])
    if (!OPENAPI_COMPONENT_GROUPS.includes(group as OpenAPIComponentGroup)) return undefined
    const name = decodePointerToken(match[2])
    return { group: group as OpenAPIComponentGroup, name, ref: componentReferenceKey(group as OpenAPIComponentGroup, name) }
  } catch {
    return undefined
  }
}

export interface CollectOpenAPIComponentReferencesOptions extends OpenapiExecutionOptions {
  ignoreMediaReferenceSiblings?: boolean
}

export function collectOpenAPIComponentReferences(value: unknown, options: CollectOpenAPIComponentReferencesOptions = {}, rootPath: Array<string | number> = []): string[] {
  const refs = new Set<string>()
  const seen = new WeakSet<object>()
  const visit = (node: unknown, path: Array<string | number>, parentKey?: string): void => {
    throwIfAborted(options.signal)
    if (typeof node === 'string') {
      if (parentKey === 'mapping') {
        const parsed = parseOpenAPIComponentReference(node)
        if (parsed) refs.add(parsed.ref)
      }
      return
    }
    if (typeof node !== 'object' || node === null || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      node.forEach((item, index) => { visit(item, [...path, index], parentKey) })
      return
    }
    const object = node as Record<string, unknown>
    if (typeof object.$ref === 'string') {
      const parsed = parseOpenAPIComponentReference(object.$ref)
      if (parsed) refs.add(parsed.ref)
      if (options.ignoreMediaReferenceSiblings && isMediaTypeReferencePosition(path)) return
    }
    for (const key of Object.keys(object).sort()) {
      if (key === 'security' && Array.isArray(object[key])) {
        for (const requirement of object[key]) {
          for (const name of Object.keys(record(requirement) ?? {}).sort()) refs.add(componentReferenceKey('securitySchemes', name))
        }
      } else if (key === 'mapping' && record(object[key])) {
        const mapping = record(object[key])
        for (const name of Object.keys(mapping ?? {}).sort()) visit(mapping?.[name], [...path, key, name], 'mapping')
      } else {
        visit(object[key], [...path, key], key)
      }
    }
  }
  visit(value, rootPath)
  return [...refs].sort()
}

function componentMaps(document: CompatibleOpenAPIDocument): Partial<Record<OpenAPIComponentGroup, Record<string, unknown>>> {
  const components = record((document as Record<string, unknown>).components) ?? {}
  return Object.fromEntries(
    OPENAPI_COMPONENT_GROUPS.map((group) => [group, record(components[group])]).filter((entry): entry is [OpenAPIComponentGroup, Record<string, unknown>] => entry[1] !== undefined),
  )
}

export interface BuildOpenAPIReferenceGraphOptions extends OpenapiExecutionOptions {
  resolvedDocument?: CompatibleOpenAPIDocument
}

export function buildOpenAPIReferenceGraph(document: CompatibleOpenAPIDocument, options: BuildOpenAPIReferenceGraphOptions = {}): OpenAPIReferenceGraph {
  const maps = componentMaps(document)
  const resolvedMaps = options.resolvedDocument ? componentMaps(options.resolvedDocument) : {}
  const nodes: string[] = []
  const edges: Record<string, string[]> = {}
  const referenceOptions = { ...options, ignoreMediaReferenceSiblings: String((document as Record<string, unknown>).openapi).startsWith('3.2.') }
  for (const group of OPENAPI_COMPONENT_GROUPS) {
    for (const name of Object.keys(maps[group] ?? {}).sort()) {
      throwIfAborted(options.signal)
      const key = componentReferenceKey(group, name)
      nodes.push(key)
      edges[key] = [...new Set([
        ...collectOpenAPIComponentReferences(maps[group]?.[name], referenceOptions, ['components', group, name]),
        ...collectOpenAPIComponentReferences(resolvedMaps[group]?.[name], referenceOptions, ['components', group, name]),
      ])].sort()
    }
  }
  return { nodes, edges, diagnostics: [] }
}

export interface ResolveComponentClosureOptions extends CollectOpenAPIComponentReferencesOptions {
  target?: string
}

export function resolveOpenAPIComponentClosure(
  graph: OpenAPIReferenceGraph,
  rootValues: unknown[],
  securitySchemeNames: string[] = [],
  options: ResolveComponentClosureOptions = {},
): { references: string[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const available = new Set(graph.nodes)
  const roots = new Set(rootValues.flatMap((value) => collectOpenAPIComponentReferences(value, options)))
  for (const name of securitySchemeNames) roots.add(componentReferenceKey('securitySchemes', name))
  const visited = new Set<string>()
  const active = new Set<string>()
  const visit = (key: string): void => {
    throwIfAborted(options.signal)
    if (active.has(key)) {
      diagnostics.push({
        code: 'PROJECTION_REFERENCE_CYCLE',
        severity: 'info',
        message: `Projection preserved the component reference cycle at ${key}${options.target ? ` for target ${options.target}` : ''}.`,
        location: { path: key.slice(2).split('/').map(decodePointerToken) },
      })
      return
    }
    if (visited.has(key)) return
    if (!available.has(key)) {
      diagnostics.push({
        code: 'PROJECTION_REFERENCE_NOT_FOUND',
        severity: 'error',
        message: `Required projection component was not found: ${key}${options.target ? ` in target ${options.target}` : ''}.`,
        location: { path: key.slice(2).split('/').map(decodePointerToken) },
      })
      return
    }
    active.add(key)
    for (const dependency of graph.edges[key] ?? []) visit(dependency)
    active.delete(key)
    visited.add(key)
  }
  for (const root of [...roots].sort()) visit(root)
  return { references: [...visited].sort(), diagnostics: sortDiagnostics(diagnostics) }
}
