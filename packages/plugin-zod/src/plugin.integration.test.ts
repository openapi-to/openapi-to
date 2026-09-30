import path from "node:path";
import { PluginManager } from "@openapi-to/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
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
		"/choice": {
			get: {
				operationId: "getChoice",
				tags: ["Users"],
				responses: {
					"200": {
						description: "A component oneOf choice",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Choice" },
							},
						},
					},
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
					"201": {
						description: "Created",
						headers: {
							"X-Optional": { schema: { type: "string" } },
							"X-Page": {
								content: {
									"application/json": { schema: { type: "integer" } },
								},
							},
							"X-Tags": {
								schema: { type: "array", items: { type: "string" } },
							},
							"X-Meta": {
								schema: {
									type: "object",
									required: ["active"],
									properties: { active: { type: "boolean" } },
								},
							},
							"X-Boolean": { schema: true },
							"X-Never": { schema: false },
							"Content-TYPE": { schema: { type: "boolean" } },
						},
						content: { "application/json": { schema: { type: "string" } } },
					},
					"400": {
						description: "Bad request",
						headers: { "Retry-After": { schema: { type: "integer" } } },
						content: { "application/json": { schema: { type: "string" } } },
					},
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
			OverlappingChoice: {
				oneOf: [{ type: "string" }, { type: "string", minLength: 1 }],
			},
			HeaderRequestId: { type: "string", minLength: 3 },
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
				anyOf: [{ type: "null" }, { $ref: "#/components/schemas/Loop" }],
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
					"X-Choice": { $ref: "#/components/headers/ChoiceHeader" },
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
				required: true,
				schema: { $ref: "#/components/schemas/HeaderRequestId" },
			},
			ChoiceHeader: {
				schema: { $ref: "#/components/schemas/OverlappingChoice" },
			},
		},
	},
};

