import type { Diagnostic } from '../../diagnostics.ts'
import type { CompatibleOpenAPIDocument } from '../../types/index.ts'
import type { OpenAPICompilation } from '../compiler.ts'

export type FullGenerationScope = { type: 'full' }

export type OperationGenerationScope = {
  type: 'operations'
  operationKeys: string[]
}

export type GenerationScope = FullGenerationScope | OperationGenerationScope

export const FULL_GENERATION_SCOPE: FullGenerationScope = Object.freeze({ type: 'full' })

export type OpenAPIComponentGroup =
  | 'schemas'
  | 'mediaTypes'
  | 'parameters'
  | 'requestBodies'
  | 'responses'
  | 'headers'
  | 'securitySchemes'
  | 'callbacks'
  | 'links'
  | 'examples'

export interface OpenAPIReferenceKey {
  group: OpenAPIComponentGroup
  name: string
  ref: string
}

export interface OpenAPIReferenceGraph {
  nodes: string[]
  edges: Record<string, string[]>
  diagnostics: Diagnostic[]
}

export interface OpenAPIProjectionStats {
  operationCount: number
  pathCount: number
  schemaCount: number
  parameterCount: number
  requestBodyCount: number
  responseCount: number
  headerCount: number
  securitySchemeCount: number
  callbackCount: number
  linkCount: number
  exampleCount: number
}

export interface OperationSelectionSummary {
  requestedOperationKeys: string[]
  resolvedOperationKeys: string[]
}

export interface ProjectOpenAPIDocumentResult {
  success: boolean
  document?: CompatibleOpenAPIDocument
  resolvedDocument?: CompatibleOpenAPIDocument
  normalizedDocument?: CompatibleOpenAPIDocument
  selection: OperationSelectionSummary
  referenceGraph: OpenAPIReferenceGraph
  includedComponents: Record<OpenAPIComponentGroup, string[]>
  stats: OpenAPIProjectionStats
  projectionHash?: string
  diagnostics: Diagnostic[]
}

export interface ProjectOpenAPICompilationResult extends ProjectOpenAPIDocumentResult {
  compilation?: OpenAPICompilation
}
