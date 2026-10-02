import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { PluginManager, pluginEnum, type OpenAPIDocument } from '@openapi-to/core'
import { definePlugin as defineRequestPlugin } from '@openapi-to/plugin-ts-request'
import { definePlugin as defineTypePlugin } from '@openapi-to/plugin-ts-type'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import fixture from '../mock/react-query.json'
import { buildImports } from './builders/buildImports.ts'
import { definePlugin } from './plugin.ts'

const GeneratedFunction = ((...parameters: string[]) => {
	const body = parameters.pop() ?? ''
	return new globalThis.Function(...parameters, ts.transpile(body))
}) as unknown as FunctionConstructor

function evaluateInitializer(initializer: string): (...args: unknown[]) => readonly unknown[] {
	return GeneratedFunction(`return (${initializer});`)()
}

function config(name: string, plugin = definePlugin()) {
	return {
		name,
		root: process.cwd(),
		input: { path: 'fixture.json' },
		output: { dir: path.join(process.cwd(), 'test-output', name) },
		plugins: [defineTypePlugin(), defineRequestPlugin(), plugin],
	}
}

function reactArtifacts(result: Awaited<ReturnType<PluginManager['execute']>>) {
	return result.artifacts
		.filter((artifact) => artifact.plugin === pluginEnum.ReactQuery)
		.sort((left, right) => left.path.localeCompare(right.path))
}

function sourceText(result: Awaited<ReturnType<PluginManager['execute']>>, suffix: string) {
	const artifact = reactArtifacts(result).find((item) => item.path.endsWith(suffix))
	if (artifact?.kind !== 'typescript') throw new Error(`Missing React Query artifact ${suffix}`)
	return artifact.sourceFile.getFullText()
}