async function generatedSources(input: unknown = fixture) {
	const output = path.resolve("packages/plugin-zod/test-output");
	const manager = new PluginManager(
		{
			root: "",
			plugins: [definePlugin()],
			input: { path: "" },
			output: { dir: output },
		},
		input as never,
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

function generatedInitializer(source: string, name: string): string {
	const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const initializer = new RegExp(
		`^export const ${escapedName} = (.*);$`,
		"m",
	).exec(source)?.[1];
	if (!initializer) throw new Error(`Missing generated schema ${name}.`);
	return initializer;
}

describe("Zod 4 plugin integration", () => {
	it("renders bounded date-time validation across components, operations, and response headers", async () => {
		const input = {
			openapi: "3.1.0",
			info: { title: "date-time contract", version: "1.0.0" },
			paths: {
				"/date-time": {
					get: {
						operationId: "dateTimeContract",
						tags: ["DateTime"],
						parameters: [
							{
								name: "observedAt",
								in: "query",
								required: true,
								schema: { type: "string", format: "date-time" },
							},
						],
						responses: {
							"200": {
								description: "Date-time response",
								content: {
									"application/json": {
										schema: { $ref: "#/components/schemas/DateTimeValue" },
									},
								},
								headers: {
									"X-Observed-At": {
										schema: { type: "string", format: "date-time" },
									},
								},
							},
						},
					},
				},
			},
			components: {
				schemas: {
					DateTimeValue: { type: "string", format: "date-time" },
				},
			},
		};
		const first = await generatedSources(input);
		const second = await generatedSources(input);
		expect(first).toEqual(second);
		expect(first.diagnostics).toEqual([]);

		const componentSource = Object.values(first.files).find((source) =>
			source.includes("export const dateTimeValueSchema ="),
		);
		const operationSource = Object.values(first.files).find((source) =>
			source.includes("export const dateTimeContractResponseSchema200 ="),
		);
		const querySource = Object.values(first.files).find((source) =>
			source.includes("observedAt") && source.includes("QueryParamsSchema"),
		);
		const headerSource = Object.values(first.files).find((source) =>
			source.includes("export const dateTimeContractResponseSchema200Headers ="),
		);
		expect(componentSource).toBeDefined();
		expect(operationSource).toBeDefined();
		expect(querySource).toBeDefined();
		expect(headerSource).toBeDefined();
		const queryExpression = querySource
			?.match(/^\s*"observedAt": (.*)$/m)?.[1]
			?.replace(/,$/, "");
		expect(queryExpression).toBeDefined();

		const component = new Function(
			"z",
			`return (${generatedInitializer(componentSource ?? "", "dateTimeValueSchema")});`,
		)(z) as z.ZodType;
		const operation = new Function(
			"z",
			"dateTimeValueSchema",
			`return (${generatedInitializer(operationSource ?? "", "dateTimeContractResponseSchema200")});`,
		)(z, component) as z.ZodType;
		const query = new Function(
			"z",
			`return z.object({ observedAt: (${queryExpression ?? "z.never()"}) });`,
		)(z) as z.ZodType;
		const headers = new Function(
			"z",
			`return (${generatedInitializer(headerSource ?? "", "dateTimeContractResponseSchema200Headers")});`,
		)(z) as z.ZodType;

		for (const value of [
			"1990-12-31T23:59:60Z",
			"1990-12-31T15:59:60-08:00",
			"1991-01-01T00:59:60+01:00",
			"1990-12-31T23:59:60.5Z",
		]) {
			expect(component.safeParse(value).success, value).toBe(true);
			expect(operation.safeParse(value).success, value).toBe(true);
			expect(query.safeParse({ observedAt: value }).success, value).toBe(true);
			expect(
				headers.safeParse({ "x-observed-at": value }).success,
				value,
			).toBe(true);
		}
		for (const value of [
			"2026-07-28T12:30:60Z",
			"1990-12-31T23:59:60+01:00",
		]) {
			expect(component.safeParse(value).success, value).toBe(false);
			expect(operation.safeParse(value).success, value).toBe(false);
			expect(query.safeParse({ observedAt: value }).success, value).toBe(false);
			expect(
				headers.safeParse({ "x-observed-at": value }).success,
				value,
			).toBe(false);
		}
	});

	it("diagnoses the bounded int64 number contract across generated entrypoints", async () => {
		const input = {
			openapi: "3.1.2",
			info: { title: "int64 boundary", version: "1" },
			paths: {
				"/items/{id}": {
					get: {
						operationId: "getItem",
						tags: ["Users"],
						parameters: [
							{
								name: "id",
								in: "path",
								required: true,
								schema: { type: "integer", format: "int64" },
							},
						],
						responses: {
							"200": {
								description: "OK",
								headers: {
									"X-Item-Id": {
										schema: { type: "integer", format: "int64" },
									},
								},
								content: {
									"application/json": {
										schema: { type: "integer", format: "int64" },
									},
								},
							},
						},
					},
				},
			},
			components: {
				schemas: {
					Int64Id: {
						type: "integer",
						format: "int64",
						examples: [{ format: "int64" }],
						description: "An identifier in the int64 format.",
					},
				},
			},
		} as never;
		const first = await generatedSources(input);
		const second = await generatedSources(input);
		const diagnostics = first.diagnostics.filter(
			({ code }) => code === "ZOD_INT64_SAFE_INTEGER_ONLY",
		);
		expect(diagnostics).toHaveLength(4);
		expect(diagnostics.every(({ severity }) => severity === "warning")).toBe(
			true,
		);
		expect(
			diagnostics.some(({ location }) =>
				location?.path?.join("/").includes("components/schemas/Int64Id"),
			),
		).toBe(true);
		expect(
			diagnostics.some(({ location }) =>
				location?.path?.join("/").includes("paths"),
			),
		).toBe(true);
		expect(first).toEqual(second);
		const componentSource = Object.entries(first.files).find(
			([fileName]) => fileName.includes("/models/") && /int-?64/.test(fileName),
		)?.[1];
		expect(componentSource, Object.keys(first.files).join(", ")).toBeDefined();
		expect(componentSource).toMatch(/export const \w+ = z\.int\(\)/);
		expect(
			first.files["users/get-item.schema.ts"]?.match(/z\.int\(\)/g),
		).toHaveLength(3);
		expect(first.files["users/get-item.schema.ts"]).toContain(
			"getItemResponseSchema200Headers",
		);
		expect(
			generatedInitializer(
				componentSource ?? "",
				/export const (\w+) = z\.int\(\)/.exec(componentSource ?? "")?.[1] ??
					"",
			),
		).toBe("z.int()");
	});

	it("fails unsupported component and response-header schemas closed", async () => {
		const input = {
			openapi: "3.1.2",
			info: { title: "unsupported validation", version: "1" },
			paths: {
				"/unsafe": {
					get: {
						operationId: "getUnsafe",
						responses: {
							200: {
								description: "OK",
								headers: {
									"X-Unique": {
										schema: { type: "array", uniqueItems: true },
									},
								},
								content: {
									"application/json": {
										schema: { $ref: "#/components/schemas/Unsafe" },
									},
								},
							},
						},
					},
				},
			},
			components: {
				schemas: {
					Forbidden: { type: "string" },
					Unsafe: {
						type: "object",
						properties: {
							child: { $ref: "#/components/schemas/Unsafe" },
						},
						not: { $ref: "#/components/schemas/Forbidden" },
					},
				},
			},
		} as never;
		const result = await generatedSources(input);
		const diagnostics = result.diagnostics.filter(
			({ code }) => code === "ZOD_UNSUPPORTED_VALIDATION_KEYWORD",
		);
		expect(diagnostics).toHaveLength(2);
		expect(diagnostics.every(({ severity }) => severity === "error")).toBe(
			true,
		);
		expect(diagnostics.map(({ message }) => message).sort()).toEqual([
			'Unsupported validation keyword(s): "not". Generated z.never() to avoid silently widening validation.',
			'Unsupported validation keyword(s): "uniqueItems". Generated z.never() to avoid silently widening validation.',
		]);

		const unsafeSource = result.files["zod/models/unsafe.schema.ts"] ?? "";
		expect(unsafeSource).toContain("unsafeSchema = z.never()");
		expect(unsafeSource).not.toContain("forbiddenSchema");
		const responseSource =
			Object.entries(result.files).find(([fileName]) =>
				fileName.endsWith("get-unsafe.schema.ts"),
			)?.[1] ?? "";
		expect(responseSource).toContain("z.never()");
		expect(await generatedSources(input)).toEqual(result);
	});

	it.each(["3.0.4", "3.1.2", "3.2.1"])(
		"applies schema $ref siblings using source dialect %s",
		async (openapi) => {
			const input = {
				openapi,
				info: { title: "ref sibling", version: "1" },
				paths: {},
				components: {
					schemas: {
						Base: { type: "string" },
						Sibling: {
							$ref: "#/components/schemas/Base",
							allOf: [{ $ref: "#/components/schemas/Minimum" }],
						},
						Minimum: { type: "string", minLength: 6 },
					},
				},
			} as never;
			const result = await generatedSources(input);
			const source = result.files["zod/models/sibling.schema.ts"] ?? "";
			const initializer = generatedInitializer(source, "siblingSchema");
			const baseInitializer = generatedInitializer(
				result.files["zod/models/base.schema.ts"] ?? "",
				"baseSchema",
			);
			const minimumInitializer = generatedInitializer(
				result.files["zod/models/minimum.schema.ts"] ?? "",
				"minimumSchema",
			);
			const schema = new Function(
				"z",
				`const baseSchema = ${baseInitializer}; const minimumSchema = ${minimumInitializer}; return (${initializer});`,
			)(z) as z.ZodType;
			const active = openapi !== "3.0.4";
			expect(source.includes("minimumSchema")).toBe(active);
			expect(schema.safeParse("abc").success).toBe(!active);
			const repeated = await generatedSources(input);
			expect(repeated).toEqual(result);
		},
	);

	it.each(["3.0.4", "3.1.2", "3.2.1"])(
		"diagnoses int64 $ref siblings only when active in OAS %s",
		async (openapi) => {
			const result = await generatedSources({
				openapi,
				info: { title: "int64 ref sibling", version: "1" },
				paths: {},
				components: {
					schemas: {
						Base: { type: "integer" },
						Int64Sibling: {
							$ref: "#/components/schemas/Base",
							type: "integer",
							format: "int64",
						},
					},
				},
			} as never);
			const warnings = result.diagnostics.filter(
				({ code }) => code === "ZOD_INT64_SAFE_INTEGER_ONLY",
			);
			expect(warnings.length).toBe(openapi === "3.0.4" ? 0 : 1);
			expect(warnings.every(({ severity }) => severity === "warning")).toBe(
				true,
			);
			expect(
				await generatedSources({
					openapi,
					info: { title: "int64 ref sibling", version: "1" },
					paths: {},
					components: {
						schemas: {
							Base: { type: "integer" },
							Int64Sibling: {
								$ref: "#/components/schemas/Base",
								type: "integer",
								format: "int64",
							},
						},
					},
				} as never),
			).toEqual(result);
		},
	);

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
		expect(first.files["zod/responses/header-body.schema.ts"]).toContain(
			'export const ResponseHeaderBodyHeaders = z.looseObject({ "x-choice": overlappingChoiceSchema.optional(), "x-request-id": headerRequestIdSchema })',
		);
		expect(Object.keys(first.files)).toContain(
			"zod/requestBodies/any-body.schema.ts",
		);
		expect(Object.keys(first.files)).toContain("users/search-users.schema.ts");
		expect(Object.keys(first.files)).toContain("users/get-choice.schema.ts");

		const all = Object.values(first.files).join("\n");
		expect(all).toContain('import { z } from "zod"');
		expect(all).toContain("z.email()");
		expect(all).toContain("z.xor([");
		expect(all).toContain("z.intersection(");
		expect(all).toContain("z.record(z.string(), profileSchema)");
		expect(all).toContain('"user-id": z.string().optional()');
		expect(all).not.toMatch(/z\.string\(\)\.(?:email|url|uuid|datetime)\(/);
		expect(all).not.toMatch(/\bz\.record\(\s*[^,()]+(?:\([^()]*\))?\s*\)/);
		expect(all).not.toContain("z.string() | z.number()");
		expect(all).not.toContain("z.string() &");
		expect(first.files["users/get-choice.schema.ts"]).toContain(
			'import { choiceSchema } from "../zod/models/choice.schema.ts"',
		);
		expect(first.files["zod/models/choice.schema.ts"]).toContain("z.xor([");
		const choiceSource = first.files["zod/models/choice.schema.ts"] ?? "";
		const choicePrefix =
			'import { z } from "zod";\nexport const choiceSchema = ';
		expect(choiceSource.startsWith(choicePrefix)).toBe(true);
		const choiceExpression = choiceSource
			.slice(choicePrefix.length)
			.trim()
			.replace(/;$/, "");
		const generatedChoice = Function(
			"z",
			`"use strict"; return (${choiceExpression});`,
		)(z) as z.ZodType;
		expect(generatedChoice.safeParse("text").success).toBe(true);
		expect(generatedChoice.safeParse(42).success).toBe(true);
		expect(generatedChoice.safeParse(false).success).toBe(false);

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
		expect(first.files["zod/models/recursive-object-map.schema.ts"]).toContain(
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
			"components/headers",
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
		const responseHeaders =
			first.files["users/response-headers.schema.ts"] ?? "";
		expect(responseHeaders).toContain(
			"export const responseHeadersResponseSchema200Headers = z.looseObject",
		);
		expect(responseHeaders).toContain(
			"export const responseHeadersResponseSchema201Headers = z.looseObject",
		);
		expect(responseHeaders).toContain('"x-optional": z.string().optional()');
		expect(responseHeaders).toContain('"x-page": z.int().optional()');
		expect(responseHeaders).not.toContain("content-type");
		expect(responseHeaders).toContain('"retry-after": z.int().optional()');
		expect(first.files["users/no-content.schema.ts"]).not.toContain("Headers");

		const headerResponseInitializer = generatedInitializer(
			responseHeaders,
			"responseHeadersResponseSchema200Headers",
		);
		const headerValueSource =
			first.files["zod/models/header-request-id.schema.ts"] ?? "";
		const overlappingChoiceSource =
			first.files["zod/models/overlapping-choice.schema.ts"] ?? "";
		const headerRequestIdSchema = new Function(
			"z",
			`return (${generatedInitializer(headerValueSource, "headerRequestIdSchema")});`,
		)(z) as z.ZodType;
		const overlappingChoiceSchema = new Function(
			"z",
			`return (${generatedInitializer(overlappingChoiceSource, "overlappingChoiceSchema")});`,
		)(z) as z.ZodType;
		const response200Headers = new Function(
			"z",
			"headerRequestIdSchema",
			"overlappingChoiceSchema",
			`return (${headerResponseInitializer});`,
		)(z, headerRequestIdSchema, overlappingChoiceSchema) as z.ZodType;
		expect(
			response200Headers.safeParse({ "x-request-id": "abc" }).success,
		).toBe(true);
		expect(
			response200Headers.safeParse({
				"x-request-id": "abc",
				"x-extra": true,
			}).success,
		).toBe(true);
		expect(response200Headers.safeParse({}).success).toBe(false);
		expect(response200Headers.safeParse({ "x-request-id": "a" }).success).toBe(
			false,
		);
		expect(
			response200Headers.safeParse({
				"x-request-id": "abc",
				"x-choice": "overlap",
				"x-extra": true,
			}).success,
		).toBe(false);
		const response201Headers = new Function(
			"z",
			`return (${generatedInitializer(responseHeaders, "responseHeadersResponseSchema201Headers")});`,
		)(z) as z.ZodType;
		expect(response201Headers.safeParse({}).success).toBe(true);
		expect(
			response201Headers.safeParse({
				"x-page": 42,
				"x-tags": ["one", "two"],
				"x-meta": { active: true },
				"x-boolean": { any: "value" },
			}).success,
		).toBe(true);
		expect(response201Headers.safeParse({ "x-page": "42" }).success).toBe(
			false,
		);
		expect(response201Headers.safeParse({ "x-tags": ["one", 2] }).success).toBe(
			false,
		);
		expect(
			response201Headers.safeParse({ "x-meta": { active: "yes" } }).success,
		).toBe(false);
		expect(
			response201Headers.safeParse({ "x-never": "any value" }).success,
		).toBe(false);
		expect(response201Headers.safeParse({ "content-type": true }).success).toBe(
			true,
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

	it("emits prototype-like header names as safe data properties", async () => {
		const protoFixture = structuredClone(fixture) as {
			paths: Record<string, Record<string, unknown>>;
		};
		protoFixture.paths["/response-header-proto"] = {
			get: {
				operationId: "responseHeaderProto",
				tags: ["Users"],
				responses: {
					"200": {
						description: "Prototype-like header",
						headers: Object.fromEntries([
							["__PROTO__", { schema: { type: "string" } }],
							["constructor", { schema: { type: "boolean" } }],
						]),
					},
				},
			},
		};
		const result = await generatedSources(protoFixture);
		const source = result.files["users/response-header-proto.schema.ts"] ?? "";
		const schema = new Function(
			"z",
			`return (${generatedInitializer(source, "responseHeaderProtoResponseSchema200Headers")});`,
		)(z) as z.ZodType;
		const value = Object.fromEntries([
			["__proto__", "safe"],
			["constructor", true],
		]);
		expect(schema.safeParse(value).success).toBe(true);
		expect(source).toContain('["__proto__"]');
	});

	it("fails closed for response header identity collisions", async () => {
		const collisionFixture = structuredClone(fixture) as {
			paths: Record<string, Record<string, unknown>>;
		};
		collisionFixture.paths["/response-header-collision"] = {
			get: {
				operationId: "responseHeaderCollision",
				tags: ["Users"],
				responses: {
					"200": {
						description: "Collision",
						headers: {
							"X-Foo": { schema: { type: "string" } },
							"x-foo": { schema: { type: "integer" } },
						},
					},
				},
			},
		};
		const result = await generatedSources(collisionFixture);
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "ZOD_RESPONSE_HEADER_NAME_COLLISION",
				severity: "error",
			}),
		);
		expect(result.files["users/response-header-collision.schema.ts"]).toContain(
			"export const responseHeaderCollisionResponseSchema200Headers = z.never()",
		);
	});

	it("diagnoses unresolved and cyclic Header Object references", async () => {
		const invalidRefsFixture = structuredClone(fixture) as {
			paths: Record<string, Record<string, unknown>>;
			components: { headers: Record<string, unknown> };
		};
		invalidRefsFixture.components.headers.CycleA = {
			$ref: "#/components/headers/CycleB",
		};
		invalidRefsFixture.components.headers.CycleB = {
			$ref: "#/components/headers/CycleA",
		};
		invalidRefsFixture.paths["/response-header-invalid-ref"] = {
			get: {
				operationId: "responseHeaderInvalidRef",
				tags: ["Users"],
				responses: {
					"200": {
						description: "Invalid header refs",
						headers: {
							"X-Missing": { $ref: "#/components/headers/Missing" },
							"X-Cycle": { $ref: "#/components/headers/CycleA" },
						},
					},
				},
			},
		};
		const result = await generatedSources(invalidRefsFixture);
		const diagnostics = result.diagnostics.filter(
			(diagnostic) =>
				diagnostic.code === "ZOD_RESPONSE_HEADER_REFERENCE_UNRESOLVED",
		);
		expect(diagnostics).toHaveLength(2);
		expect(diagnostics.every(({ severity }) => severity === "error")).toBe(
			true,
		);
		const source =
			result.files["users/response-header-invalid-ref.schema.ts"] ?? "";
		expect(source).toContain('"x-cycle": z.never().optional()');
		expect(source).toContain('"x-missing": z.never().optional()');
	});

	it("generates isolated deterministic wildcard and default response headers", async () => {
		const statusFixture = structuredClone(fixture) as {
			paths: Record<string, Record<string, unknown>>;
		};
		statusFixture.paths["/response-header-statuses"] = {
			get: {
				operationId: "responseHeaderStatuses",
				tags: ["Users"],
				responses: {
					"2XX": {
						description: "Any successful response",
						headers: {
							"X-Trace": {
								required: true,
								schema: { type: "string" },
							},
						},
					},
					default: {
						description: "Fallback response",
						headers: {
							"X-Error-Code": { schema: { type: "string" } },
						},
					},
				},
			},
		};

		const result = await generatedSources(statusFixture);
		const source =
			result.files["users/response-header-statuses.schema.ts"] ?? "";
		const wildcardName = "responseHeaderStatusesResponseSchema2XXHeaders";
		const defaultName = "responseHeaderStatusesResponseSchemaDefaultHeaders";
		const wildcardInitializer = generatedInitializer(source, wildcardName);
		const defaultInitializer = generatedInitializer(source, defaultName);
		expect(wildcardInitializer).toBe(
			'z.looseObject({ "x-trace": z.string() })',
		);
		expect(defaultInitializer).toBe(
			'z.looseObject({ "x-error-code": z.string().optional() })',
		);
		expect(wildcardInitializer).not.toContain("x-error-code");
		expect(defaultInitializer).not.toContain("x-trace");
		expect(source).toContain(
			"export const responseHeaderStatusesResponseErrorSchema",
		);
		expect(source).toContain("responseHeaderStatusesResponseSchemaDefault");

		const wildcardSchema = new Function(
			"z",
			`return (${wildcardInitializer});`,
		)(z) as z.ZodType;
		const defaultSchema = new Function("z", `return (${defaultInitializer});`)(
			z,
		) as z.ZodType;
		expect(wildcardSchema.safeParse({ "x-trace": "trace-id" }).success).toBe(
			true,
		);
		expect(wildcardSchema.safeParse({}).success).toBe(false);
		expect(defaultSchema.safeParse({}).success).toBe(true);
	});
});
