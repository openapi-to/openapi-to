import type { Operation } from "oas/operation";
import { describe, expect, it } from "vitest";
import { OperationAccessor } from "./OperationAccessor.ts";
import {
	isParameterRequired,
	resolveParameterSchema,
} from "./parameterSchema.ts";

function accessorFor(parameters: unknown[]): OperationAccessor {
	return new OperationAccessor({
		getParameters: () => parameters,
	} as unknown as Operation);
}

function accessorForDocument(
	parameters: unknown[],
	api: Record<string, unknown>,
): OperationAccessor {
	return new OperationAccessor({
		api,
		getParameters: () => parameters,
	} as unknown as Operation);
}

describe("OperationAccessor parameter classification", () => {
	it("overrides inherited identities, deduplicates only equivalent locations, and preserves source", () => {
		const inherited = [
			{ name: "X-Request-Id", in: "header", required: true },
			{ name: "id", in: "query", required: true },
			{ name: "id", in: "path", required: true },
			{ name: "ID", in: "query" },
		];
		const api = {
			components: {
				parameters: { Header: { name: "x-request-id", in: "header" } },
			},
			paths: { "/items/{id}": { parameters: inherited } },
		};
		const schema = {
			parameters: [
				{ $ref: "#/components/parameters/Header" },
				{ name: "id", in: "query" },
				{ name: "id", in: "query", required: true },
			],
		};
		const before = JSON.stringify({ api, schema });
		const accessor = new OperationAccessor({
			api,
			schema,
			path: "/items/{id}",
		} as unknown as Operation);
		expect(accessor.headerParameters).toHaveLength(1);
		expect(accessor.headerParameters[0]?.name).toBe("x-request-id");
		expect(accessor.queryParameters.map((x) => x.name)).toEqual(["id", "ID"]);
		expect(accessor.isQueryParametersOptional).toBe(true);
		expect(accessor.pathParameters[0]?.required).toBe(true);
		expect(accessor.isRequestInputOptional).toBe(false);
		expect(JSON.stringify({ api, schema })).toBe(before);
	});

	it.each([false, true])(
		"derives query group requiredness from effective members: %s",
		(required) => {
			const accessor = accessorFor([{ name: "q", in: "query", required }]);
			expect(accessor.isQueryParametersOptional).toBe(!required);
			expect(accessor.isRequestInputOptional).toBe(!required);
		},
	);

	it("makes RequestInput required for a required Header group", () => {
		const accessor = accessorFor([
			{ name: "X-Trace", in: "header", required: true },
			{ name: "dummy", in: "cookie", required: true },
		]);
		expect(accessor.isHeaderParametersOptional).toBe(false);
		expect(accessor.isRequestInputOptional).toBe(false);
	});
	it("keeps RequestInput optional when only Cookie parameters are required", () => {
		const accessor = accessorFor([
			{ name: "dummy", in: "cookie", required: true },
		]);
		expect(accessor.isRequestInputOptional).toBe(true);
	});
	it.each([false, true])(
		"derives Header group requiredness from effective members: %s",
		(required) => {
			const accessor = accessorFor([
				{ name: "X-Trace", in: "header", required },
			]);
			expect(accessor.isHeaderParametersOptional).toBe(!required);
			expect(accessor.isRequestInputOptional).toBe(!required);
		},
	);
	it("ignores special request headers case-insensitively without mutating source", () => {
		const parameters = [
			{ name: "Accept", in: "header", required: true },
			{ name: "cOnTeNt-TyPe", in: "header", required: true },
			{ name: "AUTHORIZATION", in: "header", required: true },
			{ name: "X-Trace", in: "header", required: true },
			{ name: "x-trace", in: "header", required: false },
		];
		const before = JSON.stringify(parameters);
		const accessor = accessorFor(parameters);
		expect(accessor.headerParameters.map(({ name }) => name)).toEqual([
			"X-Trace",
		]);
		expect(accessor.headerParameters[0]?.required).toBe(true);
		expect(accessor.isHeaderParametersOptional).toBe(false);
		expect(JSON.stringify(parameters)).toBe(before);
	});
	it("resolves chained local parameter identity and bounds circular refs", () => {
		const accessor = accessorForDocument(
			[
				{ $ref: "#/components/parameters/Alias" },
				{ name: "x-trace", in: "header" },
			],
			{
				components: {
					parameters: {
						Alias: { $ref: "#/components/parameters/Header" },
						Header: { name: "X-Trace", in: "header", required: true },
					},
				},
			},
		);
		expect(accessor.headerParameters).toHaveLength(1);
		expect(accessor.headerParameters[0]?.required).toBe(true);
		const cycle = accessorForDocument(
			[{ $ref: "#/components/parameters/Loop" }],
			{
				components: {
					parameters: { Loop: { $ref: "#/components/parameters/Loop" } },
				},
			},
		);
		expect(cycle.parameters).toEqual([
			{ $ref: "#/components/parameters/Loop" },
		]);
	});
	it("classifies all four request parameter locations from parameter.in", () => {
		const accessor = accessorFor([
			{ name: "id", in: "path", required: false, schema: { type: "string" } },
			{ name: "q", in: "query", schema: { type: "string" } },
			{ name: "X-Request-Id", in: "header", schema: { type: "string" } },
			{ name: "session", in: "cookie", schema: { type: "string" } },
		]) as OperationAccessor & {
			headerParameters: unknown[];
			cookieParameters: unknown[];
		};

		expect(accessor.pathParameters).toHaveLength(1);
		expect(accessor.queryParameters).toHaveLength(1);
		expect(accessor.headerParameters).toHaveLength(1);
		expect(accessor.cookieParameters).toHaveLength(1);
		expect(accessor.pathParameters[0]?.required).toBe(true);
	});

	it("resolves referenced parameters with Core JSON Pointer semantics", () => {
		const accessor = accessorForDocument(
			[{ $ref: "#/components/parameters/Limit" }],
			{
				components: {
					parameters: {
						Limit: {
							name: "limit",
							in: "query",
							required: false,
							style: "form",
							explode: false,
							schema: { type: "integer" },
						},
					},
				},
			},
		);

		expect(accessor.queryParameters).toEqual([
			{
				$ref: "#/components/parameters/Limit",
				name: "limit",
				in: "query",
				required: false,
				style: "form",
				explode: false,
				schema: { type: "integer" },
			},
		]);
	});

	it("exposes bounded Header serialization metadata from effective referenced parameters", () => {
		const accessor = accessorForDocument(
			[
				{ $ref: "#/components/parameters/Trace" },
				{
					name: "X-Content",
					in: "header",
					content: { "text/plain": { schema: { type: "string" } } },
				},
			],
			{
				components: {
					parameters: {
						Trace: {
							name: "X-Trace",
							in: "header",
							required: true,
							schema: { type: "array", items: { type: "string" } },
						},
					},
				},
			},
		);
		expect(accessor.headerParameterSerialization).toEqual([
			{
				name: "X-Trace",
				required: true,
				strategy: "schema-simple",
				style: "simple",
				explode: false,
				schemaPresent: true,
			},
			{
				name: "X-Content",
				required: false,
				strategy: "content",
				style: "simple",
				explode: false,
				schemaPresent: false,
				contentMediaType: "text/plain",
			},
		]);
	});
	it("does not classify Header arrays as query-array parameters", () => {
		const accessor = accessorFor([
			{
				name: "X-Tags",
				in: "header",
				schema: { type: "array", items: { type: "string" } },
			},
		]);
		expect(accessor.hasQueryParametersArray).toBe(false);
	});
});

describe("Parameter Object schema semantics", () => {
	it("uses schema first, otherwise the first declared media type", () => {
		expect(
			resolveParameterSchema({
				schema: { type: "boolean" },
				content: {
					"application/json": { schema: { type: "number" } },
				},
			}),
		).toEqual({ type: "boolean" });
		expect(
			resolveParameterSchema({
				content: {
					"application/json": { schema: { type: "number" } },
					"text/plain": { schema: { type: "string" } },
				},
			}),
		).toEqual({ type: "number" });
		expect(
			resolveParameterSchema({
				content: { "application/json": {} },
			}),
		).toBe(true);
	});

	it("always treats path parameters as required", () => {
		expect(isParameterRequired({ in: "path", required: false })).toBe(true);
		expect(isParameterRequired({ in: "header", required: false })).toBe(false);
	});
});