describe('React Query plugin', () => {
	it('generates QUERY with an optional body and rejects exact custom methods', async () => {
		const document = {
			openapi: '3.2.0', info: { title: 'QUERY', version: '1' },
			paths: { '/search/{scope}': {
				parameters: [{ name: 'scope', in: 'path', required: true, schema: { type: 'string' } }],
				query: {
					operationId: 'querySearch', tags: ['search'],
					parameters: [
						{ name: 'limit', in: 'query', required: true, schema: { type: 'integer' } },
						{ name: 'x-trace', in: 'header', schema: { type: 'string' } },
						{ name: 'session', in: 'cookie', schema: { type: 'string' } },
					],
					requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { term: { type: 'string' } } } } } },
					responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } } },
				},
				additionalOperations: { FoO: { operationId: 'fooSearch', tags: ['search'], responses: { '204': { description: 'ok' } } } },
			} },
		} as unknown as OpenAPIDocument
		const result = await new PluginManager(config('react-query-openapi-32'), document).execute()
		const query = sourceText(result, 'query-search.query.ts')
		const generated = result.sourceFiles.map((sourceFile) => sourceFile.getFullText())
		expect(result.sourceFiles.some((sourceFile) => sourceFile.getFilePath().endsWith('foo-search.types.ts'))).toBe(true)
		expect(result.sourceFiles.some((sourceFile) => sourceFile.getFilePath().endsWith('foo-search.service.ts'))).toBe(true)
		expect(generated.some((source) => source.includes('fooSearchService') && source.includes('method:"FoO"'))).toBe(true)
		expect(query).toContain('method: "QUERY"')
		expect(query).toContain('body: data')
		expect(query).toContain('query: params')
		expect(query).toContain('params: QuerySearchQueryParams, data?: QuerySearchMutationRequest')
		expect(ts.transpileModule(query, { reportDiagnostics: true }).diagnostics).toEqual([])
		expect(query).toContain('querySearchService({ path: { scope }, body: data, query: params, headers: options?.headers, cookies: options?.cookies }')
		const queryArtifact = reactArtifacts(result).find((artifact) => artifact.path.endsWith('query-search.query.ts'))
		if (queryArtifact?.kind !== 'typescript') throw new Error('Missing generated QUERY artifact')
		const initializer = queryArtifact.sourceFile.getVariableDeclaration('querySearchQueryKey')?.getInitializer()?.getText()
		if (!initializer) throw new Error('Missing generated QUERY key initializer')
		const queryKey = evaluateInitializer(initializer)
		const bodyA = queryKey('all', { limit: 10 }, { term: 'A' })
		const bodyB = queryKey('all', { limit: 10 }, { term: 'B' })
		expect(bodyA).not.toEqual(bodyB)
		expect(Object.keys(bodyA[0] as object)).toEqual(['target', 'operation', 'tag', 'method', 'route', 'path', 'body', 'query'])
		expect(bodyA).toEqual([expect.objectContaining({ method: 'QUERY', path: { scope: 'all' }, body: { term: 'A' }, query: { limit: 10 } })])
		expect(result.diagnostics).toContainEqual(expect.objectContaining({
			code: 'REACT_QUERY_UNSUPPORTED_METHOD',
			message: expect.stringContaining('FoO'),
			location: expect.objectContaining({ path: ['paths', '/search/{scope}', 'additionalOperations', 'FoO'] }),
		}))
		expect(reactArtifacts(result).some((artifact) => artifact.path.includes('foo-search'))).toBe(false)
	})

	it('preserves the legacy GET positional API when required options follow optional inputs', async () => {
		const document = {
			openapi: '3.1.0', info: { title: 'GET compatibility', version: '1' },
			paths: { '/legacy': { get: {
				operationId: 'legacyGet', tags: ['legacy'],
				parameters: [
					{ name: 'filter', in: 'query', schema: { type: 'string' } },
					{ name: 'x-required', in: 'header', required: true, schema: { type: 'string' } },
				],
				requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
				responses: { '200': { description: 'ok' } },
			} } },
		} as unknown as OpenAPIDocument
		const result = await new PluginManager(config('react-query-get-compatibility'), document).execute()
		const query = sourceText(result, 'legacy-get.query.ts')
		expect(query).toContain('data: LegacyGetMutationRequest, params: LegacyGetQueryParams | undefined, options: LegacyGetQueryConfig<TData>')
		expect(query).toContain('useQuery(legacyGetQueryOptions(data, params, options))')
	})

	it('runs after TsType and Request and emits operation-local query/mutation artifacts', async () => {
		const manager = new PluginManager(config('react-query-fixture'), fixture as OpenAPIDocument)
		expect(manager.pluginsByStages.map((stage) => stage.map(({ name }) => name))).toEqual([
			[pluginEnum.TsType],
			[pluginEnum.Request],
			[pluginEnum.ReactQuery],
		])

		const result = await manager.execute()
		expect(result.diagnostics).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: 'REACT_QUERY_UNSUPPORTED_METHOD', severity: 'error' }),
			expect.objectContaining({ code: 'REACT_QUERY_NORMALIZED_PARAMETER_COLLISION', severity: 'error' }),
		]))
		expect(reactArtifacts(result).map((artifact) => path.basename(artifact.path))).toEqual([
			'create-pet.mutation.ts',
			'delete-pet.mutation.ts',
			'get-body.query.ts',
			'get-option.query.ts',
			'get-pet-by-id.query.ts',
			'get-signal.query.ts',
			'update-option.mutation.ts',
			'update-pet.mutation.ts',
		])
		expect(reactArtifacts(result).some((artifact) => artifact.path.endsWith('get-reserved.query.ts'))).toBe(false)
		expect(reactArtifacts(result).some((artifact) => artifact.path.endsWith('get-numeric.query.ts'))).toBe(false)
		const query = sourceText(result, 'get-pet-by-id.query.ts')
		expect(query).toContain('getPetByIdQueryKey')
		expect(query).toContain('getPetByIdQueryOptions')
		expect(query).toContain('useGetPetByIdQuery')
		expect(query).toContain('target: "react-query-fixture"')
		expect(query).toContain('tag: "pets", method: "get"')
		expect(query).toContain('getPetByIdService({ path: { petId }, query: params }, { ...options?.requestConfig, signal })')
		expect(query).not.toContain('requestConfig.signal = signal')

		const signalQuery = sourceText(result, 'get-signal.query.ts')
		expect(signalQuery).toContain('queryFn: ({ signal: _signal })')
		expect(signalQuery).toContain('getSignalService({ path: { signal } }, { ...options?.requestConfig, signal: _signal })')

		const bodyQuery = sourceText(result, 'get-body.query.ts')
		expect(bodyQuery).toContain('getBodyQueryOptions = <TData = GetBodyResponse>(data: GetBodyMutationRequest, options?: GetBodyQueryConfig<TData>)')
		expect(bodyQuery).toContain('body: data')
		expect(bodyQuery).toContain('getBodyService({ body: data }, { ...options?.requestConfig, signal })')

		const optionsQuery = sourceText(result, 'get-option.query.ts')
		expect(optionsQuery).toContain('getOptionQueryOptions = <TData = GetOptionResponse>(options: GetOptionPathParams[\'options\'], _options?: GetOptionQueryConfig<TData>)')
		expect(optionsQuery).toContain('..._options?.requestConfig, signal')

		const optionsMutation = sourceText(result, 'update-option.mutation.ts')
		expect(optionsMutation).toContain('export type UpdateOptionVariables')
		expect(optionsMutation).toContain('UseMutationOptions<UpdateOptionMutationResponse, AxiosError<UpdateOptionResponseError>, UpdateOptionVariables>')
		expect(optionsMutation).toContain('updateOptionMutationOptions = (_options?: UpdateOptionMutationConfig)')
		expect(optionsMutation).toContain('mutationFn: ({ options, data }) => updateOptionService({ path: { options }, body: data }, _options?.requestConfig)')
		expect(reactArtifacts(result).some((artifact) => artifact.path.endsWith('get-request.query.ts'))).toBe(false)

		const update = sourceText(result, 'update-pet.mutation.ts')
		expect(update).toContain('export type UpdatePetVariables')
		expect(update).toContain('petId: UpdatePetPathParams[\'petId\'];')
		expect(update).toContain('data: UpdatePetMutationRequest;')
		expect(update).toContain('params?: UpdatePetQueryParams;')
		expect(update).toContain('updatePetService({ path: { petId }, body: data, query: params }, options?.requestConfig)')

		const deletePet = sourceText(result, 'delete-pet.mutation.ts')
		expect(deletePet).toContain('deletePetService({ path: { petId } }, options?.requestConfig)')
	})

	it('keeps options factories when hooks are disabled and follows import-extension configuration', async () => {
		const result = await new PluginManager(
			config('react-query-no-hooks', definePlugin({ hooks: false, importWithExtension: false })),
			fixture as OpenAPIDocument,
		).execute()
		const query = sourceText(result, 'get-pet-by-id.query.ts')
		expect(query).toContain('getPetByIdQueryOptions')
		expect(query).not.toContain('useQuery')
		expect(query).not.toContain('useGetPetByIdQuery')
		expect(query).not.toContain('from "./get-pet-by-id.types.ts"')
		expect(query).toContain('from "./get-pet-by-id.types"')
	})

	it('is byte-stable across fresh managers and keeps target identity in query keys', async () => {
		const first = await new PluginManager(config('service-a'), fixture as OpenAPIDocument).execute()
		const second = await new PluginManager(config('service-a'), fixture as OpenAPIDocument).execute()
		const serialize = (result: Awaited<ReturnType<PluginManager['execute']>>) =>
			reactArtifacts(result).map((artifact) => ({ path: artifact.path, text: artifact.kind === 'typescript' ? artifact.sourceFile.getFullText() : '' }))
		expect(serialize(second)).toEqual(serialize(first))

		const otherTarget = await new PluginManager(config('service-b'), fixture as OpenAPIDocument).execute()
		expect(sourceText(first, 'get-pet-by-id.query.ts')).toContain('target: "service-a"')
		expect(sourceText(otherTarget, 'get-pet-by-id.query.ts')).toContain('target: "service-b"')
	})

	it('keeps imports local for multi-tag operations', async () => {
		const document = structuredClone(fixture) as OpenAPIDocument
		if (!document.paths) throw new Error('Fixture paths are missing.')
		const petPath = document.paths['/pets/{petId}']
		if (!petPath || !('get' in petPath) || !petPath.get) throw new Error('Fixture GET operation is missing.')
		petPath.get.tags = ['pets', 'admin']
		delete document.paths['/health']

		const result = await new PluginManager(config('multi-tag'), document).execute()
		const taggedQueries = reactArtifacts(result).filter((artifact) => artifact.path.endsWith('get-pet-by-id.query.ts'))
		expect(taggedQueries).toHaveLength(2)
		for (const artifact of taggedQueries) {
			if (artifact.kind !== 'typescript') throw new Error('Expected a TypeScript React Query artifact.')
			const source = artifact.sourceFile.getFullText()
			expect(source).toContain('from "./get-pet-by-id.types.ts"')
			expect(source).toContain('from "./get-pet-by-id.service.ts"')
		}
	})

	it('preserves custom dependency metadata paths outside the output directory', () => {
		const operation = {
			method: 'get',
			accessor: {
				operationName: 'ping',
				operationTSType: {
					pathParams: 'PingPathParams',
					responseSuccess: 'PingResponse',
					responseError: 'PingError',
					filePath: '/custom/types/ping.types.ts',
				},
				operationRequest: {
					requestName: 'pingService',
					filePath: '/custom/services/ping.service.ts',
				},
			},
		} as never
		const imports = buildImports(
			'/out/pets/ping.query.ts',
			operation,
			{
				hooks: true,
				importWithExtension: true,
				requestConfigTypeImportDeclaration: { namedImports: ['RequestOptions'], moduleSpecifier: './request.ts' },
				responseErrorTypeImportDeclaration: { namedImports: ['RequestError'], moduleSpecifier: './request.ts' },
			},
			true,
			'/out',
		)
		expect(imports).toContain('custom/types/ping.types.ts')
		expect(imports).toContain('custom/services/ping.service.ts')
	})

	it('reports normalized operation-name collisions before emitting conflicting artifacts', async () => {
		const document = structuredClone(fixture) as OpenAPIDocument
		if (!document.paths) throw new Error('Fixture paths are missing.')
		const original = document.paths['/pets/{petId}']
		if (!original) throw new Error('Fixture pet path is missing.')
		document.paths['/duplicate/{petId}'] = structuredClone(original)

		const result = await new PluginManager(config('operation-name-collision'), document).execute()
		expect(result.diagnostics).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: 'OPERATION_GENERATED_NAME_COLLISION', severity: 'error' }),
		]))
		expect(reactArtifacts(result).some((artifact) => path.basename(artifact.path) === 'get-pet-by-id.query.ts')).toBe(false)
	})

	it('reports path parameters that shadow generated runtime names', async () => {
		const document = structuredClone(fixture) as OpenAPIDocument
		if (!document.paths) throw new Error('Fixture paths are missing.')
		const original = document.paths['/pets/{petId}']
		if (!original || !('get' in original) || !original.get) throw new Error('Fixture GET operation is missing.')
		document.paths['/service-collision/{getServiceCollisionService}'] = {
			get: {
				...structuredClone(original.get),
				operationId: 'getServiceCollision',
				parameters: [
					{ name: 'getServiceCollisionService', in: 'path', required: true, schema: { type: 'string' } },
				],
			},
		}

		const result = await new PluginManager(config('runtime-name-collision'), document).execute()
		expect(result.diagnostics).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: 'REACT_QUERY_NORMALIZED_PARAMETER_COLLISION', severity: 'error' }),
		]))
		expect(reactArtifacts(result).some((artifact) => path.basename(artifact.path) === 'get-service-collision.query.ts')).toBe(false)
	})

	it('reports prototype-sensitive path parameter names before building query keys', async () => {
		const document = structuredClone(fixture) as OpenAPIDocument
		if (!document.paths) throw new Error('Fixture paths are missing.')
		const original = document.paths['/pets/{petId}']
		if (!original || !('get' in original) || !original.get) throw new Error('Fixture GET operation is missing.')
		document.paths['/prototype/{__proto__}'] = {
			get: {
				...structuredClone(original.get),
				operationId: 'getPrototypeKey',
				parameters: [{ name: '__proto__', in: 'path', required: true, schema: { type: 'string' } }],
			},
		}

		const result = await new PluginManager(config('prototype-sensitive-collision'), document).execute()
		expect(result.diagnostics).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: 'REACT_QUERY_NORMALIZED_PARAMETER_COLLISION', severity: 'error' }),
		]))
		expect(reactArtifacts(result).some((artifact) => path.basename(artifact.path) === 'get-prototype-key.query.ts')).toBe(false)
	})

	it('reports path parameters that shadow imported TanStack runtime names', async () => {
		const document = structuredClone(fixture) as OpenAPIDocument
		if (!document.paths) throw new Error('Fixture paths are missing.')
		const original = document.paths['/pets/{petId}']
		if (!original || !('get' in original) || !original.get) throw new Error('Fixture GET operation is missing.')
		for (const [parameterName, operationId] of [['queryOptions', 'getQueryOptionsBinding'], ['useQuery', 'getUseQueryBinding']] as const) {
			document.paths[`/import-collision/${parameterName}`] = {
				get: {
					...structuredClone(original.get),
					operationId,
					parameters: [{ name: parameterName, in: 'path', required: true, schema: { type: 'string' } }],
				},
			}
		}

		const result = await new PluginManager(config('imported-runtime-collision'), document).execute()
		expect(result.diagnostics).toEqual(expect.arrayContaining([
			expect.objectContaining({
				code: 'REACT_QUERY_NORMALIZED_PARAMETER_COLLISION',
				location: { path: ['paths', '/import-collision/queryOptions', 'get'] },
			}),
			expect.objectContaining({
				code: 'REACT_QUERY_NORMALIZED_PARAMETER_COLLISION',
				location: { path: ['paths', '/import-collision/useQuery', 'get'] },
			}),
		]))
		expect(reactArtifacts(result).some((artifact) => path.basename(artifact.path) === 'get-query-options-binding.query.ts')).toBe(false)
		expect(reactArtifacts(result).some((artifact) => path.basename(artifact.path) === 'get-use-query-binding.query.ts')).toBe(false)
	})

	it('reports missing operationId before attempting to emit a hook file', async () => {
		const diagnostics: Array<{ code: string; severity: string }> = []
		const operation = {
			path: '/pets/{petId}',
			method: 'get',
			tagName: 'pets',
			accessor: { operationId: '' },
		} as unknown as Parameters<NonNullable<ReturnType<typeof definePlugin>['hooks']['operation']>>[0]
		const context = { addDiagnostic: (diagnostic: { code: string; severity: 'error' }) => diagnostics.push(diagnostic) }
		await definePlugin().hooks.operation?.(operation, context as never)
		expect(diagnostics).toEqual([
			expect.objectContaining({ code: 'REACT_QUERY_OPERATION_ID_MISSING', severity: 'error' }),
		])
	})

	it('rejects invalid normalized operation names', async () => {
		const diagnostics: Array<{ code: string; severity: string }> = []
		const operation = {
			path: '/invalid',
			method: 'get',
			tagName: 'pets',
			accessor: { operationId: '123', operationName: '123' },
		} as unknown as Parameters<NonNullable<ReturnType<typeof definePlugin>['hooks']['operation']>>[0]
		const context = { addDiagnostic: (diagnostic: { code: string; severity: 'error' }) => diagnostics.push(diagnostic) }
		await definePlugin().hooks.operation?.(operation, context as never)
		expect(diagnostics).toEqual([
			expect.objectContaining({ code: 'REACT_QUERY_OPERATION_NAME_INVALID', severity: 'error' }),
		])
	})

	it('keeps the maintained fixture readable from the package boundary', async () => {
		expect(JSON.parse(await readFile(new URL('../mock/react-query.json', import.meta.url), 'utf8'))).toEqual(fixture)
	})
})
