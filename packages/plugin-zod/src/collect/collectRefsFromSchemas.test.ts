import { describe, expect, it } from "vitest";
import { collectRefsFromSchema } from "./collectRefsFromSchemas.ts";

describe("collectRefsFromSchema", () => {
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
});
