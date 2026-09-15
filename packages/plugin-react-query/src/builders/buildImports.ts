import path from 'node:path'
import type { OperationWrapper } from '@openapi-to/core'
import { formatterModuleSpecifier, getRelativePath } from '@openapi-to/core/utils'
import { kebabCase } from 'lodash-es'
import type { ResolvedPluginConfig } from '../types.ts'

function importStatement(names: string[], moduleSpecifier: string, typeOnly = false): string {
	if (names.length === 0) return ''
	return `import ${typeOnly ? 'type ' : ''}{ ${[...new Set(names)].join(', ')} } from ${JSON.stringify(moduleSpecifier)};`
}

function operationArtifactPath(
	filePath: string,
	metadataPath: string | undefined,
	operation: OperationWrapper,
	suffix: 'types' | 'service',
	outputDir: string,
): string {
	const expectedName = `${kebabCase(operation.accessor.operationName)}.${suffix}.ts`
	if (metadataPath && path.basename(metadataPath) !== expectedName) return metadataPath
	if (metadataPath?.startsWith(`${outputDir}${path.sep}`)) {
		return path.join(path.dirname(filePath), expectedName)
	}
	return metadataPath ?? path.join(path.dirname(filePath), expectedName)
}

function operationTypeImport(filePath: string, operation: OperationWrapper, config: ResolvedPluginConfig, outputDir: string): string {
	const typeMetadata = operation.accessor.operationTSType
	const names = [
		typeMetadata?.pathParams,
		typeMetadata?.queryParams,
		typeMetadata?.body,
		typeMetadata?.responseSuccess,
		typeMetadata?.responseError,
	].filter((name): name is string => Boolean(name))
	const moduleSpecifier = formatterModuleSpecifier(
		getRelativePath(filePath, operationArtifactPath(filePath, typeMetadata?.filePath, operation, 'types', outputDir)),
		config.importWithExtension,
	)
	return importStatement(names, moduleSpecifier, true)
}

function requestImport(filePath: string, operation: OperationWrapper, config: ResolvedPluginConfig, outputDir: string): string {
	const request = operation.accessor.operationRequest
	return importStatement(
		request?.requestName ? [request.requestName] : [],
		formatterModuleSpecifier(getRelativePath(filePath, operationArtifactPath(filePath, request?.filePath, operation, 'service', outputDir)), config.importWithExtension),
	)
}

export function buildImports(filePath: string, operation: OperationWrapper, config: ResolvedPluginConfig, hooks: boolean, outputDir: string): string {
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
		operationTypeImport(filePath, operation, config, outputDir),
		requestImport(filePath, operation, config, outputDir),
	].filter(Boolean).join('\n')
}
