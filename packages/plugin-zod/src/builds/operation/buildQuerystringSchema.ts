import type { MediaTypeObject, OperationWrapper } from '@openapi-to/core'
import { requestBodyTemplate } from '@/templates/requestBodyTemplate.ts'
import { getQuerystringTypeName } from '@/templates/operationTypeNameTemplate.ts'
import type { SchemaRenderOptions } from '@/templates/schemaTemplate.ts'

export function buildQuerystringSchema(operation: OperationWrapper, options: SchemaRenderOptions = {}) {
  const parameter = operation.accessor.querystringParameter
  const contentType = operation.accessor.querystringContentType
  if (!parameter || !contentType) return undefined
  const media = parameter.content?.[contentType]
  if (!media) return undefined
  return requestBodyTemplate(getQuerystringTypeName(operation.accessor.operationName), media as MediaTypeObject, options)
}
