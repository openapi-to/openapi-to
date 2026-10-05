import path from "node:path";
import { type OpenAPIDocument, PluginManager } from "@openapi-to/core";
import { definePlugin as defineTypePlugin } from "@openapi-to/plugin-ts-type";
import { describe, expect, it } from "vitest";
import { definePlugin } from "./plugin.ts";

async function generate(mediaType: string, media: object, version = "3.2.1") {
	const document = {
		openapi: version,
		info: { title: "media", version: "1" },
		paths: {
			"/media": {
				get: {
					operationId: "read",
					tags: ["media"],
					responses: {
						"200": { description: "ok", content: { [mediaType]: media } },
					},
				},
			},
		},
	} as unknown as OpenAPIDocument;
	return new PluginManager(
		{
			name: "msw-media",
			root: process.cwd(),
			input: { path: "media.json" },
			output: { dir: path.join(process.cwd(), "test-output", "msw-media") },
			plugins: [defineTypePlugin(), definePlugin()],
		},
		document,
	).execute();
}

describe("OpenAPI 3.2 MSW media boundary", () => {
	it("rejects querystring itemSchema before handler creation", async () => {
		const document = { openapi: "3.2.1", info: { title: "querystring", version: "1" }, paths: { "/items": { get: { operationId: "getItems", tags: ["items"], parameters: [{ name: "filter", in: "querystring", content: { "application/json": { schema: { type: "object" }, itemSchema: { type: "string" } } } }], responses: { "204": { description: "ok" } } } } } } as unknown as OpenAPIDocument;
		const result = await new PluginManager({ name: "msw-querystring", root: process.cwd(), input: { path: "querystring.json" }, output: { dir: path.join(process.cwd(), "test-output", "msw-querystring") }, plugins: [defineTypePlugin(), definePlugin()] }, document).execute();
		expect(result.diagnostics.map((item) => item.code)).toContain("MSW_MEDIA_RUNTIME_UNSUPPORTED");
		expect(result.sourceFiles.some((file) => file.getFilePath().endsWith(".handler.ts"))).toBe(false);
	});
	for (const mediaType of [
		"application/jsonl",
		"application/json-seq",
		"application/x-ndjson",
		"application/vnd.api+json-seq",
		"text/event-stream",
		"multipart/mixed",
		"multipart/related",
	]) {
		it(`rejects ${mediaType} instead of emitting an ordinary JSON handler`, async () => {
			const result = await generate(mediaType, {
				schema: { type: "array", items: { type: "string" } },
			});
			expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
				"MSW_MEDIA_RUNTIME_UNSUPPORTED",
			);
			expect(
				result.sourceFiles.some((file) =>
					file.getFilePath().endsWith(".handler.ts"),
				),
			).toBe(false);
		});
	}
	it("rejects reusable response media references before handler creation", async () => {
		const doc = {
			openapi: "3.2.1",
			info: { title: "media", version: "1" },
			paths: {
				"/media": {
					get: {
						operationId: "read",
						tags: ["media"],
						responses: { "200": { $ref: "#/components/responses/Stream" } },
					},
				},
			},
			components: {
				mediaTypes: {
					Stream: { schema: { type: "array", items: { type: "string" } } },
				},
				responses: {
					Stream: {
						description: "stream",
						content: {
							"application/jsonl": { $ref: "#/components/mediaTypes/Stream" },
						},
					},
				},
			},
		} as unknown as OpenAPIDocument;
		const result = await new PluginManager(
			{
				name: "msw-media",
				root: process.cwd(),
				input: { path: "media.json" },
				output: { dir: path.join(process.cwd(), "test-output", "msw-media") },
				plugins: [defineTypePlugin(), definePlugin()],
			},
			doc,
		).execute();
		expect(result.diagnostics.map((item) => item.code)).toContain(
			"MSW_MEDIA_RUNTIME_UNSUPPORTED",
		);
		expect(
			result.sourceFiles.some((file) =>
				file.getFilePath().endsWith(".handler.ts"),
			),
		).toBe(false);
	});
	it("rejects multipart array type unions before handler creation", async () => {
		const result = await generate("multipart/form-data", {
			schema: { type: ["array", "null"], items: { type: "string" } },
		});
		expect(result.diagnostics.map((item) => item.code)).toContain(
			"MSW_MEDIA_RUNTIME_UNSUPPORTED",
		);
		expect(
			result.sourceFiles.some((file) =>
				file.getFilePath().endsWith(".handler.ts"),
			),
		).toBe(false);
	});
	it("rejects composed multipart array schemas before handler creation", async () => {
		const result = await generate("multipart/form-data", {
			schema: { allOf: [{ type: "array", items: { type: "string" } }] },
		});
		expect(result.diagnostics.map((item) => item.code)).toContain(
			"MSW_MEDIA_RUNTIME_UNSUPPORTED",
		);
		expect(
			result.sourceFiles.some((file) =>
				file.getFilePath().endsWith(".handler.ts"),
			),
		).toBe(false);
	});
	it("rejects array form-data fields before handler creation", async () => {
		const result = await generate("multipart/form-data", {
			schema: {
				type: "object",
				properties: { parts: { type: "array", items: { type: "string" } } },
			},
		});
		expect(result.diagnostics.map((item) => item.code)).toContain(
			"MSW_MEDIA_RUNTIME_UNSUPPORTED",
		);
		expect(
			result.sourceFiles.some((file) =>
				file.getFilePath().endsWith(".handler.ts"),
			),
		).toBe(false);
	});
	it("rejects itemSchema and positional form-data but preserves ignored fields", async () => {
		for (const media of [
			{ itemSchema: { type: "string" } },
			{ schema: { type: "array", items: { type: "string" } } },
			{ schema: { type: "object" }, prefixEncoding: [{}] },
		]) {
			const result = await generate("multipart/form-data", media);
			expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
				"MSW_MEDIA_RUNTIME_UNSUPPORTED",
			);
		}
		const ignored = await generate("application/json", {
			schema: { type: "object" },
			prefixEncoding: [{}],
			itemEncoding: {},
		});
		expect(
			ignored.diagnostics.map((diagnostic) => diagnostic.code),
		).not.toContain("MSW_MEDIA_RUNTIME_UNSUPPORTED");
		expect(
			ignored.sourceFiles.some((file) =>
				file.getFilePath().endsWith(".handler.ts"),
			),
		).toBe(true);
		const old = await generate(
			"application/jsonl",
			{ schema: { type: "array" } },
			"3.1.0",
		);
		expect(old.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
			"MSW_MEDIA_RUNTIME_UNSUPPORTED",
		);
	});
});
