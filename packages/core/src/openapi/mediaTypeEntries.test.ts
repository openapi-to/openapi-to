import { describe, expect, it } from "vitest";
import { inspectOpenAPI32MediaContent, inspectOpenAPI32QuerystringMedia } from "./mediaTypeEntries.ts";

describe("OpenAPI 3.2 media entry inspection", () => {
	it("inspects the effective referenced querystring parameter at its source path", () => {
		const document = {
			openapi: "3.2.1",
			components: { parameters: { Filter: { name: "filter", in: "querystring", content: { "application/json": { $ref: "#/components/mediaTypes/Filter" } } } }, mediaTypes: { Filter: { schema: { type: "object" }, itemSchema: { type: "string" } } } },
			paths: { "/items": { parameters: [{ $ref: "#/components/parameters/Filter" }], get: { responses: { "204": { description: "ok" } } } } },
		};
		const operation = { api: document, path: "/items", schema: document.paths["/items"].get };
		expect(inspectOpenAPI32QuerystringMedia(operation as never, ["paths", "/items", "get"])).toMatchObject([
			{ path: ["paths", "/items", "parameters", 0, "content", "application/json"], semantics: { hasItemSchema: true }, resolution: "resolved" },
		]);
	});
	it("resolves local reusable media and array schema refs while ignoring reference siblings", () => {
		const document = {
			components: {
				mediaTypes: {
					A: { $ref: "#/components/mediaTypes/B" },
					B: {
						schema: { $ref: "#/components/schemas/Parts" },
						itemEncoding: {},
					},
				},
				schemas: { Parts: { type: "array", items: { type: "string" } } },
			},
		};
		const entries = inspectOpenAPI32MediaContent(
			document,
			{
				content: {
					"multipart/form-data": {
						$ref: "#/components/mediaTypes/A",
						schema: { type: "object" },
					},
				},
			},
			["requestBody"],
		);
		expect(entries).toMatchObject([
			{
				resolution: "resolved",
				positionalArray: true,
				semantics: { encodingMode: "positional", hasItemSchema: false },
			},
		]);
		expect(entries[0]?.path).toEqual([
			"requestBody",
			"content",
			"multipart/form-data",
		]);
	});
	it("recognizes multipart array types expressed as a JSON Schema type union", () => {
		const entries = inspectOpenAPI32MediaContent(
			{},
			{
				content: {
					"multipart/form-data": {
						schema: { type: ["array", "null"], items: { type: "string" } },
					},
				},
			},
			["requestBody"],
		);
		expect(entries).toMatchObject([{ positionalArray: true }]);
	});
	it("detects arrays in bounded schema composition and local references", () => {
		const document = {
			components: {
				schemas: {
					Parts: {
						oneOf: [
							{ type: "object" },
							{ type: ["array", "null"], items: { type: "string" } },
						],
					},
				},
			},
		};
		const entries = inspectOpenAPI32MediaContent(
			document,
			{
				content: {
					"multipart/form-data": {
						schema: { allOf: [{ $ref: "#/components/schemas/Parts" }] },
					},
				},
			},
			["requestBody"],
		);
		expect(entries).toMatchObject([
			{ positionalArray: true, schemaReferenceUnresolved: false },
		]);
	});
	it("detects array fields only on the bounded form-data object path", () => {
		const media = {
			schema: {
				type: "object",
				properties: { parts: { type: "array", items: { type: "string" } } },
			},
		};
		const form = inspectOpenAPI32MediaContent(
			{},
			{ content: { "multipart/form-data": media } },
			["requestBody"],
		);
		const json = inspectOpenAPI32MediaContent(
			{},
			{ content: { "application/json": media } },
			["requestBody"],
		);
		expect(form).toMatchObject([
			{ positionalArray: false, formDataArrayProperty: true },
		]);
		expect(json).toMatchObject([
			{ positionalArray: false, formDataArrayProperty: false },
		]);
	});
	it("bounds cyclic and unresolved media references", () => {
		const document = {
			components: { mediaTypes: { A: { $ref: "#/components/mediaTypes/A" } } },
		};
		expect(
			inspectOpenAPI32MediaContent(
				document,
				{
					content: {
						"application/json": { $ref: "#/components/mediaTypes/A" },
					},
				},
				["requestBody"],
			)[0],
		).toMatchObject({ resolution: "unresolved" });
	});
	it("marks unresolved schema refs and nested multipart transport", () => {
		const document = { components: { schemas: {} } };
		const entries = inspectOpenAPI32MediaContent(
			document,
			{
				content: {
					"multipart/form-data": {
						schema: { $ref: "#/components/schemas/Missing" },
						encoding: {
							part: { contentType: "multipart/mixed", prefixEncoding: [{}] },
						},
					},
				},
			},
			["requestBody"],
		);
		expect(entries).toMatchObject([
			{ schemaReferenceUnresolved: true, nestedMultipart: true },
		]);
	});
});
