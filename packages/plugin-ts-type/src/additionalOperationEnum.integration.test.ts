import path from "node:path";
import { type OpenAPIDocument, PluginManager } from "@openapi-to/core";
import { describe, expect, it } from "vitest";
import { definePlugin } from "./plugin.ts";

describe("OpenAPI 3.2 additional operation enum generation", () => {
	it("uses canonical additionalOperations paths for request and response enums", async () => {
		const document = {
			openapi: "3.2.0",
			info: { title: "Additional operation enums", version: "1" },
			tags: [{ name: "tests" }],
			paths: {
				"/search": {
					additionalOperations: {
						FoO: {
							operationId: "customSearch",
							tags: ["tests"],
							requestBody: {
								content: {
									"application/json": {
										schema: {
											type: "object",
											properties: {
												mode: {
													type: "string",
													enum: ["quick", "complete"],
												},
											},
										},
									},
								},
							},
							responses: {
								"200": {
									description: "Search result",
									content: {
										"application/json": {
											schema: {
												type: "object",
												properties: {
													state: {
														type: "string",
														enum: ["ready", "pending"],
													},
												},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		} as OpenAPIDocument;

		const result = await new PluginManager(
			{
				root: ".",
				input: { path: "openapi.json" },
				output: { dir: "test-output/additional-operation-enums" },
				plugins: [definePlugin()],
			},
			document,
		).execute();

		expect(result.diagnostics).toEqual([]);
		const sources = Object.fromEntries(
			result.sourceFiles.map((sourceFile) => [
				path
					.relative(
						"test-output/additional-operation-enums",
						sourceFile.getFilePath(),
					)
					.split(path.sep)
					.join("/"),
				sourceFile.getFullText(),
			]),
		);
		expect(sources["tests/custom-search.types.ts"]).toContain(
			"CustomSearchMutationRequestModeEnumValue",
		);
		expect(sources["tests/custom-search.types.ts"]).toContain(
			"CustomSearchResponse200Application_u2f_JsonStateEnumValue",
		);
		expect(sources["types/enum.model.ts"]).toContain("quick");
		expect(sources["types/enum.model.ts"]).toContain("ready");
	});
});
