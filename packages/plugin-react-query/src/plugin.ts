import path from 'node:path'
import type { OperationWrapper } from '@openapi-to/core'
import { createPlugin, pluginEnum } from '@openapi-to/core'
import { camelCase, kebabCase } from 'lodash-es'
import { Project } from 'ts-morph'
import { buildImports } from './builders/buildImports.ts'
import { buildMutation } from './builders/buildMutation.ts'
import { buildQuery } from './builders/buildQuery.ts'
import {
	mutationConfigName,
	mutationHookName,
	mutationKeyName,
	mutationOptionsName,
	mutationQueryVariableName,
	operationFileName,
	queryConfigName,
	queryHookName,
	queryKeyName,
	queryOptionsName,
	queryParameterName,
	querySignalName,
} from './builders/names.ts'
import type { PluginConfig, ResolvedPluginConfig } from './types.ts'

const supportedMethods = new Set(['get', 'post', 'put', 'patch', 'delete'])
const operationNameCollisionStoreKey = 'openapi-to:react-query:operation-name-collisions'
const reservedBindingNames = new Set([
	'arguments', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
	'do', 'else', 'enum', 'eval', 'export', 'extends', 'finally', 'for', 'function', 'if', 'implements', 'import',
	'interface', 'in', 'instanceof', 'let', 'new', 'null', 'package', 'private', 'protected', 'public', 'return',
	'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
	'false',
])
const prototypeSensitiveNames = new Set(['__proto__'])

function resolveConfig(config?: PluginConfig): ResolvedPluginConfig {
	return {
		hooks: config?.hooks ?? true,
		importWithExtension: config?.importWithExtension ?? true,
		requestConfigTypeImportDeclaration: config?.requestConfigTypeImportDeclaration ?? {
			namedImports: ['AxiosRequestConfig'],
			moduleSpecifier: 'axios',
		},
		responseErrorTypeImportDeclaration: config?.responseErrorTypeImportDeclaration ?? {
			namedImports: ['AxiosError'],
			moduleSpecifier: 'axios',
		},
	}
}

function diagnostic(operation: OperationWrapper, code: string, message: string) {
	return {
		code,
		severity: 'error' as const,
		message,
		location: { path: ['paths', operation.path, operation.method] },
		plugin: pluginEnum.ReactQuery,
	}
}

function metadataAvailable(operation: OperationWrapper): boolean {
	return Boolean(
		operation.accessor.operationTSType?.filePath &&
		operation.accessor.operationRequest?.filePath &&
		operation.accessor.operationRequest?.requestName,
	)
}

function isValidIdentifier(value: string): boolean {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)
}

function hasRequestParameterCollision(operation: OperationWrapper, hooks: boolean): boolean {
	const rawPathNames = operation.accessor.parametersByLocation('path').map((parameter) => parameter.name)
	const pathNames = operation.accessor.pathParameters.map((parameter) => camelCase(parameter.name))
	const uniquePathNames = new Set(pathNames)
	const generatedRuntimeNames = operation.method === 'get'
		? [queryKeyName(operation), queryOptionsName(operation), queryHookName(operation), queryParameterName(operation), queryConfigName(operation), querySignalName(operation)]
		: [mutationKeyName(operation), mutationOptionsName(operation), mutationHookName(operation), mutationQueryVariableName(operation), mutationConfigName(operation)]
	const importedRuntimeNames = operation.method === 'get'
		? ['queryOptions', ...(hooks ? ['useQuery'] : [])]
		: ['mutationOptions', ...(hooks ? ['useMutation'] : [])]
	const requestName = operation.accessor.operationRequest?.requestName
	return uniquePathNames.size !== pathNames.length ||
		pathNames.some((name) => !isValidIdentifier(name) || ['request', 'res', 'requestConfig'].includes(name)) ||
		(operation.accessor.hasRequestBody && pathNames.includes('data')) ||
		(operation.accessor.hasQueryParameters && pathNames.includes('params')) ||
		(operation.accessor.operation.getContentType() === 'multipart/form-data' && pathNames.includes('formData')) ||
		rawPathNames.some((name) => prototypeSensitiveNames.has(name)) ||
		pathNames.some((name) => prototypeSensitiveNames.has(name) || reservedBindingNames.has(name) || generatedRuntimeNames.includes(name) || importedRuntimeNames.includes(name) || name === requestName)
}

