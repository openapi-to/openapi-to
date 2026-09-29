import { describe, expect, it } from "vitest";
import { collectRefsFromSchema } from "./collectRefsFromSchemas.ts";

describe("collectRefsFromSchema", () => {
	it("omits all refs from an entrypoint that fails closed", () => {
		expect(
			collectRefsFromSchema(
				{
					type: "object",
					not: { $ref: "#/components/schemas/Forbidden" },
				},
				{
					refSemanticContext: {
						dialect: "3.1",
						objectContext: "schema",
					},
				},
			),
		).toEqual([]);
	});

	it("does not collect refs from ignored OAS 3.0 ref siblings", () => {
		expect(
			collectRefsFromSchema(
				{
					$ref: "#/components/schemas/Base",
					not: { $ref: "#/components/schemas/Forbidden" },
				},
				{
					refSemanticContext: {
						dialect: "3.0",
						objectContext: "schema",
					},
				},
			),
		).toEqual(["#/components/schemas/Base"]);
	});

	it("omits direct unguarded recursive refs in oneOf branches", () => {
		const schema = {
			oneOf: [{ $ref: "#/components/schemas/Loop" }],
		} as never;
		expect(
			collectRefsFromSchema(schema, {
				omitUnguardedRefsWithinOneOf: new Set(["#/components/schemas/Loop"]),
			}),
		).toEqual([]);
	});

	it("keeps recursive refs reached through structural guards", () => {
		const schema = {
			oneOf: [
				{ $ref: "#/components/schemas/Loop" },
				{
					type: "object",
					properties: {
						nested: {
							oneOf: [{ type: "null" }, { $ref: "#/components/schemas/Loop" }],
						},
					},
				},
			],
		} as never;
		expect(
			collectRefsFromSchema(schema, {
				omitUnguardedRefsWithinOneOf: new Set(["#/components/schemas/Loop"]),
			}),
		).toEqual(["#/components/schemas/Loop"]);
	});

	it("keeps refs used outside oneOf branches", () => {
		const schema = {
			allOf: [
				{ $ref: "#/components/schemas/Loop" },
				{ oneOf: [{ $ref: "#/components/schemas/Loop" }] },
			],
		} as never;
		expect(
			collectRefsFromSchema(schema, {
				omitUnguardedRefsWithinOneOf: new Set(["#/components/schemas/Loop"]),
			}),
		).toEqual(["#/components/schemas/Loop"]);
	});

	it("follows schema $ref siblings only in OpenAPI 3.1 and later", () => {
		const schema = {
			$ref: "#/components/schemas/Base",
			allOf: [{ $ref: "#/components/schemas/Sibling" }],
		} as never;
		expect(
			collectRefsFromSchema(schema, {
				refSemanticContext: { dialect: "3.0", objectContext: "schema" },
			}),
		).toEqual(["#/components/schemas/Base"]);
		expect(
			collectRefsFromSchema(schema, {
				refSemanticContext: { dialect: "3.1", objectContext: "schema" },
			}),
		).toEqual(["#/components/schemas/Base", "#/components/schemas/Sibling"]);
	});
});
