import { describe, expect, it } from "vitest";
import ts from "typescript";
import { z } from "zod";
import { generateParameterSchema } from "./generateParameterSchema.ts";


const GeneratedFunction = ((...parameters: string[]) => {
	const body = parameters.pop() ?? "";
	return new globalThis.Function(...parameters, ts.transpile(body));
}) as unknown as FunctionConstructor;

function evaluate(
	parameters: unknown[],
	aliases: Record<string, z.ZodType> = {},
): z.ZodType {
	const names = Object.keys(aliases);
	return GeneratedFunction(
		"z",
		...names,
		`"use strict"; return (${generateParameterSchema(parameters as never, "testOperation")});`,
	)(z, ...names.map((name) => aliases[name])) as z.ZodType;
}

describe("generateParameterSchema", () => {
	it("applies the same required semantics to referenced and inline parameters", () => {
		const referencedOptionalQuerySchema = evaluate(
			[
				{
					$ref: "#/components/parameters/Search",
					name: "search",
					in: "query",
					schema: { type: "string" },
				},
			],
			{ ParameterSearchModel: z.string() },
		);
		const referencedRequiredQuerySchema = evaluate(
			[
				{
					$ref: "#/components/parameters/RequiredSearch",
					name: "search",
					in: "query",
					required: true,
					schema: { type: "string" },
				},
			],
			{ ParameterRequiredSearchModel: z.string() },
		);
		const referencedPathSchema = evaluate(
			[
				{
					$ref: "#/components/parameters/UserId",
					name: "id",
					in: "path",
					schema: { type: "string" },
				},
			],
			{ ParameterUserIdModel: z.string() },
		);

		expect(referencedOptionalQuerySchema.safeParse({}).success).toBe(true);
		expect(
			referencedOptionalQuerySchema.safeParse({ search: "abc" }).success,
		).toBe(true);
		expect(referencedRequiredQuerySchema.safeParse({}).success).toBe(false);
		expect(referencedPathSchema.safeParse({}).success).toBe(false);
	});

	it("preserves boolean and empty parameter schemas at runtime", () => {
		expect(
			evaluate([
				{ name: "allow", in: "query", required: true, schema: true },
			]).safeParse({ allow: null }).success,
		).toBe(true);
		expect(
			evaluate([
				{ name: "anything", in: "query", required: true, schema: {} },
			]).safeParse({ anything: { any: "value" } }).success,
		).toBe(true);
		expect(
			evaluate([
				{ name: "deny", in: "query", required: true, schema: false },
			]).safeParse({ deny: "value" }).success,
		).toBe(false);
	});

	it("renders Parameter Object content schemas without falling back to string", () => {
		const objectSchema = evaluate([
			{
				name: "filter",
				in: "query",
				required: true,
				content: {
					"application/json": {
						schema: {
							type: "object",
							properties: { status: { type: "string" } },
							required: ["status"],
						},
					},
				},
			},
		]);
		const unknownSchema = evaluate([
			{
				name: "anything",
				in: "header",
				required: true,
				content: { "application/json": {} },
			},
		]);
		const neverSchema = evaluate([
			{
				name: "never",
				in: "cookie",
				required: true,
				content: { "application/json": { schema: false } },
			},
		]);

		expect(
			objectSchema.safeParse({ filter: { status: "active" } }).success,
		).toBe(true);
		expect(objectSchema.safeParse({ filter: "active" }).success).toBe(false);
		expect(unknownSchema.safeParse({ anything: 1 }).success).toBe(true);
		expect(neverSchema.safeParse({ never: "x" }).success).toBe(false);
	});
});
