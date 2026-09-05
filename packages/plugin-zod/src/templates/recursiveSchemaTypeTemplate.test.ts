import { describe, expect, it } from "vitest";
import { recursiveSchemaTypeTemplate } from "./recursiveSchemaTypeTemplate.ts";
import { schemaTemplate } from "./schemaTemplate.ts";

const lazyRefs = new Set([
	"#/components/schemas/Node",
	"#/components/schemas/PairA",
	"#/components/schemas/PairB",
]);

describe("recursiveSchemaTypeTemplate", () => {
	it("preserves direct, array, map, and external reference output types", () => {
		expect(
			recursiveSchemaTypeTemplate(
				{
					type: "object",
					required: ["value"],
					additionalProperties: false,
					properties: {
						value: { type: "string" },
						child: { $ref: "#/components/schemas/Node" },
						children: {
							type: "array",
							items: { $ref: "#/components/schemas/Node" },
						},
						lookup: {
							type: "object",
							additionalProperties: {
								$ref: "#/components/schemas/Node",
							},
						},
						external: { $ref: "#/components/schemas/External" },
					},
				},
				{ lazyRefs },
			),
		).toBe(
			'{ "value": string; "child"?: NodeSchemaOutput | undefined; "children"?: Array<NodeSchemaOutput> | undefined; "lookup"?: { [key: string]: NodeSchemaOutput; } | undefined; "external"?: z.infer<typeof externalSchema> | undefined; }',
		);
	});

	it("uses the peer output type for mutual recursion", () => {
		expect(
			recursiveSchemaTypeTemplate(
				{
					type: "object",
					required: ["name"],
					properties: {
						name: { type: "string" },
						pair: { $ref: "#/components/schemas/PairB" },
					},
				},
				{ lazyRefs },
			),
		).toBe(
			'{ "name": string; "pair"?: PairBSchemaOutput | undefined; } & Record<string, unknown>',
		);
	});

	it("uses an index signature for a root recursive map", () => {
		expect(
			recursiveSchemaTypeTemplate(
				{
					type: "object",
					additionalProperties: {
						$ref: "#/components/schemas/Node",
					},
				},
				{ lazyRefs },
			),
		).toBe("{ [key: string]: NodeSchemaOutput; }");
	});

	it("widens a recursive catchall for fixed property output types", () => {
		expect(
			recursiveSchemaTypeTemplate(
				{
					type: "object",
					required: ["value"],
					properties: {
						value: { type: "string" },
						label: { type: "string" },
					},
					additionalProperties: {
						$ref: "#/components/schemas/Node",
					},
				},
				{ lazyRefs },
			),
		).toBe(
			'{ "value": string; "label"?: string | undefined; } & { [key: string]: NodeSchemaOutput | string | undefined; }',
		);
	});

	it("falls back for complete unguarded recursive compositions", () => {
		expect(
			recursiveSchemaTypeTemplate(
				{
					anyOf: [
						{ type: "null" },
						{ $ref: "#/components/schemas/Node" },
					],
				},
				{ lazyRefs, fallbackToUnknown: true },
			),
		).toBe("unknown");
		expect(
			recursiveSchemaTypeTemplate(
				{
					allOf: [
						{ type: "string" },
						{ $ref: "#/components/schemas/Node" },
					],
				},
				{ lazyRefs, fallbackToUnknown: true },
			),
		).toBe("unknown");
	});

	it("matches the runtime never fallback for a mixed unsupported enum", () => {
		const schema = {
			type: "object",
			required: ["kind"],
			properties: {
				kind: { enum: ["ok", { nested: true }] },
				next: { $ref: "#/components/schemas/Node" },
			},
		} as const;
		const diagnostics: string[] = [];
		expect(
			schemaTemplate(schema as never, "", "", {
				onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
			}),
		).toContain('"kind": z.never()');
		expect(diagnostics).toEqual(["ZOD_UNSUPPORTED_ENUM_VALUE"]);
		expect(
			recursiveSchemaTypeTemplate(schema as never, {
				lazyRefs,
			}),
		).toContain('"kind": never');
	});
});
