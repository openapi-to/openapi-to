import { createTypeAlias } from '@/templates/operationResponseTemplate.ts'
import { getOperationPathParamsName } from '@/templates/operationTypeNameTemplate.ts'

import { generateParameterType } from '@/utils/generatePropertyType.ts'
import type { InlineEnumSymbolResolver } from '@/utils/inlineEnumNaming.ts'
import { operationSourcePath, type OperationWrapper, type ParameterObjectWithRef } from '@openapi-to/core'
import { isEmpty } from 'lodash-es'

export function buildPathParamsTypes(
  operation: OperationWrapper,
  inlineEnumSymbols?: InlineEnumSymbolResolver,
) {
  const pathParameterName = getOperationPathParamsName(operation.accessor.operationName)

  const pathParameters: ParameterObjectWithRef[] = operation.accessor.pathParameters

  if (isEmpty(pathParameters)) {
    return
  }

  // 构建路径参数的属性类型
  const pathTypes = inlineEnumSymbols
    ? generateParameterType(
        pathParameters,
        operation.accessor.operationName,
        inlineEnumSymbols,
        operationSourcePath(operation),
      )
    : generateParameterType(pathParameters, operation.accessor.operationName)

  return createTypeAlias(pathParameterName, pathTypes, [])
}
