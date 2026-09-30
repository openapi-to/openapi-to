import type { ComponentsResponsesValue } from "@openapi-to/core";
import { describe, expect, it } from "vitest";
import { buildComponentsResponse } from "./buildComponentsResponse.ts";

describe("buildComponentsResponse", () => {
	it("fails closed when a response component declares multiple media types", () => {
		const result = buildComponentsResponse(
			{
				description: "Multiple media",
				content: {
					"application/xml": { schema: { type: "string" } },
					"application/json": {
						schema: {
							type: "object",
							properties: { id: { type: "string" } },
						},
					},
				},
			} as ComponentsResponsesValue,
			"PreferredResponse",
		);

		expect(result.declarations[0]?.initializer).toBe("z.never()");
	});
});
