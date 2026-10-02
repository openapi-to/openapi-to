import { summarizeDiagnostics, type DiagnosticSummary } from '../diagnostics.ts'
import type { CompatibleOpenAPIDocument } from '../types'
import { enumerateOpenAPIOperations } from './operations.ts'
import { throwIfAborted, type OpenapiExecutionOptions } from '../execution.ts'

export interface OpenAPIInspection {
  openapiVersion: string
  title?: string
  apiVersion?: string
  pathCount: number
  operationCount: number
  tags: Array<{ name: string; operations: number }>
  schemaCount: number
  securitySchemes: string[]
  deprecatedOperations: Array<{ path: string; method: string; operationId?: string }>
  missingOperationIds: Array<{ path: string; method: string }>
  methodDistribution: Record<string, number>
  externalReferenceCount: number
  diagnostics: DiagnosticSummary
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function inspectOpenAPIDocument(document: CompatibleOpenAPIDocument, externalReferenceCount = 0, diagnostics = [] as Parameters<typeof summarizeDiagnostics>[0], options: OpenapiExecutionOptions = {}): OpenAPIInspection {
  throwIfAborted(options.signal)
  const root = document as Record<string, unknown>
  const info = record(root.info)
  const paths = record(root.paths) ?? {}
  const tags = new Map<string, number>()
  const deprecatedOperations: OpenAPIInspection['deprecatedOperations'] = []
  const missingOperationIds: OpenAPIInspection['missingOperationIds'] = []
  const methodDistribution = new Map<string, number>()
  let operationCount = 0
  for (const pathName of Object.keys(paths).sort()) {
    throwIfAborted(options.signal)
    if (!record(paths[pathName])) continue
  }
  for (const source of enumerateOpenAPIOperations(document)) {
    throwIfAborted(options.signal)
    const { operation } = source
    operationCount += 1
    methodDistribution.set(source.wireMethod, (methodDistribution.get(source.wireMethod) ?? 0) + 1)
    const operationId = typeof operation.operationId === 'string' ? operation.operationId : undefined
    if (!operationId) missingOperationIds.push({ path: source.path, method: source.wireMethod })
    if (operation.deprecated === true) deprecatedOperations.push({ path: source.path, method: source.wireMethod, operationId })
    const operationTags = Array.isArray(operation.tags) && operation.tags.length > 0 ? operation.tags.filter((tag): tag is string => typeof tag === 'string') : ['default']
    for (const tag of operationTags) tags.set(tag, (tags.get(tag) ?? 0) + 1)
  }
  const components = record(root.components)
  const schemas = record(components?.schemas)
  const securitySchemes = record(components?.securitySchemes)
  return {
    openapiVersion: String(root.openapi ?? ''),
    title: typeof info?.title === 'string' ? info.title : undefined,
    apiVersion: typeof info?.version === 'string' ? info.version : undefined,
    pathCount: Object.keys(paths).length,
    operationCount,
    tags: [...tags].map(([name, operations]) => ({ name, operations })).sort((a, b) => compareText(a.name, b.name)),
    schemaCount: Object.keys(schemas ?? {}).length,
    securitySchemes: Object.keys(securitySchemes ?? {}).sort(),
    deprecatedOperations: deprecatedOperations.sort((a, b) => compareText(a.path, b.path) || compareText(a.method, b.method)),
    missingOperationIds: missingOperationIds.sort((a, b) => compareText(a.path, b.path) || compareText(a.method, b.method)),
    methodDistribution: Object.fromEntries([...methodDistribution].sort(([a], [b]) => compareText(a, b))),
    externalReferenceCount,
    diagnostics: summarizeDiagnostics(diagnostics),
  }
}
