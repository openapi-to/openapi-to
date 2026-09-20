import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	assertModeCapabilityAgreement,
	assertObservedStateHashChanged,
	createCodexHostLaunch,
	createSetupMcpHandoffReport,
	readDependencyProvenance,
} from "./setup-mcp-handoff-smoke.mjs";

function tool(name, properties = {}, required = [], annotations) {
	return {
		name,
		inputSchema: { type: "object", properties, required },
		outputSchema: { type: "object", properties: {} },
		...(annotations ? { annotations } : {}),
	};
}

const readOnlyAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
};

const developerAnnotations = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: false,
	openWorldHint: false,
};

function commonGenerationProperties(modeValues) {
	return {
		target: {},
		selection: {},
		output: {},
		includePreview: {},
		mode: { enum: modeValues },
	};
}

function configuredTools(generationMode) {
	const generation = generationMode === "developer"
		? tool("openapi_generate", commonGenerationProperties(["write", "dry-run"]), [], developerAnnotations)
		: tool("openapi_generate", commonGenerationProperties(["dry-run"]), [], readOnlyAnnotations);
	return [
		tool("openapi_validate"),
		tool("openapi_inspect"),
		tool("openapi_diff"),
		tool("openapi_list_targets"),
		tool("openapi_search_operations"),
		tool("openapi_get_operation"),
		generation,
		tool("openapi_check_generation"),
	];
}

function hardenedTools() {
	return [
		...configuredTools("hardened").slice(0, 6),
		tool("openapi_generate", commonGenerationProperties(["dry-run"]), [], readOnlyAnnotations),
		tool("openapi_check_generation"),
		tool("openapi_prepare_generation", { targets: {}, selection: {} }, [], {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: false,
		}),
		tool(
			"openapi_apply_generation",
			{ planId: {}, token: {}, approvedPlanHash: {} },
			["planId", "token", "approvedPlanHash"],
			{
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: false,
			},
		),
	];
}

test("constructs safe v2 Codex Host launches without the v1 write flag", () => {
	const consumerRoot = "/private/consumer-root";
	const developer = createCodexHostLaunch({
		mode: "developer",
		consumerRoot,
		platform: "linux",
	});
	assert.equal(developer.command, "pnpm");
	assert.deepEqual(developer.args, [
		"exec",
		"--",
		"./node_modules/.bin/openapi-to-mcp",
		"--workspace-root",
		".",
		"--config",
		"openapi.config.cjs",
		"--generation-mode",
		"developer",
	]);
	assert.doesNotMatch(developer.configToml, /--allow-write|approval_mode/);

	const canonicalDeveloper = createCodexHostLaunch({
		mode: "developer",
		consumerRoot,
		platform: "linux",
		includeGenerationMode: false,
	});
	assert.doesNotMatch(canonicalDeveloper.configToml, /generation-mode/);

	const hardened = createCodexHostLaunch({
		mode: "hardened",
		consumerRoot,
		platform: "linux",
	});
	assert.deepEqual(hardened.args, [...developer.args.slice(0, -1), "hardened"]);
	assert.doesNotMatch(hardened.configToml, /--allow-write/);
	assert.match(hardened.configToml, /--generation-mode",\n\s+"hardened/);
	assert.match(hardened.configToml, /approval_mode = "prompt"/);

	const windows = createCodexHostLaunch({
		mode: "hardened",
		consumerRoot: "C:\\Users\\vc\\code\\consumer",
		platform: "win32",
	});
	assert.equal(windows.command, "cmd.exe");
	assert.deepEqual(windows.args.slice(0, 3), ["/d", "/s", "/c"]);
	assert.equal(
		windows.args[3],
		"pnpm exec -- ./node_modules/.bin/openapi-to-mcp.cmd --workspace-root . --config openapi.config.cjs --generation-mode hardened",
	);
	assert.match(windows.configToml, /cwd = "C:\\\\Users\\\\vc\\\\code\\\\consumer"/);
});

test("distinguishes developer and read-only despite both exposing 8 Tools", () => {
	assert.deepEqual(
		assertModeCapabilityAgreement({
			inferredMode: "developer",
			tools: configuredTools("developer"),
		}),
		{ prepare: false, apply: false, toolCount: 8, writeCapability: true },
	);
	assert.deepEqual(
		assertModeCapabilityAgreement({
			inferredMode: "read-only",
			tools: configuredTools("read-only"),
		}),
		{ prepare: false, apply: false, toolCount: 8, writeCapability: false },
	);
	assert.deepEqual(
		assertModeCapabilityAgreement({ inferredMode: "hardened", tools: hardenedTools() }),
		{ prepare: true, apply: true, toolCount: 10, writeCapability: false },
	);
});

