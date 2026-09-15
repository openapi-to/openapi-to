import type { OperationWrapper } from '@openapi-to/core'
import { camelCase, kebabCase, upperFirst } from 'lodash-es'

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

function pathParameterNames(operation: OperationWrapper): string[] {
	return operation.accessor.pathParameters.map((parameter) => camelCase(parameter.name))
}

function uniqueName(preferred: string, usedNames: readonly string[]): string {
	const used = new Set(usedNames)
	if (!used.has(preferred)) return preferred
	let candidate = `_${preferred}`
	let suffix = 2
	while (used.has(candidate)) {
		candidate = `_${preferred}${suffix}`
		suffix += 1
	}
	return candidate
}

export function queryParameterName(operation: OperationWrapper): string {
	return uniqueName('params', pathParameterNames(operation))
}

export function queryConfigName(operation: OperationWrapper): string {
	return uniqueName('options', [...pathParameterNames(operation), queryParameterName(operation)])
}

export function querySignalName(operation: OperationWrapper): string {
	return uniqueName('signal', [
		...pathParameterNames(operation),
		...(operation.accessor.hasQueryParameters ? [queryParameterName(operation)] : []),
		queryConfigName(operation),
	])
}

export function mutationQueryVariableName(operation: OperationWrapper): string {
	return uniqueName('params', [...pathParameterNames(operation), ...(operation.accessor.hasRequestBody ? [mutationBodyVariableName(operation)] : [])])
}

export function mutationBodyVariableName(operation: OperationWrapper): string {
	return uniqueName('data', pathParameterNames(operation))
}

export function mutationConfigName(operation: OperationWrapper): string {
	return uniqueName('options', [
		...pathParameterNames(operation),
		...(operation.accessor.hasRequestBody ? [mutationBodyVariableName(operation)] : []),
		...(operation.accessor.hasQueryParameters ? [mutationQueryVariableName(operation)] : []),
	])
}
