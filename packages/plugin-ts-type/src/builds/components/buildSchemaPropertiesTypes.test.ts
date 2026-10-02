import type { SchemaObject } from "oas/types";
import { describe, expect, it } from "vitest";
import { buildSchemaPropertiesTypes } from "./buildSchemaPropertiesTypes.ts";

describe("buildSchemaPropertiesTypes", () => {
	it("requires undeclared names and keeps omitted additional properties open", () => {
		expect(
			buildSchemaPropertiesTypes(
				{ type: "object", required: ["ghost"] },
				"Example",
			),
		).toMatchObject([
			{ name: "ghost", type: "unknown" },
			{ name: "[key: string]", type: "unknown" },
		]);
	});

	it.each([
		[true, "unknown"],
		[{ type: "string" }, "string"],
		[false, "never"],
	] as const)(
		"uses effective additionalProperties %j for an undeclared name",
		(additionalProperties, expected) => {
			const result = buildSchemaPropertiesTypes(
				{ type: "object", required: ["ghost"], additionalProperties },
				"Example",
			);
			expect(result?.[0]).toMatchObject({ name: "ghost", type: expected });
			expect(result?.at(-1)?.name === "[key: string]").toBe(
				additionalProperties !== false,
			);
		},
	);

	it("deduplicates string names, ignores non-strings and preserves first occurrence", () => {
		const result = buildSchemaPropertiesTypes(
			{
				type: "object",
				required: ["b", 1, "a", "b", false, "a"],
			} as unknown as SchemaObject,
			"Example",
		);
		expect(result?.map(({ name }) => name)).toEqual([
			"b",
			"a",
			"[key: string]",
		]);
	});

	it("quotes untrusted undeclared property names", () => {
		const names = [
			"foo-bar",
			'quote"',
			"line\nbreak",
			"\u4e2d\u6587",
			"__proto__",
			"constructor",
		];
		const result = buildSchemaPropertiesTypes(
			{ type: "object", required: names },
			"Example",
		);
		expect(result?.map(({ name }) => name)).toEqual([
			'"foo-bar"',
			JSON.stringify('quote"'),
			'"line\\nbreak"',
			'"\u4e2d\u6587"',
			"__proto__",
			"constructor",
			"[key: string]",
		]);
	});

	it("keeps a typed synthetic property narrower than the existing widened index", () => {
		const result = buildSchemaPropertiesTypes(
			{
				type: "object",
				required: ["ghost"],
				properties: { id: { type: "number" } },
				additionalProperties: { type: "string" },
			},
			"Example",
		);
		expect(result?.map(({ name, type }) => [name, type])).toEqual([
			["id?", "number"],
			["ghost", "string"],
			["[key: string]", "string | number | undefined"],
		]);
	});
	it("returns undefined when no properties or index signature are defined", () => {
		expect(
			buildSchemaPropertiesTypes({} as SchemaObject, "TestModel"),
		).toBeUndefined();
	});

	it("preserves required and optional properties", () => {
		const result = buildSchemaPropertiesTypes(
			{
				type: "object",
				required: ["id"],
				properties: {
					id: { type: "string" },
					name: { type: "string" },
				},
			},
			"TestModel",
		);

		expect(result).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "id", type: "string" }),
				expect.objectContaining({ name: "name?", type: "string" }),
			]),
		);
	});

	it("quotes unsafe enum-bearing property names without changing optionality", () => {
		const result = buildSchemaPropertiesTypes(
			{
				type: "object",
				required: ["kebab-case"],
				properties: {
					"kebab-case": {
						type: "string",
						enum: ["active", "disabled"],
					},
					"optional-value": {
						type: "string",
						enum: ["active", "disabled"],
					},
				},
			},
			"User",
		);

		expect(result).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: '"kebab-case"',
					type: "UserKebab_u2d_CaseEnumValue",
				}),
				expect.objectContaining({
					name: '"optional-value"?',
					type: "UserOptional_u2d_ValueEnumValue",
				}),
			]),
		);
	});

	it("preserves true and false boolean properties with optionality", () => {
		const result = buildSchemaPropertiesTypes(
			{
				type: "object",
				required: ["anything", "forbidden"],
				properties: {
					anything: true,
					forbidden: false,
					optionalAnything: true,
					optionalForbidden: false,
					name: { type: "string" },
				},
			} as unknown as SchemaObject,
			"Example",
		);

		expect(result).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "anything", type: "unknown" }),
				expect.objectContaining({ name: "forbidden", type: "never" }),
				expect.objectContaining({
					name: "optionalAnything?",
					type: "unknown",
				}),
				expect.objectContaining({
					name: "optionalForbidden?",
					type: "never",
				}),
				expect.objectContaining({ name: "name?", type: "string" }),
			]),
		);
	});

	it.each([
		[true, "unknown"],
		[{ type: "number" }, "number"],
		[{ $ref: "#/components/schemas/Tag" }, "TagModel"],
		[{ type: "array", items: { type: "string" } }, "Array<string>"],
	] as const)(
		"uses the additionalProperties schema as the index value for %j",
		(additionalProperties, expected) => {
			const result = buildSchemaPropertiesTypes(
				{
					type: "object",
					additionalProperties,
				} as SchemaObject,
				"Example",
			);

			expect(result).toEqual([
				expect.objectContaining({ name: "[key: string]", type: expected }),
			]);
		},
	);

	it("does not emit an index signature for additionalProperties=false", () => {
		expect(
			buildSchemaPropertiesTypes(
				{ type: "object", additionalProperties: false },
				"Example",
			),
		).toBeUndefined();
	});

	it("widens a schema-valued index signature for incompatible fixed properties", () => {
		const result = buildSchemaPropertiesTypes(
			{
				type: "object",
				required: ["count"],
				properties: {
					count: { type: "number" },
					name: { type: "string" },
				},
				additionalProperties: { type: "number" },
			},
			"Example",
		);

		expect(result?.at(-1)).toMatchObject({
			name: "[key: string]",
			type: "number | string | undefined",
		});
	});
});
