import type { Operation } from "oas/operation";
import { describe, expect, it } from "vitest";

import { OperationAccessor } from "./OperationAccessor.ts";
import {
	classifyResponseStatusCodes,
	describeOperationResponses,
	describeResponse,
	describeResponseHeaders,
	selectSuccessResponseStatusCode,
} from "./responseStatus.ts";

describe("response status selection", () => {
	it.each([
		[["200"], "200"],
		[["201"], "201"],
		[["202"], "202"],
		[["204"], "204"],
		[["206"], "206"],
		[["2XX"], "2XX"],
		[["default"], "default"],
		[["default", "206", "201"], "201"],
	])("selects %j as %s", (codes, expected) => {
		expect(selectSuccessResponseStatusCode(codes)).toBe(expected);
	});

	it("uses default as an error fallback when a documented 2xx exists", () => {
		expect(classifyResponseStatusCodes(["default", "404", "201"])).toEqual({
			success: ["201"],
			error: ["404", "default"],
		});
	});

	it("classifies wildcard and informational statuses deterministically without dropping them", () => {
		expect(
			classifyResponseStatusCodes([
				"default",
				"5xx",
				"500",
				"4XX",
				"400",
				"3XX",
				"301",
				"2xx",
				"200",
				"1XX",
				"101",
				"4XX",
			]),
		).toEqual({
			success: ["200", "2XX"],
			error: [
				"101",
				"1XX",
				"301",
				"3XX",
				"400",
				"4XX",
				"500",
				"5XX",
				"default",
			],
		});
	});

	it("reads the selected success response instead of hard-coding 200", () => {
		const operation = {
			getResponseStatusCodes: () => ["204", "201"],
			getResponseByStatusCode: (code: string) =>
				code === "201"
					? { content: { "application/json": {} } }
					: { content: { "text/plain": {} } },
		} as unknown as Operation;
		expect(new OperationAccessor(operation).getResponseContentType()).toEqual([
			"application/json",
		]);
	});

	it("uses the original case-insensitive wildcard key when reading a response", () => {
		const operation = {
			schema: {
				responses: {
					"2xx": { content: { "application/json": {} } },
				},
			},
			getResponseStatusCodes: () => ["2xx"],
			getResponseByStatusCode: (code: string) =>
				code === "2xx" ? { content: { "application/json": {} } } : undefined,
		} as unknown as Operation;
		expect(new OperationAccessor(operation).getResponseContentType()).toEqual([
			"application/json",
		]);
	});

	it("selects JSON media for a standalone response component", () => {
		expect(
			describeResponse({
				description: "Multiple media",
				content: {
					"application/xml": { schema: { type: "string" } },
					"application/json": {
						schema: { type: "object", properties: { id: { type: "string" } } },
					},
				},
			}),
		).toMatchObject({
			kind: "schema",
			contentType: "application/json",
			schema: { type: "object", properties: { id: { type: "string" } } },
		});
	});

	it("keeps the compatibility response first and inventories other media deterministically", () => {
		const operation = {
			schema: {
				responses: {
					"200": {
						description: "Multiple media",
						content: {
							"text/plain": { schema: { type: "string" } },
							"application/xml": { schema: { type: "number" } },
							"application/json": { schema: { type: "object" } },
						},
					},
				},
			},
			api: {},
		} as unknown as Operation;
		expect(describeOperationResponses(operation)[0]).toMatchObject({
			kind: "schema",
			contentType: "application/json",
			inspection: [
				{ contentType: "application/json" },
				{ contentType: "application/xml" },
				{ contentType: "text/plain" },
			],
		});
	});

	it("describes schema, unknown-media, no-content, and reference responses without losing original wildcard keys", () => {
		let convertedReferences = 0;
		const operation = {
			schema: {
				responses: {
					"200": {
						description: "Body",
						content: { "application/json": { schema: { type: "string" } } },
					},
					"201": {
						description: "Any body",
						content: { "application/json": {} },
					},
					"204": { description: "No body" },
					"2xx": { $ref: "#/components/responses/Wildcard" },
				},
			},
			api: {
				components: {
					responses: {
						Wildcard: {
							description: "Resolved wildcard",
							content: {
								"application/xml": {
									schema: { type: "string", enum: ["unused"] },
								},
								"application/json": {
									schema: { $ref: "#/components/schemas/Wildcard" },
								},
							},
						},
					},
				},
			},
			getResponseAsJSONSchema: (status: string) => {
				if (status.toLowerCase() === "2xx") convertedReferences += 1;
				return [];
			},
		} as unknown as Operation;

		expect(describeOperationResponses(operation)).toMatchObject([
			{
				statusCode: "200",
				sourceStatusCode: "200",
				classification: "success",
				kind: "schema",
			},
			{
				statusCode: "201",
				sourceStatusCode: "201",
				classification: "success",
				kind: "unknown-media",
			},
			{
				statusCode: "204",
				sourceStatusCode: "204",
				classification: "success",
				kind: "no-content",
			},
			{
				statusCode: "2XX",
				sourceStatusCode: "2xx",
				classification: "success",
				kind: "reference",
				schema: { $ref: "#/components/responses/Wildcard" },
				inspection: [
					{
						contentType: "application/json",
						description: "Resolved wildcard",
						label: "application/json",
						schema: { $ref: "#/components/schemas/Wildcard" },
					},
					{
						contentType: "application/xml",
						description: "Resolved wildcard",
						label: "application/xml",
						schema: { type: "string", enum: ["unused"] },
					},
				],
			},
		]);
		expect(convertedReferences).toBe(0);
	});
});

