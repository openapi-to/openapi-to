import { createTypeAlias } from '@/templates/operationResponseTemplate.ts'
import { getQueryParamsTypeName } from '@/templates/operationTypeNameTemplate.ts'

import { generateParameterType } from '@/utils/generatePropertyType.ts'
import type { InlineEnumSymbolResolver } from '@/utils/inlineEnumNaming.ts'

import { operationSourcePath, type OperationWrapper, type ParameterObjectWithRef } from '@openapi-to/core'

export function buildQueryParamsTypes(
  operation: OperationWrapper,
  inlineEnumSymbols?: InlineEnumSymbolResolver,
) {
  const queryParamsName = getQueryParamsTypeName(operation.accessor.operationName)

  const queryParameters: ParameterObjectWithRef[] = operation.accessor.queryParameters

  if (queryParameters.length === 0) {
    return
  }

  const queryTypes = inlineEnumSymbols
    ? generateParameterType(
        queryParameters,
        operation.accessor.operationName,
        inlineEnumSymbols,
        operationSourcePath(operation),
      )
    : generateParameterType(queryParameters, operation.accessor.operationName)

  return createTypeAlias(queryParamsName, queryTypes, [])
}
