import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { PluginManager, pluginEnum, type OpenAPIDocument } from '@openapi-to/core'
import { definePlugin as defineRequestPlugin } from '@openapi-to/plugin-ts-request'
import { definePlugin as defineTypePlugin } from '@openapi-to/plugin-ts-type'
import { describe, expect, it } from 'vitest'
import fixture from '../mock/react-query.json'
import { definePlugin } from './plugin.ts'

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
	it('runs after TsType and Request and emits operation-local query/mutation artifacts', async () => {
		const manager = new PluginManager(config('react-query-fixture'), fixture as OpenAPIDocument)
		expect(manager.pluginsByStages.map((stage) => stage.map(({ name }) => name))).toEqual([
			[pluginEnum.TsType],
			[pluginEnum.Request],
			[pluginEnum.ReactQuery],
		])

		const result = await manager.execute()
		expect(result.diagnostics).toEqual([
			expect.objectContaining({ code: 'REACT_QUERY_UNSUPPORTED_METHOD', severity: 'error' }),
		])
		expect(reactArtifacts(result).map((artifact) => path.basename(artifact.path))).toEqual([
			'create-pet.mutation.ts',
			'delete-pet.mutation.ts',
			'get-pet-by-id.query.ts',
			'update-pet.mutation.ts',
		])

		const query = sourceText(result, 'get-pet-by-id.query.ts')
		expect(query).toContain('getPetByIdQueryKey')
		expect(query).toContain('getPetByIdQueryOptions')
		expect(query).toContain('useGetPetByIdQuery')
		expect(query).toContain('target: "react-query-fixture"')
		expect(query).toContain('getPetByIdService(petId, params, { ...options?.requestConfig, signal })')
		expect(query).not.toContain('requestConfig.signal = signal')

		const update = sourceText(result, 'update-pet.mutation.ts')
		expect(update).toContain('export type UpdatePetVariables')
		expect(update).toContain('petId: UpdatePetPathParams[\'petId\'];')
		expect(update).toContain('data: UpdatePetMutationRequest;')
		expect(update).toContain('params?: UpdatePetQueryParams;')
		expect(update).toContain('updatePetService(petId, data, params, options?.requestConfig)')

		const deletePet = sourceText(result, 'delete-pet.mutation.ts')
		expect(deletePet).toContain('deletePetService(petId, options?.requestConfig)')
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

	it('keeps the maintained fixture readable from the package boundary', async () => {
		expect(JSON.parse(await readFile(new URL('../mock/react-query.json', import.meta.url), 'utf8'))).toEqual(fixture)
	})
})
