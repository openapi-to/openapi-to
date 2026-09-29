import { describe, expect, it } from "vitest";
import {
	findUnsupportedValidationKeywords,
	unsupportedValidationKeywordDiagnosticMessage,
} from "./unsupportedValidationKeywords.ts";

const context = (dialect: "3.0" | "3.1" | "3.2") => ({
	refSemanticContext: { dialect, objectContext: "schema" as const },
});

describe("Zod unsupported validation keyword scan", () => {
	it.each(["3.0", "3.1", "3.2"] as const)(
		"finds the maintained missing keywords for OAS %s",
		(dialect) => {
			const scan = findUnsupportedValidationKeywords(
				{
					uniqueItems: true,
					minProperties: 2,
					maxProperties: 4,
					not: { type: "null" },
					properties: {
						value: { type: "string", maxLength: 5 },
					},
				},
				context(dialect),
			);
			expect(scan.keywords).toEqual([
				"maxProperties",
				"minProperties",
				"not",
				"uniqueItems",
			]);
			expect(scan.exceededLimit).toBe(false);
		},
	);

	it("audits the Draft 2020-12 applicator and unevaluated keywords", () => {
		const scan = findUnsupportedValidationKeywords(
			{
				prefixItems: [{ contains: { type: "string" } }],
				minContains: 1,
				maxContains: 3,
				patternProperties: { "^x": { type: "number" } },
				dependentRequired: { name: ["id"] },
				dependentSchemas: { name: { if: { type: "string" } } },
				propertyNames: { type: "string" },
				// biome-ignore lint/suspicious/noThenProperty: JSON Schema's `then` keyword is part of this vocabulary audit.
				then: { unevaluatedProperties: false },
				unevaluatedItems: false,
				$dynamicRef: "#node",
			},
			context("3.2"),
		);
		expect(scan.keywords).toEqual([
			"$dynamicRef",
			"contains",
			"dependentRequired",
			"dependentSchemas",
			"if",
			"maxContains",
			"minContains",
			"patternProperties",
			"prefixItems",
			"propertyNames",
			"then",
			"unevaluatedItems",
			"unevaluatedProperties",
		]);
	});

	it("does not treat annotations, extension values, or unknown keywords as schemas", () => {
		const scan = findUnsupportedValidationKeywords(
			{
				type: "object",
				description: "contains: prose",
				title: "example",
				default: { not: true },
				examples: [{ uniqueItems: true }],
				"x-company-rule": { minProperties: 1 },
				unknownAnnotation: { not: "annotation" },
			},
			context("3.1"),
		);
		expect(scan).toMatchObject({
			keywords: [],
			occurrences: [],
			exceededLimit: false,
		});
	});

	it("honors OAS 3.0 ignored ref siblings and OAS 3.1 active siblings", () => {
		const schema = {
			$ref: "#/components/schemas/Base",
			not: { type: "string" },
		};
		expect(
			findUnsupportedValidationKeywords(schema, context("3.0")).keywords,
		).toEqual([]);
		expect(
			findUnsupportedValidationKeywords(schema, context("3.1")).keywords,
		).toEqual(["not"]);
	});

	it("sorts and bounds keyword diagnostics", () => {
		const scan = findUnsupportedValidationKeywords(
			Object.fromEntries(
				[
					"not",
					"uniqueItems",
					"minProperties",
					"maxProperties",
					"dependentRequired",
					"prefixItems",
					"contains",
					"minContains",
					"maxContains",
				].map((keyword) => [keyword, true]),
			),
			context("3.1"),
		);
		const message = unsupportedValidationKeywordDiagnosticMessage(scan);
		expect(message).toContain('"contains"');
		expect(message).toContain("1 more");
		expect(message.length).toBeLessThan(300);
	});

	it("fails the scan closed at its deterministic depth bound", () => {
		let schema: Record<string, unknown> = { type: "string" };
		for (let index = 0; index < 140; index += 1) {
			schema = { properties: { child: schema } };
		}
		const scan = findUnsupportedValidationKeywords(schema, context("3.1"));
		expect(scan.exceededLimit).toBe(true);
		expect(unsupportedValidationKeywordDiagnosticMessage(scan)).toContain(
			"bounded traversal limit",
		);
	});
});
