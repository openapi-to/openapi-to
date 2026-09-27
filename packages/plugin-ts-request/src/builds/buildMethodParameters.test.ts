import type { OperationWrapper } from "@openapi-to/core";
import { describe, expect, it } from "vitest";
import { RequestClientEnum } from "../types.ts";
import { buildMethodParameters } from "./buildMethodParameters.ts";

describe("grouped request parameters", () => {
	it.each([false, true])("uses Core input optionality and producer metadata: %s", (optional) => {
		const operation = { accessor: { isRequestInputOptional: optional, hasRequestBody: true, operationTSType: { requestInput: "CreateInput", body: "Body" } } } as unknown as OperationWrapper;
		const parameters = buildMethodParameters(operation);
		expect(parameters).toEqual([
			{ name: "input", type: "CreateInput", ...(optional ? { initializer: "{}" } : {}) },
			{ name: "requestConfig", hasQuestionToken: true, type: "Partial<AxiosRequestConfig<Body>>" },
		]);
	});

	it("keeps Common config separate from even a strict empty input", () => {
		const operation = { accessor: { isRequestInputOptional: true, hasRequestBody: false, operationTSType: { requestInput: "EmptyRequestInput", headerParams: "Headers", cookieParams: "Cookies" } } } as unknown as OperationWrapper;
		const parameters = buildMethodParameters(operation, { requestClient: RequestClientEnum.COMMON, requestConfigTypeImportDeclaration: { namedImports: ["CustomConfig"], moduleSpecifier: "client" } });
		expect(parameters).toEqual([{ name: "input", type: "EmptyRequestInput", initializer: "{}" }, { name: "requestConfig", hasQuestionToken: true, type: "Partial<CustomConfig>" }]);
		expect(JSON.stringify(parameters)).not.toMatch(/Headers|Cookies/);
	});
});
