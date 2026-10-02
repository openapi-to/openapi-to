import type { Diagnostic } from '../../diagnostics.ts'
import type { OperationKind, OperationSourceKind } from '../operations.ts'

export interface OperationCatalogItem {
  target?: string
  operationKey: string
  operationId?: string
  method: string
  wireMethod: string
  sourceKind: OperationSourceKind
  sourceMethod: string
  sourcePath: Array<string | number>
  operationKind: OperationKind
  path: string
  tags: string[]
  summary?: string
  description?: string
  parameterNames: string[]
  requestSchemaNames: string[]
  responseSchemaNames: string[]
  responsePropertyNames: string[]
  deprecated: boolean
  sourcePointer: string
}

export interface OperationCatalog {
  target?: string
  items: OperationCatalogItem[]
  diagnostics: Diagnostic[]
}

export interface OperationSearchOptions {
  limit?: number
  methods?: string[]
  tags?: string[]
  includeDeprecated?: boolean
}

export interface OperationSearchResult {
  item: OperationCatalogItem
  score: number
  matchReasons: string[]
}

export interface OperationCatalogSearchResponse {
  totalMatches: number
  items: OperationSearchResult[]
  truncated: boolean
}

export type OperationDetailLevel = 'summary' | 'contract'

export interface OperationSchemaSummary {
  name?: string
  ref?: string
  type?: string | string[]
  format?: string
  description?: string
  nullable?: boolean
  required?: string[]
  enum?: unknown[]
  properties?: Array<{ name: string; required: boolean; schema: OperationSchemaSummary }>
  items?: OperationSchemaSummary
  allOf?: OperationSchemaSummary[]
  oneOf?: OperationSchemaSummary[]
  anyOf?: OperationSchemaSummary[]
  additionalProperties?: boolean | OperationSchemaSummary
  discriminator?: { propertyName?: string; mapping?: Record<string, string> }
  example?: unknown
  circular?: boolean
}

export interface OperationParameterContract {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required: boolean
  description?: string
  schema?: OperationSchemaSummary
  example?: unknown
}

export interface OperationContentContract {
  contentType: string
  schema?: OperationSchemaSummary
  example?: unknown
}

export interface OperationResponseContract {
  status: string
  description?: string
  success: boolean
  content: OperationContentContract[]
}

export interface OperationContract {
  operationKey: string
  operationId?: string
  method: string
  path: string
  tags: string[]
  summary?: string
  description?: string
  deprecated: boolean
  requestSchemaNames: string[]
  responseSchemaNames: string[]
  parameters?: {
    path: OperationParameterContract[]
    query: OperationParameterContract[]
    header: OperationParameterContract[]
    cookie: OperationParameterContract[]
  }
  requestBody?: { required: boolean; content: OperationContentContract[] }
  responses?: OperationResponseContract[]
  securityRequirements?: Array<Record<string, string[]>>
  schemas?: OperationSchemaSummary[]
}

export interface GetOperationContractOptions {
  detail?: OperationDetailLevel
  schemaDepth?: number
  maxSchemas?: number
  maxPropertiesPerSchema?: number
  includeExamples?: boolean
  maxBytes?: number
}

export interface OperationContractResult {
  target?: string
  found: boolean
  detail: OperationDetailLevel
  operation?: OperationContract
  diagnostics: Diagnostic[]
  truncated: boolean
  truncationReasons: string[]
  unresolvedSchemaRefs: string[]
  byteLength: number
}
