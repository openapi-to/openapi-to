import type { Schema } from "@openapi-to/core";
import { describe, expect, it } from "vitest";
import { schemaTemplate } from "./schemaTemplate";

describe("schemaTemplate", () => {
	it("retains required names in a required-only object", () => {
		expect(
			schemaTemplate({ type: "object", required: ["ghost"] }, "value"),
		).toContain("ghost: unknown");
	});

	it("retains required-only object branches in compositions", () => {
		const branch = { type: "object" as const, required: ["ghost"] };
		for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
			expect(schemaTemplate({ [keyword]: [branch] }, "value")).toContain(
				"ghost: unknown",
			);
		}
	});
	/*  it('should return "unknown" for undefined schema', () => {
    expect(schemaTemplate(undefined, 'testProperty')).toBe('unknown')
  })*/

	it("should handle $ref schema", () => {
		const schema: Schema = { $ref: "#/components/schemas/TestRef" };
		expect(schemaTemplate(schema, "testProperty")).toBe("TestRefModel");
	});

	it("maps boolean schemas consistently", () => {
		expect(schemaTemplate(true, "anything")).toBe("unknown");
		expect(schemaTemplate(false, "impossible")).toBe("never");
	});

	it("preserves scalar const, including beside $ref", () => {
		expect(schemaTemplate({ const: "fixed" }, "fixed")).toBe('"fixed"');
		expect(
			schemaTemplate(
				{
					$ref: "#/components/schemas/UserId",
					const: "fixed",
				},
				"fixedId",
			),
		).toBe('UserIdModel & "fixed"');
		expect(
			schemaTemplate(
				{
					$ref: "#/components/schemas/Count",
					const: 1,
				},
				"fixedCount",
			),
		).toBe("CountModel & 1");
	});

	it("reports unsupported object and array const values explicitly", () => {
		expect(() =>
			schemaTemplate({ const: { id: "fixed" } }, "fixedObject"),
		).toThrow(
			"TypeScript schema const currently supports only JSON scalar values.",
		);
		expect(() => schemaTemplate({ const: ["fixed"] }, "fixedArray")).toThrow(
			"TypeScript schema const currently supports only JSON scalar values.",
		);
	});

	it("uses the declared enum value name for an enum sibling beside $ref", () => {
		expect(
			schemaTemplate(
				{
					$ref: "#/components/schemas/BaseStatus",
					enum: ["active", "disabled"],
				},
				"status",
			),
		).toBe("BaseStatusModel & StatusEnumValue");
		expect(
			schemaTemplate(
				{
					$ref: "#/components/schemas/BaseStatus",
					enum: ["active", "disabled"],
				},
				"status",
				"Example",
			),
		).toBe("BaseStatusModel & ExampleStatusEnumValue");
	});

	it("preserves nullable and composition siblings beside $ref", () => {
		expect(
			schemaTemplate(
				{
					$ref: "#/components/schemas/TestRef",
					nullable: true,
				},
				"testProperty",
			),
		).toBe("TestRefModel | null");
		expect(
			schemaTemplate(
				{
					$ref: "#/components/schemas/TestRef",
					anyOf: [{ type: "string" }],
				},
				"testProperty",
			),
		).toBe("TestRefModel & string");
		expect(
			schemaTemplate(
				{
					$ref: "#/components/schemas/TestRef",
					oneOf: [{ type: "string" }, { type: "number" }],
				},
				"testProperty",
			),
		).toBe("TestRefModel & (string | number)");
		expect(
			schemaTemplate(
				{
					$ref: "#/components/schemas/TestRef",
					allOf: [{ $ref: "#/components/schemas/Extra" }],
				},
				"testProperty",
			),
		).toBe("TestRefModel & ExtraModel");
		expect(
			schemaTemplate(
				{
					$ref: "#/components/schemas/TestRef",
					anyOf: [{ $ref: "#/components/schemas/Extra" }],
					nullable: true,
				},
				"testProperty",
			),
		).toBe("(TestRefModel & ExtraModel) | null");
	});

	it("should handle enum schema", () => {
		const schema: Schema = { type: "string", enum: ["value1", "value2"] };
		expect(schemaTemplate(schema, "testProperty")).toBe(
			"TestPropertyEnumValue",
		);
	});

	it("should handle oneOf schema", () => {
		const schema: Schema = {
			oneOf: [{ type: "string" }, { type: "number" }],
		};
		expect(schemaTemplate(schema, "testProperty")).toBe("string | number");
	});

	it("should handle allOf schema", () => {
		const schema: Schema = {
			allOf: [{ type: "string" }, { type: "number" }],
		};
		expect(schemaTemplate(schema, "testProperty")).toBe("string & number");
	});

	it("should handle nullable schema", () => {
		const schema: Schema = { type: "string", nullable: true };
		expect(schemaTemplate(schema, "testProperty")).toBe("string | null");
	});

	it("should handle array schema", () => {
		const schema: Schema = { type: "array", items: { type: "string" } };
		expect(schemaTemplate(schema, "testProperty")).toBe("Array<string>");
	});

	it("should handle object schema with properties", () => {
		const schema: Schema = {
			type: "object",
			properties: {
				key1: { type: "string" },
				key2: { type: "number" },
			},
		};
		expect(schemaTemplate(schema, "testProperty")).toBe(`{
    key1?: string;
    key2?: number;
}`);
	});

	it("should handle object schema without properties", () => {
		const schema: Schema = { type: "object" };
		expect(schemaTemplate(schema, "testProperty")).toBe(
			"Record<string, unknown>",
		);
	});

	it("renders schema-valued additionalProperties as the index value", () => {
		expect(
			schemaTemplate(
				{
					type: "object",
					additionalProperties: { type: "number" },
				},
				"values",
			),
		).toBe(`{
    [key: string]: number;
}`);
	});

	it('should return "unknown" for unsupported types', () => {
		const schema = { type: "unsupportedType" } as unknown as Schema;
		expect(schemaTemplate(schema, "testProperty")).toBe("unknown");
	});
});
