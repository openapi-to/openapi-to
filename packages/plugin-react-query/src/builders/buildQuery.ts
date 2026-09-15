import type { OperationWrapper } from '@openapi-to/core'
import { camelCase } from 'lodash-es'
import {
	queryConfigTypeName,
	queryHookName,
	queryKeyName,
	queryKeyTypeName,
	queryOptionsName,
} from './names.ts'
import type { ResolvedPluginConfig } from '../types.ts'

function typeName(value: string | undefined, fallback: string): string {
	return value ?? fallback
}

function pathParameters(operation: OperationWrapper): string[] {
	return operation.accessor.pathParameters.map((parameter) => camelCase(parameter.name))
}

function pathParameterType(operation: OperationWrapper, name: string): string {
	return `${typeName(operation.accessor.operationTSType?.pathParams, 'Record<string, never>')}['${name}']`
}

function queryType(operation: OperationWrapper): string {
	return typeName(operation.accessor.operationTSType?.queryParams, 'Record<string, never>')
}

function queryArguments(operation: OperationWrapper): string[] {
	return [
		...pathParameters(operation),
		...(operation.accessor.hasQueryParameters ? ['params'] : []),
	]
}

function queryParameterDeclaration(operation: OperationWrapper): string {
	if (!operation.accessor.hasQueryParameters) return ''
	return `params${operation.accessor.isQueryParametersOptional ? '?' : ''}: ${queryType(operation)}`
}

function queryKeyDeclaration(operation: OperationWrapper, targetIdentity: string): string {
	const declarations = pathParameters(operation).map((name) => `${name}: ${pathParameterType(operation, name)}`)
	const query = queryParameterDeclaration(operation)
	if (query) declarations.push(query)
	const pathIdentity = pathParameters(operation).length > 0
		? `{ ${pathParameters(operation).map((name) => `${JSON.stringify(name)}: ${name}`).join(', ')} }`
		: '{}'
	return `export const ${queryKeyName(operation)} = (${declarations.join(', ')}) => [{ target: ${JSON.stringify(targetIdentity)}, operation: ${JSON.stringify(operation.accessor.operationId)}, path: ${pathIdentity}, query: ${operation.accessor.hasQueryParameters ? 'params' : 'undefined'} }] as const;\n\nexport type ${queryKeyTypeName(operation)} = ReturnType<typeof ${queryKeyName(operation)}>;`
}

export function buildQuery(operation: OperationWrapper, config: ResolvedPluginConfig, targetIdentity: string): string {
	const response = typeName(operation.accessor.operationTSType?.responseSuccess, 'unknown')
	const responseError = typeName(operation.accessor.operationTSType?.responseError, 'unknown')
	const requestConfigType = config.requestConfigTypeImportDeclaration.namedImports[0] ?? 'unknown'
	const errorType = config.responseErrorTypeImportDeclaration.namedImports[0] ?? 'Error'
	const key = queryKeyName(operation)
	const keyType = queryKeyTypeName(operation)
	const configType = queryConfigTypeName(operation)
	const options = queryOptionsName(operation)
	const hook = queryHookName(operation)
	const args = queryArguments(operation)
	const callArguments = [...args, `{ ...options?.requestConfig, signal }`]
	const functionParameters = [
		...pathParameters(operation).map((name) => `${name}: ${pathParameterType(operation, name)}`),
		queryParameterDeclaration(operation),
		`options?: ${configType}<TData>`,
	].filter(Boolean)
	const optionsCallArguments = [...args, 'options']
	const queryCall = `${operation.accessor.operationRequest?.requestName}(${callArguments.join(', ')})`
	const queryConfig = `export type ${configType}<TData = ${response}> = {\n  requestConfig?: Partial<${requestConfigType}>;\n  query?: Omit<UseQueryOptions<${response}, ${errorType}<${responseError}>, TData, ${keyType}>, 'queryKey' | 'queryFn'>;\n};`
	const optionsFactory = `export const ${options} = <TData = ${response}>(${functionParameters.join(', ')}) => queryOptions({\n  ...options?.query,\n  queryKey: ${key}(${args.join(', ')}),\n  queryFn: ({ signal }) => ${queryCall},\n});`
	const hookWrapper = config.hooks
		? `\n\nexport const ${hook} = <TData = ${response}>(${functionParameters.join(', ')}) => useQuery(${options}(${optionsCallArguments.join(', ')}));`
		: ''
	return `${queryKeyDeclaration(operation, targetIdentity)}\n\n${queryConfig}\n\n${optionsFactory}${hookWrapper}`
}
