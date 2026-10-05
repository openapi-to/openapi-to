import { inspectOpenAPI32QuerystringMedia, operationSourcePath, type MediaTypeObject, type OperationWrapper } from '@openapi-to/core'
import { createVariable, requestBodyTemplate } from '@/templates/requestBodyTemplate.ts'
import { getQuerystringTypeName } from '@/templates/operationTypeNameTemplate.ts'
import type { SchemaRenderOptions } from '@/templates/schemaTemplate.ts'

export function buildQuerystringSchema(operation: OperationWrapper, options: SchemaRenderOptions = {}) {
  const parameter = operation.accessor.querystringParameter
  const contentType = operation.accessor.querystringContentType
  if (!parameter || !contentType) return undefined
  const media = parameter.content?.[contentType]
  if (!media) return undefined
  let resolvedMedia: MediaTypeObject = media as MediaTypeObject
  if (String(operation.accessor.operation.api?.openapi).startsWith('3.2.')) {
    const entries = inspectOpenAPI32QuerystringMedia(operation.accessor.operation, operationSourcePath(operation))
    if (entries.some((entry) => !entry.semantics || entry.semantics.hasItemSchema)) {
      return createVariable(getQuerystringTypeName(operation.accessor.operationName), 'z.never()', [])
    }
    resolvedMedia = entries.find((entry) => entry.mediaType === contentType)?.mediaObject as MediaTypeObject | undefined ?? resolvedMedia
  }
  return requestBodyTemplate(getQuerystringTypeName(operation.accessor.operationName), resolvedMedia, options)
}
