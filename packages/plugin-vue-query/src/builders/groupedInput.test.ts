import type { OperationWrapper } from "@openapi-to/core";
import { describe, expect, it } from "vitest";
import { buildMethodBody } from "./buildMethodBody.ts";

describe("Vue grouped input", () => {
	it.each(["get", "post"])("resolves reactive values before %s request and keeps config/key contract", (method) => {
		const operation = { method, path: "/items/{id}", accessor: { operationName: "getItem", hasPathParameters: true, hasQueryParameters: true, hasRequestBody: method === "post", pathParameters: [{ name: "id" }], queryParameters: [{ name: "q" }], operationTSType: { responseError: "Error" }, operationRequest: { requestName: "getItemService" } } } as unknown as OperationWrapper;
		const text = buildMethodBody(operation, { placeholderData: { value: "keepPreviousData", pathInclude: [] }, responseErrorTypeImportDeclaration: { namedImports: ["AxiosError"] } } as never);
		expect(text).toContain("path: { id: toValue(id) }");
		expect(text).toContain("query: toValue(params)");
		expect(text).toContain("}, requestConfig)");
		if (method === "post") expect(text).toContain("body: toValue(data)");
		else {
			expect(text).toContain("requestConfig.signal = signal");
			expect(text).toContain("getItemQueryKey(toValue(id),params)");
		}
		expect(text).not.toMatch(/input\.(headers|cookies)/);
	});
});
