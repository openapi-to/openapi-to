import { describe, expect, it } from "vitest";
import { renderSchema, SchemaRenderError } from "./schemaRenderer.ts";

const document = (
	schemas: Record<string, unknown> = {},
	openapi = "3.1.0",
) => ({
	openapi,
	components: { schemas },
});

describe("Faker schema renderer", () => {
	it("uses deterministic null for true schemas and rejects false schemas", () => {
		expect(renderSchema(true, document(), ["schema"]).expression).toBe("null");
		expect(() => renderSchema(false, document(), ["schema"])).toThrowError(
			SchemaRenderError,
		);
		expect(
			renderSchema({ type: "boolean" }, document(), ["schema"]).expression,
		).toBe("faker.datatype.boolean()");
		expect(
			renderSchema({ type: "null" }, document(), ["schema"]).expression,
		).toBe("null");
		expect(
			renderSchema({ type: ["string", "null"], enum: [null] }, document(), [
				"schema",
			]).expression,
		).toBe("null");
		expect(
			renderSchema(
				{ type: "string", nullable: true, enum: [null] },
				document({}, "3.0.4"),
				["schema"],
			).expression,
		).toBe("null");
		expect(
			renderSchema(
				{ type: ["string", "null"], enum: ["allowed"], default: null },
				document(),
				["schema"],
			),
		).toMatchObject({
			expression: '"allowed"',
			diagnostics: [{ code: "FAKER_INVALID_LITERAL_CANDIDATE" }],
		});
		expect(
			renderSchema(
				{ type: "string", nullable: true, enum: ["allowed"], example: null },
				document({}, "3.0.4"),
				["schema"],
			),
		).toMatchObject({
			expression: '"allowed"',
			diagnostics: [{ code: "FAKER_INVALID_LITERAL_CANDIDATE" }],
		});
	});

	it("preserves literal precedence and falls through invalid candidates with a warning", () => {
		expect(
			renderSchema(
				{ type: "string", const: "fixed", examples: ["other"] },
				document(),
				["s"],
			).expression,
		).toBe('"fixed"');
		const fallback = renderSchema(
			{ type: "string", minLength: 3, examples: ["x"], default: "valid" },
			document(),
			["s"],
		);
		expect(fallback.expression).toBe('"valid"');
		expect(fallback.diagnostics.map(({ code }) => code)).toEqual([
			"FAKER_INVALID_LITERAL_CANDIDATE",
		]);
		expect(
			renderSchema(
				{
					type: "string",
					examples: ["first", "second"],
					example: "third",
					default: "fourth",
				},
				document(),
				["s"],
			).expression,
		).toBe('"first"');
		expect(() =>
			renderSchema({ type: "string", const: "x", minLength: 2 }, document(), [
				"s",
			]),
		).toThrowError(/const value violates/);
		expect(() =>
			renderSchema({ type: "object", const: { name: "x" } }, document(), ["s"]),
		).toThrowError(/Only scalar const/);
		expect(() =>
			renderSchema({ type: "integer", enum: [1, 2], minimum: 3 }, document(), [
				"n",
			]),
		).toThrowError(/No enum value satisfies/);
		expect(() =>
			renderSchema({ type: "string", enum: [] }, document(), ["s"]),
		).toThrowError(/empty enum/);
		expect(() =>
			renderSchema(
				{ type: "string", format: "email", enum: ["not-an-email"] },
				document(),
				["s"],
			),
		).toThrowError(/No enum value satisfies/);
	});

	it("renders bounded primitive values and rejects untrusted patterns", () => {
		expect(
			renderSchema(
				{ type: "string", minLength: 10, maxLength: 12 },
				document(),
				["s"],
			).expression,
		).toContain("length: 10");
		expect(
			renderSchema({ type: "integer", minimum: 3, maximum: 5 }, document(), [
				"n",
			]).expression,
		).toContain("min: 3, max: 5");
		expect(() =>
			renderSchema({ type: "string", pattern: "(a+)+$" }, document(), ["s"]),
		).toThrowError(/pattern/);
		const fallback = renderSchema(
			{ type: "string", format: "x'; import('evil')" },
			document(),
			["s"],
		);
		expect(fallback.expression).toContain("faker.string.alphanumeric");
		expect(fallback.diagnostics[0]?.code).toBe("FAKER_FORMAT_FALLBACK");
		expect(() =>
			renderSchema({ type: "string", format: "binary" }, document(), ["s"]),
		).toThrowError(/not supported/);
		expect(
			renderSchema({ type: "string", format: "date-time" }, document(), ["s"])
				.expression,
		).toContain('"2000-01-01T00:00:00.000Z"');
		expect(
			renderSchema({ type: "string", format: "date-time" }, document(), ["s"])
				.expression,
		).not.toMatch(/past\(|future\(|recent\(|soon\(|Date\.now/);
		expect(
			renderSchema({ type: "string", format: "time" }, document(), ["s"])
				.expression,
		).toContain("faker.number.int");
	});

	it("bounds arrays and emits object keys as string literals", () => {
		expect(
			renderSchema(
				{ type: "array", minItems: 1, maxItems: 2, items: { type: "boolean" } },
				document(),
				["a"],
			).expression,
		).toBe("[faker.datatype.boolean(), faker.datatype.boolean()]");
		expect(
			renderSchema(
				{
					type: "object",
					properties: { 'a`\n"b': { type: "null" } },
					required: ['a`\n"b'],
				},
				document(),
				["o"],
			).expression,
		).toContain(JSON.stringify('a`\n"b'));
		expect(() =>
			renderSchema({ type: "array", minItems: 33, items: true }, document(), [
				"a",
			]),
		).toThrowError(/minItems/);
		expect(() =>
			renderSchema(
				{ type: "array", minItems: 0, maxItems: -1, items: true },
				document(),
				["a"],
			),
		).toThrowError(/valid length/);
		expect(
			renderSchema(
				{
					type: "array",
					minItems: 2,
					maxItems: 2,
					uniqueItems: true,
					items: { enum: ["a", "a", "b"] },
				},
				document(),
				["a"],
			).expression,
		).toBe('["a", "b"]');
		expect(
			renderSchema(
				{
					type: "object",
					properties: { ["__proto__"]: { type: "string" } },
					required: ["__proto__"],
				},
				document(),
				["o"],
			).expression,
		).toContain('["__proto__"]: faker.string.alphanumeric');
		expect(
			renderSchema(
				{
					type: "object",
					properties: {
						name: { type: "string" },
						optional: { type: "boolean" },
					},
					required: ["name"],
					maxProperties: 1,
				},
				document(),
				["o"],
			).expression,
		).toBe('{ "name": faker.string.alphanumeric({ length: 8 }) }');
		expect(
			renderSchema(
				{
					type: "object",
					required: ["ghost"],
					additionalProperties: { type: "integer", minimum: 3, maximum: 4 },
				},
				document(),
				["o"],
			).expression,
		).toBe('{ "ghost": faker.number.int({ min: 3, max: 4 }) }');
		expect(
			renderSchema(
				{ type: "object", required: ["ghost"], additionalProperties: true },
				document(),
				["o"],
			).expression,
		).toBe('{ "ghost": null }');
		expect(() =>
			renderSchema(
				{ type: "object", required: ["a", "b"], maxProperties: 1 },
				document(),
				["o"],
			),
		).toThrowError(/maxProperties/);
	});

	it("expands projected local references and terminates optional recursive properties", () => {
		const api = document({
			Pet: {
				type: "object",
				properties: {
					name: { type: "string" },
					next: { $ref: "#/components/schemas/Pet" },
				},
				required: ["name"],
			},
		});
		const generated = renderSchema({ $ref: "#/components/schemas/Pet" }, api, [
			"components",
			"schemas",
			"Pet",
		]);
		expect(generated.expression).toContain('"name": faker.string.alphanumeric');
		expect(generated.expression).not.toContain("next");
		expect(() =>
			renderSchema({ $ref: "https://example.invalid/schema" }, api, ["schema"]),
		).toThrowError(/local component/);
		const nullableApi = document(
			{
				NullableNode: {
					type: "object",
					nullable: true,
					properties: {
						next: { $ref: "#/components/schemas/NullableNode" },
					},
					required: ["next"],
				},
			},
			"3.0.4",
		);
		expect(
			renderSchema({ $ref: "#/components/schemas/NullableNode" }, nullableApi, [
				"schema",
			]).expression,
		).toBe('{ "next": null }');
		expect(() =>
			renderSchema(
				{ $ref: "#/components/schemas/RequiredNode" },
				document({
					RequiredNode: {
						type: "object",
						properties: {
							next: {
								$ref: "#/components/schemas/RequiredNode",
								nullable: true,
							},
						},
						required: ["next"],
					},
				}),
				["schema"],
			),
		).toThrowError(/recursive/);
		expect(() =>
			renderSchema(
				{ $ref: "#/components/schemas/RequiredNode" },
				document({
					RequiredNode: {
						type: "object",
						properties: {
							next: {
								$ref: "#/components/schemas/RequiredNode",
								type: ["object", "null"],
							},
						},
						required: ["next"],
					},
				}),
				["schema"],
			),
		).toThrowError(/Validation keywords alongside a local \$ref/);
		const nullableUnionApi = document({
			NullableNode: {
				type: ["object", "null"],
				properties: {
					next: { $ref: "#/components/schemas/NullableNode" },
				},
				required: ["next"],
			},
		});
		expect(
			renderSchema(
				{ $ref: "#/components/schemas/NullableNode" },
				nullableUnionApi,
				["schema"],
			).expression,
		).toBe('{ "next": null }');
	});

	it("terminates mutual and array recursion only at schema-valid optional boundaries", () => {
		const api = document({
			A: {
				type: "object",
				properties: { b: { $ref: "#/components/schemas/B" } },
			},
			B: {
				type: "object",
				properties: { a: { $ref: "#/components/schemas/A" } },
				required: ["a"],
			},
			Tree: { type: "array", items: { $ref: "#/components/schemas/Tree" } },
			RequiredTree: {
				type: "array",
				minItems: 1,
				items: { $ref: "#/components/schemas/RequiredTree" },
			},
		});
		expect(
			renderSchema({ $ref: "#/components/schemas/A" }, api, ["schema"])
				.expression,
		).toBe("{  }");
		expect(
			renderSchema({ $ref: "#/components/schemas/Tree" }, api, ["schema"])
				.expression,
		).toBe("[]");
		expect(() =>
			renderSchema({ $ref: "#/components/schemas/RequiredTree" }, api, [
				"schema",
			]),
		).toThrowError(/recursive/);
	});

	it("fails closed for required unbounded recursion and ambiguous oneOf", () => {
		const api = document({
			Node: {
				type: "object",
				properties: { next: { $ref: "#/components/schemas/Node" } },
				required: ["next"],
			},
		});
		expect(() =>
			renderSchema({ $ref: "#/components/schemas/Node" }, api, [
				"components",
				"schemas",
				"Node",
			]),
		).toThrowError(/recursive/);
		expect(() =>
			renderSchema(
				{ oneOf: [{ type: "string" }, { type: "string", minLength: 2 }] },
				document(),
				["s"],
			),
		).toThrowError(/mutually exclusive/);
		expect(
			renderSchema({ type: ["null", "string"], nullable: true }, document(), [
				"s",
			]).expression,
		).toBe("faker.string.alphanumeric({ length: 8 })");
	});

	it("proves oneOf exclusivity from primitive types and finite scalar domains", () => {
		expect(
			renderSchema(
				{ oneOf: [{ type: "string" }, { type: "boolean" }] },
				document(),
				["s"],
			).expression,
		).toContain("faker.string.alphanumeric");
		expect(
			renderSchema(
				{ oneOf: [{ enum: ["a", "b"] }, { enum: ["c"] }] },
				document(),
				["s"],
			).expression,
		).toBe('faker.helpers.arrayElement(["a","b"])');
		expect(
			renderSchema(
				{ oneOf: [{ const: "fixed" }, { type: "string", enum: ["other"] }] },
				document(),
				["s"],
			).expression,
		).toBe('"fixed"');
		expect(() =>
			renderSchema(
				{ oneOf: [{ type: "number" }, { type: "integer" }] },
				document(),
				["s"],
			),
		).toThrowError(/mutually exclusive/);
		expect(() =>
			renderSchema(
				{ oneOf: [{ enum: ["a", "b"] }, { enum: ["b", "c"] }] },
				document(),
				["s"],
			),
		).toThrowError(/mutually exclusive/);
	});

	it("rejects validation siblings that composition branches would otherwise ignore", () => {
		expect(() =>
			renderSchema({ anyOf: [{ type: "string" }], minLength: 20 }, document(), [
				"s",
			]),
		).toThrowError(/alongside anyOf/);
		expect(() =>
			renderSchema(
				{ allOf: [{ type: "string" }], pattern: "unsafe" },
				document(),
				["s"],
			),
		).toThrowError(/pattern/);
		expect(() =>
			renderSchema(
				{
					type: "string",
					$dynamicRef: "#/$defs/OnlyA",
					$defs: { OnlyA: { const: "a" } },
				},
				document(),
				["schema"],
			),
		).toThrowError(/\$dynamicRef/);
	});

	it("fails closed when semantic formats have string length constraints", () => {
		expect(() =>
			renderSchema(
				{ type: "string", format: "email", maxLength: 8 },
				document(),
				["s"],
			),
		).toThrowError(/length constraints/);
	});

	it("combines compatible object allOf and selects the first supported anyOf branch", () => {
		const combined = renderSchema(
			{
				allOf: [
					{
						type: "object",
						properties: { id: { type: "integer", minimum: 1 } },
						required: ["id"],
					},
					{
						type: "object",
						properties: { name: { type: "string" } },
						required: ["name"],
					},
				],
			},
			document(),
			["s"],
		);
		expect(combined.expression).toContain('"id": faker.number.int');
		expect(combined.expression).toContain('"name": faker.string.alphanumeric');
		expect(() =>
			renderSchema(
				{
					allOf: [
						{ type: "object", properties: { id: { type: "string" } } },
						{ type: "object", properties: { id: { type: "boolean" } } },
					],
				},
				document(),
				["s"],
			),
		).toThrowError(/incompatible schemas/);
		for (const constraint of [
			{ const: { state: "locked" } },
			{ enum: [{ state: "locked" }] },
		]) {
			expect(() =>
				renderSchema(
					{
						allOf: [
							{
								type: "object",
								properties: { state: { type: "string" } },
								required: ["state"],
								...constraint,
							},
							{ type: "object", properties: { active: { type: "boolean" } } },
						],
					},
					document(),
					["s"],
				),
			).toThrowError(/const or enum/);
		}
		expect(
			renderSchema(
				{ anyOf: [{ type: "string", pattern: "nope" }, { type: "boolean" }] },
				document(),
				["s"],
			).expression,
		).toBe("faker.datatype.boolean()");
		expect(() =>
			renderSchema(
				{ anyOf: [{ type: "string", pattern: "nope" }] },
				document(),
				["s"],
			),
		).toThrowError(/No anyOf branch/);
		expect(() =>
			renderSchema({ type: "string", not: { const: "blocked" } }, document(), [
				"s",
			]),
		).toThrowError(/not/);
	});

	it("enforces resource limits and numeric multipleOf constraints", () => {
		expect(() =>
			renderSchema({ type: "string", minLength: 1025 }, document(), ["s"]),
		).toThrowError(/resource|limit/i);
		expect(() =>
			renderSchema(
				{ type: "array", minItems: 33, items: { type: "string" } },
				document(),
				["s"],
			),
		).toThrowError(/minItems/);
		expect(() =>
			renderSchema(
				{ type: "integer", minimum: 1, maximum: 4, multipleOf: 2 },
				document(),
				["n"],
			),
		).not.toThrow();
		expect(() =>
			renderSchema(
				{ type: "integer", minimum: 1, maximum: 1, multipleOf: 2 },
				document(),
				["n"],
			),
		).toThrowError(/multipleOf/);
		expect(
			renderSchema(
				{ type: "integer", minimum: 0, maximum: 3, multipleOf: 1e-9 },
				document(),
				["n"],
			).expression,
		).toContain("min: 0, max: 3");
		expect(() =>
			renderSchema({ type: "integer", multipleOf: 1e-13 }, document(), ["n"]),
		).toThrowError(/12 decimal places/);
		const decimalMultiple = renderSchema(
			{ type: "number", minimum: 0.3, maximum: 0.4, multipleOf: 0.1 },
			document(),
			["n"],
		);
		expect(decimalMultiple.expression).toContain("min: 3, max: 4");
		expect(decimalMultiple.expression).toContain(" / 10");
		const exclusiveDecimal = renderSchema(
			{
				type: "number",
				exclusiveMinimum: 0.3,
				maximum: 0.4,
				multipleOf: 0.1,
			},
			document(),
			["n"],
		);
		expect(exclusiveDecimal.expression).toContain("min: 4, max: 4");
		const invalidExample = renderSchema(
			{
				type: "number",
				minimum: 0.3,
				maximum: 0.4,
				multipleOf: 0.1,
				example: 0.30000000000000004,
			},
			document(),
			["n"],
		);
		expect(invalidExample.expression).not.toBe("0.30000000000000004");
	});
});
