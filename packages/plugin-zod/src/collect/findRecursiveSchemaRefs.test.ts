import type { ComponentsSchemas } from "@openapi-to/core";
import { describe, expect, it } from "vitest";
import {
	findRecursiveSchemaRefs,
	findUnguardedRecursiveSchemaRefs,
} from "./findRecursiveSchemaRefs.ts";

describe("findRecursiveSchemaRefs", () => {
	it("marks self and mutual recursion but not ordinary reference chains", () => {
		const recursive = findRecursiveSchemaRefs({
			Leaf: { type: "object", properties: { value: { type: "string" } } },
			Wrapper: {
				type: "object",
				properties: { leaf: { $ref: "#/components/schemas/Leaf" } },
			},
			Node: {
				type: "object",
				properties: { next: { $ref: "#/components/schemas/Node" } },
			},
			Left: {
				type: "object",
				properties: { right: { $ref: "#/components/schemas/Right" } },
			},
			Right: {
				type: "object",
				properties: { left: { $ref: "#/components/schemas/Left" } },
			},
		});
		expect([...recursive].sort()).toEqual([
			"#/components/schemas/Left",
			"#/components/schemas/Node",
			"#/components/schemas/Right",
		]);
	});

	it("marks only cycles whose complete path lacks a structural guard", () => {
		const schemas: ComponentsSchemas = {
			Loop: {
				anyOf: [
					{ type: "null" },
					{ $ref: "#/components/schemas/Loop" },
				],
			},
			Alias: { $ref: "#/components/schemas/GuardedNode" },
			GuardedNode: {
				type: "object",
				properties: { next: { $ref: "#/components/schemas/Alias" } },
			},
			UnguardedLeft: { $ref: "#/components/schemas/UnguardedRight" },
			UnguardedRight: {
				oneOf: [
					{ type: "null" },
					{ $ref: "#/components/schemas/UnguardedLeft" },
				],
			},
		};
		expect([...findRecursiveSchemaRefs(schemas)].sort()).toEqual([
			"#/components/schemas/Alias",
			"#/components/schemas/GuardedNode",
			"#/components/schemas/Loop",
			"#/components/schemas/UnguardedLeft",
			"#/components/schemas/UnguardedRight",
		]);
		expect([...findUnguardedRecursiveSchemaRefs(schemas)].sort()).toEqual([
			"#/components/schemas/Loop",
			"#/components/schemas/UnguardedLeft",
			"#/components/schemas/UnguardedRight",
		]);
	});
});
