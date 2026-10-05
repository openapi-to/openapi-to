import path from "node:path";
import { type OpenAPIDocument, PluginManager } from "@openapi-to/core";
import { definePlugin as defineTypePlugin } from "@openapi-to/plugin-ts-type";
import { describe, expect, it } from "vitest";
import { definePlugin } from "./plugin.ts";

function document(
	mediaType: string,
	media: object,
	direction: "request" | "response" = "request",
	version = "3.2.1",
) {
	const operation = {
		operationId: "send",
		tags: ["media"],
		...(direction === "request"
			? {
					requestBody: { content: { [mediaType]: media } },
					responses: { "204": { description: "ok" } },
				}
			: {
					responses: {
						"200": { description: "ok", content: { [mediaType]: media } },
					},
				}),
	};
	return {
		openapi: version,
		info: { title: "media", version: "1" },
		paths: { "/media": { post: operation } },
	} as unknown as OpenAPIDocument;
}
async function generate(doc: OpenAPIDocument, requestClient: "axios" | "common" | "fetch" = "axios") {
	return new PluginManager(
		{
			name: "media-runtime",
			root: process.cwd(),
			input: { path: "media.json" },
			output: { dir: path.join(process.cwd(), "test-output", "media-runtime") },
			plugins: [defineTypePlugin(), definePlugin({ requestClient })],
		},
		doc,
	).execute();
}

function querystringDocument(media: object): OpenAPIDocument {
	return { openapi: "3.2.1", info: { title: "querystring", version: "1" }, paths: { "/items": { get: { operationId: "getItems", tags: ["items"], parameters: [{ name: "filter", in: "querystring", content: { "application/json": media } }], responses: { "204": { description: "ok" } } } } } } as unknown as OpenAPIDocument;
}