function operationNameCollisionKey(operation: OperationWrapper): string {
	return `${operation.tagName}\0${operation.accessor.operationName}`
}

export const definePlugin = createPlugin<PluginConfig>((pluginConfig) => {
	const config = resolveConfig(pluginConfig)
	return {
		name: pluginEnum.ReactQuery,
		dependencies: [pluginEnum.TsType, pluginEnum.Request],
		hooks: {
			buildStart: (ctx) => {
				const counts = new Map<string, number>()
				for (const operations of Object.values(ctx.openapiHelper.operationsByTag)) {
					for (const operation of operations) {
						const key = operationNameCollisionKey(operation)
						counts.set(key, (counts.get(key) ?? 0) + 1)
					}
				}
				ctx.store.set(
					operationNameCollisionStoreKey,
					new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key)),
				)
			},
			operation: (operation, ctx) => {
				if (!operation.accessor.operationId) {
					ctx.addDiagnostic(diagnostic(operation, 'REACT_QUERY_OPERATION_ID_MISSING', 'React Query generation requires every operation to have an operationId.'))
					return
				}
				if (!isValidIdentifier(operation.accessor.operationName)) {
					ctx.addDiagnostic(diagnostic(operation, 'REACT_QUERY_OPERATION_NAME_INVALID', 'React Query generation requires operationId to normalize to a valid TypeScript identifier.'))
					return
				}
				if (!supportedMethods.has(operation.method)) {
					ctx.addDiagnostic(diagnostic(operation, 'REACT_QUERY_UNSUPPORTED_METHOD', `React Query generation does not support HTTP method ${operation.method.toUpperCase()}.`))
					return
				}
				const operationNameCollisions = ctx.store.get(operationNameCollisionStoreKey) as Set<string> | undefined
				if (operationNameCollisions?.has(operationNameCollisionKey(operation))) {
					ctx.addDiagnostic(diagnostic(operation, 'REACT_QUERY_OPERATION_NAME_COLLISION', 'React Query generation requires unique operation names within each tag after normalization.'))
					return
				}
				if (hasRequestParameterCollision(operation, config.hooks)) {
					ctx.addDiagnostic(diagnostic(operation, 'REACT_QUERY_NORMALIZED_PARAMETER_COLLISION', 'React Query generation cannot represent normalized path parameter names that collide with each other or the Request plugin signature.'))
					return
				}
				if (!metadataAvailable(operation)) {
					ctx.addDiagnostic(diagnostic(operation, 'REACT_QUERY_METADATA_MISSING', 'React Query generation requires TsType and Request operation metadata.'))
					return
				}
				const kind = operation.method === 'get' ? 'query' : 'mutation'
				const filePath = path.join(ctx.openapiToSingleConfig.output.dir, kebabCase(operation.tagName), operationFileName(operation, kind))
				const project = new Project()
				const sourceFile = project.createSourceFile(filePath, '', { overwrite: true })
				const targetIdentity = ctx.openapiToSingleConfig.name ?? 'default'
				const source = kind === 'query' ? buildQuery(operation, config, targetIdentity) : buildMutation(operation, config, targetIdentity)
				sourceFile.addStatements(`${buildImports(filePath, operation, config, config.hooks, ctx.openapiToSingleConfig.output.dir)}\n\n${source}`)
				ctx.addArtifact({ kind: 'typescript', path: filePath, sourceFile, plugin: pluginEnum.ReactQuery })
			},
		},
	}
})
