import path from "node:path";
import { PluginManager } from "@openapi-to/core";
import { describe, expect, it } from "vitest";
import { definePlugin } from "./plugin.ts";

const fixture = {
	openapi: "3.1.0",
	info: { title: "Zod 4 fixture", version: "1.0.0" },
	paths: {
		"/users/{id}": {
			get: {
				operationId: "getUser",
				tags: ["Users"],
				parameters: [
					{ $ref: "#/components/parameters/UserId" },
					{ $ref: "#/components/parameters/TraceId" },
				],
				responses: {
					"200": {
						description: "Found",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/UserInput" },
							},
						},
					},
					"404": { $ref: "#/components/responses/NotFound" },
				},
			},
		},
		"/search": {
			get: {
				operationId: "searchUsers",
				tags: ["Users"],
				parameters: [{ $ref: "#/components/parameters/Search" }],
				responses: {
					"200": {
						description: "Text",
						content: {
							"application/json": { schema: { type: "string" } },
						},
					},
					"201": {
						description: "Number",
						content: {
							"application/json": { schema: { type: "number" } },
						},
					},
					"400": {
						description: "Inline error",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/ErrorBody" },
							},
						},
					},
					"404": { $ref: "#/components/responses/NotFound" },
				},
			},
		},
		"/required-search": {
			get: {
				operationId: "requiredSearch",
				tags: ["Users"],
				parameters: [
					{ $ref: "#/components/parameters/RequiredSearch" },
					{ $ref: "#/components/parameters/NeverParameter" },
					{ $ref: "#/components/parameters/LongValue" },
				],
				responses: {
					"200": {
						description: "OK",
						content: {
							"application/json": { schema: { type: "string" } },
						},
					},
				},
			},
		},
		"/wildcard": {
			get: {
				operationId: "wildcardResponses",
				tags: ["Users"],
				responses: Object.fromEntries(
					[
						["101", "informational"],
						["1XX", "informational wildcard"],
						["200", "success"],
						["2xx", "success wildcard"],
						["301", "redirect"],
						["3XX", "redirect wildcard"],
						["400", "client error"],
						["4xx", "client error wildcard"],
						["500", "server error"],
						["5XX", "server error wildcard"],
						["default", "fallback"],
					].map(([code, description]) => [
						code,
						{
							description,
							content: {
								"application/json": { schema: { type: "string" } },
							},
						},
					]),
				),
			},
		},
		"/component-no-content": {
			delete: {
				operationId: "deleteUser",
				tags: ["Users"],
				responses: {
					"204": { $ref: "#/components/responses/NoContent" },
				},
			},
		},
		"/empty-operation-body": {
			post: {
				operationId: "emptyOperationBody",
				tags: ["Users"],
				requestBody: {
					content: { "application/json": {} },
				},
				responses: {
					"200": {
						description: "Any response",
						content: { "application/json": {} },
					},
				},
			},
		},
		"/empty-component-body": {
			post: {
				operationId: "emptyComponentBody",
				tags: ["Users"],
				requestBody: { $ref: "#/components/requestBodies/AnyBody" },
				responses: { "204": { description: "Done" } },
			},
		},
		"/ref-sibling-body": {
			post: {
				operationId: "refSiblingBody",
				tags: ["Users"],
				requestBody: {
					content: {
						"application/json": {
							schema: {
								$ref: "#/components/schemas/BaseString",
								type: "string",
								minLength: 10,
							},
						},
					},
				},
				responses: {
					"200": { $ref: "#/components/responses/NullableBody" },
				},
			},
		},
		"/component-ref-sibling-body": {
			post: {
				operationId: "componentRefSiblingBody",
				tags: ["Users"],
				requestBody: { $ref: "#/components/requestBodies/LongBody" },
				responses: { "204": { description: "Done" } },
			},
		},
		"/response-headers": {
			get: {
				operationId: "responseHeaders",
				tags: ["Users"],
				responses: {
					"200": { $ref: "#/components/responses/HeaderBody" },
				},
			},
		},
		"/no-content": {
			get: {
				operationId: "noContent",
				tags: ["Users"],
				responses: {
					"204": { description: "No content" },
					"400": {
						description: "Bad",
						content: {
							"application/json": { schema: { type: "string" } },
						},
					},
				},
			},
		},
		"/errors-only": {
			get: {
				operationId: "errorsOnly",
				tags: ["Users"],
				responses: {
					"400": {
						description: "Inline error",
						content: {
							"application/json": { schema: { type: "string" } },
						},
					},
					"404": { $ref: "#/components/responses/NotFound" },
				},
			},
		},
		"/only-no-content": {
			get: {
				operationId: "onlyNoContent",
				tags: ["Users"],
				responses: { "204": { description: "No content" } },
			},
		},
		"/default": {
			get: {
				operationId: "defaultResponse",
				tags: ["Users"],
				responses: {
					default: {
						description: "Default",
						content: {
							"application/json": { schema: { type: "boolean" } },
						},
					},
				},
			},
		},
		"/body": {
			post: {
				operationId: "createUser",
				tags: ["Users"],
				requestBody: { $ref: "#/components/requestBodies/CreateUser" },
				responses: { "204": { description: "Created without body" } },
			},
		},
		"/boolean": {
			post: {
				operationId: "booleanSchemas",
				tags: ["Users"],
				requestBody: {
					content: { "application/json": { schema: true } },
				},
				responses: {
					"200": {
						description: "Any",
						content: { "application/json": { schema: {} } },
					},
					"400": {
						description: "Never",
						content: { "application/json": { schema: false } },
					},
				},
			},
		},
	},
	components: {
		schemas: {
			BaseString: { type: "string" },
			AnyValue: true,
			NoValue: false,
			EmptySchema: {},
			UserInput: {
				type: "object",
				required: ["name"],
				properties: { name: { type: "string" } },
			},
			ErrorBody: {
				type: "object",
				required: ["message"],
				properties: { message: { type: "string" } },
			},
			Profile: {
				type: "object",
				required: ["email"],
				additionalProperties: false,
				properties: {
					email: { type: "string", format: "email" },
					"user-id": { type: "string" },
				},
			},
			ProfileMap: {
				type: "object",
				additionalProperties: { $ref: "#/components/schemas/Profile" },
			},
			Choice: {
				oneOf: [{ type: "string" }, { type: "number" }],
			},
			Combined: {
				allOf: [
					{
						type: "object",
						required: ["left"],
						properties: { left: { type: "string" } },
					},
					{
						type: "object",
						required: ["right"],
						properties: { right: { type: "boolean" } },
					},
				],
			},
			Node: {
				type: "object",
				required: ["value"],
				additionalProperties: false,
				properties: {
					value: { type: "string" },
					child: { $ref: "#/components/schemas/Node" },
					children: {
						type: "array",
						items: { $ref: "#/components/schemas/Node" },
					},
					lookup: {
						type: "object",
						additionalProperties: { $ref: "#/components/schemas/Node" },
					},
				},
			},
			PairA: {
				type: "object",
				required: ["name"],
				properties: {
					name: { type: "string" },
					pair: { $ref: "#/components/schemas/PairB" },
				},
			},
			PairB: {
				type: "object",
				required: ["count"],
				properties: {
					count: { type: "integer" },
					pair: { $ref: "#/components/schemas/PairA" },
				},
			},
			NodeWrapper: {
				type: "object",
				required: ["node"],
				properties: {
					node: { $ref: "#/components/schemas/Node" },
				},
			},
			Loop: {
				anyOf: [
					{ type: "null" },
					{ $ref: "#/components/schemas/Loop" },
				],
			},
			LoopString: {
				allOf: [
					{ type: "string" },
					{ $ref: "#/components/schemas/LoopString" },
				],
			},
			RecursiveMap: {
				type: "object",
				additionalProperties: {
					$ref: "#/components/schemas/RecursiveMap",
				},
			},
			RecursiveObjectMap: {
				type: "object",
				required: ["value"],
				properties: {
					value: { type: "string" },
					label: { type: "string" },
				},
				additionalProperties: {
					$ref: "#/components/schemas/RecursiveObjectMap",
				},
			},
			Alias: { $ref: "#/components/schemas/GuardedNode" },
			GuardedNode: {
				type: "object",
				required: ["value"],
				properties: {
					value: { type: "string" },
					next: { $ref: "#/components/schemas/Alias" },
				},
			},
			UnguardedLeft: { $ref: "#/components/schemas/UnguardedRight" },
			UnguardedRight: {
				oneOf: [
					{ type: "null" },
					{ $ref: "#/components/schemas/UnguardedLeft" },
				],
			},
		},
		parameters: {
			UserId: {
				name: "id",
				in: "path",
				required: true,
				schema: { type: "string" },
			},
			TraceId: {
				name: "X-Trace-Id",
				in: "header",
				schema: { type: "string" },
			},
			Search: {
				name: "search",
				in: "query",
				schema: { type: "string" },
			},
			RequiredSearch: {
				name: "requiredSearch",
				in: "query",
				required: true,
				schema: { type: "string" },
			},
			NeverParameter: {
				name: "never",
				in: "query",
				required: true,
				schema: false,
			},
			LongValue: {
				name: "longValue",
				in: "query",
				required: true,
				schema: {
					$ref: "#/components/schemas/BaseString",
					type: "string",
					minLength: 10,
				},
			},
		},
		requestBodies: {
			CreateUser: {
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/UserInput" },
					},
				},
			},
			AnyBody: {
				content: { "application/json": {} },
			},
			LongBody: {
				content: {
					"application/json": {
						schema: {
							$ref: "#/components/schemas/BaseString",
							type: "string",
							minLength: 10,
						},
					},
				},
			},
		},
		responses: {
			NoContent: {
				description: "No content",
				headers: {
					"X-Request-Id": {
						$ref: "#/components/headers/RequestId",
					},
				},
			},
			NotFound: {
				description: "Not found",
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/ErrorBody" },
					},
				},
			},
			HeaderBody: {
				description: "Success",
				headers: {
					"X-Request-Id": {
						$ref: "#/components/headers/RequestId",
					},
				},
				content: {
					"application/json": {
						schema: {
							$ref: "#/components/schemas/BaseString",
							type: "string",
							minLength: 10,
						},
					},
				},
			},
			NullableBody: {
				description: "Nullable",
				content: {
					"application/json": {
						schema: {
							$ref: "#/components/schemas/BaseString",
							nullable: true,
						},
					},
				},
			},
		},
		headers: {
			RequestId: {
				schema: { type: "string" },
			},
		},
	},
};