test("fails closed when developer or read-only exposes Prepare or Apply", () => {
	for (const writeTool of hardenedTools().slice(-2)) {
		assert.throws(
			() =>
				assertModeCapabilityAgreement({
					inferredMode: "read-only",
					tools: [...configuredTools("read-only"), writeTool],
				}),
			/Read-only Setup mode must not expose Prepare or Apply/,
		);
	}
});

test("fails closed when hardened omits Prepare or Apply", () => {
	const complete = hardenedTools();
	for (const missingName of [
		"openapi_prepare_generation",
		"openapi_apply_generation",
	]) {
		assert.throws(
			() =>
				assertModeCapabilityAgreement({
					inferredMode: "hardened",
					tools: complete.filter(({ name }) => name !== missingName),
				}),
				/Hardened Setup mode must expose both Prepare and Apply/,
		);
	}
});

test("rejects Inspector modes that cannot authorize the observed capability", () => {
	assert.throws(
			() =>
				assertModeCapabilityAgreement({
					inferredMode: "analysis-only",
					tools: configuredTools("read-only"),
			}),
		/Unsupported Setup Inspector mode analysis-only/,
	);
	assert.throws(
			() =>
				assertModeCapabilityAgreement({
					inferredMode: "read-only",
					tools: hardenedTools(),
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
		developerState: "HOST_CONFIG_READY",
		readOnlyState: "HOST_CONFIG_READY",
		hardenedState: "HOST_CONFIG_READY",
		developerMode: "developer",
		readOnlyMode: "read-only",
		hardenedMode: "hardened",
		developerCapabilities: { prepare: false, apply: false, writeCapability: true },
		readOnlyCapabilities: { prepare: false, apply: false, writeCapability: false },
		hardenedCapabilities: { prepare: true, apply: true, writeCapability: false },
		observedStateHashChanged: true,
		dependencyProvenancePreserved: true,
	});
	assert.deepEqual(report, {
		success: true,
		inspectorSource: "repository-skill",
		runtimeSource: "packed-tarballs",
		acceptanceClass: "packed-runtime-handoff-only",
		realAgentFirstAttemptConformance: "not-evaluated",
		states: {
			withoutHost: "HOST_CONFIG_MISSING",
			developer: "HOST_CONFIG_READY",
			readOnly: "HOST_CONFIG_READY",
			hardened: "HOST_CONFIG_READY",
		},
		modes: {
			developer: "developer",
			readOnly: "read-only",
			hardened: "hardened",
		},
		capabilities: {
			developerPrepare: false,
			developerApply: false,
			developerWrite: true,
			readOnlyPrepare: false,
			readOnlyApply: false,
			readOnlyWrite: false,
			hardenedPrepare: true,
			hardenedApply: true,
			hardenedWrite: false,
		},
		observedStateHashChanged: true,
		dependencyProvenancePreserved: true,
		restartBoundary: {
			hostConfigWrite: "RESTART_REQUIRED",
			packedToolSchemaVerification: "fresh-packed-process-only",
		},
	});
	assert.doesNotMatch(JSON.stringify(report), /config\.toml|[/\\]tmp|token/);
});

test("bounds dependency provenance hashing and includes the package manager lockfile", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-provenance-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	for (const [file, contents] of [
		["package.json", "{}\n"],
		["pnpm-workspace.yaml", "packages: []\n"],
		["pnpm-lock.yaml", "lockfileVersion: '9.0'\n"],
	]) {
		await writeFile(join(root, file), contents);
	}
	const provenance = await readDependencyProvenance(root);
	assert.deepEqual(
		provenance.map(([file]) => file),
		["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"],
	);
	for (const [, record] of provenance) {
		assert.equal(typeof record.size, "number");
		assert.match(record.sha256, /^[a-f0-9]{64}$/);
	}
	await writeFile(join(root, "pnpm-lock.yaml"), Buffer.alloc(32 * 1024 * 1024 + 1));
	await assert.rejects(
		readDependencyProvenance(root),
		/provenance file exceeds 33554432 bytes: pnpm-lock\.yaml/,
	);
});
