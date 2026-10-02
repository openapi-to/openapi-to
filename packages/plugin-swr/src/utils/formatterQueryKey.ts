import { isQueryOperation, type OperationWrapper } from '@openapi-to/core'
import { upperFirst } from 'lodash-es'

export const formatterQueryKeyTypeName = (operation: OperationWrapper) =>
  `${upperFirst(operation.accessor.operationName)}${isQueryOperation(operation) ? 'Query' : 'Mutation'}Key`

export const formatterQueryKeyName = (operation: OperationWrapper) =>
  `${operation.accessor.operationName}${isQueryOperation(operation) ? 'Query' : 'Mutation'}Key`

//
