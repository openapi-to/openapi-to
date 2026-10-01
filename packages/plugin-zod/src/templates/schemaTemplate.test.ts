import { describe, expect, it } from "vitest";
import ts from "typescript";
import { z } from "zod";
import { recursiveSchemaTypeTemplate } from "./recursiveSchemaTypeTemplate.ts";
import { renderObjectSchema, schemaTemplate } from "./schemaTemplate.ts";


const GeneratedFunction = ((...parameters: string[]) => {
	const body = parameters.pop() ?? "";
	return new globalThis.Function(...parameters, ts.transpile(body));
}) as unknown as FunctionConstructor;

function evaluate(schema: unknown) {
	return GeneratedFunction(
		"z",
		`"use strict"; return (${schemaTemplate(schema as never, "", "", { onDiagnostic: () => {} })});`,
	)(z) as z.ZodType;
}

describe("schemaTemplate Zod 4 output", () => {
	it.each([
		[{ type: "string", format: "email" }, "z.email()"],
		[{ type: "string", format: "uri" }, "z.url()"],
		[{ type: "string", format: "url" }, "z.url()"],
		[{ type: "string", format: "uuid" }, "z.uuid()"],
		[{ type: "string", format: "date" }, "z.iso.date()"],
		[{ type: "string", format: "byte" }, "z.base64()"],
		[{ type: "string", format: "binary" }, "z.string()"],
	])("renders %j as %s", (schema, expected) => {
		expect(schemaTemplate(schema as never)).toBe(expected);
	});

	it("renders date-time as a bounded string refinement", () => {
		const expression = schemaTemplate({ type: "string", format: "date-time" } as never);
		expect(expression).toContain("dateTime.safeParse(value).success");
		expect(expression).toContain("const leapSecond = /^(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}):60(?:\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})$/;");
		expect(expression).toContain("Date.parse(surrogate)");
		expect(schemaTemplate({ type: "string", format: "datetime" } as never)).toBe(expression);
	});

	it("preserves string constraints on top-level formats", () => {
		expect(
			schemaTemplate({
				type: "string",
				format: "email",
				minLength: 3,
				maxLength: 40,
				pattern: ".+@.+",
			} as never),
		).toBe('z.email().min(3).max(40).regex(new RegExp(".+@.+"))');
	});

	it("keeps int64 as a safe number and rejects out-of-contract values", () => {
		const expression = schemaTemplate(
			{ type: "integer", format: "int64" } as never,
			"",
			"",
			{ onDiagnostic: () => {} },
		);
		expect(expression).toBe("z.int()");
		const schema = evaluate({ type: "integer", format: "int64" });
		const int64Min = -9223372036854775808n;
		const int64Max = 9223372036854775807n;

		expect(schema.safeParse(Number.MIN_SAFE_INTEGER).success).toBe(true);
		expect(schema.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(true);
		expect(schema.safeParse(Number.MIN_SAFE_INTEGER - 1).success).toBe(false);
		expect(schema.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
		expect(schema.safeParse(int64Min).success).toBe(false);
		expect(schema.safeParse(int64Max).success).toBe(false);
		expect(schema.safeParse(int64Min.toString()).success).toBe(false);
		expect(schema.safeParse(int64Max.toString()).success).toBe(false);
		for (const decimal of [int64Min.toString(), int64Max.toString()]) {
			const parsed = JSON.parse(decimal) as number;
			expect(Number.isSafeInteger(parsed)).toBe(false);
			expect(schema.safeParse(parsed).success).toBe(false);
		}
		const genericInteger = evaluate({ type: "integer" });
		expect(genericInteger.safeParse(Number.MIN_SAFE_INTEGER).success).toBe(
			true,
		);
		expect(genericInteger.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(
			true,
		);
		expect(genericInteger.safeParse(Number.MIN_SAFE_INTEGER - 1).success).toBe(
			false,
		);
		expect(genericInteger.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(
			false,
		);
		for (const value of [
			1.5,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
		]) {
			expect(schema.safeParse(value).success).toBe(false);
		}
	});

	it("emits one bounded int64 warning after fail-closed schema checks", () => {
		const diagnostics: Array<{ code: string; message: string }> = [];
		const schema = {
			type: "object",
			properties: {
				first: { type: "integer", format: "int64" },
				second: { type: "integer", format: "int64" },
			},
		};
		const expression = schemaTemplate(schema as never, "", "", {
			refSemanticContext: { dialect: "3.1", objectContext: "schema" },
			onDiagnostic: ({ code, message }) => diagnostics.push({ code, message }),
		});
		expect(expression).toContain("z.looseObject");
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.code).toBe("ZOD_INT64_SAFE_INTEGER_ONLY");
		expect(diagnostics[0]?.message).toContain("Number.MIN_SAFE_INTEGER");
		expect(diagnostics[0]?.message.length).toBeLessThan(300);

		const blockedDiagnostics: string[] = [];
		expect(
			schemaTemplate(
				{
					type: "integer",
					format: "int64",
					uniqueItems: true,
				} as never,
				"",
				"",
				{
					refSemanticContext: { dialect: "3.1", objectContext: "schema" },
					onDiagnostic: ({ code }) => blockedDiagnostics.push(code),
				},
			),
		).toBe("z.never()");
		expect(blockedDiagnostics).toEqual(["ZOD_UNSUPPORTED_VALIDATION_KEYWORD"]);
	});

	it("ignores annotation data and inactive OAS 3.0 $ref siblings", () => {
		const codes: string[] = [];
		const annotations = schemaTemplate(
			{
				type: "string",
				example: { format: "int64" },
				examples: [{ format: "int64" }],
				default: { format: "int64" },
				description: "format int64",
				"x-example": { format: "int64" },
			} as never,
			"",
			"",
			{ onDiagnostic: ({ code }) => codes.push(code) },
		);
		schemaTemplate(
			{
				$ref: "#/components/schemas/Base",
				type: "integer",
				format: "int64",
			} as never,
			"",
			"",
			{
				refSemanticContext: { dialect: "3.0", objectContext: "schema" },
				onDiagnostic: ({ code }) => codes.push(code),
			},
		);
		const inactiveDateTimeDiagnostics: string[] = [];
		const inactiveDateTime = schemaTemplate(
			{
				$ref: "#/components/schemas/BaseString",
				type: "string",
				format: "date-time",
			} as never,
			"",
			"",
			{
				refSemanticContext: { dialect: "3.0", objectContext: "schema" },
				onDiagnostic: ({ code }) => inactiveDateTimeDiagnostics.push(code),
			},
		);
		const activeDateTime = schemaTemplate(
			{
				$ref: "#/components/schemas/BaseString",
				type: "string",
				format: "date-time",
			} as never,
			"",
			"",
			{
				refSemanticContext: { dialect: "3.1", objectContext: "schema" },
				onDiagnostic: ({ code }) => inactiveDateTimeDiagnostics.push(code),
			},
		);
		expect(annotations).toContain("z.string()");
		expect(codes).toEqual([]);
		expect(inactiveDateTime).toBe("baseStringSchema");
		expect(activeDateTime).toContain("dateTime.safeParse(value)");
		expect(activeDateTime).toContain("z.intersection(baseStringSchema,");
		expect(inactiveDateTimeDiagnostics).toEqual([]);
	});

	it("enforces the documented RFC3339 date-time profile", () => {
		const schema = evaluate({ type: "string", format: "date-time" });
		for (const value of [
			"2026-07-28T12:30:00Z",
			"2026-07-28T12:30:00.123Z",
			"2026-07-28T12:30:00+08:00",
			"2026-07-28T12:30:00-05:30",
			"1990-12-31T23:59:60Z",
			"1990-12-31T15:59:60-08:00",
			"1991-01-01T00:59:60+01:00",
			"1990-12-31T23:59:60.5Z",
		]) {
			expect(schema.safeParse(value).success, value).toBe(true);
		}
		for (const value of [
			"2026-07-28T12:30Z",
			"2026-07-28 12:30:00Z",
			"2026-13-40T99:99:99Z",
			"2026-07-28T12:30:00+24:00",
			"2026-07-28T12:30:60Z",
			"1990-12-30T23:59:60Z",
			"1990-12-31T23:58:60Z",
			"1990-12-31T23:59:61Z",
			"1990-12-31T23:59:60+24:00",
			"1990-12-31T23:59:60",
			"1990-12-31T23:59:60+01:00",
			"2026-07-28T12:30Z",
			"2026-07-28T12:30:00z",
		]) {
			expect(schema.safeParse(value).success, value).toBe(false);
		}
	});

	it("preserves string constraints around the date-time refine", () => {
		const schema = evaluate({
			type: "string",
			format: "date-time",
			minLength: 20,
			maxLength: 40,
			pattern: "Z$",
		});
		expect(schema.safeParse("1990-12-31T23:59:60.5Z").success).toBe(true);
		expect(schema.safeParse("2026-07-28T12:30:00Z").success).toBe(true);
		expect(schema.safeParse("2026-07-28T12:30:00+08:00").success).toBe(
			false,
		);
		expect(schema.safeParse("1990-12-31T23:59:60").success).toBe(false);
	});

	it("preserves boolean and empty JSON schemas", () => {
		expect(schemaTemplate(true as never)).toBe("z.unknown()");
		expect(schemaTemplate(false as never)).toBe("z.never()");
		expect(schemaTemplate({} as never)).toBe("z.unknown()");
		expect(evaluate(true).safeParse({ any: "value" }).success).toBe(true);
		expect(evaluate({}).safeParse(null).success).toBe(true);
		expect(evaluate(false).safeParse(undefined).success).toBe(false);
		expect(
			evaluate({ type: "array", items: false }).safeParse([]).success,
		).toBe(true);
		expect(
			evaluate({ type: "array", items: false }).safeParse([1]).success,
		).toBe(false);
	});

	it("fails the whole entrypoint closed for unsupported validation keywords", () => {
		const diagnostics: Array<{ code: string; message: string }> = [];
		const schema = {
			oneOf: [
				{ type: "string", not: { const: "forbidden" } },
				{ type: "string" },
			],
		};
		const expression = schemaTemplate(schema as never, "", "", {
			refSemanticContext: { dialect: "3.1", objectContext: "schema" },
			onDiagnostic: ({ code, message }) => diagnostics.push({ code, message }),
		});
		expect(expression).toBe("z.never()");
		expect(diagnostics).toEqual([
			{
				code: "ZOD_UNSUPPORTED_VALIDATION_KEYWORD",
				message: expect.stringContaining('"not"'),
			},
		]);
		expect(
			GeneratedFunction("z", `return (${expression});`)(z).safeParse("ordinary").success,
		).toBe(false);
		expect(
			recursiveSchemaTypeTemplate(schema as never, {
				lazyRefs: new Set(),
				refSemanticContext: { dialect: "3.1", objectContext: "schema" },
			}),
		).toBe("never");
	});

	it("keeps unsupported validation keywords ahead of date-time rendering", () => {
		const diagnostics: string[] = [];
		const expression = schemaTemplate(
			{
				type: "string",
				format: "date-time",
				not: { const: "blocked" },
			} as never,
			"",
			"",
			{
				refSemanticContext: { dialect: "3.1", objectContext: "schema" },
				onDiagnostic: ({ code }) => diagnostics.push(code),
			},
		);
		expect(expression).toBe("z.never()");
		expect(diagnostics).toEqual(["ZOD_UNSUPPORTED_VALIDATION_KEYWORD"]);
	});

	it("fails closed for active OAS 3.1 $ref validation siblings", () => {
		const diagnostics: string[] = [];
		expect(
			schemaTemplate(
				{
					$ref: "#/components/schemas/Base",
					not: { type: "string" },
				} as never,
				"",
				"",
				{
					refSemanticContext: { dialect: "3.1", objectContext: "schema" },
					onDiagnostic: ({ code }) => diagnostics.push(code),
				},
			),
		).toBe("z.never()");
		expect(diagnostics).toEqual(["ZOD_UNSUPPORTED_VALIDATION_KEYWORD"]);
	});

	it.each([
		[{ type: "array", uniqueItems: true }, "3.0", "uniqueItems"],
		[{ type: "object", minProperties: 2 }, "3.0", "minProperties"],
		[{ type: "object", maxProperties: 1 }, "3.0", "maxProperties"],
		[
			{
				type: "object",
				properties: { value: { type: "array", uniqueItems: true } },
			},
			"3.1",
			"uniqueItems",
		],
		[
			{ type: "array", items: { type: "object", minProperties: 2 } },
			"3.1",
			"minProperties",
		],
		[
			{ allOf: [{ type: "object" }, { type: "object", maxProperties: 1 }] },
			"3.2",
			"maxProperties",
		],
	])("fails closed for %s in OAS %s", (schema, dialect, keyword) => {
		const diagnostics: Array<{ code: string; message: string }> = [];
		const expression = schemaTemplate(schema as never, "", "", {
			refSemanticContext: {
				dialect: dialect as "3.0" | "3.1" | "3.2",
				objectContext: "schema",
			},
			onDiagnostic: ({ code, message }) => diagnostics.push({ code, message }),
		});
		expect(expression).toBe("z.never()");
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.code).toBe("ZOD_UNSUPPORTED_VALIDATION_KEYWORD");
		expect(diagnostics[0]?.message).toContain(`"${keyword}"`);
	});

	it("does not scan ignored OAS 3.0 ref siblings or annotation data", () => {
		const diagnostics: string[] = [];
		const expression = schemaTemplate(
			{
				$ref: "#/components/schemas/Base",
				not: { type: "string" },
				description: "test",
				title: "Example",
				default: { maxProperties: 1 },
				examples: [{ contains: "example data" }],
				deprecated: true,
				"x-company-rule": { not: "metadata" },
			},
			"",
			"",
			{
				refSemanticContext: { dialect: "3.0", objectContext: "schema" },
				onDiagnostic: ({ code }) => diagnostics.push(code),
			},
		);
		expect(expression).toBe("baseSchema");
		expect(diagnostics).toEqual([]);

		const annotationExpression = schemaTemplate(
			{
				type: "object",
				unknownAnnotation: { not: "metadata" },
				"x-company-rule": { contains: "metadata" },
				examples: [{ not: "example data" }],
			},
			"",
			"",
			{
				refSemanticContext: { dialect: "3.2", objectContext: "schema" },
				onDiagnostic: ({ code }) => diagnostics.push(code),
			},
		);
		expect(annotationExpression).toBe("z.looseObject({})");
		expect(diagnostics).toEqual([]);
	});

	it("enforces int32, safe integer, and password boundaries", () => {
		const int32 = evaluate({ type: "integer", format: "int32" });
		expect(int32.safeParse(-2147483648).success).toBe(true);
		expect(int32.safeParse(2147483647).success).toBe(true);
		expect(int32.safeParse(-2147483649).success).toBe(false);
		expect(int32.safeParse(2147483648).success).toBe(false);
		expect(evaluate({ type: "integer" }).safeParse(1.5).success).toBe(false);
		expect(
			evaluate({ type: "integer", format: "int64" }).safeParse(
				Number.MAX_SAFE_INTEGER + 1,
			).success,
		).toBe(false);
		expect(
			evaluate({ type: "string", format: "password" }).safeParse("").success,
		).toBe(true);
		expect(
			evaluate({
				type: "string",
				format: "password",
				minLength: 1,
			}).safeParse("").success,
		).toBe(false);
	});

	it("combines validation-affecting sibling keywords", () => {
		const impossibleEnum = evaluate({
			type: "string",
			enum: ["a"],
			minLength: 2,
		});
		expect(impossibleEnum.safeParse("a").success).toBe(false);

		const patternedEnum = evaluate({
			enum: ["ab", "ac"],
			pattern: "^ab$",
		});
		expect(patternedEnum.safeParse("ab").success).toBe(true);
		expect(patternedEnum.safeParse("ac").success).toBe(false);

		const constant = evaluate({ const: 1, type: "string" });
		expect(constant.safeParse(1).success).toBe(false);
		expect(
			evaluate({
				oneOf: [{ type: "string" }, { type: "number" }],
				nullable: true,
			}).safeParse(null).success,
		).toBe(true);
		expect(
			evaluate({
				type: ["string", "null"],
				minLength: 2,
			}).safeParse("a").success,
		).toBe(false);

		const refSiblingExpression = schemaTemplate({
			$ref: "#/components/schemas/Base",
			type: "string",
			minLength: 2,
		} as never);
		expect(refSiblingExpression).toBe(
			"z.intersection(baseSchema, z.string().min(2))",
		);
		const refSibling = GeneratedFunction(
			"z",
			"baseSchema",
			`return (${refSiblingExpression});`,
		)(z, z.string()) as z.ZodType;
		expect(refSibling.safeParse("ab").success).toBe(true);
		expect(refSibling.safeParse("a").success).toBe(false);
	});

	it("diagnoses allOf/additionalProperties sibling semantics it cannot express exactly", () => {
		const diagnostics: string[] = [];
		const expression = schemaTemplate(
			{
				allOf: [
					{
						type: "object",
						properties: { value: { type: "string" } },
					},
				],
				additionalProperties: false,
			} as never,
			"",
			"",
			{ onDiagnostic: ({ code }) => diagnostics.push(code) },
		);
		expect(diagnostics).toEqual(["ZOD_UNSUPPORTED_SCHEMA_SIBLINGS"]);
		expect(
			GeneratedFunction("z", `return (${expression});`)(z).safeParse({ value: "x" })
				.success,
		).toBe(true);
	});

	it("renders string, numeric, boolean, mixed, single and escaped enums", () => {
		expect(schemaTemplate({ enum: ["a", "b"] } as never)).toBe(
			'z.enum(["a", "b"])',
		);
		expect(schemaTemplate({ enum: [1, 2] } as never)).toBe(
			"z.union([z.literal(1), z.literal(2)])",
		);
		expect(schemaTemplate({ enum: [true, false] } as never)).toBe(
			"z.union([z.literal(true), z.literal(false)])",
		);
		expect(schemaTemplate({ enum: ["a", 2, false] } as never)).toBe(
			'z.union([z.literal("a"), z.literal(2), z.literal(false)])',
		);
		expect(schemaTemplate({ enum: ["single"] } as never)).toBe(
			'z.literal("single")',
		);
		expect(schemaTemplate({ enum: ['quote"', "slash\\\n"] } as never)).toBe(
			'z.enum(["quote\\"", "slash\\\\\\n"])',
		);
	});

	it("diagnoses empty enums and compositions without emitting broken code", () => {
		const diagnostics: string[] = [];
		expect(
			schemaTemplate({ enum: [] } as never, "", "", {
				onDiagnostic: ({ code }) => diagnostics.push(code),
			}),
		).toBe("z.never()");
		expect(
			schemaTemplate({ oneOf: [] } as never, "", "", {
				onDiagnostic: ({ code }) => diagnostics.push(code),
			}),
		).toBe("z.never()");
		expect(
			schemaTemplate({ allOf: [] } as never, "", "", {
				onDiagnostic: ({ code }) => diagnostics.push(code),
			}),
		).toBe("z.never()");
		expect(diagnostics).toEqual([
			"ZOD_EMPTY_ENUM",
			"ZOD_EMPTY_COMPOSITION",
			"ZOD_EMPTY_COMPOSITION",
		]);
		expect(() => schemaTemplate({ oneOf: [] } as never)).toThrow(
			/ZOD_EMPTY_COMPOSITION/,
		);
		expect(() =>
			schemaTemplate({ enum: [{ unsupported: true }] } as never),
		).toThrow(/ZOD_UNSUPPORTED_ENUM_VALUE/);
	});

	it("renders executable unions and nested intersections with stable single-member output", () => {
		expect(
			schemaTemplate({
				oneOf: [{ type: "string" }, { type: "number" }],
			} as never),
		).toBe("z.xor([z.string(), z.number()])");
		expect(schemaTemplate({ anyOf: [{ type: "boolean" }] } as never)).toBe(
			"z.boolean()",
		);
		const allOf = schemaTemplate({
			allOf: [
					{
						type: "object",
						properties: { a: { type: "string" } },
						required: ["a"],
					},
					{
						type: "object",
						properties: { b: { type: "number" } },
						required: ["b"],
					},
					{
						type: "object",
						properties: { c: { type: "boolean" } },
						required: ["c"],
					},
			],
		} as never);
		expect(allOf.match(/hasOwnProperty\.call/g)?.length).toBeGreaterThanOrEqual(3);
		expect(allOf).toContain('["a"]');
		expect(allOf).toContain('["b"]');
		expect(allOf).toContain('["c"]');
	});

	it("enforces exact-one at runtime while anyOf keeps its at-least-one behavior", () => {
		const oneOf = evaluate({
			oneOf: [{ type: "string" }, { type: "number" }],
		});
		expect(oneOf.safeParse(true).success).toBe(false);
		expect(oneOf.safeParse("value").success).toBe(true);
		expect(oneOf.safeParse(42).success).toBe(true);

		const overlapping = evaluate({
			oneOf: [
				{
					type: "object",
					required: ["name"],
					properties: { name: { type: "string" } },
				},
				{
					type: "object",
					required: ["name", "active"],
					properties: {
						name: { type: "string" },
						active: { type: "boolean" },
					},
				},
			],
		});
		expect(overlapping.safeParse({ name: "Ada" }).success).toBe(true);
		expect(overlapping.safeParse({ name: "Ada", active: true }).success).toBe(
			false,
		);
		expect(
			evaluate({ oneOf: [{ type: "string" }, { type: "string" }] }).safeParse(
				"same",
			).success,
		).toBe(false);
		expect(
			evaluate({ oneOf: [{ type: "string" }] }).safeParse("single").success,
		).toBe(true);
		expect(schemaTemplate({ oneOf: [{ type: "string" }] } as never)).toBe(
			"z.string()",
		);

		const anyOf = evaluate({
			anyOf: [{ type: "string" }, { minLength: 2 }],
		});
		expect(anyOf.safeParse("multiple").success).toBe(true);
	});

	it("keeps exact-one semantics through nested compositions, properties, and siblings", () => {
		const allOf = evaluate({
			allOf: [
				{ oneOf: [{ type: "string" }, { type: "number" }] },
				{ type: "string", minLength: 2 },
			],
		});
		expect(allOf.safeParse("valid").success).toBe(true);
		expect(allOf.safeParse("x").success).toBe(false);
		expect(allOf.safeParse(1).success).toBe(false);

		const oneOfInsideAnyOf = evaluate({
			anyOf: [
				{ oneOf: [{ type: "string" }, { type: "number" }] },
				{ type: "boolean" },
			],
		});
		expect(oneOfInsideAnyOf.safeParse("ok").success).toBe(true);
		expect(oneOfInsideAnyOf.safeParse(true).success).toBe(true);

		const anyOfInsideOneOf = evaluate({
			oneOf: [
				{ anyOf: [{ type: "string" }, { type: "boolean" }] },
				{ type: "number" },
			],
		});
		expect(anyOfInsideOneOf.safeParse("ok").success).toBe(true);
		expect(anyOfInsideOneOf.safeParse(1).success).toBe(true);
		expect(anyOfInsideOneOf.safeParse(true).success).toBe(true);

		const property = evaluate({
			type: "object",
			required: ["choice"],
			properties: {
				choice: { oneOf: [{ type: "string" }, { type: "number" }] },
			},
		});
		expect(property.safeParse({ choice: "ok" }).success).toBe(true);
		expect(property.safeParse({ choice: true }).success).toBe(false);

		const withSibling = evaluate({
			oneOf: [{ type: "string" }, { type: "number" }],
			minLength: 2,
		});
		expect(withSibling.safeParse("ok").success).toBe(true);
		expect(withSibling.safeParse("x").success).toBe(false);
		expect(withSibling.safeParse(1).success).toBe(false);
	});

	it("preserves nullable policy and ignores discriminator hints for matching truth", () => {
		const nullable = evaluate({
			oneOf: [{ type: "string" }, { type: "number" }],
			nullable: true,
		});
		expect(nullable.safeParse(null).success).toBe(true);

		const discriminated = evaluate({
			discriminator: { propertyName: "kind", mapping: { A: "A", B: "B" } },
			oneOf: [
				{
					type: "object",
					required: ["kind", "a"],
					properties: { kind: { const: "A" }, a: { type: "string" } },
				},
				{
					type: "object",
					required: ["kind", "b"],
					properties: { kind: { enum: ["A", "B"] }, b: { type: "string" } },
				},
			],
		});
		expect(discriminated.safeParse({ kind: "A", a: "x", b: "y" }).success).toBe(
			false,
		);
	});

	it("supports referenced and lazy recursive oneOf branches through public safeParse", () => {
		const refExpression = schemaTemplate({
			oneOf: [{ $ref: "#/components/schemas/Base" }, { type: "number" }],
		} as never);
		const referenced = GeneratedFunction(
			"z",
			"baseSchema",
			`return (${refExpression});`,
		)(z, z.string()) as z.ZodType;
		expect(referenced.safeParse("base").success).toBe(true);
		expect(referenced.safeParse(1).success).toBe(true);

		let recursiveSchema: z.ZodType;
		const lazyRecursive = z.lazy(() => recursiveSchema);
		const recursiveExpression = schemaTemplate(
			{
				oneOf: [
					{ type: "null" },
					{
						type: "object",
						required: ["next"],
						properties: { next: { $ref: "#/components/schemas/Recursive" } },
					},
				],
			} as never,
			"",
			"",
			{ lazyRefs: new Set(["#/components/schemas/Recursive"]) },
		);
		recursiveSchema = GeneratedFunction(
			"z",
			"recursiveSchema",
			`return (${recursiveExpression});`,
		)(z, lazyRecursive) as z.ZodType;
		expect(recursiveSchema.safeParse({ next: { next: null } }).success).toBe(
			true,
		);
		expect(recursiveSchema.safeParse({ next: true }).success).toBe(false);

		let unguardedSchema: z.ZodType;
		const lazyUnguarded = z.lazy(() => unguardedSchema);
		const unguardedExpression = schemaTemplate(
			{
				oneOf: [{ type: "null" }, { $ref: "#/components/schemas/Unguarded" }],
			} as never,
			"",
			"",
			{
				lazyRefs: new Set(["#/components/schemas/Unguarded"]),
				unguardedRecursiveRefs: new Set(["#/components/schemas/Unguarded"]),
			},
		);
		unguardedSchema = GeneratedFunction(
			"z",
			"unguardedSchema",
			`return (${unguardedExpression});`,
		)(z, lazyUnguarded) as z.ZodType;
		expect(unguardedSchema.safeParse(null).success).toBe(true);
		let mixedUnguardedSchema: z.ZodType;
		const lazyMixedUnguarded = z.lazy(() => mixedUnguardedSchema);
		const mixedExpression = schemaTemplate(
			{
				oneOf: [
					{ $ref: "#/components/schemas/Unguarded" },
					{
						type: "object",
						required: ["next"],
						properties: {
							next: { $ref: "#/components/schemas/Unguarded" },
						},
					},
					{ type: "null" },
				],
			} as never,
			"",
			"",
			{
				lazyRefs: new Set(["#/components/schemas/Unguarded"]),
				unguardedRecursiveRefs: new Set(["#/components/schemas/Unguarded"]),
			},
		);
		mixedUnguardedSchema = GeneratedFunction(
			"z",
			"unguardedSchema",
			`return (${mixedExpression});`,
		)(z, lazyMixedUnguarded) as z.ZodType;
		expect(mixedUnguardedSchema.safeParse({ next: null }).success).toBe(true);

		let nestedMixedSchema: z.ZodType;
		const lazyNestedMixed = z.lazy(() => nestedMixedSchema);
		const nestedMixedExpression = schemaTemplate(
			{
				oneOf: [
					{ $ref: "#/components/schemas/Nested" },
					{
						type: "object",
						required: ["next"],
						properties: {
							next: {
								oneOf: [
									{ type: "null" },
									{ $ref: "#/components/schemas/Nested" },
								],
							},
						},
					},
					{ type: "string" },
				],
			} as never,
			"",
			"",
			{
				lazyRefs: new Set(["#/components/schemas/Nested"]),
				unguardedRecursiveRefs: new Set(["#/components/schemas/Nested"]),
			},
		);
		nestedMixedSchema = GeneratedFunction(
			"z",
			"nestedSchema",
			`return (${nestedMixedExpression});`,
		)(z, lazyNestedMixed) as z.ZodType;
		expect(nestedMixedSchema.safeParse({ next: null }).success).toBe(true);
		expect(nestedMixedSchema.safeParse({ next: { next: null } }).success).toBe(
			true,
		);
	});

	it("validates recursive oneOf branches without repeated exponential parsing", () => {
		let recursiveSchema: z.ZodType;
		let referenceParseCount = 0;
		const recursiveRef = z.preprocess(
			(value) => {
				referenceParseCount += 1;
				return value;
			},
			z.lazy(() => recursiveSchema),
		);
		const recursiveExpression = schemaTemplate(
			{
				oneOf: [
					{ type: "null" },
					{
						type: "object",
						required: ["next"],
						properties: { next: { $ref: "#/components/schemas/Recursive" } },
					},
				],
			} as never,
			"",
			"",
			{ lazyRefs: new Set(["#/components/schemas/Recursive"]) },
		);
		recursiveSchema = GeneratedFunction(
			"z",
			"recursiveSchema",
			`return (${recursiveExpression});`,
		)(z, recursiveRef) as z.ZodType;

		let value: unknown = null;
		for (let depth = 0; depth < 20; depth += 1) value = { next: value };
		expect(recursiveSchema.safeParse(value).success).toBe(true);
		expect(referenceParseCount).toBeLessThan(100);
	});

	it("uses two-argument records and models additionalProperties policies", () => {
		expect(
			renderObjectSchema({
				type: "object",
				additionalProperties: { type: "integer" },
			}),
		).toBe("z.record(z.string(), z.int())");
		expect(
			renderObjectSchema({ type: "object", additionalProperties: true }),
		).toBe("z.looseObject({})");
		expect(
			renderObjectSchema({ type: "object", additionalProperties: false }),
		).toBe("z.strictObject({})");
		expect(
			renderObjectSchema({
				type: "object",
				properties: { fixed: { type: "string" } },
				required: ["fixed"],
				additionalProperties: { enum: [1, 2] },
			}),
		).toContain(
			'z.object({"fixed": z.string()}).catchall(z.union([z.literal(1), z.literal(2)]))',
		);
		expect(
			schemaTemplate({
				type: "object",
				additionalProperties: { $ref: "#/components/schemas/Value" },
			} as never),
		).toBe("z.record(z.string(), valueSchema)");
	});

	it("guards required declared keys by own-property presence at the object input boundary", () => {
		const schema = (value: unknown) =>
			GeneratedFunction("z", `return (${schemaTemplate(value as never)});`)(z) as z.ZodType;
		const cases = [
			{
				name: "unconstrained object",
				shape: {
					type: "object",
					required: ["payload"],
					properties: { payload: {} },
				},
			},
			{
				name: "boolean true",
				shape: {
					type: "object",
					required: ["payload"],
					properties: { payload: true },
				},
			},
			{
				name: "composition",
				shape: {
					type: "object",
					required: ["payload"],
					properties: {
						payload: { anyOf: [{}, { type: "string" }] },
					},
				},
			},
		];
		for (const { name, shape } of cases) {
			const parsed = schema(shape);
			expect(parsed.safeParse({ payload: "anything" }).success, name).toBe(true);
			expect(parsed.safeParse({ payload: null }).success, name).toBe(true);
			expect(parsed.safeParse({ payload: undefined }).success, name).toBe(true);
			expect(parsed.safeParse({}).success, name).toBe(false);
		}

		const optional = schema({
			type: "object",
			properties: { payload: {} },
		});
		expect(optional.safeParse({}).success).toBe(true);
		expect(optional.safeParse({ payload: "anything" }).success).toBe(true);
		expect(optional.safeParse({ payload: null }).success).toBe(true);

		const requiredFalse = schema({
			type: "object",
			required: ["payload"],
			properties: { payload: false },
		});
		expect(requiredFalse.safeParse({}).success).toBe(false);
		expect(requiredFalse.safeParse({ payload: "anything" }).success).toBe(false);
		const optionalFalse = schema({
			type: "object",
			properties: { payload: false },
		});
		expect(optionalFalse.safeParse({}).success).toBe(true);
		expect(optionalFalse.safeParse({ payload: "anything" }).success).toBe(false);

		const nullable = schema({
			type: "object",
			required: ["payload"],
			properties: { payload: { type: "string", nullable: true } },
		});
		expect(nullable.safeParse({ payload: "text" }).success).toBe(true);
		expect(nullable.safeParse({ payload: null }).success).toBe(true);
		expect(nullable.safeParse({}).success).toBe(false);

		const nested = schema({
			type: "object",
			required: ["outer"],
			properties: {
				outer: {
					type: "object",
					required: ["payload"],
					properties: { payload: {} },
				},
			},
		});
		expect(nested.safeParse({ outer: { payload: 1 } }).success).toBe(true);
		expect(nested.safeParse({ outer: {} }).success).toBe(false);
		expect(nested.safeParse({}).success).toBe(false);
	});

	it("escapes guard property names and preserves object policies", () => {
		const properties = Object.fromEntries(
			[
				'quote"',
				"back\\slash",
				"line\nbreak",
				"__proto__",
				"constructor",
				"雪",
			].map((key) => [key, {}]),
		);
		const expression = renderObjectSchema({
			type: "object",
			required: Object.keys(properties),
			properties,
			additionalProperties: { type: "string" },
		});
		expect(expression).toContain(".catchall(z.string())");
		expect(expression).toContain(JSON.stringify([...Object.keys(properties)].sort()));
		const parsed = GeneratedFunction("z", `return (${expression});`)(z) as z.ZodType;
		expect(
			Object.hasOwn(
				(parsed as z.ZodType & { shape: Record<string, unknown> }).shape,
				"__proto__",
			),
			).toBe(true);
		const present = Object.fromEntries(
			Object.keys(properties).map((key) => [key, key === "__proto__" ? "proto-value" : undefined]),
		);
		const parsedPresent = parsed.safeParse(present);
		expect(parsedPresent.success).toBe(true);
		if (parsedPresent.success) {
			expect(Object.hasOwn(parsedPresent.data as object, "__proto__")).toBe(true);
			expect(
				Object.getOwnPropertyDescriptor(parsedPresent.data as object, "__proto__")?.value,
			).toBe("proto-value");
		}
		expect(parsed.safeParse({}).success).toBe(false);
		const protoApi = parsed as unknown as z.ZodObject;
		const pickedProto = protoApi.pick({ ["__proto__"]: true } as never);
		expect(pickedProto.safeParse({}).success).toBe(false);
		expect(pickedProto.safeParse({ ["__proto__"]: "proto-value" }).success).toBe(true);
		const extendedProto = protoApi.extend({ extra: z.string() });
		expect(extendedProto.safeParse({ ...present, extra: "ok" }).success).toBe(true);
		expect(protoApi.keyof().options).toContain("__proto__");

		for (const additionalProperties of [
			true,
			false,
			{ type: "string" },
		] as const) {
			const guarded = schemaTemplate({
				type: "object",
				required: ["payload"],
				properties: { payload: {} },
				additionalProperties,
			});
			expect(guarded).toContain("z.preprocess((input, ctx) =>");
			expect(guarded).toContain(": objectShape;");
		}
	});

	it("requires own properties even when an inherited property is parseable", () => {
		const parsed = evaluate({
			type: "object",
			required: ["payload"],
			properties: { payload: {} },
		});
		const inherited = Object.create({ payload: "inherited" });
		expect(parsed.safeParse(inherited).success).toBe(false);
		expect(parsed.safeParse({ payload: undefined }).success).toBe(true);
		const objectApi = parsed as unknown as z.ZodObject;
		expect(objectApi.pick({ payload: true }).safeParse({ payload: null }).success).toBe(true);
		expect(objectApi.pick({ payload: true }).safeParse({}).success).toBe(false);
		expect(objectApi.extend({ extra: z.string() }).safeParse({ payload: null, extra: "value" }).success).toBe(true);
		expect(objectApi.partial().safeParse({}).success).toBe(true);
		expect(objectApi.strict().safeParse({ payload: null, extra: true }).success).toBe(false);

		const withOptionalUnknown = evaluate({
			type: "object",
			required: ["payload"],
			properties: { payload: {}, optionalPayload: {} },
		}) as unknown as z.ZodObject;
		const undefinedMaskApi = withOptionalUnknown as unknown as {
			required(mask?: unknown): z.ZodType;
			partial(mask?: unknown): z.ZodType;
		};
		expect(undefinedMaskApi.required(undefined).safeParse({ payload: null }).success).toBe(false);
		expect(undefinedMaskApi.required(undefined).safeParse({ payload: null, optionalPayload: null }).success).toBe(true);
		expect(undefinedMaskApi.partial(undefined).safeParse({}).success).toBe(true);

		const mergeLeft = evaluate({
			type: "object",
			required: ["left"],
			properties: { left: {} },
		});
		const mergeRight = evaluate({
			type: "object",
			required: ["right"],
			properties: { right: {} },
		});
		const merged = (mergeLeft as unknown as z.ZodObject).merge(mergeRight as unknown as z.ZodObject);
		expect(merged.safeParse({ left: null }).success).toBe(false);
		expect(merged.safeParse({ right: null }).success).toBe(false);
		expect(merged.safeParse({ left: null, right: null }).success).toBe(true);
	});

	it("quotes unsafe property names and preserves required, optional and nullable behavior", () => {
		const expression = renderObjectSchema({
			type: "object",
			required: ["user-id", "default", "1name"],
			additionalProperties: false,
			properties: {
				"user-id": { type: "string" },
				"content/type": { type: "string" },
				default: { type: "number" },
				"has space": { type: "boolean" },
				"single'quote": { type: "string" },
				'double"quote': { type: "string" },
				"back\\slash": { type: "string" },
				"1name": { type: "string", nullable: true },
			},
		});
		expect(expression).toContain('"user-id": z.string()');
		expect(expression).toContain('"content/type": z.string().optional()');
		expect(expression).toContain('"double\\"quote": z.string().optional()');
		expect(expression).toContain('"back\\\\slash": z.string().optional()');
		expect(expression).toContain('"1name": z.string().nullable()');
		const parsed = GeneratedFunction("z", `return (${expression});`)(z) as z.ZodType;
		expect(
			parsed.safeParse({ "user-id": "u", default: 1, "1name": null }).success,
		).toBe(true);
		expect(
			parsed.safeParse({
				"user-id": "u",
				default: 1,
				"1name": "x",
				extra: true,
			}).success,
		).toBe(false);
	});

	it("parses representative Zod 4 values at runtime", () => {
		const schema = evaluate({
			type: "object",
			required: [
				"email",
				"url",
				"uuid",
				"date",
				"dateTime",
				"bytes",
				"count",
				"choice",
				"items",
				"nested",
				"metadata",
			],
			additionalProperties: false,
			properties: {
				email: { type: "string", format: "email" },
				url: { type: "string", format: "uri" },
				uuid: { type: "string", format: "uuid" },
				date: { type: "string", format: "date" },
				dateTime: { type: "string", format: "date-time" },
				bytes: { type: "string", format: "byte" },
				count: { type: "integer", minimum: 1, maximum: 3 },
				choice: { enum: ["a", 2] },
				items: { type: "array", items: { enum: ["x", "y"] }, minItems: 1 },
				nested: {
					type: "object",
					required: ["ok"],
					properties: { ok: { type: "boolean" } },
				},
				metadata: { type: "object", additionalProperties: { type: "string" } },
				nullable: { type: "string", nullable: true },
			},
		});
		const valid = {
			email: "user@example.com",
			url: "https://example.com/a",
			uuid: "550e8400-e29b-41d4-a716-446655440000",
			date: "2026-07-28",
			dateTime: "2026-07-28T12:30:00Z",
			bytes: "aGVsbG8=",
			count: 2,
			choice: 2,
			items: ["x"],
			nested: { ok: true },
			metadata: { owner: "codex" },
			nullable: null,
		};
		expect(schema.parse(valid)).toEqual(valid);
		expect(schema.safeParse({ ...valid, email: "invalid" }).success).toBe(
			false,
		);
		expect(schema.safeParse({ ...valid, count: 2.5 }).success).toBe(false);
		expect(schema.safeParse({ ...valid, bytes: "not base64!" }).success).toBe(
			false,
		);
	});
});
