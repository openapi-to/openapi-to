import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import {
	buildFromCompilation,
	pluginEnum,
	type CompatibleOpenAPIDocument,
	type OpenAPICompilation,
	type OperationFaker,
	type OpenapiToSingleConfig,
	type PluginDefinition,
} from "@openapi-to/core";
import { afterEach, describe, expect, it } from "vitest";
import { definePlugin as pluginFaker } from "./plugin.ts";
import { definePlugin as pluginTSType } from "@openapi-to/plugin-ts-type";

function fixture(): CompatibleOpenAPIDocument {
	return {
		openapi: "3.1.0",
		info: { title: "Faker factories", version: "1" },
		paths: {
			"/pets/{id}": {
				get: {
					operationId: "getPet",
					tags: ["pets"],
					responses: {
						"200": {
							description: "pet",
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/Pet" },
								},
							"application/problem+json": {
								schema: { $ref: "#/components/schemas/Pet" },
								},
							},
						},
						"204": { description: "empty" },
						"404": {
							description: "missing",
							content: {
								"application/problem+json": {
									schema: {
										type: "object",
										properties: { message: { type: "string" } },
										required: ["message"],
									},
								},
							},
						},
					},
				},
			},
		},
		components: {
			schemas: {
				Pet: {
					type: "object",
					properties: {
						id: { type: "integer", minimum: 1 },
						name: { type: "string", minLength: 2 },
					},
					required: ["id", "name"],
				},
			},
		},
	} as CompatibleOpenAPIDocument;
}