async function generatedSources() {
	const output = path.resolve("packages/plugin-zod/test-output");
	const manager = new PluginManager(
		{
			root: "",
			plugins: [definePlugin()],
			input: { path: "" },
			output: { dir: output },
		},
		fixture as never,
	);
	const result = await manager.execute();
	return {
		diagnostics: result.diagnostics,
		files: Object.fromEntries(
			result.sourceFiles
				.map<[string, string]>((sourceFile) => [
					path
						.relative(output, sourceFile.getFilePath())
						.split(path.sep)
						.join("/"),
					sourceFile.getFullText(),
				])
				.sort(([left], [right]) => left.localeCompare(right)),
		),
	};
}

describe("Zod 4 plugin integration", () => {
	it("generates executable Zod 4 schemas with safe imports and stable bytes", async () => {
		const first = await generatedSources();
		const second = await generatedSources();
		expect(first).toEqual(second);
		expect(first.diagnostics).toEqual([]);
		expect(Object.keys(first.files)).toContain(
			"zod/parameters/trace-id.schema.ts",
		);
		expect(Object.keys(first.files)).toContain(
			"zod/requestBodies/create-user.schema.ts",
		);
		expect(Object.keys(first.files)).toContain(
			"zod/responses/not-found.schema.ts",
		);
		expect(Object.keys(first.files)).toContain(
			"zod/responses/no-content.schema.ts",
		);
		expect(Object.keys(first.files)).toContain(
			"zod/requestBodies/any-body.schema.ts",
		);
		expect(Object.keys(first.files)).toContain("users/search-users.schema.ts");

		const all = Object.values(first.files).join("\n");
		expect(all).toContain('import { z } from "zod"');
		expect(all).toContain("z.email()");
		expect(all).toContain("z.union([z.string(), z.number()])");
		expect(all).toContain("z.intersection(");
		expect(all).toContain("z.record(z.string(), profileSchema)");
		expect(all).toContain('"user-id": z.string().optional()');
		expect(all).not.toMatch(/z\.string\(\)\.(?:email|url|uuid|datetime)\(/);
		expect(all).not.toMatch(/\bz\.record\(\s*[^,()]+(?:\([^()]*\))?\s*\)/);
		expect(all).not.toContain("z.string() | z.number()");
		expect(all).not.toContain("z.string() &");

		expect(first.files["zod/models/profile-map.schema.ts"]).toContain(
			'import { profileSchema } from "./profile.schema.ts"',
		);
		expect(first.files["zod/models/profile-map.schema.ts"]).not.toContain(
			"z.lazy",
		);
		expect(first.files["zod/models/node.schema.ts"]).toContain(
			"export type NodeSchemaOutput = {",
		);
		expect(first.files["zod/models/node.schema.ts"]).toContain(
			"export const nodeSchema: z.ZodType<NodeSchemaOutput>",
		);
		expect(first.files["zod/models/node.schema.ts"]).toContain(
			"z.lazy(() => nodeSchema)",
		);
		expect(first.files["zod/models/node.schema.ts"]).not.toContain(
			'from "./node.schema"',
		);
		expect(first.files["zod/models/pair-a.schema.ts"]).toContain(
			'import type { PairBSchemaOutput } from "./pair-b.schema.ts"',
		);
		expect(first.files["zod/models/pair-a.schema.ts"]).toContain(
			"export const pairASchema: z.ZodType<PairASchemaOutput>",
		);
		expect(first.files["zod/models/node-wrapper.schema.ts"]).not.toContain(
			"import type",
		);
		expect(first.files["zod/models/loop.schema.ts"]).toContain(
			"export type LoopSchemaOutput = unknown",
		);
		expect(first.files["zod/models/loop-string.schema.ts"]).toContain(
			"export type LoopStringSchemaOutput = unknown",
		);
		expect(first.files["zod/models/recursive-map.schema.ts"]).toContain(
			"export type RecursiveMapSchemaOutput = { [key: string]: RecursiveMapSchemaOutput; }",
		);
		expect(
			first.files["zod/models/recursive-object-map.schema.ts"],
		).toContain(
			"{ [key: string]: RecursiveObjectMapSchemaOutput | string | undefined; }",
		);
		expect(first.files["zod/models/alias.schema.ts"]).toContain(
			"export type AliasSchemaOutput = GuardedNodeSchemaOutput",
		);
		expect(first.files["zod/models/guarded-node.schema.ts"]).toContain(
			'"next"?: AliasSchemaOutput | undefined',
		);
		expect(first.files["zod/models/unguarded-left.schema.ts"]).not.toContain(
			"import type",
		);
		expect(first.files["zod/models/unguarded-right.schema.ts"]).not.toContain(
			"import type",
		);
		expect(first.files["zod/models/any-value.schema.ts"]).toContain(
			"export const anyValueSchema = z.unknown()",
		);
		expect(first.files["zod/models/no-value.schema.ts"]).toContain(
			"export const noValueSchema = z.never()",
		);
		expect(first.files["zod/models/empty-schema.schema.ts"]).toContain(
			"export const emptySchemaSchema = z.unknown()",
		);
		expect(first.files["zod/parameters/trace-id.schema.ts"]).toContain(
			"export const ParameterTraceIdModel = z.string()",
		);
		expect(first.files["zod/requestBodies/create-user.schema.ts"]).toContain(
			'import { userInputSchema } from "../models/user-input.schema.ts"',
		);
		expect(first.files["zod/responses/not-found.schema.ts"]).toContain(
			"export const ResponseNotFound = errorBodySchema",
		);
		expect(first.files["zod/responses/no-content.schema.ts"]).toContain(
			"export const ResponseNoContent = z.undefined()",
		);
		expect(first.files["zod/requestBodies/any-body.schema.ts"]).toContain(
			"export const anyBodySchema = z.unknown()",
		);
		expect(first.files["zod/parameters/never-parameter.schema.ts"]).toContain(
			"export const ParameterNeverParameterModel = z.never()",
		);
		expect(first.files["zod/parameters/long-value.schema.ts"]).toContain(
			"z.intersection(baseStringSchema, z.string().min(10))",
		);
		expect(first.files["zod/requestBodies/long-body.schema.ts"]).toContain(
			"z.intersection(baseStringSchema, z.string().min(10))",
		);
		expect(first.files["zod/responses/header-body.schema.ts"]).toContain(
			"z.intersection(baseStringSchema, z.string().min(10))",
		);
		expect(first.files["zod/responses/header-body.schema.ts"]).not.toContain(
			"RequestId",
		);
		expect(first.files["zod/responses/nullable-body.schema.ts"]).toContain(
			"baseStringSchema.nullable()",
		);

		const search = first.files["users/search-users.schema.ts"] ?? "";
		expect(search).toContain(
			'import { ParameterSearchModel } from "../zod/parameters/search.schema.ts"',
		);
		expect(search).toContain(
			'import { ResponseNotFound } from "../zod/responses/not-found.schema.ts"',
		);
		expect(search).toContain(
			"export const searchUsersResponseSchema200 = z.string()",
		);
		expect(search).toContain(
			"export const searchUsersResponseSchema201 = z.number()",
		);
		expect(search).toContain(
			"export const searchUsersResponseSchema = z.union([searchUsersResponseSchema200, searchUsersResponseSchema201])",
		);
		expect(search).toContain(
			"export const searchUsersResponseErrorSchema = z.union([searchUsersResponseSchema400, searchUsersResponseSchema404])",
		);
		expect(search).toContain('"search": ParameterSearchModel.optional()');
		const requiredSearch = first.files["users/required-search.schema.ts"] ?? "";
		expect(requiredSearch).toContain(
			'"requiredSearch": ParameterRequiredSearchModel',
		);
		expect(requiredSearch).toContain('"never": ParameterNeverParameterModel');
		expect(requiredSearch).not.toContain(
			'"requiredSearch": ParameterRequiredSearchModel.optional()',
		);
		const getUser = first.files["users/get-user.schema.ts"] ?? "";
		expect(getUser).toContain('"id": ParameterUserIdModel');
		expect(getUser).not.toContain('"id": ParameterUserIdModel.optional()');
		const wildcard = first.files["users/wildcard-responses.schema.ts"] ?? "";
		for (const suffix of [
			"101",
			"1XX",
			"200",
			"2XX",
			"301",
			"3XX",
			"400",
			"4XX",
			"500",
			"5XX",
			"Default",
		]) {
			expect(wildcard).toContain(`wildcardResponsesResponseSchema${suffix}`);
		}
		expect(wildcard).toContain(
			"z.union([wildcardResponsesResponseSchema200, wildcardResponsesResponseSchema2XX])",
		);
		expect(wildcard).toContain("wildcardResponsesResponseSchema1XX");
		const deleteUser = first.files["users/delete-user.schema.ts"] ?? "";
		expect(deleteUser).toContain(
			"export const deleteUserMutationSchemaResponseSchema204 = ResponseNoContent",
		);
		const emptyOperationBody =
			first.files["users/empty-operation-body.schema.ts"] ?? "";
		expect(emptyOperationBody).toContain(
			"export const emptyOperationBodyMutationRequestSchema = z.unknown()",
		);
		expect(emptyOperationBody).toContain(
			"export const emptyOperationBodyMutationSchemaResponseSchema200 = z.unknown()",
		);
		const refSiblingBody =
			first.files["users/ref-sibling-body.schema.ts"] ?? "";
		expect(refSiblingBody).toContain(
			"z.intersection(baseStringSchema, z.string().min(10))",
		);
		const noContent = first.files["users/no-content.schema.ts"] ?? "";
		expect(noContent).toContain(
			"export const noContentResponseSchema204 = z.undefined()",
		);
		expect(noContent).toContain(
			"export const noContentResponseSchema = noContentResponseSchema204",
		);
		const errorsOnly = first.files["users/errors-only.schema.ts"] ?? "";
		expect(errorsOnly).toContain(
			"export const errorsOnlyResponseSchema = z.unknown()",
		);
		expect(errorsOnly).toContain(
			"export const errorsOnlyResponseErrorSchema = z.union([errorsOnlyResponseSchema400, errorsOnlyResponseSchema404])",
		);
		const booleanSchemas = first.files["users/boolean-schemas.schema.ts"] ?? "";
		expect(booleanSchemas).toContain(
			"export const booleanSchemasMutationRequestSchema = z.unknown()",
		);
		expect(booleanSchemas).toContain(
			"export const booleanSchemasMutationSchemaResponseSchema200 = z.unknown()",
		);
		expect(booleanSchemas).toContain(
			"export const booleanSchemasMutationSchemaResponseSchema400 = z.never()",
		);

		for (const [fileName, source] of Object.entries(first.files)) {
			const declarations = [
				...source.matchAll(/export const ([A-Za-z_$][\w$]*)/g),
			].map((match) => match[1]);
			expect(new Set(declarations).size, fileName).toBe(declarations.length);
			for (const match of source.matchAll(
				/import \{ ([^}]+) \} from "([^"]+)"/g,
			)) {
				const moduleSpecifier = match[2];
				if (!moduleSpecifier || moduleSpecifier === "zod") continue;
				const target = path.posix.normalize(
					path.posix.join(path.posix.dirname(fileName), moduleSpecifier),
				);
				const targetFile = target.endsWith(".ts") ? target : `${target}.ts`;
				const targetSource = first.files[targetFile];
				expect(targetSource, `${fileName} -> ${targetFile}`).toBeDefined();
				for (const imported of match[1]
					?.split(",")
					.map((name) => name.trim()) ?? []) {
					expect(
						targetSource,
						`${fileName} imports ${imported} from ${targetFile}`,
					).toMatch(new RegExp(`export const ${imported}\\b`));
				}
			}
			expect(source, fileName).not.toMatch(
				new RegExp(
					`from ["'][^"']*${path.posix.basename(fileName, ".ts")}["']`,
				),
			);
		}
	});
});
