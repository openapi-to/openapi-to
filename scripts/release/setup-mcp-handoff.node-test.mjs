import assert from "node:assert/strict";
import test from "node:test";

import {
	createCodexHostLaunch,
	formatPackedMcpConnectionFailure,
} from "./setup-mcp-handoff-smoke.mjs";

test("packed MCP connection diagnostics are bounded and redact secrets", () => {
	const launch = createCodexHostLaunch({ mode: "read-only" });
	const diagnostic = formatPackedMcpConnectionFailure({
		launch,
		error: Object.assign(
			new Error(
				"spawn failed: Authorization: Bearer bearer-secret token=token-secret",
			),
			{ code: "ENOENT" },
		),
		transportError: new Error("transport failed?key=key-secret"),
		stderr: `startup ${"x".repeat(10_000)}&password=password-secret`,
		closed: true,
		pid: 123,
	});

	assert.equal(diagnostic.includes("/private/consumer-with-secret"), false);
	assert.equal(diagnostic.includes("bearer-secret"), false);
	assert.equal(diagnostic.includes("token-secret"), false);
	assert.equal(diagnostic.includes("key-secret"), false);
	assert.equal(diagnostic.includes("password-secret"), false);
	assert.match(diagnostic, /connectError=Error: spawn failed/);
	assert.match(diagnostic, /transportError=Error: transport failed/);
	assert.match(diagnostic, /stderr=/);
	assert.ok(diagnostic.length < 5_000);
});
