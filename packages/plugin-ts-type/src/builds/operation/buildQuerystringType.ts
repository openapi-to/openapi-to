import { inspectOpenAPI32QuerystringMedia, type MediaTypeObject, type OperationWrapper, operationSourcePath } from '@openapi-to/core'
import { requestBodyTemplate } from '@/templates/requestBodyTemplate.ts'
import { getQuerystringTypeName } from '@/templates/operationTypeNameTemplate.ts'
import type { InlineEnumSymbolResolver } from '@/utils/inlineEnumNaming.ts'
import { StructureKind, type InterfaceDeclarationStructure, type TypeAliasDeclarationStructure } from 'ts-morph'

export function buildQuerystringType(operation: OperationWrapper, inlineEnumSymbols?: InlineEnumSymbolResolver): InterfaceDeclarationStructure | TypeAliasDeclarationStructure | undefined {
  const parameter = operation.accessor.querystringParameter
  const contentType = operation.accessor.querystringContentType
  if (!parameter || !contentType) return undefined
  const media = parameter.content?.[contentType]
  if (!media) return undefined
  let resolvedMedia: MediaTypeObject = media as MediaTypeObject
  if (String(operation.accessor.operation.api?.openapi).startsWith('3.2.')) {
    const entries = inspectOpenAPI32QuerystringMedia(operation.accessor.operation, operationSourcePath(operation))
    if (entries.some((entry) => !entry.semantics || entry.semantics.hasItemSchema)) {
      return { kind: StructureKind.TypeAlias, name: getQuerystringTypeName(operation.accessor.operationName), type: 'never', isExported: true }
    }
    resolvedMedia = entries.find((entry) => entry.mediaType === contentType)?.mediaObject as MediaTypeObject | undefined ?? resolvedMedia
  }
  return requestBodyTemplate(
    getQuerystringTypeName(operation.accessor.operationName),
    resolvedMedia,
    inlineEnumSymbols,
    [...operationSourcePath(operation), 'parameters', contentType, 'schema'],
  )
}