describe("OperationAccessor instance isolation", () => {
	it("does not reuse an accessor for a different document with the same path and method", () => {
		const first = {
			path: "/users/{id}",
			method: "get",
			getOperationId: () => "targetA",
		} as unknown as Operation;
		const second = {
			path: "/users/{id}",
			method: "get",
			getOperationId: () => "targetB",
		} as unknown as Operation;
		const firstAccessor = OperationAccessor.getInstance(first);
		const secondAccessor = OperationAccessor.getInstance(second);
		expect(firstAccessor).not.toBe(secondAccessor);
		expect(firstAccessor.operationId).toBe("targetA");
		expect(secondAccessor.operationId).toBe("targetB");
		expect(OperationAccessor.getInstance(first)).toBe(firstAccessor);
	});
});

describe("response header semantics", () => {
	const document = {
		components: {
			responses: {
				Reusable: {
					headers: {
						"X-Request-Id": { $ref: "#/components/headers/RequestId" },
					},
				},
			},
			headers: {
				RequestId: {
					required: true,
					schema: { $ref: "#/components/schemas/Id" },
				},
				Page: {
					content: {
						"application/json": { schema: { type: "integer" } },
					},
				},
			},
			schemas: { Id: { type: "string" } },
		},
	};

	it("describes inline schema and content headers with deterministic canonical identity", () => {
		expect(
			describeResponseHeaders(
				{
					headers: {
						"X-Page": { $ref: "#/components/headers/Page" },
						"X-Required": { required: true, schema: { type: "integer" } },
						"X-Optional": { schema: { type: "string" } },
						"cOnTeNt-TyPe": { schema: { type: "boolean" } },
					},
				} as never,
				document,
			),
		).toEqual({
			headers: [
				{
					sourceName: "X-Optional",
					canonicalName: "x-optional",
					required: false,
					schema: { type: "string" },
					resolution: "inline",
				},
				{
					sourceName: "X-Page",
					canonicalName: "x-page",
					required: false,
					schema: { type: "integer" },
					contentType: "application/json",
					sourceRef: "#/components/headers/Page",
					resolution: "resolved",
				},
				{
					sourceName: "X-Required",
					canonicalName: "x-required",
					required: true,
					schema: { type: "integer" },
					resolution: "inline",
				},
			],
			collisions: [],
		});
	});

	it("resolves response references and fails closed for case-only header collisions", () => {
		const descriptor = describeResponseHeaders(
			{ $ref: "#/components/responses/Reusable" } as never,
			document,
		);
		expect(descriptor.headers).toMatchObject([
			{
				sourceName: "X-Request-Id",
				canonicalName: "x-request-id",
				required: true,
				schema: { $ref: "#/components/schemas/Id" },
				resolution: "resolved",
			},
		]);
		expect(
			describeResponseHeaders(
				{
					headers: {
						"X-Foo": { schema: { type: "string" } },
						"x-foo": { schema: { type: "integer" } },
						"CONTENT-TYPE": { $ref: "#/components/headers/Missing" },
					},
				} as never,
				document,
			).collisions,
		).toEqual([{ canonicalName: "x-foo", sourceNames: ["X-Foo", "x-foo"] }]);
	});

	it("bounds missing and cyclic local header references", () => {
		const cyclicDocument = {
			components: {
				headers: {
					A: { $ref: "#/components/headers/B" },
					B: { $ref: "#/components/headers/A" },
				},
			},
		};
		expect(
			describeResponseHeaders(
				{
					headers: {
						Missing: { $ref: "#/components/headers/Nope" },
						Cyclic: { $ref: "#/components/headers/A" },
					},
				} as never,
				cyclicDocument,
			).headers.map(({ schema, resolution }) => ({ schema, resolution })),
		).toEqual([
			{ schema: false, resolution: "cycle" },
			{ schema: false, resolution: "unresolved" },
		]);
	});

	it("fails closed on multiple Header content entries even beside a schema", () => {
		expect(
			describeResponseHeaders(
				{
					headers: {
						"X-Invalid": {
							schema: { type: "string" },
							content: {
								"application/json": { schema: { type: "object" } },
								"text/plain": { schema: { type: "string" } },
							},
						},
					},
				} as never,
				{},
			).headers,
		).toMatchObject([
			{
				sourceName: "X-Invalid",
				schema: false,
				invalidContent: true,
			},
		]);
	});
});
