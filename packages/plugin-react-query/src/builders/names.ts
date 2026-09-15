import type { OperationWrapper } from '@openapi-to/core'
import { kebabCase, upperFirst } from 'lodash-es'

export function operationBaseName(operation: OperationWrapper): string {
	return operation.accessor.operationName
}

export function operationFileName(operation: OperationWrapper, kind: 'query' | 'mutation'): string {
	return `${kebabCase(operationBaseName(operation))}.${kind}.ts`
}

export function queryKeyName(operation: OperationWrapper): string {
	return `${operationBaseName(operation)}QueryKey`
}

export function queryKeyTypeName(operation: OperationWrapper): string {
	return `${upperFirst(operationBaseName(operation))}QueryKey`
}

export function queryOptionsName(operation: OperationWrapper): string {
	return `${operationBaseName(operation)}QueryOptions`
}

export function queryConfigTypeName(operation: OperationWrapper): string {
	return `${upperFirst(operationBaseName(operation))}QueryConfig`
}

export function queryHookName(operation: OperationWrapper): string {
	return `use${upperFirst(operationBaseName(operation))}Query`
}

export function mutationKeyName(operation: OperationWrapper): string {
	return `${operationBaseName(operation)}MutationKey`
}

export function mutationKeyTypeName(operation: OperationWrapper): string {
	return `${upperFirst(operationBaseName(operation))}MutationKey`
}

export function mutationOptionsName(operation: OperationWrapper): string {
	return `${operationBaseName(operation)}MutationOptions`
}

export function mutationConfigTypeName(operation: OperationWrapper): string {
	return `${upperFirst(operationBaseName(operation))}MutationConfig`
}

export function variablesTypeName(operation: OperationWrapper): string {
	return `${upperFirst(operationBaseName(operation))}Variables`
}

export function mutationHookName(operation: OperationWrapper): string {
	return `use${upperFirst(operationBaseName(operation))}Mutation`
}
