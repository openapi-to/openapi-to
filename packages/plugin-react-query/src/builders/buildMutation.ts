import type { OperationWrapper } from '@openapi-to/core'
import { camelCase } from 'lodash-es'
import {
	mutationConfigTypeName,
	mutationHookName,
	mutationKeyName,
	mutationKeyTypeName,
	mutationOptionsName,
	variablesTypeName,
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

function variableProperties(operation: OperationWrapper): string[] {
	const properties = pathParameters(operation).map((name) => `${name}: ${pathParameterType(operation, name)}`)
	if (operation.accessor.hasRequestBody) properties.push(`data: ${typeName(operation.accessor.operationTSType?.body, 'unknown')}`)
	if (operation.accessor.hasQueryParameters) properties.push(`params${operation.accessor.isQueryParametersOptional ? '?' : ''}: ${queryType(operation)}`)
	return properties
}

export function buildMutation(operation: OperationWrapper, config: ResolvedPluginConfig, targetIdentity: string): string {
	const response = typeName(operation.accessor.operationTSType?.responseSuccess, 'unknown')
	const responseError = typeName(operation.accessor.operationTSType?.responseError, 'unknown')
	const requestConfigType = config.requestConfigTypeImportDeclaration.namedImports[0] ?? 'unknown'
	const errorType = config.responseErrorTypeImportDeclaration.namedImports[0] ?? 'Error'
	const key = mutationKeyName(operation)
	const keyType = mutationKeyTypeName(operation)
	const variables = variablesTypeName(operation)
	const configType = mutationConfigTypeName(operation)
	const options = mutationOptionsName(operation)
	const hook = mutationHookName(operation)
	const variableNames = [...pathParameters(operation), ...(operation.accessor.hasRequestBody ? ['data'] : []), ...(operation.accessor.hasQueryParameters ? ['params'] : [])]
	const requestArguments = [...variableNames, 'options?.requestConfig']
	const properties = variableProperties(operation)
	const mutationConfig = `export type ${configType} = {\n  requestConfig?: Partial<${requestConfigType}>;\n  mutation?: Omit<UseMutationOptions<${response}, ${errorType}<${responseError}>, ${variables}>, 'mutationKey' | 'mutationFn'>;\n};`
	const keyFactory = `export const ${key} = () => [{ target: ${JSON.stringify(targetIdentity)}, operation: ${JSON.stringify(operation.accessor.operationId)} }] as const;\n\nexport type ${keyType} = ReturnType<typeof ${key}>;`
	const variablesType = `export type ${variables} = {\n${properties.map((property) => `  ${property};`).join('\n')}\n};`
	const optionsFactory = `export const ${options} = (options?: ${configType}) => mutationOptions({\n  ...options?.mutation,\n  mutationKey: ${key}(),\n  mutationFn: (${properties.length > 0 ? `{ ${variableNames.join(', ')} }` : '()'}) => ${operation.accessor.operationRequest?.requestName}(${requestArguments.join(', ')}),\n});`
	const hookWrapper = config.hooks ? `\n\nexport const ${hook} = (options?: ${configType}) => useMutation(${options}(options));` : ''
	return `${keyFactory}\n\n${variablesType}\n\n${mutationConfig}\n\n${optionsFactory}${hookWrapper}`
}
