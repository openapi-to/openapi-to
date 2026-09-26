import type { OperationWrapper } from "@openapi-to/core";
import { describe, expect, it } from "vitest";
import { buildMethodBody } from "./buildMethodBody.ts";
import { RequestClientEnum } from "../types.ts";

describe("grouped runtime transport", () => {
	it.each([RequestClientEnum.AXIOS, RequestClientEnum.COMMON])("routes input path/query/body and keeps config separate for %s", (requestClient) => {
		const operation = { method: "post", accessor: { operation: { path: "/items/{input}", getContentType: () => "application/json" }, hasQueryParameters: true, hasRequestBody: true, isRequestBodyRequired: false, isJsonContainsDefaultCases: true, dataReturnType: [], operationTSType: { body: "Body", responseSuccess: "Result", queryParams: "Query" }, operationZodSchema: { body: "bodySchema" } } } as unknown as OperationWrapper;
		const text = buildMethodBody(operation, { requestClient, parser: "zod" } as never);
		// biome-ignore lint/suspicious/noTemplateCurlyInString: asserting generated TypeScript interpolation
		expect(text).toContain("${input.path.input}");
		expect(text).toContain("const params = input.query");
		expect(text).toContain("const data = input.body");
		expect(text).toContain("data === undefined ? undefined : bodySchema.parse(data)");
		expect(text).toContain("...requestConfig");
		expect(text).not.toMatch(/input\.(headers|cookies)|const input =/);
	});
});
