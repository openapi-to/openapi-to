import { describe, expect, it } from "vitest";
import { hasInt64SafeIntegerBoundary } from "./int64SafeInteger.ts";

const context = (dialect: "3.0" | "3.1" | "3.2") => ({
	refSemanticContext: { dialect, objectContext: "schema" as const },
});

describe("Zod int64 safe-integer boundary scan", () => {
	it("finds int64 only through schema-bearing containers", () => {
		expect(
			hasInt64SafeIntegerBoundary({
				type: "object",
				properties: {
					id: { type: "integer", format: "int64" },
				},
				items: { type: "number", format: "int64" },
				examples: [{ type: "integer", format: "int64" }],
				default: { type: "integer", format: "int64" },
				description: "format int64",
				"x-example": { format: "int64" },
			}),
		).toBe(true);
	});

	it("does not report annotation-only format values", () => {
		expect(
			hasInt64SafeIntegerBoundary({
				description: "int64",
				example: { format: "int64" },
				examples: [{ format: "int64" }],
				default: { format: "int64" },
				"x-openapi-to": { format: "int64" },
			}),
		).toBe(false);
		expect(
			hasInt64SafeIntegerBoundary({ type: "string", format: "int64" }),
		).toBe(false);
		expect(hasInt64SafeIntegerBoundary({ format: "int64" })).toBe(false);
	});

	it("honors OAS $ref sibling semantics", () => {
		const schema = {
			$ref: "#/components/schemas/Base",
			type: "integer",
			format: "int64",
		};
		expect(hasInt64SafeIntegerBoundary(schema, context("3.0"))).toBe(false);
		expect(hasInt64SafeIntegerBoundary(schema, context("3.1"))).toBe(true);
		expect(hasInt64SafeIntegerBoundary(schema, context("3.2"))).toBe(true);
	});

	it("terminates on cycles and bounded deep schemas", () => {
		const cyclic: Record<string, unknown> = { type: "object" };
		cyclic.properties = { self: cyclic };
		expect(hasInt64SafeIntegerBoundary(cyclic)).toBe(false);

		let deep: Record<string, unknown> = { type: "integer", format: "int64" };
		for (let index = 0; index < 140; index += 1) {
			deep = { properties: { nested: deep } };
		}
		expect(hasInt64SafeIntegerBoundary(deep)).toBe(false);
	});
});
