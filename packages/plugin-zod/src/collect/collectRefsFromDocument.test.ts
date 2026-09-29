import { describe, expect, it } from "vitest";
import {
	collectRefsFromComponentParameters,
	collectRefsFromComponentResponse,
	collectRefsFromOperationParameter,
	collectRefsFromOperationRequestBody,
} from "./collectRefsFromDocument.ts";

describe("collectRefsFromComponentResponse", () => {
	it("collects refs only from the preferred response media", () => {
		expect(
			collectRefsFromComponentResponse({
				description: "Multiple media",
				content: {
					"application/xml": {
						schema: { $ref: "#/components/schemas/XmlMessage" },
					},
					"application/json": {
						schema: { $ref: "#/components/schemas/JsonMessage" },
					},
				},
			} as never, {}),
		).toEqual(["#/components/schemas/JsonMessage"]);
	});

	it("collects body schema refs without treating response header refs as body imports", () => {
		expect(
			collectRefsFromComponentResponse({
				description: "Success",
				headers: {
					"X-Request-Id": {
						$ref: "#/components/headers/RequestId",
					},
				},
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/Message" },
					},
				},
			} as never, {}),
		).toEqual(["#/components/schemas/Message"]);
	});

	it("collects every schema ref sibling recursively", () => {
		expect(
			collectRefsFromComponentResponse({
				description: "Composed",
				content: {
					"application/json": {
						schema: {
							$ref: "#/components/schemas/Base",
							allOf: [{ $ref: "#/components/schemas/Extra" }],
							anyOf: [{ $ref: "#/components/schemas/Alternative" }],
							properties: {
								child: { $ref: "#/components/schemas/Child" },
							},
						},
					},
				},
			} as never, {}),
		).toEqual([
			"#/components/schemas/Base",
			"#/components/schemas/Child",
			"#/components/schemas/Extra",
			"#/components/schemas/Alternative",
		]);
	});

	it("collects value-schema dependencies through component Header Objects", () => {
		const document = {
			components: {
				headers: {
					RequestId: {
						schema: { $ref: "#/components/schemas/RequestIdValue" },
					},
				},
			},
		};
		expect(
			collectRefsFromComponentResponse(
				{
					description: "Success",
					headers: {
						"X-Request-Id": {
							$ref: "#/components/headers/RequestId",
						},
					},
				} as never,
				document,
			),
		).toEqual(["#/components/schemas/RequestIdValue"]);
	});
});

describe("parameter reference collection", () => {
	it("collects nested refs from operation and component Parameter Object content", () => {
		const parameter = {
			name: "filter",
			in: "header",
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							value: { $ref: "#/components/schemas/Filter" },
						},
					},
				},
			},
		};

		expect(collectRefsFromOperationParameter([parameter] as never)).toEqual([
			"#/components/schemas/Filter",
		]);
		expect(
			collectRefsFromComponentParameters({ Filter: parameter } as never),
		).toEqual(["#/components/schemas/Filter"]);
	});
});

describe("request body reference collection", () => {
	it("does not short-circuit a schema carrying $ref siblings", () => {
		expect(
			collectRefsFromOperationRequestBody({
				schema: {
					requestBody: {
						content: {
							"application/json": {
								schema: {
									$ref: "#/components/schemas/Base",
									oneOf: [{ $ref: "#/components/schemas/Extra" }],
								},
							},
						},
					},
				},
			} as never),
		).toEqual(["#/components/schemas/Base", "#/components/schemas/Extra"]);
	});
});
