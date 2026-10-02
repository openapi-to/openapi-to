import type { CompatibleOpenAPIDocument } from '../types/index.ts'
import { classifyOpenAPIDialect } from './dialect.ts'

export const FIXED_OPERATION_METHODS = ['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace'] as const
export const OPENAPI_32_FIXED_OPERATION_METHODS = [...FIXED_OPERATION_METHODS, 'query'] as const

export type FixedOperationMethod = (typeof OPENAPI_32_FIXED_OPERATION_METHODS)[number]
export type OperationSourceKind = 'fixed' | 'additional'
export type OperationKind = 'query' | 'mutation' | 'unknown'

export interface OpenAPIOperationSource {
  path: string
  sourceKind: OperationSourceKind
  sourceMethod: string
  /** Exact HTTP method spelling that must be sent on the wire. */
  wireMethod: string
  /** Legacy-compatible method identity: lowercase for fixed slots, exact for additional methods. */
  method: string
  sourcePath: Array<string | number>
  sourcePointer: string
  operationKind: OperationKind
  pathItem: Record<string, unknown>
  operation: Record<string, unknown>
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

export function classifyOperationKind(sourceKind: OperationSourceKind, sourceMethod: string): OperationKind {
  if (sourceKind === 'additional') return 'unknown'
  if (sourceMethod === 'get' || sourceMethod === 'query') return 'query'
  return 'mutation'
}

export function enumerateOpenAPIOperations(document: CompatibleOpenAPIDocument): OpenAPIOperationSource[] {
  const root = document as Record<string, unknown>
  const paths = record(root.paths) ?? {}
  const is32 = classifyOpenAPIDialect(root.openapi) === '3.2'
  const fixedMethods = is32 ? OPENAPI_32_FIXED_OPERATION_METHODS : FIXED_OPERATION_METHODS
  const operations: OpenAPIOperationSource[] = []

  for (const path of Object.keys(paths).sort(compareText)) {
    const pathItem = record(paths[path])
    if (!pathItem) continue
    for (const sourceMethod of fixedMethods) {
      const operation = record(pathItem[sourceMethod])
      if (!operation) continue
      const sourcePath = ['paths', path, sourceMethod]
      operations.push({
        path,
        sourceKind: 'fixed',
        sourceMethod,
        wireMethod: sourceMethod.toUpperCase(),
        method: sourceMethod,
        sourcePath,
        sourcePointer: `/${sourcePath.map((part) => escapePointer(String(part))).join('/')}`,
        operationKind: classifyOperationKind('fixed', sourceMethod),
        pathItem,
        operation,
      })
    }
    if (!is32) continue
    const additionalOperations = record(pathItem.additionalOperations)
    for (const sourceMethod of Object.keys(additionalOperations ?? {}).sort(compareText)) {
      const operation = record(additionalOperations?.[sourceMethod])
      if (!operation) continue
      const sourcePath = ['paths', path, 'additionalOperations', sourceMethod]
      operations.push({
        path,
        sourceKind: 'additional',
        sourceMethod,
        wireMethod: sourceMethod,
        method: sourceMethod,
        sourcePath,
        sourcePointer: `/${sourcePath.map((part) => escapePointer(String(part))).join('/')}`,
        operationKind: classifyOperationKind('additional', sourceMethod),
        pathItem,
        operation,
      })
    }
  }

  return operations
}

interface LegacyOperationIdentity {
  operationKind?: OperationKind
  method?: string
  accessor?: { operation?: { method?: string } }
}

function legacyMethod(operation: LegacyOperationIdentity): string | undefined {
  return operation.method ?? operation.accessor?.operation?.method
}

export function isQueryOperation(operation: LegacyOperationIdentity): boolean {
  return operation.operationKind === 'query' || (operation.operationKind === undefined && legacyMethod(operation) === 'get')
}

export function isMutationOperation(operation: LegacyOperationIdentity): boolean {
  return operation.operationKind === 'mutation' || (operation.operationKind === undefined && legacyMethod(operation) !== 'get')
}

export function operationSourcePath(operation: LegacyOperationIdentity & { sourcePath?: Array<string | number>; path: string }): Array<string | number> {
  return operation.sourcePath ?? ['paths', operation.path, legacyMethod(operation) ?? '']
}
