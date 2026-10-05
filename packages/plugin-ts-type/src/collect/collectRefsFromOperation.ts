import { collectRefsFromOperationParameter, collectRefsFromOperationRequestBody, collectRefsFromOperationResponse } from '@/collect/collectRefsFromDocument.ts'
import { inspectOpenAPI32QuerystringMedia, operationSourcePath, type OperationWrapper } from '@openapi-to/core'
import { collectRefsFromSchema } from '@/collect/collectRefsFromSchemas.ts'

export function collectRefsFromOperation(operation: OperationWrapper): string[] {
  // 收集响应中的引用

  const oasOperation = operation.accessor.operation
  const querystringEntries = String(oasOperation.api?.openapi).startsWith('3.2.')
    ? inspectOpenAPI32QuerystringMedia(oasOperation, operationSourcePath(operation))
    : []
  const querystringSupported = querystringEntries.every((entry) => entry.semantics && !entry.semantics.hasItemSchema)
  const querystringRefs = querystringSupported
    ? querystringEntries.flatMap((entry) => entry.mediaObject?.schema === undefined ? [] : collectRefsFromSchema(entry.mediaObject.schema as Parameters<typeof collectRefsFromSchema>[0]))
    : []

  return [
    ...new Set([
      ...collectRefsFromOperationParameter(operation.accessor.parameters.filter((parameter) => parameter.in !== 'querystring')),
      ...querystringRefs,
      ...collectRefsFromOperationRequestBody(oasOperation),
      ...collectRefsFromOperationResponse(oasOperation),
    ]),
  ]
}