describe("Faker plugin integration", () => {
	const roots: string[] = [];
	afterEach(async () => {
		await Promise.all(
			roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
		);
	});

	it("emits one deterministic factory artifact and structured response metadata", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "openapi-faker-plugin-"));
		roots.push(root);
		const source = fixture();
		const compilation: OpenAPICompilation = {
			success: true,
			source: "fixture",
			uri: "memory://faker",
			version: "3.1.0",
			document: source,
			resolvedDocument: source,
			normalizedDocument: source,
			diagnostics: [],
		};
		let responseMetadata: OperationFaker | undefined;
		const metadataCapture: PluginDefinition = {
			name: pluginEnum.MSW,
			dependencies: [pluginEnum.Faker],
			hooks: {
				buildEnd(ctx) {
					responseMetadata =
						ctx.openapiHelper.getAllOperations()[0]?.accessor.operationFaker;
				},
			},
		};
		const config: OpenapiToSingleConfig = {
			name: "faker-test",
			root,
			input: { path: "unused" },
			output: { dir: path.join(root, "generated"), clean: false },
			plugins: [
				pluginTSType(),
				pluginFaker({ importWithExtension: false }),
				metadataCapture,
			],
		};
		const first = await buildFromCompilation(config, compilation, {
			dryRun: true,
		});
		const second = await buildFromCompilation(config, compilation, {
			dryRun: true,
		});
		expect(first.error, JSON.stringify(first.diagnostics)).toBeUndefined();
		expect(second.error, JSON.stringify(second.diagnostics)).toBeUndefined();
		const generated =
			first.generationResult?.artifacts.filter(
				(artifact) =>
					artifact.kind === "typescript" &&
					artifact.path.endsWith(path.join("faker", "factories.ts")),
			) ?? [];
		expect(generated).toHaveLength(1);
		if (generated[0]?.kind !== "typescript")
			throw new Error("Expected a TypeScript Faker artifact.");
		const sourceText = generated[0].sourceFile.getFullText();
		expect(sourceText).toContain(
			'import type { Faker } from "@faker-js/faker"',
		);
		expect(sourceText).toContain("createPet");
		expect(sourceText).toContain("createGetPet200ApplicationJsonResponse");
		expect(sourceText).toContain(
			"createGetPet200ApplicationProblemJsonResponse",
		);
		expect(sourceText).toContain("createGetPet204NoContentResponse");
		expect(sourceText).toContain(
			"createGetPet404ApplicationProblemJsonResponse",
		);
		const repeated = second.generationResult?.artifacts.find(
			(artifact) =>
				artifact.kind === "typescript" &&
				artifact.path.endsWith(path.join("faker", "factories.ts")),
		);
		expect(
			repeated?.kind === "typescript" ? repeated.sourceFile.getFullText() : "",
		).toBe(sourceText);
		expect(responseMetadata?.responses).toEqual([
			{
				statusCode: "200",
				sourceStatusCode: "200",
				classification: "success",
				mediaType: "application/json",
				kind: "schema",
				factoryName: "createGetPet200ApplicationJsonResponse",
			},
			{
				statusCode: "200",
				sourceStatusCode: "200",
				classification: "success",
				mediaType: "application/problem+json",
				kind: "schema",
				factoryName: "createGetPet200ApplicationProblemJsonResponse",
			},
			{
				statusCode: "204",
				sourceStatusCode: "204",
				classification: "success",
				kind: "no-content",
				factoryName: "createGetPet204NoContentResponse",
			},
			{
				statusCode: "404",
				sourceStatusCode: "404",
				classification: "error",
				mediaType: "application/problem+json",
				kind: "schema",
				factoryName: "createGetPet404ApplicationProblemJsonResponse",
			},
		]);
		expect(responseMetadata?.responseSuccess).toBe(
			"createGetPet200ApplicationJsonResponse",
		);
	});

	it("rejects OAS 3.2 streaming, item-level, and positional response media", async () => {
		const root = await mkdtemp(
			path.join(os.tmpdir(), "openapi-faker-32-media-"),
		);
		roots.push(root);
		const source = {
			openapi: "3.2.0",
			info: { title: "Faker media semantics", version: "1" },
			paths: {
				"/events": {
					get: {
						operationId: "getEvents",
						responses: {
							"200": {
								description: "events",
								content: {
									"application/jsonl": {
										schema: { type: "array", items: { type: "string" } },
										itemSchema: { type: "string" },
									},
									"text/event-stream": { schema: { type: "string" } },
									"multipart/mixed": {
										schema: { type: "object" },
										prefixEncoding: [],
									},
									"text/plain": {},
								},
							},
						},
					},
				},
			},
			components: { schemas: {} },
		} as CompatibleOpenAPIDocument;
		const compilation: OpenAPICompilation = {
			success: true,
			source: "fixture",
			uri: "memory://faker-media",
			version: "3.2.0",
			document: source,
			resolvedDocument: source,
			normalizedDocument: source,
			diagnostics: [],
		};
		const config: OpenapiToSingleConfig = {
			name: "faker-media-test",
			root,
			input: { path: "unused" },
			output: { dir: path.join(root, "generated"), clean: false },
			plugins: [pluginTSType(), pluginFaker()],
		};
		const result = await buildFromCompilation(config, compilation, {
			dryRun: true,
		});
		expect(
			result.diagnostics.filter(
				({ code }) => code === "FAKER_RESPONSE_MEDIA_UNSUPPORTED",
			),
		).toHaveLength(4);
		expect(
			result.generationResult?.artifacts.some((artifact) =>
				artifact.path.endsWith(path.join("faker", "factories.ts")),
			),
		).toBe(false);
	});

	it("keeps Core's selected success status when its response has no supported factory", async () => {
		const root = await mkdtemp(
			path.join(os.tmpdir(), "openapi-faker-selected-response-"),
		);
		roots.push(root);
		const source = fixture();
		const petPath = source.paths?.["/pets/{id}"];
		if (!petPath || !("get" in petPath) || !petPath.get)
			throw new Error("Expected the fixture GET operation.");
		const responses = petPath.get.responses as Record<string, unknown>;
		responses["200"] = {
			description: "unsupported binary",
			content: {
				"application/octet-stream": {
					schema: { type: "string", format: "binary" },
				},
			},
		};
		responses["201"] = {
			description: "supported but not Core-selected",
			content: { "application/json": { schema: { type: "string" } } },
		};
		const compilation: OpenAPICompilation = {
			success: true,
			source: "fixture",
			uri: "memory://faker-selected-response",
			version: "3.1.0",
			document: source,
			resolvedDocument: source,
			normalizedDocument: source,
			diagnostics: [],
		};
		let responseMetadata: OperationFaker | undefined;
		const metadataCapture: PluginDefinition = {
			name: pluginEnum.MSW,
			dependencies: [pluginEnum.Faker],
			hooks: {
				buildEnd(ctx) {
					responseMetadata =
						ctx.openapiHelper.getAllOperations()[0]?.accessor.operationFaker;
				},
			},
		};
		const result = await buildFromCompilation(
			{
				name: "faker-selected-response-test",
				root,
				input: { path: "unused" },
				output: { dir: path.join(root, "generated"), clean: false },
				plugins: [pluginTSType(), pluginFaker(), metadataCapture],
			},
			compilation,
			{ dryRun: true },
		);
		expect(result.diagnostics.map(({ code }) => code)).toContain(
			"FAKER_UNSUPPORTED_FORMAT",
		);
		expect(responseMetadata?.responses?.map(({ statusCode }) => statusCode)).toContain(
			"201",
		);
		expect(responseMetadata?.responses?.map(({ statusCode }) => statusCode)).not.toContain(
			"200",
		);
		expect(responseMetadata?.responseSuccess).toBe("");
	});

	it("omits a media factory when its schema is outside the TypeScript response type", async () => {
		const root = await mkdtemp(
			path.join(os.tmpdir(), "openapi-faker-media-return-type-"),
		);
		roots.push(root);
		const source = fixture();
		const petPath = source.paths?.["/pets/{id}"];
		if (!petPath || !("get" in petPath) || !petPath.get)
			throw new Error("Expected the fixture GET operation.");
		const response200 = petPath.get.responses?.["200"];
		if (!response200 || "$ref" in response200 || !response200.content)
			throw new Error("Expected the fixture 200 response content.");
		response200.content["application/problem+json"] = {
			schema: { type: "string" },
		};
		const compilation: OpenAPICompilation = {
			success: true,
			source: "fixture",
			uri: "memory://faker-media-return-type",
			version: "3.1.0",
			document: source,
			resolvedDocument: source,
			normalizedDocument: source,
			diagnostics: [],
		};
		const result = await buildFromCompilation(
			{
				name: "faker-media-return-type-test",
				root,
				input: { path: "unused" },
				output: { dir: path.join(root, "generated"), clean: false },
				plugins: [pluginTSType(), pluginFaker()],
			},
			compilation,
			{ dryRun: true },
		);
		expect(result.diagnostics.map(({ code }) => code)).toContain(
			"FAKER_UNSUPPORTED_SCHEMA",
		);
		const artifact = result.generationResult?.artifacts.find(
			(item) => item.path.endsWith(path.join("faker", "factories.ts")),
		);
		expect(artifact?.kind).toBe("typescript");
		if (artifact?.kind === "typescript") {
			expect(artifact.sourceFile.getFullText()).toContain(
				"createGetPet200ApplicationJsonResponse",
			);
			expect(artifact.sourceFile.getFullText()).not.toContain(
				"createGetPet200ApplicationProblemJsonResponse",
			);
		}
	});
});
