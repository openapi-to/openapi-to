import type { Operation } from "oas/operation";
import { describe, expect, it } from "vitest";
import { OperationAccessor } from "./OperationAccessor.ts";

describe("OperationAccessor request metadata", () => {
	it("clears request ownership between reused operation generations", () => {
		const accessor = new OperationAccessor({} as Operation);
		accessor.setOperationRequest({ filePath: "old.service.ts", requestName: "oldService", transport: "fetch" });

		accessor.clearOperationRequest();

		expect(accessor.operationRequest).toBeUndefined();
	});
});
