const command = (id, label) => ({ id, label });
const report = (
	id,
	label,
	sourceEnv,
	relativePath,
	format = "json",
	options = {},
) => ({
	id,
	label,
	sourceEnv,
	relativePath,
	format,
	...options,
});
const actionSteps = Object.freeze([
	{ id: "checkout", label: "Check out code" },
	{ id: "diagnostics-init", label: "Initialize CI diagnostics" },
	{ id: "setup", label: "Setup" },
]);

function plan(definition) {
	return {
		...definition,
		steps: actionSteps,
		childEnv: [
			...new Set(definition.reports.map(({ sourceEnv }) => sourceEnv)),
		],
	};
}

export const plans = Object.freeze({
	"quality-build": plan({
		workflow: "Quality",
		jobId: "build",
		jobName: "Build",
		commands: [command("build", "Build")],
		reports: [],
	}),
	"quality-typecheck": plan({
		workflow: "Quality",
		jobId: "typecheck",
		jobName: "Typecheck",
		commands: [
			command("build", "Build"),
			command("package-typecheck", "Package typecheck"),
			command("project-reference-typecheck", "Project-reference typecheck"),
		],
		reports: [],
	}),
	"quality-tests": plan({
		workflow: "Quality",
		jobId: "tests",
		jobName: "Tests",
		commands: [
			command("build", "Build"),
			command("test", "Test"),
			command("ci-diagnostics-tests", "Test CI diagnostics"),
		],
		reports: [],
	}),
	"quality-lint-changed": plan({
		workflow: "Quality",
		jobId: "lint-changed",
		jobName: "Lint changed files",
		commands: [
			command("test-lint-collector", "Test lint collector"),
			command("lint-changed", "Lint changed files"),
		],
		reports: [],
	}),
	"quality-release-smoke": plan({
		workflow: "Quality",
		jobId: "release-smoke",
		jobName: "Package and install smoke",
		commands: [
			command("build", "Build"),
			command("repository-contracts", "Verify repository contracts"),
			command("package-surface", "Verify package surface"),
			command("pack-install", "Pack and install packages"),
			command("changesets-development", "Verify Changesets development state"),
		],
		reports: [],
	}),
	"a1-contracts": plan({
		workflow: "A1 cross-platform contracts",
		jobId: "contracts",
		jobName: "A1 focused",
		commands: [
			command("pnpm-launcher", "Verify pnpm launcher"),
			command("build", "Build packages"),
			command(
				"codex-skills-installer-tests",
				"Run focused Codex Skill installer tests",
			),
			command(
				"codex-skills-installer-built-bin",
				"Run built Codex Skill installer smoke",
			),
			command("ci-diagnostics-tests", "Run CI diagnostics tests"),
			command("a1-contracts", "Run A1 focused contracts"),
			command("cli-openapi-help", "Verify openapi CLI alias"),
			command("cli-openapi-to-version", "Verify openapi-to CLI alias"),
			command("cli-mcp-help", "Verify aggregate MCP CLI alias"),
			command("mcp-openapi-wrapper", "Verify aggregate MCP wrapper"),
			command("mcp-package-wrapper", "Verify package MCP wrapper"),
		],
		reports: [
			report(
				"a1-runtime",
				"A1 runtime",
				"A1_TEST_ARTIFACT_DIR",
				"runtime.json",
			),
			report(
				"a1-summary",
				"A1 summary",
				"A1_TEST_ARTIFACT_DIR",
				"summary.json",
			),
			report(
				"a1-inventory",
				"A1 test inventory",
				"A1_TEST_ARTIFACT_DIR",
				"test-files.txt",
				"text",
			),
			report(
				"a1-vitest",
				"A1 Vitest report",
				"A1_TEST_ARTIFACT_DIR",
				"vitest.json",
			),
		],
	}),
	"e2e-common": plan({
		workflow: "E2E",
		jobId: "cli",
		jobName: "CLI CommonJS E2E",
		commands: [
			command("build", "Build"),
			command("cli-e2e", "Run deterministic CommonJS CLI E2E"),
		],
		reports: [
			report(
				"cli-runtime",
				"CLI runtime",
				"CLI_E2E_ARTIFACT_DIR",
				"runtime.json",
			),
			report(
				"cli-summary",
				"CLI E2E summary",
				"CLI_E2E_ARTIFACT_DIR",
				"summary.json",
			),
			report(
				"cli-fixture",
				"CLI fixture metadata",
				"CLI_E2E_ARTIFACT_DIR",
				"fixture.json",
			),
			report(
				"cli-files",
				"CLI generated-file inventory",
				"CLI_E2E_ARTIFACT_DIR",
				"generated-files.txt",
				"text",
			),
		],
	}),
	"e2e-module": plan({
		workflow: "E2E",
		jobId: "cli",
		jobName: "CLI ESM E2E",
		commands: [command("cli-e2e", "Run deterministic ESM CLI E2E")],
		reports: [
			report(
				"cli-runtime",
				"CLI runtime",
				"CLI_E2E_ARTIFACT_DIR",
				"runtime.json",
			),
			report(
				"cli-summary",
				"CLI E2E summary",
				"CLI_E2E_ARTIFACT_DIR",
				"summary.json",
			),
			report(
				"cli-fixture",
				"CLI fixture metadata",
				"CLI_E2E_ARTIFACT_DIR",
				"fixture.json",
			),
			report(
				"cli-files",
				"CLI generated-file inventory",
				"CLI_E2E_ARTIFACT_DIR",
				"generated-files.txt",
				"text",
			),
		],
	}),
	"e2e-remote": plan({
		workflow: "E2E",
		jobId: "cli",
		jobName: "CLI local HTTP E2E",
		commands: [
			command("cli-e2e", "Generate from controlled local HTTP fixtures"),
		],
		reports: [
			report(
				"cli-runtime",
				"CLI runtime",
				"CLI_E2E_ARTIFACT_DIR",
				"runtime.json",
			),
			report(
				"cli-summary",
				"CLI E2E summary",
				"CLI_E2E_ARTIFACT_DIR",
				"summary.json",
			),
			report(
				"cli-fixture",
				"CLI fixture metadata",
				"CLI_E2E_ARTIFACT_DIR",
				"fixture.json",
			),
			report(
				"cli-files",
				"CLI generated-file inventory",
				"CLI_E2E_ARTIFACT_DIR",
				"generated-files.txt",
				"text",
			),
		],
	}),
	"e2e-mcp-stdio": plan({
		workflow: "E2E",
		jobId: "mcp-stdio-e2e",
		jobName: "MCP stdio E2E",
		commands: [
			command(
				"mcp-stdio",
				"Test built-bin stdio and controlled-write protocol",
			),
			command("mcp-doctor", "Run MCP Doctor"),
		],
		reports: [
			report(
				"mcp-runner",
				"MCP runner",
				"MCP_TEST_ARTIFACT_DIR",
				"runner.json",
				"json",
				{ expectedGroup: "stdio" },
			),
			report(
				"mcp-results",
				"MCP Vitest report",
				"MCP_TEST_ARTIFACT_DIR",
				"results.json",
			),
			report("mcp-doctor", "MCP Doctor report", "MCP_DOCTOR_REPORT", "."),
		],
	}),
	"e2e-mcp-cross-platform": plan({
		workflow: "E2E",
		jobId: "mcp-cross-platform",
		jobName: "MCP cross-platform smoke",
		commands: [
			command("mcp-smoke", "Initialize, list tools, validate, and close"),
		],
		reports: [
			report(
				"mcp-runner",
				"MCP runner",
				"MCP_TEST_ARTIFACT_DIR",
				"runner.json",
				"json",
				{ expectedGroup: "smoke" },
			),
			report(
				"mcp-results",
				"MCP Vitest report",
				"MCP_TEST_ARTIFACT_DIR",
				"results.json",
			),
			report(
				"mcp-smoke",
				"MCP smoke summary",
				"MCP_TEST_ARTIFACT_DIR",
				"mcp-cross-platform-smoke.json",
			),
		],
	}),
	"e2e-mcp-transaction-safety": plan({
		workflow: "E2E",
		jobId: "mcp-transaction-safety",
		jobName: "MCP transaction safety",
		commands: [
			command(
				"mcp-recovery",
				"Test rollback, recovery, cancellation, and locks",
			),
		],
		reports: [
			report(
				"mcp-runner",
				"MCP runner",
				"MCP_TEST_ARTIFACT_DIR",
				"runner.json",
				"json",
				{ expectedGroup: "recovery" },
			),
			report(
				"mcp-results",
				"MCP Vitest report",
				"MCP_TEST_ARTIFACT_DIR",
				"results.json",
			),
		],
	}),
	"e2e-mcp-performance": plan({
		workflow: "E2E",
		jobId: "mcp-performance",
		jobName: "MCP performance and bounded stress",
		commands: [
			command("mcp-performance", "Run benchmark regression and bounded stress"),
		],
		reports: [
			report(
				"mcp-runner",
				"MCP runner",
				"MCP_TEST_ARTIFACT_DIR",
				"runner.json",
				"json",
				{ expectedGroup: "performance" },
			),
		],
	}),
	"version-readiness": plan({
		workflow: "Version Readiness",
		jobId: "changeset-state",
		jobName: "Verify strict Changesets state",
		commands: [
			command("changeset-state", "Verify release candidate Changesets state"),
		],
		reports: [],
	}),
});

export function getPlan(id) {
	const plan = plans[id];
	if (!plan)
		throw new Error(`Unknown CI diagnostic plan: ${id ?? "<missing>"}`);
	return plan;
}