describe("OpenAPI 3.2 Request media runtime boundary", () => {
	it("keeps Fetch fail-closed for itemSchema streaming querystring media", async () => {
		const result = await generate(querystringDocument({ itemSchema: { type: "string" } }), "fetch");
		expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "TS_REQUEST_MEDIA_RUNTIME_UNSUPPORTED", severity: "error" })]));
		expect(result.sourceFiles.some((file) => file.getFilePath().endsWith(".service.ts"))).toBe(false);
	});

	it("rejects itemSchema-only querystring through the media boundary", async () => {
		const result = await generate(querystringDocument({ itemSchema: { type: "string" } }));
		expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "TS_REQUEST_MEDIA_RUNTIME_UNSUPPORTED", severity: "error", location: expect.objectContaining({ path: ["paths", "/items", "get", "parameters", 0, "content", "application/json"] }) })]));
		expect(result.diagnostics.map((item) => item.code)).not.toContain("TS_REQUEST_QUERYSTRING_UNSUPPORTED");
		expect(result.sourceFiles.some((file) => file.getFilePath().endsWith(".service.ts"))).toBe(false);
	});
	it("keeps schema-only and ignored positional JSON querystring transport", async () => {
		for (const media of [
			{ schema: { type: "object" } },
			{ schema: { type: "object" }, prefixEncoding: [{}], itemEncoding: {} },
		]) {
			const result = await generate(querystringDocument(media));
			expect(result.diagnostics.map((item) => item.code)).not.toContain("TS_REQUEST_MEDIA_RUNTIME_UNSUPPORTED");
			const service = result.sourceFiles.find((file) => file.getFilePath().endsWith(".service.ts"));
			expect(service?.getFullText()).toContain("querystringJson");
		}
	});
	it("uses Core-resolved schema-only querystring Media Type references", async () => {
		const doc = querystringDocument({ $ref: "#/components/mediaTypes/Filter" }) as unknown as Record<string, unknown>;
		doc.components = { mediaTypes: { Filter: { schema: { type: "object" } } } };
		const result = await generate(doc as OpenAPIDocument);
		expect(result.diagnostics.map((item) => item.code)).not.toContain("TS_REQUEST_MEDIA_RUNTIME_UNSUPPORTED");
		expect(result.diagnostics.map((item) => item.code)).not.toContain("TS_REQUEST_QUERYSTRING_UNSUPPORTED");
		expect(result.sourceFiles.find((file) => file.getFilePath().endsWith(".service.ts"))?.getFullText()).toContain("querystringJson");
	});
	it("rejects querystring itemSchema before service creation, including inherited references", async () => {
		const doc = document("application/json", { schema: { type: "string" } }) as unknown as Record<string, unknown>;
		const paths = doc.paths as Record<string, Record<string, unknown>>;
		const pathItem = paths["/media"];
		if (!pathItem) throw new Error("Expected /media path item");
		delete (pathItem.post as Record<string, unknown>).requestBody;
		pathItem.parameters = [{ $ref: "#/components/parameters/Filter" }];
		doc.components = { parameters: { Filter: { name: "filter", in: "querystring", content: { "application/json": { $ref: "#/components/mediaTypes/Filter" } } } }, mediaTypes: { Filter: { schema: { type: "object" }, itemSchema: { type: "string" } } } };
		const result = await generate(doc as OpenAPIDocument);
		expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "TS_REQUEST_MEDIA_RUNTIME_UNSUPPORTED", location: expect.objectContaining({ path: ["paths", "/media", "parameters", 0, "content", "application/json"] }) })]));
		expect(result.sourceFiles.some((file) => file.getFilePath().endsWith(".service.ts"))).toBe(false);
	});
	for (const mediaType of [
		"application/jsonl",
		"application/json-seq",
		"application/x-ndjson",
		"application/vnd.api+json-seq",
		"text/event-stream",
	]) {
		for (const direction of ["request", "response"] as const) {
			it(`rejects ${mediaType} ${direction} before service creation`, async () => {
				const result = await generate(
					document(
						mediaType,
						{ schema: { type: "array", items: { type: "string" } } },
						direction,
					),
				);
				expect(result.diagnostics).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							code: "TS_REQUEST_MEDIA_RUNTIME_UNSUPPORTED",
							severity: "error",
							location: expect.objectContaining({
								path: expect.arrayContaining(["content", mediaType]),
							}),
						}),
					]),
				);
				expect(
					result.sourceFiles.some((file) =>
						file.getFilePath().endsWith(".service.ts"),
					),
				).toBe(false);
			});
		}
	}
	it("rejects positional multipart and itemSchema, including reusable media references", async () => {
		const doc = document("multipart/form-data", {
			$ref: "#/components/mediaTypes/Parts",
		}) as unknown as Record<string, unknown>;
		doc.components = {
			mediaTypes: { Parts: { schema: { $ref: "#/components/schemas/Parts" } } },
			schemas: { Parts: { type: "array", items: { type: "string" } } },
		};
		const result = await generate(doc as OpenAPIDocument);
		expect(result.diagnostics.map((item) => item.code)).toContain(
			"TS_REQUEST_MEDIA_RUNTIME_UNSUPPORTED",
		);
		expect(
			result.sourceFiles.some((file) =>
				file.getFilePath().endsWith(".service.ts"),
			),
		).toBe(false);
		const item = await generate(
			document(
				"application/octet-stream",
				{ itemSchema: { type: "string" } },
				"response",
			),
		);
		expect(item.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
			"TS_REQUEST_MEDIA_RUNTIME_UNSUPPORTED",
		);
	});
	it("rejects multipart array type unions before service creation", async () => {
		for (const direction of ["request", "response"] as const) {
			const result = await generate(
				document(
					"multipart/form-data",
					{ schema: { type: ["array", "null"], items: { type: "string" } } },
					direction,
				),
			);
			expect(result.diagnostics.map((item) => item.code)).toContain(
				"TS_REQUEST_MEDIA_RUNTIME_UNSUPPORTED",
			);
			expect(
				result.sourceFiles.some((file) =>
					file.getFilePath().endsWith(".service.ts"),
				),
			).toBe(false);
		}
	});
	it("rejects composed multipart array schemas before service creation", async () => {
		for (const direction of ["request", "response"] as const) {
			const result = await generate(
				document(
					"multipart/form-data",
					{ schema: { allOf: [{ type: "array", items: { type: "string" } }] } },
					direction,
				),
			);
			expect(result.diagnostics.map((item) => item.code)).toContain(
				"TS_REQUEST_MEDIA_RUNTIME_UNSUPPORTED",
			);
			expect(
				result.sourceFiles.some((file) =>
					file.getFilePath().endsWith(".service.ts"),
				),
			).toBe(false);
		}
	});
	it("rejects array form-data fields that the serializer would drop", async () => {
		const result = await generate(
			document("multipart/form-data", {
				schema: {
					type: "object",
					properties: { parts: { type: "array", items: { type: "string" } } },
				},
			}),
		);
		expect(result.diagnostics.map((item) => item.code)).toContain(
			"TS_REQUEST_MEDIA_RUNTIME_UNSUPPORTED",
		);
		expect(
			result.sourceFiles.some((file) =>
				file.getFilePath().endsWith(".service.ts"),
			),
		).toBe(false);
	});
	it("keeps ignored encoding and legacy name-based form-data paths", async () => {
		for (const [mediaType, media] of [
			[
				"application/json",
				{ schema: { type: "object" }, prefixEncoding: [{}], itemEncoding: {} },
			],
			[
				"multipart/form-data",
				{
					schema: { type: "object", properties: { name: { type: "string" } } },
					encoding: { name: { contentType: "text/plain" } },
				},
			],
		] as const) {
			const result = await generate(document(mediaType, media));
			expect(
				result.diagnostics.map((diagnostic) => diagnostic.code),
			).not.toContain("TS_REQUEST_MEDIA_RUNTIME_UNSUPPORTED");
			expect(
				result.sourceFiles.some((file) =>
					file.getFilePath().endsWith(".service.ts"),
				),
			).toBe(true);
		}
		const old = await generate(
			document(
				"application/jsonl",
				{ schema: { type: "string" } },
				"response",
				"3.1.0",
			),
		);
		expect(old.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
			"TS_REQUEST_MEDIA_RUNTIME_UNSUPPORTED",
		);
	});
	it("rejects unresolved schema refs and nested multipart encodings before FormData generation", async () => {
		for (const media of [
			{ schema: { $ref: "#/components/schemas/Missing" } },
			{
				schema: { type: "object" },
				encoding: {
					part: { contentType: "multipart/mixed", prefixEncoding: [{}] },
				},
			},
		]) {
			const result = await generate(document("multipart/form-data", media));
			expect(result.diagnostics.map((item) => item.code)).toContain(
				"TS_REQUEST_MEDIA_RUNTIME_UNSUPPORTED",
			);
			expect(
				result.sourceFiles.some((file) =>
					file.getFilePath().endsWith(".service.ts"),
				),
			).toBe(false);
		}
	});
	it("rejects requestBody and response references to reusable streaming media", async () => {
		const doc = document("application/json", {
			schema: { type: "string" },
		}) as unknown as Record<string, unknown>;
		const operation = (
			(doc.paths as Record<string, unknown>)["/media"] as Record<
				string,
				unknown
			>
		).post as Record<string, unknown>;
		operation.requestBody = { $ref: "#/components/requestBodies/Stream" };
		operation.responses = { "200": { $ref: "#/components/responses/Stream" } };
		doc.components = {
			mediaTypes: { Stream: { itemSchema: { type: "string" } } },
			requestBodies: {
				Stream: {
					content: {
						"application/json-seq": { $ref: "#/components/mediaTypes/Stream" },
					},
				},
			},
			responses: {
				Stream: {
					description: "stream",
					content: {
						"application/json-seq": { $ref: "#/components/mediaTypes/Stream" },
					},
				},
			},
		};
		const result = await generate(doc as OpenAPIDocument);
		expect(result.diagnostics.map((item) => item.code)).toContain(
			"TS_REQUEST_MEDIA_RUNTIME_UNSUPPORTED",
		);
		expect(
			result.sourceFiles.some((file) =>
				file.getFilePath().endsWith(".service.ts"),
			),
		).toBe(false);
	});
	it("is deterministic for the same unsupported input", async () => {
		const doc = document(
			"application/x-ndjson",
			{ itemSchema: { type: "string" } },
			"response",
		);
		const first = await generate(doc);
		const second = await generate(doc);
		const summarize = (result: Awaited<ReturnType<typeof generate>>) => ({
			diagnostics: result.diagnostics,
			files: result.sourceFiles
				.map((file) => [file.getFilePath(), file.getFullText()])
				.sort(([a], [b]) => String(a).localeCompare(String(b))),
		});
		expect(summarize(second)).toEqual(summarize(first));
	});
});
