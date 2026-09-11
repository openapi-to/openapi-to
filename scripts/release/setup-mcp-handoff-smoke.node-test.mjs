import assert from "node:assert/strict";
import test from "node:test";

import {
	assertModeCapabilityAgreement,
	assertObservedStateHashChanged,
	createCodexHostLaunch,
	createSetupMcpHandoffReport,
} from "./setup-mcp-handoff-smoke.mjs";

function tool(name, properties = {}, required = []) {
	return {
		name,
		inputSchema: { type: "object", properties, required },
		outputSchema: { type: "object", properties: {} },
	};
}

function readOnlyTools() {
	return [
		tool("openapi_validate"),
		tool("openapi_list_targets"),
		tool("openapi_generate_dry_run", { targets: {}, scope: {} }),
	];
}

function writeEnabledTools() {
	return [
		...readOnlyTools(),
		tool("openapi_prepare_generation", { targets: {}, selection: {} }),
		tool(
			"openapi_apply_generation",
			{ planId: {}, token: {}, approvedPlanHash: {} },
			["planId", "token", "approvedPlanHash"],
		),
	];
}

test("constructs safe read-only and write-enabled Codex Host launches", () => {
	const readOnly = createCodexHostLaunch({
		mode: "read-only",
		platform: "linux",
	});
	assert.equal(readOnly.command, "pnpm");
	assert.deepEqual(readOnly.args, [
		"exec",
		"--",
		"openapi-to-mcp",
		"--workspace-root",
		".",
		"--config",
		"openapi.config.cjs",
	]);
	assert.doesNotMatch(readOnly.configToml, /--allow-write|approval_mode/);

	const writeEnabled = createCodexHostLaunch({
		mode: "write-enabled",
		platform: "linux",
	});
	assert.deepEqual(writeEnabled.args, [...readOnly.args, "--allow-write"]);
	assert.match(writeEnabled.configToml, /--allow-write/);
	assert.match(writeEnabled.configToml, /approval_mode = "prompt"/);

	const windows = createCodexHostLaunch({
		mode: "write-enabled",
		platform: "win32",
	});
	assert.equal(windows.command, "cmd.exe");
	assert.deepEqual(windows.args.slice(0, 3), ["/d", "/s", "/c"]);
	assert.equal(
		windows.args[3],
		"pnpm exec -- openapi-to-mcp --workspace-root . --config openapi.config.cjs --allow-write",
	);
	assert.doesNotMatch(windows.configToml, /[A-Za-z]:[\\/]|\\\\/);
});

test("derives capabilities from Tool names and verifies their Schemas", () => {
	assert.deepEqual(
		assertModeCapabilityAgreement({
			inferredMode: "read-only",
			tools: readOnlyTools(),
		}),
		{ prepare: false, apply: false },
	);
	assert.deepEqual(
		assertModeCapabilityAgreement({
			inferredMode: "write-enabled",
			tools: writeEnabledTools(),
		}),
		{ prepare: true, apply: true },
	);
});

test("fails closed when read-only exposes Prepare or Apply", () => {
	for (const writeTool of writeEnabledTools().slice(-2)) {
		assert.throws(
			() =>
				assertModeCapabilityAgreement({
					inferredMode: "read-only",
					tools: [...readOnlyTools(), writeTool],
				}),
			/Read-only Setup mode must not expose Prepare or Apply/,
		);
	}
});

test("fails closed when write-enabled omits Prepare or Apply", () => {
	const complete = writeEnabledTools();
	for (const missingName of [
		"openapi_prepare_generation",
		"openapi_apply_generation",
	]) {
		assert.throws(
			() =>
				assertModeCapabilityAgreement({
					inferredMode: "write-enabled",
					tools: complete.filter(({ name }) => name !== missingName),
				}),
			/Write-enabled Setup mode must expose both Prepare and Apply/,
		);
	}
});

test("rejects Inspector modes that cannot authorize the observed capability", () => {
	assert.throws(
		() =>
			assertModeCapabilityAgreement({
				inferredMode: "analysis-only",
				tools: readOnlyTools(),
			}),
		/Unsupported Setup Inspector mode analysis-only/,
	);
	assert.throws(
		() =>
			assertModeCapabilityAgreement({
				inferredMode: "read-only",
				tools: writeEnabledTools(),
			}),
		/Read-only Setup mode must not expose Prepare or Apply/,
	);
});

test("requires observedStateHash drift before expiring handoff evidence", () => {
	const first = "a".repeat(64);
	const second = "b".repeat(64);
	assert.equal(assertObservedStateHashChanged(first, second), true);
	assert.throws(
		() => assertObservedStateHashChanged(first, first),
		/Setup handoff evidence must become stale/,
	);
	assert.throws(
		() => assertObservedStateHashChanged("not-a-hash", second),
		/Setup Inspector must return a SHA-256/,
	);
});

test("returns a stable bounded bridge report without paths or configuration", () => {
	const report = createSetupMcpHandoffReport({
		withoutHostState: "HOST_CONFIG_MISSING",
		readOnlyState: "HOST_CONFIG_READY",
		writeEnabledState: "HOST_CONFIG_READY",
		readOnlyMode: "read-only",
		writeEnabledMode: "write-enabled",
		readOnlyCapabilities: { prepare: false, apply: false },
		writeEnabledCapabilities: { prepare: true, apply: true },
		observedStateHashChanged: true,
	});
	assert.deepEqual(report, {
		success: true,
		inspectorSource: "repository-skill",
		runtimeSource: "packed-tarballs",
		states: {
			withoutHost: "HOST_CONFIG_MISSING",
			readOnly: "HOST_CONFIG_READY",
			writeEnabled: "HOST_CONFIG_READY",
		},
		modes: {
			readOnly: "read-only",
			writeEnabled: "write-enabled",
		},
		capabilities: {
			readOnlyPrepare: false,
			readOnlyApply: false,
			writePrepare: true,
			writeApply: true,
		},
		observedStateHashChanged: true,
	});
	assert.doesNotMatch(JSON.stringify(report), /config\.toml|[/\\]tmp|token/);
});
