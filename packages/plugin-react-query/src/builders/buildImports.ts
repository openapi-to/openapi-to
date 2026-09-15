import type { OperationWrapper } from '@openapi-to/core'
import { formatterModuleSpecifier, getRelativePath } from '@openapi-to/core/utils'
import type { ResolvedPluginConfig } from '../types.ts'

function importStatement(names: string[], moduleSpecifier: string, typeOnly = false): string {
	if (names.length === 0) return ''
	return `import ${typeOnly ? 'type ' : ''}{ ${[...new Set(names)].join(', ')} } from ${JSON.stringify(moduleSpecifier)};`
}

function operationTypeImport(filePath: string, operation: OperationWrapper, config: ResolvedPluginConfig): string {
	const typeMetadata = operation.accessor.operationTSType
	const names = [
		typeMetadata?.pathParams,
		typeMetadata?.queryParams,
		typeMetadata?.body,
		typeMetadata?.responseSuccess,
		typeMetadata?.responseError,
	].filter((name): name is string => Boolean(name))
	const moduleSpecifier = formatterModuleSpecifier(
		getRelativePath(filePath, typeMetadata?.filePath ?? ''),
		config.importWithExtension,
	)
	return importStatement(names, moduleSpecifier, true)
}

function requestImport(filePath: string, operation: OperationWrapper, config: ResolvedPluginConfig): string {
	const request = operation.accessor.operationRequest
	return importStatement(
		request?.requestName ? [request.requestName] : [],
		formatterModuleSpecifier(getRelativePath(filePath, request?.filePath ?? ''), config.importWithExtension),
	)
}

export function buildImports(filePath: string, operation: OperationWrapper, config: ResolvedPluginConfig, hooks: boolean): string {
	const queryRuntime = operation.method === 'get' ? ['queryOptions', ...(hooks ? ['useQuery'] : [])] : ['mutationOptions', ...(hooks ? ['useMutation'] : [])]
	const queryTypes = operation.method === 'get' ? ['UseQueryOptions'] : ['UseMutationOptions']
	const requestConfig = config.requestConfigTypeImportDeclaration
	const responseError = config.responseErrorTypeImportDeclaration
	const requestAndErrorImports = requestConfig.moduleSpecifier === responseError.moduleSpecifier
		? importStatement([...requestConfig.namedImports, ...responseError.namedImports], requestConfig.moduleSpecifier, true)
		: [
			importStatement(requestConfig.namedImports, requestConfig.moduleSpecifier, true),
			importStatement(responseError.namedImports, responseError.moduleSpecifier, true),
		].filter(Boolean).join('\n')

	return [
		importStatement(queryRuntime, '@tanstack/react-query'),
		importStatement(queryTypes, '@tanstack/react-query', true),
		requestAndErrorImports,
		operationTypeImport(filePath, operation, config),
		requestImport(filePath, operation, config),
	].filter(Boolean).join('\n')
}
