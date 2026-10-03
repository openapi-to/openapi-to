import { isQueryOperation, type OperationWrapper } from '@openapi-to/core'
import { URLPath } from '@openapi-to/core/utils'
import { camelCase } from 'lodash-es'

import { StructureKind, type TypeAliasDeclarationStructure, VariableDeclarationKind, type VariableStatementStructure } from 'ts-morph'
import type { PluginConfig } from '../types.ts'
import { formatterQueryKeyName, formatterQueryKeyTypeName } from '../utils/formatterQueryKey.ts'

export function buildQueryKey(operation: OperationWrapper, pluginConfig?: PluginConfig): VariableStatementStructure {
  const url = isQueryOperation(operation) ? new URLPath(<string>operation.accessor.operation.path).requestPath : `'${operation.path}'`
  const queryKeyName = formatterQueryKeyName(operation)

  const queryParameters = operation.accessor.hasQueryParameters ? `params${operation.accessor.isQueryParametersOptional ? '?' : ''}:${operation.accessor.operationTSType?.queryParams}` : ''
  const querystringParameter = operation.accessor.hasQuerystringParameter ? `querystring${operation.accessor.isQuerystringRequired ? '' : '?'}:${operation.accessor.operationTSType?.querystring}` : ''
  const pathParameters = operation.accessor.parameters
    .filter((x) => x.in === 'path')
    .map((item) => {
      const name = camelCase(item.name)
      const type = `${operation.accessor.operationTSType?.pathParams || ''}['${camelCase(item.name)}']`
      return `${name}:${type}`
    })

  const bodyParameter = operation.sourceMethod === 'query' && operation.accessor.hasRequestBody ? `data${operation.accessor.isRequestBodyRequired ? '' : '?'}:${operation.accessor.operationTSType?.body || 'unknown'}` : ''
  const queryInputs = [
    ...(bodyParameter ? [{ declaration: bodyParameter, optional: !operation.accessor.isRequestBodyRequired }] : []),
    ...(queryParameters ? [{ declaration: queryParameters, optional: operation.accessor.isQueryParametersOptional }] : []),
    ...(querystringParameter ? [{ declaration: querystringParameter, optional: !operation.accessor.isQuerystringRequired }] : []),
  ].sort((left, right) => Number(left.optional) - Number(right.optional))
  const parameters = [...(isQueryOperation(operation) ? pathParameters : []), ...(isQueryOperation(operation) || !operation.accessor.hasQuerystringParameter ? queryInputs.map(({ declaration }) => declaration) : [])].filter(Boolean)
  const initializer = operation.sourceMethod === 'query'
    ? `( ${parameters}) => [{ url:${url}, method: 'QUERY', body: ${operation.accessor.hasRequestBody ? 'data' : 'undefined'}, query: ${operation.accessor.hasQueryParameters ? 'params' : 'undefined'}${operation.accessor.hasQuerystringParameter ? ', querystring' : ''} }] as const`
    : isQueryOperation(operation) && operation.accessor.hasQuerystringParameter
      ? `( ${parameters}) => [{ url:${url}, method: '${operation.method}', querystring }] as const`
      : `( ${parameters}) => [{ url:${url}, method: '${operation.method}'${operation.accessor.hasQueryParameters ? ',...(params ? [params] : [])' : ''} }] as const`

  if (operation.accessor.queryParameters.some((x) => x.name === pluginConfig?.infinite?.pageNumParam)) {
    return {
      kind: StructureKind.VariableStatement,
      declarationKind: VariableDeclarationKind.Const,
      docs: [],
      declarations: [
        {
          name: queryKeyName,
          type: '',
          initializer: `(params?: ${operation.accessor.operationTSType?.queryParams}) => (pageIndex: number, previousPageData:${operation.accessor.operationTSType?.responseSuccess}) => {
  if (previousPageData && !previousPageData.length) return null

  return {
    ...params,
    ${pluginConfig?.infinite?.pageNumParam}: pageIndex + 1,
  } as const
}`,
        },
      ],
      isExported: true,
    }
  }

  return {
    kind: StructureKind.VariableStatement,
    declarationKind: VariableDeclarationKind.Const,
    docs: [],
    declarations: [
      {
        name: queryKeyName,
        type: '',
        initializer,
      },
    ],
    isExported: true,
  }
}

export function buildQueryKeyType(operation: OperationWrapper): TypeAliasDeclarationStructure {
  return {
    kind: StructureKind.TypeAlias,
    name: formatterQueryKeyTypeName(operation),
    isExported: true,
    type: `ReturnType<typeof ${formatterQueryKeyName(operation)}>`,
    docs: [],
  }
}
