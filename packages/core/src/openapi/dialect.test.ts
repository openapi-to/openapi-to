import { describe, expect, it } from "vitest";
import {
	classifyOpenAPIDialect,
	hasActiveSchemaRefSiblings,
} from "./dialect.ts";

describe("OpenAPI dialect semantics", () => {
	it.each([
		["3.0.4", "3.0"],
		["3.1.2", "3.1"],
		["3.2.1", "3.2"],
		["swagger: 2.0", "unknown"],
		[undefined, "unknown"],
	])("classifies %s as %s", (version, dialect) => {
		expect(classifyOpenAPIDialect(version)).toBe(dialect);
	});

	it.each([
		["3.0", "schema", false],
		["3.1", "schema", true],
		["3.2", "schema", true],
		["3.1", "reference", false],
		["unknown", "schema", false],
	] as const)(
		"resolves $ref siblings for %s %s as %s",
		(dialect, objectContext, active) => {
			expect(hasActiveSchemaRefSiblings({ dialect, objectContext })).toBe(
				active,
			);
		},
	);
});
