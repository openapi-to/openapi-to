import { describe, expect, it } from "vitest";
import { getOperationRequestBodyMediaTypeObject } from "../OpenAPIContext/requestBody.ts";
import type { OperationWrapper } from "../OpenAPIContext/types.ts";
import type { OpenAPIDocument, OpenapiToSingleConfig } from "../types";
import { PluginManager } from "./PluginManager.ts";
import type { HookContext } from "./types.ts";

function document(version: string): OpenAPIDocument {
	return {
		openapi: version,
		info: { title: `OAS ${version}`, version: "1" },
		servers: [{ url: "https://root.example.test" }],
		security: [{ bearer: [] }],
		tags: [{ name: "pets" }],
		paths: {
			"/pets/{id}": {
				parameters: [{ $ref: "#/components/parameters/PetId" }],
				get: {
					operationId: "getPet",
					tags: ["pets"],
					servers: [{ url: "https://operation.example.test" }],
					parameters: [
						{
							name: "include",
							in: "query",
							required: false,
							style: "form",
							explode: true,
							schema: { type: "string" },
						},
						{
							name: "session",
							in: "cookie",
							required: false,
							style: "form",
							explode: true,
							schema: { type: "string" },
						},
					],
					requestBody: { $ref: "#/components/requestBodies/Lookup" },
					responses: {
						"200": { $ref: "#/components/responses/Pet" },
						default: { description: "error" },
					},
				},
			},
		},
		components: {
			parameters: {
				PetId: {
					name: "id",
					in: "path",
					required: true,
					style: "simple",
					explode: false,
					schema: { type: "string" },
				},
			},
			requestBodies: {
				Lookup: {
					required: true,
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/Lookup" },
						},
					},
				},
			},
			responses: {
				Pet: {
					description: "ok",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/Pet" },
						},
					},
				},
			},
			schemas: {
				Lookup: { type: "object" },
				Pet: { type: "object", properties: { id: { type: "string" } } },
			},
			securitySchemes: {
				bearer: { type: "http", scheme: "bearer" },
			},
		},
	} as OpenAPIDocument;
}

describe.each(["3.0.3", "3.1.0", "3.2.0"])(
	"PluginManager oas semantics for OpenAPI %s",
	(version) => {
		it("preserves operation discovery and wrapper behavior", async () => {
			const observations: unknown[] = [];
			const source = document(version);
			const config: OpenapiToSingleConfig = {
				name: "oas-migration",
				root: ".",
				input: { path: "openapi.json" },
				output: { dir: "generated" },
				plugins: [
					{
						name: "observer",
						dependencies: [],
						hooks: {
							operation(operation: OperationWrapper, context: HookContext) {
								const wrapped = operation.accessor.operation;
								observations.push(
									structuredClone({
										path: operation.path,
										method: operation.method,
										operationId: operation.accessor.operationId,
										tags: wrapped.getTags().map((tag) => tag.name),
										parameters: operation.accessor.parameters.map(
											({ name, in: location, required, style, explode }) => ({
												name,
												location,
												required,
												style,
												explode,
											}),
										),
										requestBody:
											getOperationRequestBodyMediaTypeObject(wrapped),
										responseStatuses: wrapped.getResponseStatusCodes(),
										response: wrapped.getResponseByStatusCode("200"),
										security: wrapped.getSecurity(),
										servers: wrapped.getServers(),
										helperVersion: wrapped.api.openapi,
										contextVersion: context.openAPIDocument.openapi,
										contextDialect: context.openAPIDialect,
										cookieSerialization:
											operation.accessor.cookieParameterSerialization,
									}),
								);
							},
						},
					},
				],
			};

			const result = await new PluginManager(config, source).execute();

			expect(result.diagnostics).toEqual([]);
			expect(observations).toEqual([
				{
					path: "/pets/{id}",
					method: "get",
					operationId: "getPet",
					tags: ["pets"],
					parameters: [
						{
							name: "include",
							location: "query",
							required: false,
							style: "form",
							explode: true,
						},
						{
							name: "session",
							location: "cookie",
							required: false,
							style: "form",
							explode: true,
						},
						{
							name: "id",
							location: "path",
							required: true,
							style: "simple",
							explode: false,
						},
					],
					requestBody: {
						schema: { $ref: "#/components/schemas/Lookup" },
					},
					responseStatuses: ["200", "default"],
					response: {
						description: "ok",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Pet" },
							},
						},
					},
					security: [{ bearer: [] }],
					servers: [{ url: "https://operation.example.test" }],
					helperVersion: version === "3.2.0" ? "3.1.0" : version,
					contextVersion: version,
					contextDialect: version.startsWith("3.0")
						? "3.0"
						: version.startsWith("3.2")
							? "3.2"
							: "3.1",
					cookieSerialization: [
						{
							name: "session",
							required: false,
							strategy: "schema",
							style: "form",
							explode: true,
							schemaType: "string",
							dialect: version.startsWith("3.2")
								? "3.2"
								: version.startsWith("3.0")
									? "3.0"
									: "3.1",
						},
					],
				},
			]);

			const firstObservation = structuredClone(observations);
			observations.length = 0;
			const repeated = await new PluginManager(config, source).execute();
			expect(repeated.diagnostics).toEqual([]);
			expect(observations).toEqual(firstObservation);
			expect(source).toMatchObject({
				openapi: version,
				paths: {
					"/pets/{id}": {
						get: {
							requestBody: { $ref: "#/components/requestBodies/Lookup" },
							responses: {
								"200": { $ref: "#/components/responses/Pet" },
							},
						},
					},
				},
			});
		});
	},
);
