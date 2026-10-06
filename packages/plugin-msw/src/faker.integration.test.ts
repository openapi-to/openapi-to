// @ts-nocheck
import path from "node:path";
import { PluginManager } from "@openapi-to/core";
import { definePlugin as defineFakerPlugin } from "@openapi-to/plugin-faker";
import { definePlugin as defineTsTypePlugin } from "@openapi-to/plugin-ts-type";
import { afterEach, describe, expect, it } from "vitest";
import { definePlugin as defineMswPlugin } from "./plugin.ts";

const OUTPUT_DIR = path.resolve(import.meta.dirname, "../test-output/faker");

function document(responses, openapi = "3.1.0") {
	return {
		openapi,
		info: { title: "MSW Faker integration", version: "1" },
		paths: {
			"/pets": {
				get: {
					operationId: "getPet",
					tags: ["pets"],
					parameters: [
						{ name: "search", in: "query", required: false, schema: { type: "string" } },
					],
					responses,
				},
			},
		},
		components: { schemas: {} },
	};
}

function jsonResponse(schema = { type: "object", properties: { id: { type: "string" } } }) {
	return { description: "ok", content: { "application/json": { schema } } };
}

async function generate(
	source,
	{ includeFaker = true, responseDefaultType = "faker" } = {},
) {
	const plugins = [defineTsTypePlugin()];
	if (includeFaker) plugins.push(defineFakerPlugin());
	plugins.push(
		defineMswPlugin(
			responseDefaultType === null ? {} : { responseDefaultType },
		),
	);
	return new PluginManager(
		{
			name: "msw-faker",
			root: "",
			plugins,
			input: { path: "" },
			output: { dir: OUTPUT_DIR },
		},
		source,
	).execute();
}

function handlerSource(result) {
	return result.sourceFiles.find((sourceFile) =>
		sourceFile.getFilePath().endsWith(".handler.ts"),
	)?.getFullText();
}

afterEach(async () => {
	const fs = await import("node:fs/promises");
	await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
});

describe("MSW Faker response integration", () => {
	it.each(["200", "201"])("injects the canonical %s response factory", async (status) => {
		const result = await generate(document({ [status]: jsonResponse() }));
		const source = handlerSource(result);
		expect(source).toContain(`createGetPet${status}ApplicationJsonResponse`);
		expect(source).toContain(
			`faker: Parameters<typeof createGetPet${status}ApplicationJsonResponse>[0]`,
		);
		expect(source).toContain(
			`data: GetPetResponse = createGetPet${status}ApplicationJsonResponse(faker)`,
		);
		expect(source).not.toContain("data?:");
		expect(source).toContain(`status: ${status}`);
		expect(source).not.toContain("responseSuccess);");
	});

	it("prefers exact application/json over vendor JSON media", async () => {
		const response = jsonResponse();
		response.content["application/problem+json"] = jsonResponse().content["application/json"];
		const result = await generate(document({ "200": response }));
		const source = handlerSource(result);
		expect(source).toContain("createGetPet200ApplicationJsonResponse");
		expect(source).not.toContain("createGetPet200ApplicationProblemJsonResponse(faker)");
		expect(result.diagnostics.map(({ code }) => code)).not.toContain(
			"MSW_FAKER_RESPONSE_AMBIGUOUS",
		);
	});

	it("selects one application/*+json candidate", async () => {
		const result = await generate(
			document({
				"200": {
					description: "ok",
					content: {
						"application/problem+json": {
							schema: { type: "object", properties: { message: { type: "string" } } },
						},
					},
				},
			}),
		);
		expect(handlerSource(result)).toContain(
			"createGetPet200ApplicationProblemJsonResponse(faker)",
		);
	});

	it("fails closed when multiple vendor JSON factories are ambiguous", async () => {
		const response = {
			description: "ok",
			content: {
				"application/problem+json": jsonResponse().content["application/json"],
			},
		};
		response.content["application/vnd.pet+json"] = jsonResponse().content["application/json"];
		const result = await generate(document({ "200": response }));
		expect(handlerSource(result)).toBeUndefined();
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "MSW_FAKER_RESPONSE_AMBIGUOUS",
				severity: "error",
				plugin: "MSW",
				location: {
					path: ["paths", "/pets", "get", "responses", "200", "content"],
				},
			}),
		);
	});

	it.each([
		["wildcard status", { "2XX": jsonResponse() }, "MSW_FAKER_STATUS_UNSUPPORTED"],
		["default status", { default: jsonResponse() }, "MSW_FAKER_STATUS_UNSUPPORTED"],
		["no content", { "204": { description: "empty" } }, "MSW_FAKER_RESPONSE_UNAVAILABLE"],
		[
			"204 body-forbidden JSON status",
			{ "204": jsonResponse() },
			"MSW_FAKER_STATUS_UNSUPPORTED",
		],
		[
			"205 body-forbidden JSON status",
			{ "205": jsonResponse() },
			"MSW_FAKER_STATUS_UNSUPPORTED",
		],
		[
			"text response",
			{ "200": { description: "text", content: { "text/plain": { schema: { type: "string" } } } } },
			"MSW_FAKER_RESPONSE_UNAVAILABLE",
		],
		[
			"binary response",
			{ "200": { description: "binary", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } } },
			"MSW_FAKER_RESPONSE_UNAVAILABLE",
		],
		[
			"schema-less JSON",
			{ "200": { description: "empty JSON", content: { "application/json": {} } } },
			"MSW_FAKER_RESPONSE_UNAVAILABLE",
		],
	])("omits handler for unsupported %s", async (_name, responses) => {
		const result = await generate(document(responses));
		expect(handlerSource(result)).toBeUndefined();
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({
				code: expect.stringMatching(/^MSW_FAKER_/),
				severity: "error",
				plugin: "MSW",
			}),
		);
	});

	it.each([
		[
			"streaming JSON",
			"application/jsonl",
			{
				schema: { type: "array", items: { type: "string" } },
				itemSchema: { type: "string" },
			},
		],
		["SSE", "text/event-stream", { schema: { type: "string" } }],
		[
			"positional multipart",
			"multipart/mixed",
			{ schema: { type: "object" }, prefixEncoding: [] },
		],
	])("preserves the OAS 3.2 %s transport gate", async (_name, mediaType, media) => {
		const source = document(
			{ "200": { description: "media", content: { [mediaType]: media } } },
			"3.2.0",
		);
		const result = await generate(source);
		expect(handlerSource(result)).toBeUndefined();
		expect(result.diagnostics.map(({ code }) => code)).toContain(
			"MSW_MEDIA_RUNTIME_UNSUPPORTED",
		);
	});

	it("fails the plugin dependency contract when pluginFaker is absent", async () => {
		await expect(
			generate(document({ "200": jsonResponse() }), { includeFaker: false }),
		).rejects.toThrow(/Faker/);
	});

	it("keeps omitted and non-faker configuration byte-identical", async () => {
		const source = document({ "200": jsonResponse() });
		const omitted = await generate(source, {
			includeFaker: false,
			responseDefaultType: null,
		});
		const otherValue = await generate(source, {
			includeFaker: false,
			responseDefaultType: "stub",
		});
		expect(handlerSource(otherValue)).toBe(handlerSource(omitted));
	});
});
