import { type MediaTypeObject, type OperationWrapper, operationSourcePath } from '@openapi-to/core'
import { requestBodyTemplate } from '@/templates/requestBodyTemplate.ts'
import { getQuerystringTypeName } from '@/templates/operationTypeNameTemplate.ts'
import type { InlineEnumSymbolResolver } from '@/utils/inlineEnumNaming.ts'

export function buildQuerystringType(operation: OperationWrapper, inlineEnumSymbols?: InlineEnumSymbolResolver) {
  const parameter = operation.accessor.querystringParameter
  const contentType = operation.accessor.querystringContentType
  if (!parameter || !contentType) return undefined
  const media = parameter.content?.[contentType]
  if (!media) return undefined
  return requestBodyTemplate(
    getQuerystringTypeName(operation.accessor.operationName),
    media as MediaTypeObject,
    inlineEnumSymbols,
    [...operationSourcePath(operation), 'parameters', contentType, 'schema'],
  )
}
