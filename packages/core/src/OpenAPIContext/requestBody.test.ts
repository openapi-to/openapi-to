import type { Operation } from "oas/operation";
import { describe, expect, it, vi } from "vitest";
import {
	getOperationRequestBodyMediaType,
	getOperationRequestBodyMediaTypeObject,
	isOperationRequestBodyRequired,
} from "./requestBody.ts";

describe("request body media selection", () => {
	it.each([undefined, false, true])("resolves effective requestBody requiredness without mutation: %s", (required) => {
		const operation = { schema: { requestBody: { $ref: "#/components/requestBodies/Input" } }, api: { components: { requestBodies: { Input: { required, content: { "application/json": { schema: { type: "string" } } } } } } } } as unknown as Operation;
		const before = JSON.stringify(operation);
		expect(isOperationRequestBodyRequired(operation)).toBe(required === true);
		expect(JSON.stringify(operation)).toBe(before);
	});
	it("resolves local request-body refs and prefers JSON without mutating through oas", () => {
		const getRequestBody = vi.fn(() => {
			throw new Error("oas request-body conversion must not run");
		});
		const operation = {
			schema: { requestBody: { $ref: "#/components/requestBodies/Input" } },
			api: {
				components: {
					requestBodies: {
						Input: {
							content: {
								"text/plain": { schema: { type: "string" } },
								"application/problem+json": {
									schema: { $ref: "#/components/schemas/Input" },
								},
							},
						},
					},
				},
			},
			getRequestBody,
		} as unknown as Operation;

		expect(getOperationRequestBodyMediaTypeObject(operation)).toEqual({
			schema: { $ref: "#/components/schemas/Input" },
		});
		expect(getOperationRequestBodyMediaType(operation)).toEqual([
			"application/problem+json",
			{ schema: { $ref: "#/components/schemas/Input" } },
		]);
		expect(getRequestBody).not.toHaveBeenCalled();
	});

	it("fails closed on a circular request-body reference", () => {
		const operation = {
			schema: { requestBody: { $ref: "#/components/requestBodies/Loop" } },
			api: {
				components: {
					requestBodies: {
						Loop: { $ref: "#/components/requestBodies/Loop" },
					},
				},
			},
		} as unknown as Operation;

		expect(getOperationRequestBodyMediaTypeObject(operation)).toBe(false);
	});
});
