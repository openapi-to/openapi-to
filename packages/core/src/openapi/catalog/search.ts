import { DEFAULT_OPERATION_SEARCH_LIMIT, MAX_OPERATION_SEARCH_LIMIT } from './limits.ts'
import type { OperationCatalog, OperationCatalogItem, OperationCatalogSearchResponse, OperationSearchOptions, OperationSearchResult } from './types.ts'

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').trim()
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function tokens(value: string): string[] {
  const separated = value
    .normalize('NFKC')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-./{}:[\](),]+/g, ' ')
  return [...new Set(separated.split(/\s+/u).map(normalize).filter(Boolean))]
}

interface SearchField {
  reason: string
  weight: number
  values: string[]
}

function fields(item: OperationCatalogItem): SearchField[] {
  return [
    { reason: 'operationKey matched', weight: 90, values: [item.operationKey] },
    { reason: 'operationId matched', weight: 100, values: item.operationId ? [item.operationId] : [] },
    { reason: 'method matched', weight: 30, values: [item.method] },
    { reason: 'path matched', weight: 70, values: [item.path] },
    { reason: 'tag matched', weight: 60, values: item.tags },
    { reason: 'schema matched', weight: 50, values: [...item.requestSchemaNames, ...item.responseSchemaNames, ...item.responsePropertyNames] },
    { reason: 'parameter matched', weight: 45, values: item.parameterNames },
    { reason: 'summary matched', weight: 40, values: item.summary ? [item.summary] : [] },
    { reason: 'description matched', weight: 20, values: item.description ? [item.description] : [] },
  ]
}

function scoreItem(item: OperationCatalogItem, query: string): OperationSearchResult | undefined {
  const normalizedQuery = normalize(query)
  const queryTokens = tokens(query)
  if (!normalizedQuery || queryTokens.length === 0) return undefined
  const itemFields = fields(item).map((field) => ({ ...field, values: field.values.map(normalize), tokenValues: field.values.flatMap(tokens) }))
  const reasons = new Set<string>()
  let score = 0
  if (normalize(item.operationId ?? '') === normalizedQuery) {
    score += 1_000
    reasons.add('operationId exact match')
  }
  if (normalize(item.operationKey) === normalizedQuery) {
    score += 950
    reasons.add('operationKey exact match')
  }
  if (normalize(`${item.method} ${item.path}`) === normalizedQuery) {
    score += 800
    reasons.add('method and path exact match')
  }
  if (normalize(item.path) === normalizedQuery) {
    reasons.add('path exact match')
  }
  for (const token of queryTokens) {
    let tokenScore = 0
    let tokenReason: string | undefined
    for (const field of itemFields) {
      const exact = field.values.some((value) => value === token) || field.tokenValues.some((value) => value === token)
      const partial = field.values.some((value) => value.includes(token))
      const candidate = exact ? field.weight : partial ? Math.floor(field.weight * 0.7) : 0
      if (candidate > tokenScore) {
        tokenScore = candidate
        tokenReason = field.reason
      }
    }
    if (tokenScore === 0) return undefined
    score += tokenScore
    if (tokenReason) reasons.add(tokenReason)
  }
  if (item.deprecated) score -= 10
  return { item, score, matchReasons: [...reasons] }
}

export function searchOperationCatalog(catalog: OperationCatalog, query: string, options: OperationSearchOptions = {}): OperationSearchResult[] {
  return searchOperationCatalogWithMetadata(catalog, query, options).items
}

export function searchOperationCatalogWithMetadata(catalog: OperationCatalog, query: string, options: OperationSearchOptions = {}): OperationCatalogSearchResponse {
  const methods = new Set((options.methods ?? []).map((method) => method.toUpperCase()))
  const tags = new Set((options.tags ?? []).map(normalize))
  const limit = Math.min(MAX_OPERATION_SEARCH_LIMIT, Math.max(0, Math.floor(options.limit ?? DEFAULT_OPERATION_SEARCH_LIMIT)))
  const matches = catalog.items
    .filter((item) => options.includeDeprecated === true || !item.deprecated)
    .filter((item) => methods.size === 0 || methods.has(item.method))
    .filter((item) => tags.size === 0 || item.tags.some((tag) => tags.has(normalize(tag))))
    .map((item) => scoreItem(item, query))
    .filter((result): result is OperationSearchResult => result !== undefined)
    .sort((left, right) => right.score - left.score || compareText(left.item.operationKey, right.item.operationKey) || compareText(left.item.sourcePointer, right.item.sourcePointer))
  return { totalMatches: matches.length, items: matches.slice(0, limit), truncated: matches.length > limit }
}
