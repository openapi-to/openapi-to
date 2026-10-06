import type { Operation } from "oas/operation";
import { describe, expect, it } from "vitest";
import { OperationAccessor } from "./OperationAccessor.ts";

describe("OperationAccessor Faker metadata", () => {
	it("clears producer metadata between reused generation invocations", () => {
		const accessor = new OperationAccessor({} as Operation);
		accessor.setOperationFaker({
			filePath: "faker/factories.ts",
			responseSuccess: "createPing200ApplicationJsonResponse",
			responses: [
				{
					statusCode: "200",
					sourceStatusCode: "200",
					classification: "success",
					mediaType: "application/json",
					kind: "schema",
					factoryName: "createPing200ApplicationJsonResponse",
				},
			],
		});

		accessor.clearOperationFaker();

		expect(accessor.operationFaker).toBeUndefined();
	});
});
