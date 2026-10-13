import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
	mkdir,
	readdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { load as loadYaml } from "js-yaml";

import {
	PRIVATE_WORKSPACE_NODE_ENGINE,
	PUBLISHED_NODE_ENGINE,
	REPOSITORY_NODE_ENGINE,
} from "./node-runtime-contract.mjs";
import {
	auditAgentAndSkillContracts,
	auditCiDiagnosticsContracts,
	auditCiFoundationContracts,
	auditCodexSkillInstallerContracts,
	auditConsumerAcceptanceContracts,
	auditDependencyUpdateContracts,
	auditGitHubWorkflowContexts,
	auditMergeQueueContracts,
	auditNodeRuntimeContracts,
	auditPublicationContracts,
	auditPullRequestIssueLinkContract,
	auditRepositoryContracts,
	auditVersionPackagesContracts,
	auditVersionReadinessContracts,
	discoverAgentDocuments,
	parseOpenAiSkillYaml,
	parseSkillFrontmatter,
	parseWorkspacePatterns,
	REQUIRED_AGENT_DOCUMENTS,
	REQUIRED_SKILLS,
	repositoryRoot,
	validatePullRequestIssueLinkBody,
} from "./repository-contract.mjs";

const execFileAsync = promisify(execFile);
const DOLLAR_SIGN = "$";

async function writeFixtureFile(root, relativePath, contents) {
	const path = join(root, relativePath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, contents);
}

async function createConsumerAcceptanceContractFixture(t) {
	const root = await mkdtemp(
		join(tmpdir(), "openapi-to-consumer-acceptance-contract-"),
	);
	t.after(() => rm(root, { recursive: true, force: true }));
	for (const relativePath of [
		"package.json",
		"docs/testing/consumer-acceptance-matrix.md",
		".github/workflows/quality.yml",
		"scripts/ci-diagnostics/plans.mjs",
		"scripts/consumer-codegen-smoke.mjs",
		"scripts/release/pack-install-smoke.mjs",
		"scripts/release/setup-mcp-handoff-smoke.mjs",
	]) {
		await writeFixtureFile(
			root,
			relativePath,
			await readFile(join(repositoryRoot, relativePath), "utf8"),
		);
	}
	return root;
}

async function git(root, ...args) {
	await execFileAsync("git", args, { cwd: root });
}

function skillContents(name, body = "") {
	return `---
name: ${name}
description: Use when a focused repository example needs deterministic contract validation without unrelated product changes.
---

# ${name}

${body}
`;
}

function skillInterface(name) {
	return `interface:
  display_name: "${name} contract example"
  short_description: "Validate the ${name} repository contract"
  default_prompt: "Use $${name} to validate the repository contract."
`;
}

function releaseSkillContents() {
	return `---
name: release-monorepo
description: Prepare Version Packages PRs and Changesets for RC or stable npm publication and dist-tags, Git tags, GitHub Releases, and partial-publication recovery. Use for release planning and exactly authorized manual publication; default to preparation-only without remote writes.
---

# Release

## Two-phase release state machine

This Skill defaults to preparation-only.

### Phase A: Version candidate

The Version Packages PR prepares versions and changelogs; it is not publication.

### Phase B: Publication

Require the exact expected \`main\` SHA, exact fixed-group version, \`rc\` or
\`latest\` channel, and manual publication Workflow. Use npm-production and
Trusted Publishing/OIDC, then verify every expected package version and
dist-tag before create the immutable version tag and GitHub Release.

For partial publication recovery, preserve a nonzero failure. Without exact
authorization, do not trigger the Workflow.

## Preparation workflow
`;
}

async function copyFixtureTree(root, relativePath) {
	const source = join(repositoryRoot, relativePath);
	for (const entry of await readdir(source, { withFileTypes: true })) {
		const target = join(relativePath, entry.name);
		if (entry.isDirectory()) await copyFixtureTree(root, target);
		else if (entry.isFile())
			await writeFixtureFile(
				root,
				target,
				await readFile(join(repositoryRoot, target)),
			);
	}
}

async function createContractFixture(t) {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-contract-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await git(root, "init", "--quiet");
	await writeFixtureFile(
		root,
		"package.json",
		JSON.stringify({
			name: "contract-fixture",
			private: true,
			scripts: { known: "node scripts/known.mjs" },
		}),
	);
	for (const path of REQUIRED_AGENT_DOCUMENTS)
		await writeFixtureFile(root, path, `# ${path}\n`);
	for (const entry of await readdir(join(repositoryRoot, ".agents/skills"), {
		withFileTypes: true,
	})) {
		if (!entry.isDirectory()) continue;
		const name = entry.name;
		if (name === "openapi-to-generate" || name === "openapi-to-setup") {
			await copyFixtureTree(root, `.agents/skills/${name}`);
			continue;
		}
		await writeFixtureFile(
			root,
			`.agents/skills/${name}/SKILL.md`,
			name === "release-monorepo"
				? releaseSkillContents()
				: skillContents(name),
		);
		await writeFixtureFile(
			root,
			`.agents/skills/${name}/agents/openai.yaml`,
			skillInterface(name),
		);
	}
	await writeFixtureFile(
		root,
		"docs/skills.md",
		await readFile(join(repositoryRoot, "docs/skills.md")),
	);
	await writeFixtureFile(
		root,
		"docs/setup-skill.md",
		await readFile(join(repositoryRoot, "docs/setup-skill.md")),
	);
	await writeFixtureFile(root, "scripts/known.mjs", "export {};\n");
	await git(root, "add", "--", ".");
	return root;
}

async function createPublicationContractFixture(t) {
	const root = await mkdtemp(
		join(tmpdir(), "openapi-to-publication-contract-"),
	);
	t.after(async () => {
		await rm(root, { recursive: true, force: true });
	});
	await git(root, "init", "--quiet");
	for (const relativePath of [
		".github/workflows/publish.yml",
		".github/workflows/version-packages.yml",
		".github/pull_request_template.md",
		"package.json",
		"pnpm-workspace.yaml",
		"pnpm-lock.yaml",
		"scripts/release/publication-sha-guard.mjs",
		"scripts/release/publication.mjs",
	]) {
		await writeFixtureFile(
			root,
			relativePath,
			await readFile(join(repositoryRoot, relativePath), "utf8"),
		);
	}
	await git(root, "add", "--", ".");
	return root;
}

async function createCiDiagnosticsContractFixture(t) {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-ci-contract-"));
	t.after(async () => {
		await rm(root, { recursive: true, force: true });
	});
	await git(root, "init", "--quiet");
	for (const relativePath of [
		"package.json",
		"scripts/ci-diagnostics/schema.mjs",
		"scripts/ci-diagnostics/sanitize.mjs",
		"scripts/ci-diagnostics/filesystem.mjs",
		"scripts/ci-diagnostics/plans.mjs",
		"scripts/ci-diagnostics/initialize.mjs",
		"scripts/ci-diagnostics/run-command.mjs",
		"scripts/ci-diagnostics/finalize-job.mjs",
		"scripts/ci-diagnostics/ci-diagnostics.node-test.mjs",
		"scripts/ci-routing/changed-surface.mjs",
		"scripts/ci-routing/require-job-results.mjs",
		"scripts/ci-routing/ci-routing.node-test.mjs",
		"docs/testing/ci-diagnostics.md",
		".github/workflows/quality.yml",
		".github/workflows/a1-cross-platform.yml",
		".github/workflows/e2e.yaml",
		".github/workflows/version-readiness.yml",
		".github/workflows/version-packages.yml",
	]) {
		await writeFixtureFile(
			root,
			relativePath,
			await readFile(join(repositoryRoot, relativePath), "utf8"),
		);
	}
	await git(root, "add", "--", ".");
	return root;
}

function assertFailure(result, pattern) {
	assert.ok(
		result.failures.some((failure) => pattern.test(failure)),
		`expected failure ${pattern}, received:\n${result.failures.join("\n")}`,
	);
}

async function mutateTrackedFixture(root, relativePath, mutate) {
	const path = join(root, relativePath);
	const contents = await readFile(path, "utf8");
	const mutated = mutate(contents);
	assert.notEqual(
		mutated,
		contents,
		`fixture mutation must change ${relativePath}`,
	);
	await writeFile(path, mutated);
	await git(root, "add", "--", relativePath);
}

test("repository scripts, workspaces, docs, packages, and binary claims stay aligned", async () => {
	const result = await auditRepositoryContracts(repositoryRoot);
	assert.deepEqual(result.failures, []);
	assert.ok(result.workspaces.includes("packages/openapi"));
	assert.ok(result.workspaces.includes("packages/mcp"));
	assert.ok(result.workspaces.includes("e2e/common"));
	assert.ok(result.workspaces.includes("e2e/module"));
	assert.deepEqual(result.agents, [
		".github/AGENTS.md",
		"AGENTS.md",
		"packages/cli/AGENTS.md",
		"packages/core/AGENTS.md",
		"packages/mcp/AGENTS.md",
	]);
	assert.deepEqual(result.agents, [...result.agents].sort());
	assert.deepEqual(result.skills, [...result.skills].sort());
	assert.ok(result.skills.includes("fix-github-actions"));
	assert.ok(result.skills.includes("fix-codegen-regression"));
	assert.ok(result.skills.includes("openapi-to-generate"));
	assert.ok(result.skills.includes("openapi-to-setup"));
	assert.deepEqual(REQUIRED_SKILLS, [
		"add-cli-command",
		"add-mcp-tool",
		"add-mcp-write-tool",
		"add-openapi-plugin",
		"fix-codegen-regression",
		"fix-github-actions",
		"openapi-to-generate",
		"openapi-to-setup",
		"release-monorepo",
		"run-codegen-tests",
		"upgrade-dependencies",
		"upgrade-openapi-support",
	]);
});

test("PR linking contract preserves executable Agent guidance without a default Refs placeholder", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-pr-link-contract-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	for (const path of ["AGENTS.md", ".github/pull_request_template.md"])
		await writeFixtureFile(
			root,
			path,
			await readFile(join(repositoryRoot, path), "utf8"),
		);
	assert.deepEqual(await auditPullRequestIssueLinkContract(root), []);
	await writeFixtureFile(root, ".github/pull_request_template.md", "## Related Issue\n\nRefs #\n");
	assert.match(
		(await auditPullRequestIssueLinkContract(root)).join("\n"),
		/PR template must not prefill an Issue association/,
	);
	await writeFixtureFile(
		root,
		".github/pull_request_template.md",
		(await readFile(join(repositoryRoot, ".github/pull_request_template.md"), "utf8")).replace(
			"Auto-close",
			"automatic setting",
		),
	);
	assert.match(
		(await auditPullRequestIssueLinkContract(root)).join("\n"),
		/PR template lacks PR linking rule \/Auto-close\//,
	);
});

test("visible PR body links follow final, partial, and no-Issue decisions", () => {
	const body = (link) => `## Summary\n\nGovernance fix.\n\n## Related Issue\n\n${link}\n\n## Risks / Notes\n\nNone\n`;
	const final = {
		classification: "FINAL_COMPLETE",
		issueNumber: 123,
		acceptanceComplete: true,
		baseBranch: "main",
	};
	assert.deepEqual(validatePullRequestIssueLinkBody({ ...final, body: body("Closes #123") }), []);
	assert.deepEqual(
		validatePullRequestIssueLinkBody({ ...final, baseBranch: "feature", body: body("Refs #123") }),
		[],
	);
	assert.deepEqual(
		validatePullRequestIssueLinkBody({
			classification: "PARTIAL",
			issueNumber: 123,
			body: body("Refs #123"),
		}),
		[],
	);
	for (const classification of ["ROADMAP", "UMBRELLA"])
		assert.deepEqual(
			validatePullRequestIssueLinkBody({
				classification,
				issueNumber: 123,
				body: body("Refs #123"),
			}),
			[],
		);
	assert.deepEqual(
		validatePullRequestIssueLinkBody({ classification: "NO_ISSUE", body: body("None — 未发现本任务 Issue") }),
		[],
	);
	for (const invalid of [
		{ ...final, body: body("Refs #123") },
		{ ...final, body: body("Closes #123\nRefs #123") },
		{ ...final, body: body("Closes #123\nCloses #124") },
		{ ...final, body: body("Refs #") },
		{ ...final, body: body("None — unknown") },
		{ ...final, body: body("Closes #123"), acceptanceComplete: false },
		{ ...final, body: body("Closes #123"), baseBranch: "feature" },
		{ ...final, body: body("<!-- Closes #123 -->") },
		{ ...final, body: body("```md\nCloses #123\n```") },
		{ ...final, body: body("    Closes #123") },
		{ ...final, body: body("\tCloses #123") },
		{ ...final, body: "## Summary\nCloses #123\n\n## Related Issue\nNone — missing\n" },
		{ classification: "PARTIAL", issueNumber: 123, body: `## Summary\nFixes other/repo#124\n\n## Related Issue\nRefs #123\n` },
		{ classification: "PARTIAL", issueNumber: 123, body: `## Summary\nCLOSES: #124\n\n## Related Issue\nRefs #123\n` },
		{ classification: "PARTIAL", issueNumber: 123, body: body("Closes #123") },
		{ classification: "NO_ISSUE", body: body("Refs #123") },
	])
		assert.notDeepEqual(validatePullRequestIssueLinkBody(invalid), [], JSON.stringify(invalid));
});

test("Renovate dependency automation contract protects catalog and governance boundaries", async () => {
	assert.deepEqual(await auditDependencyUpdateContracts(repositoryRoot), []);
});

test("Renovate dependency automation contract rejects enabled automerge", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-renovate-contract-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const config = JSON.parse(
		await readFile(join(repositoryRoot, "renovate.json"), "utf8"),
	);
	config.automerge = true;
	await writeFixtureFile(root, "renovate.json", JSON.stringify(config));
	const result = await auditDependencyUpdateContracts(root);
	assert.ok(
		result.some((failure) => /must explicitly disable automerge/.test(failure)),
	);
});

test("Version Packages contract accepts the manual-only workflow", async (t) => {
	const root = await createPublicationContractFixture(t);
	const workflow = loadYaml(
		await readFile(
			join(root, ".github/workflows/version-packages.yml"),
			"utf8",
		),
	);
	assert.equal(workflow.on.workflow_dispatch, null);
	assert.deepEqual(await auditVersionPackagesContracts(root), []);
});

test("Version Packages contract rejects configured or malformed dispatch", async (t) => {
	const dispatchCases = [
		{
			name: "false",
			replacement: "  workflow_dispatch: false\n",
		},
		{
			name: "true",
			replacement: "  workflow_dispatch: true\n",
		},
		{
			name: "empty sequence",
			replacement: "  workflow_dispatch: []\n",
		},
		{
			name: "non-empty sequence",
			replacement: "  workflow_dispatch: [unexpected]\n",
		},
		{
			name: "string scalar",
			replacement: '  workflow_dispatch: "manual"\n',
		},
		{
			name: "numeric scalar",
			replacement: "  workflow_dispatch: 1\n",
		},
		{
			name: "empty mapping",
			replacement: "  workflow_dispatch: {}\n",
		},
		{
			name: "empty inputs mapping",
			replacement: "  workflow_dispatch:\n    inputs: {}\n",
		},
		{
			name: "non-empty inputs mapping",
			replacement:
				"  workflow_dispatch:\n    inputs:\n      release:\n        type: boolean\n",
		},
		{
			name: "malformed inputs sequence",
			replacement: "  workflow_dispatch:\n    inputs: []\n",
		},
	];

	for (const dispatchCase of dispatchCases) {
		await t.test(dispatchCase.name, async (t) => {
			const root = await createPublicationContractFixture(t);
			await mutateTrackedFixture(
				root,
				".github/workflows/version-packages.yml",
				(contents) =>
					contents.replace("  workflow_dispatch:\n", dispatchCase.replacement),
			);
			assertFailure(
				{ failures: await auditVersionPackagesContracts(root) },
				/workflow_dispatch as its only trigger with no configuration/,
			);
		});
	}
});

test("Version Packages contract rejects missing dispatch and automatic triggers", async (t) => {
	const triggerCases = [
		"  push:\n    branches: [main]",
		"  pull_request:",
		"  pull_request_target:",
		"  merge_group:",
		"  workflow_run:\n    workflows: [Quality]\n    types: [completed]",
		"  schedule:\n    - cron: '0 0 * * *'",
		"  issue_comment:",
		"  release:",
		"  repository_dispatch:",
		"  delete:",
	];

	for (const automaticTrigger of triggerCases) {
		await t.test(automaticTrigger.trim().split(":", 1)[0], async (t) => {
			const root = await createPublicationContractFixture(t);
			await mutateTrackedFixture(
				root,
				".github/workflows/version-packages.yml",
				(contents) =>
					contents.replace(
						"on:\n  workflow_dispatch:\n",
						`on:\n${automaticTrigger}\n  workflow_dispatch:\n`,
					),
			);
			assertFailure(
				{ failures: await auditVersionPackagesContracts(root) },
				/workflow_dispatch as its only trigger/,
			);
		});
	}

	const missingDispatchRoot = await createPublicationContractFixture(t);
	await mutateTrackedFixture(
		missingDispatchRoot,
		".github/workflows/version-packages.yml",
		(contents) =>
			contents.replace(
				"on:\n  workflow_dispatch:\n",
				"on:\n  push:\n    branches: [main]\n",
			),
	);
	assertFailure(
		{ failures: await auditVersionPackagesContracts(missingDispatchRoot) },
		/workflow_dispatch as its only trigger/,
	);
});

test("Version Packages contract rejects a missing or weakened main ref guard", async (t) => {
	for (const replacement of [
		"",
		"    if: github.ref == 'refs/heads/release'\n",
		"    if: github.event_name == 'workflow_dispatch'\n",
	]) {
		const root = await createPublicationContractFixture(t);
		await mutateTrackedFixture(
			root,
			".github/workflows/version-packages.yml",
			(contents) =>
				contents.replace(
					"    if: github.ref == 'refs/heads/main'\n",
					replacement,
				),
		);
		assertFailure(
			{ failures: await auditVersionPackagesContracts(root) },
			/fail closed outside the main branch ref/,
		);
	}
});

test("Version Packages contract rejects unexpected or substituted Jobs", async (t) => {
	const jobCases = [
		{
			name: "additional unguarded executable Job",
			mutate: (contents) => `${contents}
  unexpected:
    runs-on: ubuntu-latest
    steps:
      - run: echo unexpected
`,
		},
		{
			name: "additional write-capable executable Job",
			mutate: (contents) => `${contents}
  unexpected-write:
    permissions:
      contents: write
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/setup
`,
		},
		{
			name: "missing version Job",
			mutate: (contents) => contents.replace(/jobs:\n[\s\S]*$/, "jobs: {}\n"),
		},
		{
			name: "renamed substitute Job",
			mutate: (contents) => contents.replace("  version:\n", "  substitute:\n"),
		},
	];

	for (const jobCase of jobCases) {
		await t.test(jobCase.name, async (t) => {
			const root = await createPublicationContractFixture(t);
			await mutateTrackedFixture(
				root,
				".github/workflows/version-packages.yml",
				jobCase.mutate,
			);
			assertFailure(
				{ failures: await auditVersionPackagesContracts(root) },
				/define exactly the version Job/,
			);
		});
	}
});

test("Version Packages contract rejects comment-spoofed Changesets semantics", async (t) => {
	const changesetsStepPattern =
		/\n {6}- name: Create or update Version Packages PR[\s\S]*$/;
	const actionMarker =
		"      # uses: changesets/action@ae32849d5ba541f9ae29e40e22a623bc13562f51 # v2.1.2";
	const versionMarker = "      # version-script: pnpm run version";
	const tokenMarker = `      # github-token: ${DOLLAR_SIGN}{{ secrets.GITHUB_TOKEN }}`;

	const spoofCases = [
		{
			name: "comment-only Changesets action marker",
			mutate: (contents) =>
				contents.replace(
					changesetsStepPattern,
					`\n${actionMarker}\n${versionMarker}\n${tokenMarker}\n`,
				),
			failure: /exactly checkout, repository setup, and Changesets steps/,
		},
		{
			name: "comment-only root version command",
			mutate: (contents) =>
				contents.replace(
					"          version-script: pnpm run version\n",
					"          # version-script: pnpm run version\n",
				),
			failure:
				/maintained v2 inputs, repository token, and root version command/,
		},
		{
			name: "comment-only repository token",
			mutate: (contents) =>
				contents.replace(
					`          github-token: ${DOLLAR_SIGN}{{ secrets.GITHUB_TOKEN }}\n`,
					`          # github-token: ${DOLLAR_SIGN}{{ secrets.GITHUB_TOKEN }}\n`,
				),
			failure:
				/maintained v2 inputs, repository token, and root version command/,
		},
		{
			name: "unexpected shell step with comment markers",
			mutate: (contents) =>
				contents.replace(
					changesetsStepPattern,
					`\n      - run: echo unexpected\n${actionMarker}\n${versionMarker}\n${tokenMarker}\n`,
				),
			failure: /full-SHA pinned Changesets Action step/,
		},
	];

	for (const spoofCase of spoofCases) {
		await t.test(spoofCase.name, async (t) => {
			const root = await createPublicationContractFixture(t);
			await mutateTrackedFixture(
				root,
				".github/workflows/version-packages.yml",
				spoofCase.mutate,
			);
			assertFailure(
				{ failures: await auditVersionPackagesContracts(root) },
				spoofCase.failure,
			);
		});
	}
});

test("Version Packages contract bounds the complete executable step surface", async (t) => {
	const stepCases = [
		{
			name: "additional executable step",
			from: "      - name: Create or update Version Packages PR\n",
			to: "      - run: echo unexpected\n      - name: Create or update Version Packages PR\n",
			failure: /exactly checkout, repository setup, and Changesets steps/,
		},
		{
			name: "mutable Changesets Action reference",
			from: "changesets/action@ae32849d5ba541f9ae29e40e22a623bc13562f51 # v2.1.2",
			to: "changesets/action@v1",
			failure: /full-SHA pinned Changesets Action step/,
		},
		{
			name: "publish input",
			from: "          version-script: pnpm run version\n",
			to: "          version-script: pnpm run version\n          publish-script: pnpm run publish\n",
			failure:
				/maintained v2 inputs, repository token, and root version command/,
		},
		{
			name: "missing scoped Husky bypass",
			from: '          HUSKY: "0"\n',
			to: "",
			failure:
				/scope only HUSKY=0 and pass the repository token through github-token/,
		},
	];

	for (const stepCase of stepCases) {
		await t.test(stepCase.name, async (t) => {
			const root = await createPublicationContractFixture(t);
			await mutateTrackedFixture(
				root,
				".github/workflows/version-packages.yml",
				(contents) => contents.replace(stepCase.from, stepCase.to),
			);
			assertFailure(
				{ failures: await auditVersionPackagesContracts(root) },
				stepCase.failure,
			);
		});
	}
});

test("Version Packages contract rejects broadened workflow or Job authority", async (t) => {
	const workflowEnvironmentRoot = await createPublicationContractFixture(t);
	await mutateTrackedFixture(
		workflowEnvironmentRoot,
		".github/workflows/version-packages.yml",
		(contents) =>
			contents.replace(
				"concurrency:\n",
				`env:\n  NODE_AUTH_TOKEN: ${DOLLAR_SIGN}{{ secrets.NODE_AUTH_TOKEN }}\n\nconcurrency:\n`,
			),
	);
	assertFailure(
		{ failures: await auditVersionPackagesContracts(workflowEnvironmentRoot) },
		/unexpected top-level execution configuration/,
	);

	const workflowPermissionRoot = await createPublicationContractFixture(t);
	await mutateTrackedFixture(
		workflowPermissionRoot,
		".github/workflows/version-packages.yml",
		(contents) =>
			contents.replace(
				"  pull-requests: write\n",
				"  pull-requests: write\n  id-token: write\n",
			),
	);
	assertFailure(
		{ failures: await auditVersionPackagesContracts(workflowPermissionRoot) },
		/grant only contents: write and pull-requests: write/,
	);

	const jobPermissionRoot = await createPublicationContractFixture(t);
	await mutateTrackedFixture(
		jobPermissionRoot,
		".github/workflows/version-packages.yml",
		(contents) =>
			contents.replace(
				"    runs-on: ubuntu-latest\n",
				"    permissions:\n      id-token: write\n    runs-on: ubuntu-latest\n",
			),
	);
	assertFailure(
		{ failures: await auditVersionPackagesContracts(jobPermissionRoot) },
		/contain only its guard, runner, timeout, and steps/,
	);
});

test("Node runtime contracts separate repository and package floors", async () => {
	const rootManifest = JSON.parse(
		await readFile(join(repositoryRoot, "package.json"), "utf8"),
	);
	const failures = await auditNodeRuntimeContracts(repositoryRoot, [
		[".", rootManifest],
		[
			"packages/core",
			{ name: "@openapi-to/core", engines: { node: PUBLISHED_NODE_ENGINE } },
		],
	]);
	assert.deepEqual(failures, []);

	assert.equal(REPOSITORY_NODE_ENGINE, ">=22.13.0");
	assert.equal(PUBLISHED_NODE_ENGINE, ">=22");
	assert.equal(PRIVATE_WORKSPACE_NODE_ENGINE, ">=22");

	const oldRootFailure = await auditNodeRuntimeContracts(repositoryRoot, [
		[
			".",
			{ ...rootManifest, engines: { ...rootManifest.engines, node: ">=22" } },
		],
	]);
	assert.deepEqual(oldRootFailure, [
		"./package.json must declare repository toolchain Node engine >=22.13.0",
	]);

	const invalidPublishedFailure = await auditNodeRuntimeContracts(
		repositoryRoot,
		[["packages/core", { engines: { node: ">=20" } }]],
	);
	assert.deepEqual(invalidPublishedFailure, [
		"packages/core/package.json must declare published package runtime Node engine >=22",
	]);
});

test("Codex Skill installer distribution, CLI, packed smoke, and docs stay aligned", async (t) => {
	assert.deepEqual(await auditCodexSkillInstallerContracts(repositoryRoot), []);
	const root = await mkdtemp(
		join(tmpdir(), "openapi-to-codex-skills-contract-"),
	);
	t.after(() => rm(root, { recursive: true, force: true }));
	for (const relativePath of [
		"turbo.json",
		"packages/cli/package.json",
		"packages/openapi/package.json",
		"packages/cli/src/index.ts",
		"packages/cli/src/init.ts",
		"packages/cli/src/skillsInstall.ts",
		"packages/cli/src/setup.ts",
		"packages/cli/src/setup.integration.test.ts",
		"packages/openapi/bin/openapi.js",
		"scripts/build-consumer-skill-assets.mjs",
		"scripts/build-consumer-skill-assets.node-test.mjs",
		"docs/capability-matrix.md",
		"scripts/codex-skills-installer-cross-platform-smoke.mjs",
		"scripts/release/pack-smoke-helpers.mjs",
		"scripts/release/pack-install-smoke.mjs",
		".github/workflows/a1-cross-platform.yml",
		"README.md",
		"docs/getting-started.md",
		"docs/skills.md",
		"docs/setup-skill.md",
	]) {
		await writeFixtureFile(
			root,
			relativePath,
			await readFile(join(repositoryRoot, relativePath), "utf8"),
		);
	}
	const cliIndexPath = join(root, "packages/cli/src/index.ts");
	await writeFile(
		cliIndexPath,
		(await readFile(cliIndexPath, "utf8")).replace(
			'.command("skills <action>"',
			'.command("removed <action>"',
		),
	);
	assertFailure(
		{ failures: await auditCodexSkillInstallerContracts(root) },
		/CLI Codex Skill command is missing/,
	);
	await writeFile(
		cliIndexPath,
		(await readFile(cliIndexPath, "utf8")).replace(
			'.command("setup",',
			'.command("removed",',
		),
	);
	assertFailure(
		{ failures: await auditCodexSkillInstallerContracts(root) },
		/CLI setup command is missing \.command\("setup"/,
	);
	await writeFile(
		cliIndexPath,
		await readFile(join(repositoryRoot, "packages/cli/src/index.ts"), "utf8"),
	);
	const turboPath = join(root, "turbo.json");
	const turbo = JSON.parse(await readFile(turboPath, "utf8"));
	turbo.globalDependencies = turbo.globalDependencies.filter(
		(entry) => entry !== ".agents/skills/openapi-to-setup/**",
	);
	await writeFile(turboPath, `${JSON.stringify(turbo, null, 2)}\n`);
	assertFailure(
		{ failures: await auditCodexSkillInstallerContracts(root) },
		/Turbo globalDependencies must invalidate consumer Skill assets/,
	);
	turbo.globalDependencies.push(".agents/skills/openapi-to-setup/**");
	turbo.globalDependencies = turbo.globalDependencies.filter(
		(entry) => entry !== "docs/capability-matrix.md",
	);
	await writeFile(turboPath, `${JSON.stringify(turbo, null, 2)}\n`);
	assertFailure(
		{ failures: await auditCodexSkillInstallerContracts(root) },
		/Turbo globalDependencies must invalidate consumer Skill assets for docs\/capability-matrix\.md/,
	);
	turbo.globalDependencies.push("docs/capability-matrix.md");
	await writeFile(turboPath, `${JSON.stringify(turbo, null, 2)}\n`);
	const builderPath = join(root, "scripts/build-consumer-skill-assets.mjs");
	await writeFile(
		builderPath,
		(await readFile(builderPath, "utf8")).replace(
			'path.join(effectiveRepositoryRoot, ".agents", "skills")',
			'path.join(effectiveRepositoryRoot, "packages", "cli", "dist", "skills")',
		),
	);
	assertFailure(
		{ failures: await auditCodexSkillInstallerContracts(root) },
		/asset builder must use the authoritative \.agents\/skills source root/,
	);
});

test("aggregate aliases disable notifier only for the real skills top-level command", async (t) => {
	const root = await mkdtemp(
		join(tmpdir(), "openapi-to-aggregate-skills-wrapper-"),
	);
	t.after(() => rm(root, { recursive: true, force: true }));
	const wrapper = await readFile(
		join(repositoryRoot, "packages/openapi/bin/openapi.js"),
		"utf8",
	);
	for (const relativePath of [
		"packages/openapi/bin/openapi.js",
		"packages/openapi/bin/openapi-to.js",
	]) {
		await writeFixtureFile(root, relativePath, wrapper);
	}
	await writeFixtureFile(
		root,
		"package.json",
		'{"private":true,"type":"module"}\n',
	);
	await writeFixtureFile(
		root,
		"node_modules/semver/package.json",
		'{"name":"semver","type":"module","exports":"./index.js"}\n',
	);
	await writeFixtureFile(
		root,
		"node_modules/semver/index.js",
		`export default {
  satisfies(version, range) {
    return range === ">=22.0.0" && Number.parseInt(version.slice(1).split(".")[0], 10) >= 22;
  },
};
`,
	);
	await writeFixtureFile(
		root,
		"override-node-version.cjs",
		`Object.defineProperty(process, "version", {
  configurable: true,
  value: process.env.OPENAPI_TO_TEST_NODE_VERSION,
});
`,
	);
	await writeFixtureFile(
		root,
		"node_modules/@openapi-to/cli/package.json",
		'{"name":"@openapi-to/cli","type":"module","exports":"./index.js"}\n',
	);
	await writeFixtureFile(
		root,
		"node_modules/@openapi-to/cli/index.js",
		`import { appendFile } from "node:fs/promises";
export async function run(argv) {
  await appendFile(process.env.OPENAPI_TO_RUN_TRACE, JSON.stringify(argv.slice(2)) + "\\n");
}
`,
	);
	await writeFixtureFile(
		root,
		"packages/openapi/dist/utils.js",
		`import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
export function updateVersionNotifier() {
  appendFileSync(process.env.OPENAPI_TO_NOTIFIER_TRACE, "called\\n");
  mkdirSync(process.env.OPENAPI_TO_NOTIFIER_STATE, { recursive: true });
  writeFileSync(process.env.OPENAPI_TO_NOTIFIER_STATE + "/state", "created\\n");
}
`,
	);
	const notifierTrace = join(root, "notifier-calls");
	const notifierState = join(root, "notifier-state");
	const runTrace = join(root, "run-calls");
	const runAlias = async (alias, args, nodeVersion) => {
		await rm(notifierTrace, { force: true });
		await rm(notifierState, { recursive: true, force: true });
		await rm(runTrace, { force: true });
		await execFileAsync(
			process.execPath,
			[
				...(nodeVersion
					? ["--require", join(root, "override-node-version.cjs")]
					: []),
				join(root, "packages/openapi/bin", `${alias}.js`),
				...args,
			],
			{
				cwd: root,
				env: {
					...process.env,
					OPENAPI_TO_NOTIFIER_TRACE: notifierTrace,
					OPENAPI_TO_NOTIFIER_STATE: notifierState,
					OPENAPI_TO_RUN_TRACE: runTrace,
					OPENAPI_TO_TEST_NODE_VERSION: nodeVersion,
				},
			},
		);
		assert.deepEqual(
			JSON.parse((await readFile(runTrace, "utf8")).trim()),
			args,
		);
	};
	await runAlias("openapi", ["--json", "--help"], "v22.0.0");
	const unsupported = await execFileAsync(
		process.execPath,
		[
			"--require",
			join(root, "override-node-version.cjs"),
			join(root, "packages/openapi/bin/openapi.js"),
		],
		{
			cwd: root,
			env: {
				...process.env,
				OPENAPI_TO_TEST_NODE_VERSION: "v20.19.5",
			},
		},
	).then(
		() => undefined,
		(error) => error,
	);
	assert(unsupported);
	assert.equal(unsupported.code, 1);
	assert.equal(unsupported.stdout, "");
	assert.equal(
		unsupported.stderr,
		"Error: This tool requires Node.js >=22.0.0, but you are using v20.19.5\n",
	);
	const skillsCases = [
		["skills", "install", "--host", "codex"],
		["--debug", "skills", "install", "--host", "codex"],
		["--json", "skills", "install", "--host", "codex"],
		["--debug", "--json", "skills", "install", "--host", "codex"],
		["--json", "--debug", "skills", "unsupported"],
		["--debug=true", "skills", "install", "--host", "codex"],
		["--json=true", "skills", "install", "--host", "codex"],
		["--debug=false", "skills", "install", "--host", "codex"],
		["--json=false", "skills", "install", "--host", "codex"],
		["--no-debug", "skills", "install", "--host", "codex"],
		["--no-json", "skills", "install", "--host", "codex"],
		["skills", "install", "--host", "codex", "--debug"],
	];
	for (const alias of ["openapi", "openapi-to"]) {
		for (const args of skillsCases) {
			await runAlias(alias, args);
			await assert.rejects(readFile(notifierTrace), { code: "ENOENT" });
			await assert.rejects(readFile(join(notifierState, "state")), {
				code: "ENOENT",
			});
		}
	}
	for (const args of [
		["inspect", "./skills"],
		["validate", "skills"],
		["diff", "old-skills.yaml", "new-skills.yaml"],
		["generate", "--config", "./skills/openapi.config.ts"],
	]) {
		await runAlias("openapi", args);
		assert.equal(await readFile(notifierTrace, "utf8"), "called\n");
		assert.equal(
			await readFile(join(notifierState, "state"), "utf8"),
			"created\n",
		);
	}
});

test("consumer acceptance contract accepts the consolidated packed path", async (t) => {
	const root = await createConsumerAcceptanceContractFixture(t);
	assert.deepEqual(await auditConsumerAcceptanceContracts(root), []);
});

test("consumer acceptance contract rejects owner, bridge, and duplicate-path drift", async (t) => {
	const missingOwnerRoot = await createConsumerAcceptanceContractFixture(t);
	const matrixPath = join(
		missingOwnerRoot,
		"docs/testing/consumer-acceptance-matrix.md",
	);
	await writeFile(
		matrixPath,
		(await readFile(matrixPath, "utf8")).replaceAll(
			"`release:smoke`",
			"`removed-release-owner`",
		),
	);
	assertFailure(
		{ failures: await auditConsumerAcceptanceContracts(missingOwnerRoot) },
		/missing canonical owner `release:smoke`/,
	);

	const missingPeerFloorDocsRoot =
		await createConsumerAcceptanceContractFixture(t);
	const peerFloorMatrixPath = join(
		missingPeerFloorDocsRoot,
		"docs/testing/consumer-acceptance-matrix.md",
	);
	await writeFile(
		peerFloorMatrixPath,
		(await readFile(peerFloorMatrixPath, "utf8")).replace(
			"| Zod current profile 与 peer-floor profile |",
			"| Removed Zod peer-floor evidence |",
		),
	);
	assertFailure(
		{
			failures: await auditConsumerAcceptanceContracts(
				missingPeerFloorDocsRoot,
			),
		},
		/missing Zod current and peer-floor consumer acceptance contract/,
	);

	const missingWorkflowRoot = await createConsumerAcceptanceContractFixture(t);
	const qualityPath = join(
		missingWorkflowRoot,
		".github/workflows/quality.yml",
	);
	await writeFile(
		qualityPath,
		(await readFile(qualityPath, "utf8")).replace(
			"      - name: Zod peer-floor codegen\n        run:",
			"      - name: Zod peer-floor codegen\n        if: github.event_name == 'push'\n        run:",
		),
	);
	assertFailure(
		{ failures: await auditConsumerAcceptanceContracts(missingWorkflowRoot) },
		/must run the Zod peer-floor consumer through CI diagnostics on every event/,
	);

	const missingDiagnosticsRoot =
		await createConsumerAcceptanceContractFixture(t);
	const plansPath = join(
		missingDiagnosticsRoot,
		"scripts/ci-diagnostics/plans.mjs",
	);
	await writeFile(
		plansPath,
		(await readFile(plansPath, "utf8")).replaceAll(
			'"zod-peer-floor",',
			'"removed-peer-floor",',
		),
	);
	assertFailure(
		{
			failures: await auditConsumerAcceptanceContracts(missingDiagnosticsRoot),
		},
		/quality-release-smoke diagnostics plan must declare zod-peer-floor/,
	);

	const missingScriptRoot = await createConsumerAcceptanceContractFixture(t);
	const rootPackagePath = join(missingScriptRoot, "package.json");
	await writeFile(
		rootPackagePath,
		(await readFile(rootPackagePath, "utf8")).replace(
			'"test:consumer:codegen:zod-peer-floor": "pnpm test:consumer:codegen -- --profile peer-floor",',
			'"test:consumer:codegen:zod-peer-floor": "removed",',
		),
	);
	assertFailure(
		{ failures: await auditConsumerAcceptanceContracts(missingScriptRoot) },
		/test:consumer:codegen:zod-peer-floor must retain its canonical consumer acceptance responsibility/,
	);

	const missingCallRoot = await createConsumerAcceptanceContractFixture(t);
	const releasePath = join(
		missingCallRoot,
		"scripts/release/pack-install-smoke.mjs",
	);
	await writeFile(
		releasePath,
		(await readFile(releasePath, "utf8")).replaceAll(
			"runSetupMcpHandoffScenario",
			"removedSetupMcpHandoffScenario",
		),
	);
	assertFailure(
		{ failures: await auditConsumerAcceptanceContracts(missingCallRoot) },
		/release smoke must call the Setup to packed MCP bridge/,
	);

	for (const [marker, failure] of [
		[
			"| Setup first-plan safety contract |",
			/missing capability Setup first-plan safety contract/,
		],
		[
			"| Generate natural-language first-attempt conformance |",
			/missing capability Generate natural-language first-attempt conformance/,
		],
		[
			"`helper/unit/static/packed evidence != real-Agent natural-language first-attempt conformance`",
			/missing conformance boundary/,
		],
	]) {
		const missingBoundaryRoot =
			await createConsumerAcceptanceContractFixture(t);
		const missingBoundaryPath = join(
			missingBoundaryRoot,
			"docs/testing/consumer-acceptance-matrix.md",
		);
		await writeFile(
			missingBoundaryPath,
			(await readFile(missingBoundaryPath, "utf8")).replace(
				marker,
				"removed-acceptance-boundary",
			),
		);
		assertFailure(
			{ failures: await auditConsumerAcceptanceContracts(missingBoundaryRoot) },
			failure,
		);
	}

	for (const [source, failure] of [
		["packReleasePackages();", /must not use packReleasePackages/],
		["pnpm link openapi-to;", /must not use pnpm link/],
		["homedir();", /must not use user Codex home/],
		["npm install openapi-to;", /must not use npm registry installation/],
	]) {
		const forbiddenRoot = await createConsumerAcceptanceContractFixture(t);
		const bridgePath = join(
			forbiddenRoot,
			"scripts/release/setup-mcp-handoff-smoke.mjs",
		);
		await writeFile(
			bridgePath,
			`${await readFile(bridgePath, "utf8")}\n${source}\n`,
		);
		assertFailure(
			{ failures: await auditConsumerAcceptanceContracts(forbiddenRoot) },
			failure,
		);
	}

	const missingLockfileProvenanceRoot =
		await createConsumerAcceptanceContractFixture(t);
	const missingLockfileProvenancePath = join(
		missingLockfileProvenanceRoot,
		"scripts/release/setup-mcp-handoff-smoke.mjs",
	);
	await writeFile(
		missingLockfileProvenancePath,
		(await readFile(missingLockfileProvenancePath, "utf8")).replace(
			'["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"]',
			'["package.json", "pnpm-workspace.yaml"]',
		),
	);
	assertFailure(
		{
			failures: await auditConsumerAcceptanceContracts(
				missingLockfileProvenanceRoot,
			),
		},
		/missing package and lockfile provenance snapshot/,
	);

	const duplicateRoot = await createConsumerAcceptanceContractFixture(t);
	await writeFixtureFile(
		duplicateRoot,
		"scripts/consumer-golden-path.mjs",
		"export {};\n",
	);
	assertFailure(
		{ failures: await auditConsumerAcceptanceContracts(duplicateRoot) },
		/duplicate consumer golden path exists/,
	);
});

test("blocking Actions workflows use controlled fixtures and retain diagnostic artifacts", async () => {
	const [a1, e2e] = await Promise.all([
		readFile(
			join(repositoryRoot, ".github/workflows/a1-cross-platform.yml"),
			"utf8",
		),
		readFile(join(repositoryRoot, ".github/workflows/e2e.yaml"), "utf8"),
	]);
	assert.match(a1, /fail-fast:\s*false/);
	assert.match(a1, /working-directory:\s*e2e\/common/);
	assert.match(a1, /actions\/upload-artifact@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
	assert.match(a1, /name:\s*Run openapi-to setup inspector tests/);
	assert.match(
		a1,
		/run:\s*node --test scripts\/openapi-to-setup\.node-test\.mjs/,
	);
	assert.doesNotMatch(e2e, /petstore\.swagger\.io/);
	assert.doesNotMatch(e2e, /fail-fast:\s*true/);
	assert.match(e2e, /pnpm test:e2e:remote/);
	assert.match(e2e, /MCP_TEST_ARTIFACT_DIR/);
	assert.match(e2e, /actions\/upload-artifact@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
});

test("GitHub YAML contracts require immutable third-party Action pins with exact version comments", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-action-pins-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFixtureFile(
		root,
		".github/workflows/pins.yml",
		`name: Pins
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: ./local-action
      - uses: actions/checkout@v4
      - uses: actions/upload-artifact@v4 # current stable version
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # current stable version
`,
	);

	const failures = await auditGitHubWorkflowContexts(root);
	assert.deepEqual(failures, [
		".github/workflows/pins.yml: SHA-pinned Action must retain an exact version comment: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
		".github/workflows/pins.yml: SHA-pinned Action must retain an exact version comment: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
		".github/workflows/pins.yml: third-party Action must use a full 40-character SHA: actions/checkout@v4",
		".github/workflows/pins.yml: third-party Action must use a full 40-character SHA: actions/upload-artifact@v4",
	]);
});

async function createCiFoundationContractFixture(t) {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-ci-foundation-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	for (const relativePath of [
		".github/workflows/a1-cross-platform.yml",
		".github/workflows/e2e.yaml",
		".github/workflows/quality.yml",
		".github/workflows/version-readiness.yml",
		".github/dependabot.yml",
	]) {
		await writeFixtureFile(
			root,
			relativePath,
			await readFile(join(repositoryRoot, relativePath), "utf8"),
		);
	}
	return root;
}

test("CI foundation contracts require PR-only cancellation and weekly Action updates", async (t) => {
	const validRoot = await createCiFoundationContractFixture(t);
	assert.deepEqual(await auditCiFoundationContracts(validRoot), []);

	const missingConcurrencyRoot = await createCiFoundationContractFixture(t);
	const qualityPath = join(
		missingConcurrencyRoot,
		".github/workflows/quality.yml",
	);
	await writeFile(
		qualityPath,
		(await readFile(qualityPath, "utf8")).replace(
			/concurrency:\n(?: {2}.*\n){2}\n/,
			"",
		),
	);
	assert.deepEqual(await auditCiFoundationContracts(missingConcurrencyRoot), [
		".github/workflows/quality.yml must define PR-aware concurrency",
	]);

	const broadCancellationRoot = await createCiFoundationContractFixture(t);
	const e2ePath = join(broadCancellationRoot, ".github/workflows/e2e.yaml");
	await writeFile(
		e2ePath,
		(await readFile(e2ePath, "utf8")).replace(
			`cancel-in-progress: ${DOLLAR_SIGN}{{ github.event_name == 'pull_request' }}`,
			"cancel-in-progress: true",
		),
	);
	assert.deepEqual(await auditCiFoundationContracts(broadCancellationRoot), [
		".github/workflows/e2e.yaml must use the required PR-only cancellation policy",
	]);

	const missingDependabotRoot = await createCiFoundationContractFixture(t);
	await rm(join(missingDependabotRoot, ".github/dependabot.yml"));
	assert.deepEqual(await auditCiFoundationContracts(missingDependabotRoot), [
		"missing .github/dependabot.yml",
	]);

	const weakDependabotRoot = await createCiFoundationContractFixture(t);
	const dependabotPath = join(weakDependabotRoot, ".github/dependabot.yml");
	await writeFile(
		dependabotPath,
		(await readFile(dependabotPath, "utf8")).replace("weekly", "monthly"),
	);
	assert.deepEqual(await auditCiFoundationContracts(weakDependabotRoot), [
		".github/dependabot.yml must contain exactly one weekly root github-actions update",
	]);
});

test("merge queue contracts accept universal checks and the conditional release gate", async (t) => {
	const root = await createCiFoundationContractFixture(t);
	assert.deepEqual(await auditMergeQueueContracts(root), []);

	const trackedRoot = await createCiDiagnosticsContractFixture(t);
	assert.deepEqual(await auditVersionReadinessContracts(trackedRoot), []);
});

test("stable aggregate checks fail closed for every non-success dependency result", async (t) => {
	const contracts = [
		{
			workflow: ".github/workflows/quality.yml",
			job: "required-quality",
			dependencies: [
				"build",
				"typecheck",
				"tests",
				"lint-changed",
				"release-smoke",
			],
		},
		{
			workflow: ".github/workflows/e2e.yaml",
			job: "required-e2e",
			dependencies: [
				"classify-surface",
				"cli",
				"mcp-stdio-e2e",
				"mcp-cross-platform",
				"mcp-transaction-safety",
			],
			skippable: [
				"cli",
				"mcp-stdio-e2e",
				"mcp-cross-platform",
				"mcp-transaction-safety",
			],
		},
		{
			workflow: ".github/workflows/a1-cross-platform.yml",
			job: "required-a1",
			dependencies: ["classify-surface", "contracts"],
			skippable: ["contracts"],
		},
	];

	for (const contract of contracts) {
		await t.test(contract.job, async () => {
			const source = await readFile(
				join(repositoryRoot, contract.workflow),
				"utf8",
			);
			const workflow = loadYaml(source);
			const steps = workflow.jobs[contract.job].steps;
			const inlineRun = steps.find(
				(step) =>
					typeof step.run === "string" && step.run.startsWith("node -e "),
			)?.run;
			const match = inlineRun && /^node -e '([\s\S]+)'$/.exec(inlineRun.trim());
			const helper = steps.some(
				(step) =>
					step.run === "node scripts/ci-routing/require-job-results.mjs",
			);
			assert.ok(
				match || helper,
				`${contract.job} must contain one executable Node gate`,
			);
			const results = Object.fromEntries(
				contract.dependencies.map((dependency) => [
					dependency,
					{ outputs: {}, result: "success" },
				]),
			);
			const env = {
				...process.env,
				GITHUB_EVENT_NAME: "merge_group",
				CI_REQUIRED_JOBS: contract.dependencies.join(","),
				CI_REQUIRED_RESULTS: JSON.stringify(results),
				CI_CLASSIFICATION: JSON.stringify({
					route: "full",
					classification: "full",
					reason: "non-docs-or-universal-event",
				}),
				CI_SKIPPABLE_JOBS: (contract.skippable ?? []).join(","),
			};
			const command = match
				? ["-e", match[1]]
				: [join(repositoryRoot, "scripts/ci-routing/require-job-results.mjs")];
			await execFileAsync(process.execPath, command, { env });

			for (const dependency of contract.dependencies) {
				for (const result of ["failure", "cancelled", "skipped"]) {
					results[dependency].result = result;
					await assert.rejects(
						execFileAsync(process.execPath, command, {
							env: { ...env, CI_REQUIRED_RESULTS: JSON.stringify(results) },
						}),
						(error) => {
							assert.equal(error.code, 1);
							assert.match(error.stderr, /not-successful|did not succeed/);
							return true;
						},
					);
					results[dependency].result = "success";
				}
			}
		});
	}
});

test("merge queue contracts reject trigger, event, lint, and aggregate regressions", async (t) => {
	const cases = [
		{
			name: "universal workflow loses merge_group",
			workflow: ".github/workflows/a1-cross-platform.yml",
			mutate: (contents) =>
				contents.replace("  merge_group:\n    types: [checks_requested]\n", ""),
			failure: /must run on merge_group checks_requested/,
		},
		{
			name: "universal workflow gains a PR path filter",
			workflow: ".github/workflows/quality.yml",
			mutate: (contents) =>
				contents.replace(
					"  pull_request:\n    branches: [main]\n",
					"  pull_request:\n    branches: [main]\n    paths: [packages/**]\n",
				),
			failure: /must target main without path filters/,
		},
		{
			name: "merge-group head metadata is removed",
			workflow: ".github/workflows/a1-cross-platform.yml",
			mutate: (contents) =>
				contents.replace(
					"github.event.pull_request.head.sha || github.event.merge_group.head_sha || github.sha",
					"github.event.pull_request.head.sha || github.sha",
				),
			failure: /must record event-aware pull_request and merge_group SHAs/,
		},
		{
			name: "ordinary E2E validation becomes PR-only",
			workflow: ".github/workflows/e2e.yaml",
			mutate: (contents) =>
				contents.replace(
					"needs.classify-surface.outputs.route != 'docs-only'",
					"needs.classify-surface.outputs.route == 'docs-only'",
				),
			failure: /unexpected route condition/,
		},
		{
			name: "E2E expensive validation restores always during cancellation",
			workflow: ".github/workflows/e2e.yaml",
			mutate: (contents) =>
				contents.replace(
					`if: ${DOLLAR_SIGN}{{ !cancelled() && github.event_name != 'schedule' && (needs.classify-surface.result != 'success' || needs.classify-surface.outputs.route != 'docs-only') }}`,
					"if: always() && github.event_name != 'schedule' && (needs.classify-surface.result != 'success' || needs.classify-surface.outputs.route != 'docs-only')",
				),
			failure: /unexpected route condition/,
		},
		{
			name: "A1 contracts lose classifier-failure full-validation fallback",
			workflow: ".github/workflows/a1-cross-platform.yml",
			mutate: (contents) =>
				contents.replace(
					"needs.classify-surface.result != 'success'",
					"needs.classify-surface.result == 'success'",
				),
			failure: /unexpected route condition/,
		},
		{
			name: "performance validation expands to merge groups",
			workflow: ".github/workflows/e2e.yaml",
			mutate: (contents) =>
				contents.replace(
					"github.event_name != 'pull_request' && github.event_name != 'merge_group'",
					"github.event_name != 'pull_request'",
				),
			failure: /must remain excluded from pull_request and merge_group/,
		},
		{
			name: "merge-group lint loses its fail-closed base check",
			workflow: ".github/workflows/quality.yml",
			mutate: (contents) =>
				contents.replace(
					`          test -n "${DOLLAR_SIGN}{MERGE_GROUP_BASE_SHA}"\n`,
					"",
				),
			failure:
				/merge_group lint must validate the event head, fail closed without a base/,
		},
		{
			name: "Quality aggregate omits release smoke",
			workflow: ".github/workflows/quality.yml",
			mutate: (contents) =>
				contents.replace(
					"needs: [build, typecheck, tests, lint-changed, release-smoke]",
					"needs: [build, typecheck, tests, lint-changed]",
				),
			failure: /must fail closed over the exact required Job set/,
		},
		{
			name: "Quality pull request selects Full instead of Fast",
			workflow: ".github/workflows/quality.yml",
			mutate: (contents) =>
				contents.replace(
					`        run: node scripts/ci-diagnostics/run-command.mjs --dir "\${{ env.CI_DIAGNOSTIC_DIR }}" --id pack-install -- pnpm release:smoke:fast`,
					`        run: node scripts/ci-diagnostics/run-command.mjs --dir "\${{ env.CI_DIAGNOSTIC_DIR }}" --id pack-install -- pnpm release:smoke`,
				),
			failure: /must select Fast only for pull_request/,
		},
		{
			name: "Quality Full gate gains PR-only routing",
			workflow: ".github/workflows/quality.yml",
			mutate: (contents) =>
				contents.replace(
					"      - name: Full packed consumer acceptance\n        id: pack-install-full\n        if: github.event_name != 'pull_request'",
					"      - name: Full packed consumer acceptance\n        id: pack-install-full\n        if: github.event_name == 'pull_request'",
				),
			failure: /must select Fast only for pull_request/,
		},
		{
			name: "Quality selected-gate outcome guard can be skipped",
			workflow: ".github/workflows/quality.yml",
			mutate: (contents) =>
				contents.replace(
					"      - name: Require the selected packed gate\n        if: always()",
					"      - name: Require the selected packed gate\n        if: failure()",
				),
			failure: /must select Fast only for pull_request/,
		},
		{
			name: "A1 aggregate accepts skipped dependencies",
			workflow: ".github/workflows/a1-cross-platform.yml",
			mutate: (contents) =>
				contents.replace(
					"node scripts/ci-routing/require-job-results.mjs",
					"node -e 'process.exit(0)'",
				),
			failure: /must fail closed over the exact required Job set/,
		},
		{
			name: "aggregate check names become ambiguous",
			workflow: ".github/workflows/a1-cross-platform.yml",
			mutate: (contents) =>
				contents.replace(
					"    name: Required A1 cross-platform\n",
					"    name: Required quality\n",
				),
			failure: /aggregate check name Required quality is ambiguous/,
		},
	];

	for (const fixture of cases) {
		await t.test(fixture.name, async (t) => {
			const root = await createCiFoundationContractFixture(t);
			const workflowPath = join(root, fixture.workflow);
			const contents = await readFile(workflowPath, "utf8");
			const mutated = fixture.mutate(contents);
			assert.notEqual(
				mutated,
				contents,
				"fixture mutation must change workflow",
			);
			await writeFile(workflowPath, mutated);
			assertFailure(
				{ failures: await auditMergeQueueContracts(root) },
				fixture.failure,
			);
		});
	}
});

test("GitHub YAML contracts reject runner context in Job env without rejecting runner-assigned contexts", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-workflow-context-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFixtureFile(
		root,
		".github/workflows/invalid.yml",
		`name: Invalid
jobs:
  build:
    env:
      CI_DIAGNOSTIC_DIR: \${{ runner.temp }}/diagnostics
      SAFE_DIR: \${{ github.workspace }}/.ci-artifacts/safe
      SAFE_TEXT: \${{ github.workspace }}/runner.temp
    steps:
      - run: echo ok
        env:
          STEP_TEMP: \${{ runner.temp }}/step
`,
	);
	await writeFixtureFile(
		root,
		".github/workflows/second.yaml",
		`name: Second invalid
jobs:
  test:
    env:
      RUNNER_HINT: \${{ runner.os }}
    steps:
      - run: echo test
`,
	);
	await writeFixtureFile(
		root,
		".github/setup/action.yml",
		`name: Setup
runs:
  using: composite
  steps:
    - shell: bash
      run: echo ok
      env:
        STEP_TEMP: \${{ runner.temp }}/composite
`,
	);

	const failures = await auditGitHubWorkflowContexts(root);
	assert.deepEqual(failures, [
		".github/workflows/invalid.yml: jobs.build.env.CI_DIAGNOSTIC_DIR must not use the runner context before a runner is assigned",
		".github/workflows/second.yaml: jobs.test.env.RUNNER_HINT must not use the runner context before a runner is assigned",
	]);
});

test("GitHub YAML contracts parse composite actions and report syntax failures", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-workflow-yaml-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFixtureFile(
		root,
		".github/actions/example/action.yaml",
		"name: Broken\nruns: [\n",
	);

	const failures = await auditGitHubWorkflowContexts(root);
	assert.equal(failures.length, 1);
	assert.match(
		failures[0],
		/^\.github\/actions\/example\/action\.yaml:\d+:\d+: invalid YAML:/,
	);
});

test("CI diagnostics repository contract accepts the tracked bounded integration", async (t) => {
	const root = await createCiDiagnosticsContractFixture(t);
	assert.deepEqual(await auditCiDiagnosticsContracts(root), []);
});

test("CI diagnostics contract binds each consolidated CLI finalizer to its scenario reports", async (t) => {
	const root = await createCiDiagnosticsContractFixture(t);
	const workflowPath = join(root, ".github/workflows/e2e.yaml");
	const original = await readFile(workflowPath, "utf8");
	const mutated = original.replace(
		"CLI_E2E_ARTIFACT_DIR: " +
			"$" +
			"{{ github.workspace }}/.ci-artifacts/cli-common\n        run: node scripts/ci-diagnostics/finalize-job.mjs",
		"run: node scripts/ci-diagnostics/finalize-job.mjs",
	);
	assert.notEqual(
		mutated,
		original,
		"fixture mutation must remove the CommonJS finalizer report root",
	);
	await writeFile(workflowPath, mutated);
	assertFailure(
		{ failures: await auditCiDiagnosticsContracts(root) },
		/CLI E2E must retain separate e2e-common diagnostics and finalizer report root/,
	);
});

test("CLI ESM and local HTTP finalizers ignore failures from sibling scenarios", async (t) => {
	const root = await createCiDiagnosticsContractFixture(t);
	const workflowPath = join(root, ".github/workflows/e2e.yaml");
	const original = await readFile(workflowPath, "utf8");
	const mutated = original.replaceAll(
		`--job-status "${DOLLAR_SIGN}{{ job.status == 'cancelled' && 'cancelled' || 'success' }}"`,
		`--job-status "${DOLLAR_SIGN}{{ job.status }}"`,
	);
	assert.notEqual(
		mutated,
		original,
		"fixture mutation must restore the shared Job status",
	);
	await writeFile(workflowPath, mutated);
	assertFailure(
		{ failures: await auditCiDiagnosticsContracts(root) },
		/CLI E2E e2e-module finalizer must use its scenario-scoped job status/,
	);
});

test("CI diagnostics repository contract rejects missing canonical test wiring", async (t) => {
	const cases = [
		{
			name: "root test command removed",
			file: "package.json",
			mutate: (contents) =>
				contents.replace(
					'\t\t"test:ci-diagnostics": "node --test scripts/ci-diagnostics/*.node-test.mjs",\n',
					"",
				),
			failure: /test:ci-diagnostics must run Node tests/,
		},
		{
			name: "Quality execution removed",
			file: ".github/workflows/quality.yml",
			mutate: (contents) =>
				contents.replace(
					/^\s+- name: Test CI diagnostics\r?\n\s+run:.*\r?\n/m,
					"",
				),
			failure: /Quality tests Job must run pnpm test:ci-diagnostics/,
		},
		{
			name: "A1 execution removed",
			file: ".github/workflows/a1-cross-platform.yml",
			mutate: (contents) =>
				contents.replace(
					/^\s+- name: Run CI diagnostics tests\r?\n\s+run:.*\r?\n/m,
					"",
				),
			failure: /A1 contracts Job must run pnpm test:ci-diagnostics/,
		},
		{
			name: "Quality plan command removed",
			file: "scripts/ci-diagnostics/plans.mjs",
			mutate: (contents) =>
				contents.replace(
					'\t\t\tcommand("ci-diagnostics-tests", "Test CI diagnostics"),\n',
					"",
				),
			failure: /quality-tests CI diagnostics plan must declare command id/,
		},
		{
			name: "A1 plan command removed",
			file: "scripts/ci-diagnostics/plans.mjs",
			mutate: (contents) =>
				contents.replace(
					'\t\t\tcommand("ci-diagnostics-tests", "Run CI diagnostics tests"),\n',
					"",
				),
			failure: /a1-contracts CI diagnostics plan must declare command id/,
		},
		{
			name: "local full quality gate removed",
			file: "package.json",
			mutate: (contents) =>
				contents.replace(" && pnpm test:ci-diagnostics", ""),
			failure: /release:check:quality must execute pnpm test:ci-diagnostics/,
		},
	];

	for (const fixture of cases) {
		await t.test(fixture.name, async (t) => {
			const root = await createCiDiagnosticsContractFixture(t);
			const filePath = join(root, fixture.file);
			const original = await readFile(filePath, "utf8");
			const mutated = fixture.mutate(original);
			assert.notEqual(
				mutated,
				original,
				"fixture mutation must change its file",
			);
			await writeFile(filePath, mutated);
			assertFailure(
				{ failures: await auditCiDiagnosticsContracts(root) },
				fixture.failure,
			);
		});
	}
});

test("Version readiness contract accepts source-aware strict and development gates", async (t) => {
	const root = await createCiDiagnosticsContractFixture(t);
	assert.deepEqual(await auditVersionReadinessContracts(root), []);
});

test("Version readiness contract rejects gate selection and bypass regressions", async (t) => {
	const cases = [
		{
			name: "strict command removed",
			mutate: (contents) =>
				contents.replace(
					" -- pnpm verify:changeset-state\n",
					" -- pnpm verify:changeset-state:development\n",
				),
			failure: /must run strict verify:changeset-state only/,
		},
		{
			name: "development command removed",
			mutate: (contents) =>
				contents.replace(
					" -- pnpm verify:changeset-state:development\n",
					" -- pnpm verify:changeset-state\n",
				),
			failure: /must run verify:changeset-state:development for every other PR/,
		},
		{
			name: "strict identity binding weakened",
			mutate: (contents) =>
				contents.replace(
					"        ${{ github.event.pull_request.head.repo.full_name == github.repository &&\n",
					"        ${{ github.event.pull_request.head.ref == 'changeset-release/main' &&\n",
				),
			failure: /strict mode must bind to same-repository/,
		},
		{
			name: "whole Job skipped",
			mutate: (contents) =>
				contents.replace(
					"    runs-on: ubuntu-latest\n",
					"    if: false\n    runs-on: ubuntu-latest\n",
				),
			failure: /Job must not be conditionally skipped/,
		},
		{
			name: "pull request trigger removed",
			mutate: (contents) =>
				contents.replace("  pull_request:\n", "  workflow_dispatch:\n"),
			failure:
				/must retain its pull_request main-branch and version-state path triggers/,
		},
		{
			name: "continue on error added",
			mutate: (contents) =>
				contents.replace(
					"    runs-on: ubuntu-latest\n",
					"    runs-on: ubuntu-latest\n    continue-on-error: true\n",
				),
			failure: /must not use continue-on-error/,
		},
	];
	for (const fixture of cases) {
		await t.test(fixture.name, async (t) => {
			const root = await createCiDiagnosticsContractFixture(t);
			const workflowPath = join(
				root,
				".github/workflows/version-readiness.yml",
			);
			const workflow = await readFile(workflowPath, "utf8");
			await writeFile(workflowPath, fixture.mutate(workflow));
			assertFailure(
				{ failures: await auditVersionReadinessContracts(root) },
				fixture.failure,
			);
		});
	}
});

test("CI diagnostics repository contract rejects missing or untracked core files", async (t) => {
	const root = await createCiDiagnosticsContractFixture(t);
	await rm(join(root, "scripts/ci-diagnostics/run-command.mjs"));
	let failures = await auditCiDiagnosticsContracts(root);
	assert.ok(
		failures.some((failure) =>
			/missing CI diagnostics infrastructure scripts\/ci-diagnostics\/run-command\.mjs/.test(
				failure,
			),
		),
	);
	await git(
		root,
		"rm",
		"--cached",
		"--force",
		"--",
		"scripts/ci-diagnostics/run-command.mjs",
	);
	await writeFixtureFile(
		root,
		"scripts/ci-diagnostics/run-command.mjs",
		"export {};\n",
	);
	failures = await auditCiDiagnosticsContracts(root);
	assert.ok(
		failures.some((failure) =>
			/not Git-tracked: scripts\/ci-diagnostics\/run-command\.mjs/.test(
				failure,
			),
		),
	);
});

test("CI diagnostics repository contract rejects schema and retention drift", async (t) => {
	const root = await createCiDiagnosticsContractFixture(t);
	const schemaPath = join(root, "scripts/ci-diagnostics/schema.mjs");
	const schema = await readFile(schemaPath, "utf8");
	await writeFile(
		schemaPath,
		schema
			.replace("SCHEMA_VERSION = 2", "SCHEMA_VERSION = 3")
			.replace("ARTIFACT_RETENTION_DAYS = 14", "ARTIFACT_RETENTION_DAYS = 7"),
	);
	const failures = await auditCiDiagnosticsContracts(root);
	assert.ok(
		failures.some((failure) =>
			/schema entrypoint must declare version 2/.test(failure),
		),
	);
	assert.ok(
		failures.some((failure) =>
			/retention contract must remain 14 days/.test(failure),
		),
	);
});

test("CI diagnostics repository contract rejects missing finalizers and hidden failures", async (t) => {
	const root = await createCiDiagnosticsContractFixture(t);
	const workflowPath = join(root, ".github/workflows/quality.yml");
	const workflow = await readFile(workflowPath, "utf8");
	await writeFile(
		workflowPath,
		workflow
			.replace("- name: Finalize CI diagnostics", "- name: Missing finalizer")
			.replace("    steps:", "    continue-on-error: true\n    steps:"),
	);
	const failures = await auditCiDiagnosticsContracts(root);
	assert.ok(
		failures.some((failure) =>
			/must finalize all 5 covered Jobs/.test(failure),
		),
	);
	assert.ok(
		failures.some((failure) => /must not use continue-on-error/.test(failure)),
	);
});

test("CI diagnostics repository contract rejects artifact-policy drift", async (t) => {
	const root = await createCiDiagnosticsContractFixture(t);
	const workflowPath = join(root, ".github/workflows/version-readiness.yml");
	const workflow = await readFile(workflowPath, "utf8");
	await writeFile(
		workflowPath,
		workflow
			.replace("if: failure()", "if: always()")
			.replace("retention-days: 14", "retention-days: 30"),
	);
	const failures = await auditCiDiagnosticsContracts(root);
	assert.ok(
		failures.some((failure) =>
			/upload all 1 standard diagnostics with if: failure/.test(failure),
		),
	);
	assert.ok(failures.some((failure) => /14-day retention/.test(failure)));
});

test("CI diagnostics repository contract rejects work-directory uploads and pnpm-hosted wrappers", async (t) => {
	const root = await createCiDiagnosticsContractFixture(t);
	const workflowPath = join(root, ".github/workflows/version-readiness.yml");
	const workflow = await readFile(workflowPath, "utf8");
	await writeFile(
		workflowPath,
		workflow
			.replace(
				`path: \${{ steps.diagnostics-init.outputs.upload-dir }}`,
				`path: \${{ env.CI_DIAGNOSTIC_DIR }}`,
			)
			.replace(
				"run: node scripts/ci-diagnostics/run-command.mjs",
				"run: pnpm exec node scripts/ci-diagnostics/run-command.mjs",
			),
	);
	const failures = await auditCiDiagnosticsContracts(root);
	assertFailure({ failures }, /isolated upload directory/);
	assertFailure(
		{ failures },
		/start the CI diagnostics wrapper directly with node/,
	);
});

test("CI diagnostics repository contract rejects persisted checkout credentials and missing Action ids", async (t) => {
	const root = await createCiDiagnosticsContractFixture(t);
	const workflowPath = join(root, ".github/workflows/version-readiness.yml");
	const workflow = await readFile(workflowPath, "utf8");
	await writeFile(
		workflowPath,
		workflow
			.replace("          persist-credentials: false\n", "")
			.replace("        id: setup\n", ""),
	);
	const failures = await auditCiDiagnosticsContracts(root);
	assertFailure({ failures }, /disable persisted credentials/);
	assertFailure({ failures }, /stable setup ids/);
});

test("CI diagnostics repository contract rejects missing bounded reads, child environment policy, and upload materialization", async (t) => {
	const root = await createCiDiagnosticsContractFixture(t);
	const filesystemPath = join(root, "scripts/ci-diagnostics/filesystem.mjs");
	await writeFile(
		filesystemPath,
		(await readFile(filesystemPath, "utf8")).replace(
			"export async function readBoundedRegularFile",
			"async function unsafeRead",
		),
	);
	const runCommandPath = join(root, "scripts/ci-diagnostics/run-command.mjs");
	await writeFile(
		runCommandPath,
		`${(await readFile(runCommandPath, "utf8"))
			.replace("CHILD_ENV_DENYLIST", "REMOVED_CHILD_POLICY")
			.replaceAll(
				"resourceSnapshot",
				"REMOVED_RESOURCE_SNAPSHOT",
			)}\n// TURBO_LOG_FILE\n`,
	);
	const finalizerPath = join(root, "scripts/ci-diagnostics/finalize-job.mjs");
	await writeFile(
		finalizerPath,
		(await readFile(finalizerPath, "utf8"))
			.replaceAll("materializeUploadDirectory", "unsafeUploadDirectory")
			.replaceAll(
				"within(repositoryRoot, turboManifestPath)",
				"removedTurboManifestContainment",
			),
	);
	const failures = await auditCiDiagnosticsContracts(root);
	assertFailure({ failures }, /bounded file reader is missing/);
	assertFailure({ failures }, /child environment policy is missing/);
	assertFailure({ failures }, /upload materialization is missing/);
	assertFailure({ failures }, /process evidence is missing resourceSnapshot/);
	assertFailure({ failures }, /runtime normalization is missing within/);
	assertFailure({ failures }, /unbounded structured log channel/);
});

test("CI diagnostics repository contract rejects gate and matrix shrinkage", async (t) => {
	const root = await createCiDiagnosticsContractFixture(t);
	const qualityPath = join(root, ".github/workflows/quality.yml");
	await writeFile(
		qualityPath,
		(await readFile(qualityPath, "utf8")).replace(
			"pnpm typecheck --concurrency=1",
			"pnpm typecheck",
		),
	);
	const a1Path = join(root, ".github/workflows/a1-cross-platform.yml");
	await writeFile(
		a1Path,
		(await readFile(a1Path, "utf8")).replace(", windows-latest", ""),
	);
	const failures = await auditCiDiagnosticsContracts(root);
	assert.ok(
		failures.some((failure) =>
			/removed gate command: pnpm typecheck --concurrency=1/.test(failure),
		),
	);
	assert.ok(
		failures.some((failure) =>
			/A1 diagnostics integration removed contract: os:/.test(failure),
		),
	);
});

test("CI diagnostics repository contract rejects Version Packages integration", async (t) => {
	const root = await createCiDiagnosticsContractFixture(t);
	const workflowPath = join(root, ".github/workflows/version-packages.yml");
	await writeFile(
		workflowPath,
		`${await readFile(workflowPath, "utf8")}\n# ci-diagnostics\n`,
	);
	const failures = await auditCiDiagnosticsContracts(root);
	assert.ok(
		failures.some((failure) =>
			/Version Packages must remain outside CI diagnostics/.test(failure),
		),
	);
});

test("publication repository contract accepts the manual least-privilege workflow", async (t) => {
	const root = await createPublicationContractFixture(t);
	assert.deepEqual(await auditPublicationContracts(root), []);
});

test("publication contract rejects artifact transfer regressions", async (t) => {
	const cases = [
		{
			name: "missing include-hidden-files",
			mutate: (contents) =>
				contents.replace("          include-hidden-files: true\n", ""),
			failure: /include-hidden-files true/,
		},
		{
			name: "include-hidden-files false",
			mutate: (contents) =>
				contents.replace(
					"          include-hidden-files: true",
					"          include-hidden-files: false",
				),
			failure: /include-hidden-files true/,
		},
		{
			name: "include-hidden-files string",
			mutate: (contents) =>
				contents.replace(
					"          include-hidden-files: true",
					'          include-hidden-files: "true"',
				),
			failure: /include-hidden-files true/,
		},
		{
			name: "if-no-files-found warning",
			mutate: (contents) =>
				contents.replace(
					"          if-no-files-found: error",
					"          if-no-files-found: warn",
				),
			failure: /if-no-files-found error/,
		},
		{
			name: "artifact overwrite",
			mutate: (contents) =>
				contents.replace(
					"          if-no-files-found: error",
					"          overwrite: true\n          if-no-files-found: error",
				),
			failure: /must not configure overwrite/,
		},
		{
			name: "artifact overwrite string",
			mutate: (contents) =>
				contents.replace(
					"          if-no-files-found: error",
					'          overwrite: "true"\n          if-no-files-found: error',
				),
			failure: /must not configure overwrite/,
		},
		{
			name: "duplicate upload step",
			mutate: (contents) =>
				contents.replace(
					"          compression-level: 0\n",
					`          compression-level: 0

      - name: Upload an unsafe duplicate artifact
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: unsafe-duplicate
          path: .
          include-hidden-files: true
          if-no-files-found: error
`,
				),
			failure: /must upload only the controlled hidden publication artifact/,
		},
		{
			name: "artifact name omits run attempt",
			mutate: (contents) =>
				contents
					.replace(
						`          RUN_ATTEMPT: ${DOLLAR_SIGN}{{ github.run_attempt }}\n`,
						"",
					)
					.replace(
						`          printf 'name=openapi-to-publication-%s-attempt-%s\\n' \\
            "${DOLLAR_SIGN}{EXPECTED_SHA}" \\
            "${DOLLAR_SIGN}{RUN_ATTEMPT}" >> "${DOLLAR_SIGN}{GITHUB_OUTPUT}"`,
						`          printf 'name=openapi-to-publication-%s\\n' "${DOLLAR_SIGN}{EXPECTED_SHA}" >> "${DOLLAR_SIGN}{GITHUB_OUTPUT}"`,
					),
			failure: /verified expected SHA and validated github\.run_attempt/,
		},
		{
			name: "artifact name uses only expected SHA",
			mutate: (contents) =>
				contents.replace(
					"name=openapi-to-publication-%s-attempt-%s",
					"name=openapi-to-publication-%s",
				),
			failure: /verified expected SHA and validated github\.run_attempt/,
		},
		{
			name: "artifact name adds untrusted env",
			mutate: (contents) =>
				contents.replace(
					`          RUN_ATTEMPT: ${DOLLAR_SIGN}{{ github.run_attempt }}`,
					`          RUN_ATTEMPT: ${DOLLAR_SIGN}{{ github.run_attempt }}
          UNSAFE_VERSION: ${DOLLAR_SIGN}{{ inputs.expected_version }}`,
				),
			failure: /canonical output script/,
		},
		{
			name: "artifact name redirects canonical output",
			mutate: (contents) =>
				contents.replace(
					`  "${DOLLAR_SIGN}{RUN_ATTEMPT}" >> "${DOLLAR_SIGN}{GITHUB_OUTPUT}"`,
					`  "${DOLLAR_SIGN}{RUN_ATTEMPT}" >/dev/null
          printf 'name=unsafe-alternate\\n' >> "${DOLLAR_SIGN}{GITHUB_OUTPUT}"`,
				),
			failure: /canonical output script/,
		},
		{
			name: "duplicate artifact binding step",
			mutate: (contents) =>
				contents.replace(
					"      - name: Upload only the verified publication artifact\n",
					`      - name: Duplicate artifact binding
        id: artifact
        shell: bash
        run: printf 'name=unsafe-duplicate\\n' >> "${DOLLAR_SIGN}{GITHUB_OUTPUT}"

      - name: Upload only the verified publication artifact
`,
				),
			failure: /canonical output script/,
		},
		{
			name: "intervening artifact contamination step",
			mutate: (contents) =>
				contents.replace(
					"      - name: Upload only the verified publication artifact\n",
					`      - name: Contaminate the verified artifact
        run: touch .ci-artifacts/publication/unexpected

      - name: Upload only the verified publication artifact
`,
				),
			failure:
				/finish preflight with consecutive prepare, smoke, artifact-name/,
		},
		{
			name: "publish download uses hardcoded name",
			mutate: (contents) =>
				contents.replace(
					`          name: ${DOLLAR_SIGN}{{ needs.preflight-and-package.outputs.artifact_name }}`,
					"          name: openapi-to-publication-hardcoded",
				),
			failure: /jobs\.publish must download the upstream artifact_name/,
		},
		{
			name: "publish download recomputes name",
			mutate: (contents) =>
				contents.replace(
					`          name: ${DOLLAR_SIGN}{{ needs.preflight-and-package.outputs.artifact_name }}`,
					`          name: openapi-to-publication-${DOLLAR_SIGN}{{ needs.preflight-and-package.outputs.expected_sha }}-attempt-${DOLLAR_SIGN}{{ github.run_attempt }}`,
				),
			failure: /jobs\.publish must download the upstream artifact_name/,
		},
		{
			name: "publish download selects a different run",
			mutate: (contents) =>
				contents.replace(
					`          name: ${DOLLAR_SIGN}{{ needs.preflight-and-package.outputs.artifact_name }}
          path: .ci-artifacts/publication`,
					`          name: ${DOLLAR_SIGN}{{ needs.preflight-and-package.outputs.artifact_name }}
          path: .ci-artifacts/publication
          repository: other/repository
          run-id: 12345`,
				),
			failure: /jobs\.publish must download the upstream artifact_name/,
		},
		{
			name: "extra uncontrolled download",
			mutate: (contents) =>
				contents.replace(
					"      - name: Bind immutable artifact name\n",
					`      - name: Download an uncontrolled artifact
        uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093
        with:
          name: uncontrolled
          path: .ci-artifacts/publication

      - name: Bind immutable artifact name
`,
				),
			failure: /exactly one controlled publication download/,
		},
		{
			name: "upload path expands to artifact root",
			mutate: (contents) =>
				contents.replace(
					"          path: .ci-artifacts/publication\n          include-hidden-files: true",
					"          path: .ci-artifacts\n          include-hidden-files: true",
				),
			failure: /controlled hidden publication artifact/,
		},
		{
			name: "upload path expands to repository root",
			mutate: (contents) =>
				contents.replace(
					"          path: .ci-artifacts/publication\n          include-hidden-files: true",
					"          path: .\n          include-hidden-files: true",
				),
			failure: /controlled hidden publication artifact/,
		},
		{
			name: "artifact job output removed",
			mutate: (contents) =>
				contents.replace(
					`      artifact_name: ${DOLLAR_SIGN}{{ steps.artifact.outputs.name }}\n`,
					"",
				),
			failure:
				/outputs\.artifact_name must come from steps\.artifact\.outputs\.name/,
		},
		{
			name: "run attempt replaced by user input",
			mutate: (contents) =>
				contents.replace(
					`          RUN_ATTEMPT: ${DOLLAR_SIGN}{{ github.run_attempt }}`,
					`          RUN_ATTEMPT: ${DOLLAR_SIGN}{{ inputs.expected_version }}`,
				),
			failure: /verified expected SHA and validated github\.run_attempt/,
		},
	];
	for (const fixture of cases) {
		await t.test(fixture.name, async (t) => {
			const root = await createPublicationContractFixture(t);
			await mutateTrackedFixture(
				root,
				".github/workflows/publish.yml",
				fixture.mutate,
			);
			assertFailure(
				{ failures: await auditPublicationContracts(root) },
				fixture.failure,
			);
		});
	}
});

test("publication contract rejects trigger, concurrency, permission, and dependency drift", async (t) => {
	const cases = [
		{
			path: ".github/workflows/publish.yml",
			mutate: (contents) =>
				contents.replace(
					"on:\n  workflow_dispatch:",
					"on:\n  push:\n  workflow_dispatch:",
				),
			failure: /only trigger/,
		},
		{
			path: ".github/workflows/publish.yml",
			mutate: (contents) =>
				contents.replace(
					"group: publish-openapi-to-fixed-group",
					`group: publish-openapi-to-fixed-group-${DOLLAR_SIGN}{{ inputs.channel }}`,
				),
			failure: /fixed-group publication lock|must not vary/,
		},
		{
			path: ".github/workflows/publish.yml",
			mutate: (contents) =>
				contents.replace(
					"concurrency:\n  group: publish-openapi-to-fixed-group\n  cancel-in-progress: false\n\n",
					"",
				),
			failure: /fixed-group publication lock/,
		},
		{
			path: ".github/workflows/publish.yml",
			mutate: (contents) =>
				contents.replace(
					"cancel-in-progress: false",
					"cancel-in-progress: true",
				),
			failure: /cancel-in-progress false/,
		},
		{
			path: ".github/workflows/publish.yml",
			mutate: (contents) =>
				contents.replace(
					"    permissions:\n      contents: read\n      id-token: write",
					"    permissions:\n      contents: write\n      id-token: write",
				),
			failure: /jobs\.publish\.permissions/,
		},
		{
			path: ".github/workflows/publish.yml",
			mutate: (contents) => contents.replace("      - verify-registry\n", ""),
			failure: /depend on registry verification/,
		},
	];
	for (const fixture of cases) {
		const root = await createPublicationContractFixture(t);
		await mutateTrackedFixture(root, fixture.path, fixture.mutate);
		assertFailure(
			{ failures: await auditPublicationContracts(root) },
			fixture.failure,
		);
	}
});

test("publication contract rejects tarball pipeline and approval-time SHA regressions", async (t) => {
	const cases = [
		{
			mutate: (contents) =>
				contents.replace(
					"publication.mjs prepare-artifacts",
					"publication.mjs preflight",
				),
			failure: /artifact preparation|prepare-artifacts/,
		},
		{
			mutate: (contents) =>
				contents.replace(
					" -- --publication-manifest .ci-artifacts/publication/publication-manifest.json",
					"",
				),
			failure: /consumer smoke must install the exact/,
		},
		{
			mutate: (contents) =>
				contents.replace(
					"git fetch --no-tags origin main",
					"git status --short",
				),
			failure: /current-main guard|missing blocking behavior/,
		},
		{
			mutate: (contents) =>
				contents.replace(
					"publication.mjs verify-artifacts",
					"publication.mjs preflight",
				),
			failure:
				/artifact verification|GitHub release is missing verified behavior/,
		},
		{
			mutate: (contents) =>
				contents.replace(
					"        id: remote-release-guard\n",
					"        id: removed-remote-release-guard\n",
				),
			failure: /remote tag\/Release compatibility|remote collision guard/,
		},
		{
			mutate: (contents) =>
				contents.replace(
					"publication.mjs publish-artifacts",
					"npm publish packages/core",
				),
			failure: /verified tarball publication|forbidden source/,
		},
		{
			mutate: (contents) =>
				contents.replace(
					"node scripts/release/publication.mjs publish-artifacts",
					"pnpm pack && node scripts/release/publication.mjs publish-artifacts",
				),
			failure: /forbidden source\/rebuild behavior pnpm pack/,
		},
	];
	for (const fixture of cases) {
		const root = await createPublicationContractFixture(t);
		await mutateTrackedFixture(
			root,
			".github/workflows/publish.yml",
			fixture.mutate,
		);
		assertFailure(
			{ failures: await auditPublicationContracts(root) },
			fixture.failure,
		);
	}
});

test("publication contract preserves the zero-dependency SHA guard", async (t) => {
	await t.test("guard file deletion", async (t) => {
		const root = await createPublicationContractFixture(t);
		await rm(join(root, "scripts/release/publication-sha-guard.mjs"));
		await git(
			root,
			"add",
			"--update",
			"--",
			"scripts/release/publication-sha-guard.mjs",
		);
		assertFailure(
			{ failures: await auditPublicationContracts(root) },
			/missing zero-dependency guard/,
		);
	});

	await t.test("workflow reverts to publication.mjs verify-sha", async (t) => {
		const root = await createPublicationContractFixture(t);
		await mutateTrackedFixture(
			root,
			".github/workflows/publish.yml",
			(contents) =>
				contents.replaceAll(
					"publication-sha-guard.mjs",
					"publication.mjs verify-sha",
				),
		);
		assertFailure(
			{ failures: await auditPublicationContracts(root) },
			/missing blocking behavior publication-sha-guard|guard must bind|current-main guard is missing/,
		);
	});

	await t.test(
		"dependency installation moves before the first guard",
		async (t) => {
			const root = await createPublicationContractFixture(t);
			await mutateTrackedFixture(
				root,
				".github/workflows/publish.yml",
				(contents) =>
					contents.replace(
						'          guard="$(node scripts/release/publication-sha-guard.mjs \\\n',
						'          pnpm install --frozen-lockfile\n          guard="$(node scripts/release/publication-sha-guard.mjs \\\n',
					),
			);
			assertFailure(
				{ failures: await auditPublicationContracts(root) },
				/dependency installation must remain after the zero-dependency SHA guard/,
			);
		},
	);

	await t.test("approval-time guard is removed", async (t) => {
		const root = await createPublicationContractFixture(t);
		await mutateTrackedFixture(
			root,
			".github/workflows/publish.yml",
			(contents) =>
				contents.replace(
					"        id: approval-sha-guard\n",
					"        id: removed-approval-sha-guard\n",
				),
		);
		assertFailure(
			{ failures: await auditPublicationContracts(root) },
			/must revalidate current main|approval-time zero-dependency SHA guard/,
		);
	});

	await t.test("guard imports a bare package", async (t) => {
		const root = await createPublicationContractFixture(t);
		await mutateTrackedFixture(
			root,
			"scripts/release/publication-sha-guard.mjs",
			(contents) => `${contents}\nimport semver from "semver";\n`,
		);
		assertFailure(
			{ failures: await auditPublicationContracts(root) },
			/must import only Node built-in modules; found semver|forbidden dependency behavior semver/,
		);
	});

	for (const [name, appendedSource] of [
		[
			"guard uses createRequire",
			'import { createRequire } from "node:module";\nconst loadPackage = createRequire(import.meta.url);\nloadPackage("third-party");',
		],
		[
			"guard uses a variable dynamic import",
			'const packageName = "third-party";\nawait import(packageName);',
		],
	]) {
		await t.test(name, async (t) => {
			const root = await createPublicationContractFixture(t);
			await mutateTrackedFixture(
				root,
				"scripts/release/publication-sha-guard.mjs",
				(contents) => `${contents}\n${appendedSource}\n`,
			);
			assertFailure(
				{ failures: await auditPublicationContracts(root) },
				/must not use runtime module loading/,
			);
		});
	}
});

test("publication contract rejects checksum, workspace, metadata, and recovery weakening", async (t) => {
	const cases = [
		[
			"verifyPublicationArtifacts",
			"verifyUncheckedArtifacts",
			/tarball-first safety behavior verifyPublicationArtifacts/,
		],
		[
			'createHash("sha256")',
			'createHash("md5")',
			/tarball-first safety behavior createHash/,
		],
		[
			"WORKSPACE_PROTOCOL_IN_TARBALL",
			"WORKSPACE_ALLOWED",
			/tarball-first safety behavior WORKSPACE_PROTOCOL/,
		],
		[
			"EXPECTED_REPOSITORY_URL",
			"UNVERIFIED_REPOSITORY_URL",
			/tarball-first safety behavior EXPECTED_REPOSITORY_URL/,
		],
		[
			"PUBLISHED_BYTES_MISMATCH",
			"PUBLISHED_BYTES_ALLOWED",
			/tarball-first safety behavior PUBLISHED_BYTES_MISMATCH/,
		],
		[
			"REGISTRY_UNAVAILABLE",
			"REGISTRY_ASSUMED_OK",
			/tarball-first safety behavior REGISTRY_UNAVAILABLE/,
		],
		[
			"PUBLICATION_TARBALL_CHANGED",
			"PUBLICATION_TARBALL_ASSUMED_STABLE",
			/tarball-first safety behavior PUBLICATION_TARBALL_CHANGED/,
		],
		[
			"PUBLICATION_WORKTREE_DIRTY",
			"PUBLICATION_WORKTREE_ASSUMED_CLEAN",
			/tarball-first safety behavior PUBLICATION_WORKTREE_DIRTY/,
		],
	];
	for (const [from, to, failure] of cases) {
		const root = await createPublicationContractFixture(t);
		await mutateTrackedFixture(
			root,
			"scripts/release/publication.mjs",
			(contents) => contents.replaceAll(from, to),
		);
		assertFailure({ failures: await auditPublicationContracts(root) }, failure);
	}
});

test("publication contract rejects bypasses, tokens, Changesets publishing, and loose toolchains", async (t) => {
	const workflowCases = [
		{
			mutate: (contents) =>
				contents.replace(
					"    environment: npm-production\n",
					`    environment: npm-production
    env:
      NPM_TOKEN: ${DOLLAR_SIGN}{{ secrets.NPM_TOKEN }}
`,
				),
			failure: /forbidden publication behavior NPM_TOKEN/,
		},
		{
			mutate: (contents) =>
				contents.replace(
					"        id: publish\n",
					"        id: publish\n        if: false\n",
				),
			failure:
				/forbidden publication behavior if: false|unconditional blocking/,
		},
		{
			mutate: (contents) =>
				contents.replace(
					"--npm-version 12.0.2",
					"--npm-version 12.0.2 || true",
				),
			failure: /forbidden publication behavior \|\| true/,
		},
		{
			mutate: (contents) =>
				contents.replace(
					"publication.mjs publish-artifacts",
					"pnpm exec changeset publish",
				),
			failure: /changeset publish/,
		},
	];
	for (const fixture of workflowCases) {
		const root = await createPublicationContractFixture(t);
		await mutateTrackedFixture(
			root,
			".github/workflows/publish.yml",
			fixture.mutate,
		);
		assertFailure(
			{ failures: await auditPublicationContracts(root) },
			fixture.failure,
		);
	}

	const packageRoot = await createPublicationContractFixture(t);
	await mutateTrackedFixture(packageRoot, "pnpm-workspace.yaml", (contents) =>
		contents.replace(
			"'@changesets/cli': '3.0.2'",
			"'@changesets/cli': '^3.0.2'",
		),
	);
	assertFailure(
		{ failures: await auditPublicationContracts(packageRoot) },
		/@changesets\/cli must remain exactly pinned/,
	);

	for (const forbidden of [
		'manifest.packageManager = "npm@12.0.2"',
		"await unlink(preStatePath)",
		"runChangesetsPublish()",
	]) {
		const root = await createPublicationContractFixture(t);
		await mutateTrackedFixture(
			root,
			"scripts/release/publication.mjs",
			(contents) => `${contents}\n// ${forbidden}\n`,
		);
		assertFailure(
			{ failures: await auditPublicationContracts(root) },
			/forbidden Changesets publication behavior/,
		);
	}
});

test("publication contract rejects Version Packages publication and unpinned Actions", async (t) => {
	const versionRoot = await createPublicationContractFixture(t);
	await mutateTrackedFixture(
		versionRoot,
		".github/workflows/version-packages.yml",
		(contents) =>
			`${contents}
  forbidden-publish:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm exec changeset publish
`,
	);
	assertFailure(
		{ failures: await auditPublicationContracts(versionRoot) },
		/version-packages\.yml contains forbidden publication behavior changeset publish/,
	);

	const versionActionRoot = await createPublicationContractFixture(t);
	await mutateTrackedFixture(
		versionActionRoot,
		".github/workflows/version-packages.yml",
		(contents) =>
			contents.replace(
				"changesets/action@ae32849d5ba541f9ae29e40e22a623bc13562f51 # v2.1.2",
				"changesets/action@v1",
			),
	);
	assertFailure(
		{ failures: await auditGitHubWorkflowContexts(versionActionRoot) },
		/third-party Action must use a full 40-character SHA: changesets\/action@v1/,
	);

	const actionRoot = await createPublicationContractFixture(t);
	await mutateTrackedFixture(
		actionRoot,
		".github/workflows/publish.yml",
		(contents) =>
			contents.replace(
				"actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
				"actions/checkout@v7",
			),
	);
	assertFailure(
		{ failures: await auditPublicationContracts(actionRoot) },
		/high-privilege Action must use a full commit SHA/,
	);

	for (const [from, to] of [
		["--prerelease", "--draft"],
		["--latest", "--notes-start-tag"],
		["--json tagName,isPrerelease", "--json tagName"],
		["isDraft", "draftState"],
		[".name == $title", ".name != $title"],
		[".body //", ".wrongBody //"],
		["/releases/latest", "/releases"],
	]) {
		const root = await createPublicationContractFixture(t);
		await mutateTrackedFixture(
			root,
			".github/workflows/publish.yml",
			(contents) => contents.replaceAll(from, to),
		);
		assertFailure(
			{ failures: await auditPublicationContracts(root) },
			/GitHub release is missing verified behavior/,
		);
	}
});

test("consumer generation Skill preserves trigger, workflow, approval, and evaluation contracts", async (t) => {
	const cases = [
		{
			path: ".agents/skills/openapi-to-generate/SKILL.md",
			mutate: (contents) => contents.replace("pure frontend", "visual-only"),
			failure: /description is missing trigger boundary pure frontend/,
		},
		{
			path: ".agents/skills/openapi-to-generate/SKILL.md",
			mutate: (contents) =>
				contents.replace("## Intent routing", "## Optional routing guidance"),
			failure: /missing root routing or safety marker ## Intent routing/,
		},
		{
			path: ".agents/skills/openapi-to-generate/SKILL.md",
			mutate: (contents) =>
				contents.replace(
					"references/mcp-workflow.md",
					"references/workflow.md",
				),
			failure:
				/missing root routing or safety marker references\/mcp-workflow\.md/,
		},
		{
			path: ".agents/skills/openapi-to-generate/references/mcp-workflow.md",
			mutate: (contents) =>
				contents.replace('"type": "operations"', '"type": "full"'),
			failure: /must contain an operation-scoped Dry Run JSON example/,
		},
		{
			path: ".agents/skills/openapi-to-generate/references/mcp-workflow.md",
			mutate: (contents) =>
				contents.replace(
					"Do not switch to a global binary",
					"Use any available binary",
				),
			failure:
				/missing bare-path discovery marker Do not switch to a global binary/,
		},
		{
			path: ".agents/skills/openapi-to-generate/references/controlled-write.md",
			mutate: (contents) =>
				contents.replace(
					"Do not chain Prepare and Apply automatically",
					"Automate Prepare followed by Apply",
				),
			failure:
				/missing routed semantic marker Do not chain Prepare and Apply automatically/,
		},
		{
			path: ".agents/skills/openapi-to-generate/references/mcp-workflow.md",
			mutate: (contents) =>
				contents.replace(
					"Tool name being present does not",
					"Tool names and counts prove",
				),
			failure:
				/missing bare-path discovery marker does not prove that its newer inputSchema capabilities are present/,
		},
		{
			path: ".agents/skills/openapi-to-generate/SKILL.md",
			mutate: (contents) =>
				contents.replace("standalone API-looking path shorthand", "path input"),
			failure:
				/description is missing trigger boundary standalone API-looking path shorthand/,
		},
		{
			path: ".agents/skills/openapi-to-generate/SKILL.md",
			mutate: (contents) =>
				contents.replace("API-looking bare path", "API path"),
			failure: /missing root routing or safety marker API-looking bare path/,
		},
		{
			path: ".agents/skills/openapi-to-generate/SKILL.md",
			mutate: (contents) =>
				contents.replace("full-target generation", "broad generation"),
			failure: /missing root routing or safety marker full-target generation/,
		},
		{
			path: ".agents/skills/openapi-to-generate/references/mcp-workflow.md",
			mutate: (contents) =>
				contents.replace('  "target": "<exact-target>",\n', ""),
			failure: /operation-scoped Dry Run JSON example 1 must pass exactly one/,
		},
		{
			path: ".agents/skills/openapi-to-generate/references/mcp-workflow.md",
			mutate: (contents) =>
				contents.replace(
					'    "strategy": "add"\n  },\n  "mode": "dry-run"\n',
					'    "strategy": "add"\n  }\n',
				),
			failure:
				/operation-scoped Dry Run JSON example 1 must set mode to "dry-run"/,
		},
		{
			path: ".agents/skills/openapi-to-generate/agents/openai.yaml",
			mutate: (contents) =>
				contents.replace(
					"Reference openapi-to and integrate API code",
					"Generate API clients for consumer projects",
				),
			failure: /short_description must equal/,
		},
		{
			path: ".agents/skills/openapi-to-generate/agents/openai.yaml",
			mutate: (contents) =>
				contents.replace(
					"Bare API paths are read-only discovery",
					"API requests may write",
				),
			failure: /default_prompt must equal/,
		},
		{
			path: ".agents/skills/openapi-to-generate/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					"trigger-consumer-plugin-reference",
					"removed-consumer-plugin-reference",
				),
			failure: /missing required case trigger-consumer-plugin-reference/,
		},
		{
			path: ".agents/skills/openapi-to-generate/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					"expected: report_bounded_explicit_cookie_header_transport",
					"expected: claim_no_cookie_transport",
				),
			failure:
				/case reference-ts-request-cookie-transport must be trigger with expected report_bounded_explicit_cookie_header_transport/,
		},
		{
			path: ".agents/skills/openapi-to-generate/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					'id: trigger-consumer-plugin-reference\n    category: trigger\n    prompt: "pluginZod 的 oneOf 怎么处理？"\n    expected: activate_reference_only',
					'id: trigger-consumer-plugin-reference\n    category: trigger\n    prompt: "pluginZod 的 oneOf 怎么处理？"\n    expected: handoff_openapi_to_setup',
				),
			failure:
				/case trigger-consumer-plugin-reference must have category trigger/,
		},
		{
			path: ".agents/skills/openapi-to-generate/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					"trigger-existing-generated-output-integration",
					"removed-generated-output-integration",
				),
			failure:
				/missing required case trigger-existing-generated-output-integration/,
		},
		{
			path: ".agents/skills/openapi-to-generate/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					'id: reject-consumer-bootstrap\n    category: reject\n    prompt: "帮我安装并配置 openapi-to 到这个项目"\n    expected: handoff_openapi_to_setup',
					'id: reject-consumer-bootstrap\n    category: reject\n    prompt: "帮我安装并配置 openapi-to 到这个项目"\n    expected: activate_reference_only',
				),
			failure: /case reject-consumer-bootstrap must have category reject/,
		},
		{
			path: ".agents/skills/openapi-to-generate/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace("kind: static_skill_evaluation_inputs\n", ""),
			failure: /must contain schema_version 1, static kind, and a cases array/,
		},
		{
			path: ".agents/skills/openapi-to-generate/references/evaluation-matrix.yaml",
			mutate: (contents) => {
				let replacements =
					(contents.match(/category: degraded/g) ?? []).length - 3;
				return contents.replaceAll("category: degraded", (category) => {
					if (replacements === 0) return category;
					replacements -= 1;
					return "category: reject";
				});
			},
			failure: /requires at least 4 degraded cases, found 3/,
		},
		{
			path: ".agents/skills/openapi-to-generate/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					"degraded-schema-not-visible",
					"degraded-schema-hidden",
				),
			failure: /missing required case degraded-schema-not-visible/,
		},
		{
			path: ".agents/skills/openapi-to-generate/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					"degraded-apply-token-expired",
					"degraded-apply-token-old",
				),
			failure: /missing required case degraded-apply-token-expired/,
		},
		{
			path: ".agents/skills/openapi-to-generate/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					"degraded-setup-any-other-state",
					"degraded-setup-analysis-only",
				),
			failure: /missing required case degraded-setup-any-other-state/,
		},
		{
			path: ".agents/skills/openapi-to-generate/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace("id: trigger-bare-api-path", "id: trigger-bare-path"),
			failure: /missing required case trigger-bare-api-path/,
		},
		{
			path: ".agents/skills/openapi-to-generate/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					"id: trigger-bare-api-path\n    category: trigger",
					"id: trigger-bare-api-path\n    category: degraded",
				),
			failure:
				/case trigger-bare-api-path must have category trigger, prompt "\/pet\/findByStatus", and expected activate_read_only_operation_discovery/,
		},
		{
			path: ".agents/skills/openapi-to-generate/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					'id: trigger-method-api-path\n    category: trigger\n    prompt: "GET /pet/findByStatus"\n    expected: activate_read_only_operation_discovery',
					'id: trigger-method-api-path\n    category: trigger\n    prompt: "GET /pet/findByStatus"\n    expected: activate_generate_workflow',
				),
			failure:
				/case trigger-method-api-path must have category trigger, prompt "GET \/pet\/findByStatus", and expected activate_read_only_operation_discovery/,
		},
		{
			path: ".agents/skills/openapi-to-generate/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					'id: degraded-frontend-route-no-match\n    category: degraded\n    prompt: "/dashboard/settings"',
					'id: degraded-frontend-route-no-match\n    category: degraded\n    prompt: "/dashboard/preferences"',
				),
			failure:
				/case degraded-frontend-route-no-match must have category degraded, prompt "\/dashboard\/settings", and expected do_not_invent_operation_and_fail_closed/,
		},
	];
	for (const contractCase of cases) {
		const root = await createContractFixture(t);
		await mutateTrackedFixture(root, contractCase.path, contractCase.mutate);
		assertFailure(
			await auditAgentAndSkillContracts(root),
			contractCase.failure,
		);
	}

	for (const id of [
		"first-discovery-mcp-authority",
		"first-discovery-target-then-search",
		"first-discovery-bounded-contract",
		"degraded-broad-openapi-first",
		"completion-bounded-evidence",
		"completion-truncated-evidence",
		"preview-generator-provenance",
		"preview-agent-example",
		"degraded-include-preview-schema-missing",
		"composite-first-attempt-generate",
		"reference-ts-request-cookie-transport",
		"trigger-consumer-plugin-exact-option",
		"reject-runtime-three-tools",
		"degraded-ambiguous-config-intent",
	]) {
		const root = await createContractFixture(t);
		await mutateTrackedFixture(
			root,
			".agents/skills/openapi-to-generate/references/evaluation-matrix.yaml",
			(contents) => contents.replace(id, `${id}-removed`),
		);
		assertFailure(
			await auditAgentAndSkillContracts(root),
			new RegExp(`missing required case ${id}`),
		);
	}

	for (const relativePath of [
		".agents/skills/openapi-to-generate/SKILL.md",
		"docs/skills.md",
	]) {
		const root = await createContractFixture(t);
		await mutateTrackedFixture(
			root,
			relativePath,
			(contents) => `${contents}\nLegacy: \`.OpenAPI/openapi.config.ts\`.\n`,
		);
		assertFailure(
			await auditAgentAndSkillContracts(root),
			/must not use legacy config path \.OpenAPI\/openapi\.config\.ts/,
		);
	}

	const missingReferenceRoot = await createContractFixture(t);
	await mutateTrackedFixture(
		missingReferenceRoot,
		".agents/skills/openapi-to-generate/SKILL.md",
		(contents) =>
			contents.replace(
				"references/mcp-workflow.md",
				"references/missing-workflow.md",
			),
	);
	assertFailure(
		await auditAgentAndSkillContracts(missingReferenceRoot),
		/references missing path references\/missing-workflow\.md/,
	);

	const missingDistributionFileRoot = await createContractFixture(t);
	await git(
		missingDistributionFileRoot,
		"rm",
		"--cached",
		"--",
		".agents/skills/openapi-to-generate/references/controlled-write.md",
	);
	assertFailure(
		await auditAgentAndSkillContracts(missingDistributionFileRoot),
		/consumer Skill file is not tracked by Git: .*controlled-write\.md/,
	);

	const openHandoffDocumentRoot = await createContractFixture(t);
	await mutateTrackedFixture(
		openHandoffDocumentRoot,
		"docs/skills.md",
		(contents) =>
			contents.replace(
				"No Generate handoff; finish or repair setup first.",
				"Generate may start after manual judgment.",
			),
	);
	assertFailure(
		await auditAgentAndSkillContracts(openHandoffDocumentRoot),
		/must allow only verified Developer, Read-only, and Hardened states, then deny any other state/,
	);
});

test("consumer setup Skill preserves routing, safety, files, and evaluation contracts", async (t) => {
	const cases = [
		{
			path: ".agents/skills/openapi-to-setup/SKILL.md",
			mutate: (contents) =>
				contents.replace("actual Tool list", "reported Tool count"),
			failure: /missing root routing or safety marker fresh actual Tool list/,
		},
		{
			path: ".agents/skills/openapi-to-setup/SKILL.md",
			mutate: (contents) =>
				contents.replace(
					"唯一 deterministic writer",
					"preferred deterministic writer",
				),
			failure:
				/missing root routing or safety marker 唯一 deterministic writer/,
		},
		{
			path: ".agents/skills/openapi-to-setup/SKILL.md",
			mutate: (contents) =>
				contents.replace(
					"不要进入\n  Skill Setup Plan 写入路径。",
					"进入 Skill Setup Plan 写入路径。",
				),
			failure:
				/missing root routing or safety marker 不要进入 Skill Setup Plan 写入路径/,
		},
		{
			path: ".agents/skills/openapi-to-setup/SKILL.md",
			mutate: (contents) =>
				contents.replace(
					"Inspector 必须先于任何 Skill-mediated Setup Plan",
					"Setup Plan may precede Inspector",
				),
			failure:
				/first-plan gate is missing or out of order marker Inspector 必须先于/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/safe-writes.md",
			mutate: (contents) =>
				contents.replaceAll(
					"node scripts/hash-setup-plan.mjs",
					"manual hashing",
				),
			failure:
				/missing routed semantic marker node scripts\/hash-setup-plan\.mjs/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/safe-writes.md",
			mutate: (contents) =>
				contents.replace("Never use global install", "Use global install"),
			failure: /missing routed semantic marker Never use global install/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/safe-writes.md",
			mutate: (contents) =>
				contents.replace(
					"Re-plan, re-hash to a new `setupPlanId`",
					"reuse the old plan",
				),
			failure: /missing routed semantic marker Re-plan, re-hash to a new/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/diagnosis.md",
			mutate: (contents) =>
				contents.replaceAll("`PACKAGE_JSON_MISSING`", "`PACKAGE_MISSING`"),
			failure: /missing routed semantic marker PACKAGE_JSON_MISSING/,
		},
		{
			path: ".agents/skills/openapi-to-setup/SKILL.md",
			mutate: (contents) =>
				contents.replaceAll("UNKNOWN / UNVERIFIED", "MCP_ANALYSIS_ONLY"),
			failure: /missing root routing or safety marker UNKNOWN \/ UNVERIFIED/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/diagnosis.md",
			mutate: (contents) =>
				contents.replace("Multiple actual lockfiles", "Multiple manager types"),
			failure: /missing setup state-binding marker Multiple actual lockfiles/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/safe-writes.md",
			mutate: (contents) =>
				contents.replace(
					"this reference is not an alternate bootstrap path.",
					"This is a general bootstrap path.",
				),
			failure:
				/is missing routed semantic marker this reference is not an alternate bootstrap path/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/safe-writes.md",
			mutate: (contents) =>
				contents.replaceAll("new `setupPlanId`", "existing `setupPlanId`"),
			failure: /missing routed semantic marker Re-plan, re-hash to a new/,
			alsoFailure: /missing setup state-binding marker new `setupPlanId`/,
		},
		{
			path: ".agents/skills/openapi-to-setup/scripts/secure-file-read.mjs",
			mutate: (contents) => contents.replace(": readOnlyFlag;", ": undefined;"),
			failure: /missing portable safety marker : readOnlyFlag;/,
		},
		{
			path: ".agents/skills/openapi-to-setup/scripts/secure-file-read.mjs",
			mutate: (contents) => `${contents}\n// --unsafe-no-follow\n`,
			failure: /exposes forbidden safety override --unsafe-no-follow/,
		},
		{
			path: ".agents/skills/openapi-to-setup/agents/openai.yaml",
			mutate: (contents) =>
				contents.replace(
					"Install and diagnose openapi-to setup and Codex MCP runtime",
					"Configure openapi-to",
				),
			failure: /short_description must equal/,
		},
		{
			path: ".agents/skills/openapi-to-setup/agents/openai.yaml",
			mutate: (contents) =>
				contents.replace("runtime diagnosis only", "all consumer questions"),
			failure: /default_prompt must equal/,
		},
		{
			path: ".agents/skills/openapi-to-setup/agents/openai.yaml",
			mutate: (contents) =>
				contents.replace(
					"Route ordinary first Codex project bootstrap directly to the published CLI command `openapi setup --host codex --scope project`; do not use a Skill Setup Plan for it.",
					"Start with the Inspector and use a Setup Plan for bootstrap.",
				),
			failure: /default_prompt must equal/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					"degraded-count-schema-mismatch",
					"degraded-count-only",
				),
			failure: /missing required case degraded-count-schema-mismatch/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					"expected: state_runtime_unknown_and_report_config_separately_without_causal_guess",
					"expected: activate_diagnosis",
				),
			failure:
				/case trigger-three-tools must be trigger with expected state_runtime_unknown_and_report_config_separately_without_causal_guess/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/diagnosis.md",
			mutate: (contents) =>
				contents.replace(
					"never claim that the current MCP exposes three Tools",
					"",
				),
			failure:
				/missing routed semantic marker never claim that the current MCP exposes three Tools/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/diagnosis.md",
			mutate: (contents) =>
				contents.replace("user-reported Tool count is a symptom", ""),
			failure:
				/missing routed semantic marker user-reported Tool count is a symptom/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					"degraded-config-state-without-runtime-tool-evidence",
					"removed-config-runtime-evidence-case",
				),
			failure:
				/missing required case degraded-config-state-without-runtime-tool-evidence/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					"expected: do_not_infer_runtime_capability_from_config_state",
					"expected: infer_analysis_only_from_config_missing",
				),
			failure:
				/case degraded-config-state-without-runtime-tool-evidence must be degraded with expected do_not_infer_runtime_capability_from_config_state/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					"degraded-package-json-missing",
					"degraded-manifest-absent",
				),
			failure: /missing required case degraded-package-json-missing/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					"degraded-windows-no-nofollow",
					"degraded-windows-portable-read",
				),
			failure: /missing required case degraded-windows-no-nofollow/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					"degraded-handoff-any-other-state",
					"degraded-handoff-analysis-only",
				),
			failure: /missing required case degraded-handoff-any-other-state/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					"expected: block_package_manager_conflict",
					"expected: infer_package_manager",
				),
			failure:
				/case degraded-multiple-same-manager-lockfiles must be degraded with expected block_package_manager_conflict/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					"id: degraded-lockfile-too-large\n    category: degraded",
					"id: degraded-lockfile-too-large\n    category: trigger",
				),
			failure:
				/case degraded-lockfile-too-large must be degraded with expected fail_closed_without_reading_contents/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					"composite-first-plan-safety",
					"composite-first-plan-missing",
				),
			failure: /missing required case composite-first-plan-safety/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace("reject-plugin-reference", "removed-plugin-reference"),
			failure: /missing required case reject-plugin-reference/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					'id: reject-existing-generated-integration\n    category: reject\n    prompt: "已经生成 deleteUser，帮我接到当前页面"\n    expected: handoff_openapi_to_generate_integration',
					'id: reject-existing-generated-integration\n    category: reject\n    prompt: "已经生成 deleteUser，帮我接到当前页面"\n    expected: activate_setup_plan',
				),
			failure:
				/case reject-existing-generated-integration must have category reject/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/evaluation-matrix.yaml",
			mutate: (contents) =>
				contents.replace(
					"degraded-ambiguous-config-intent",
					"removed-ambiguous-config-intent",
				),
			failure: /missing required case degraded-ambiguous-config-intent/,
		},
	];
	for (const contractCase of cases) {
		const root = await createContractFixture(t);
		await mutateTrackedFixture(root, contractCase.path, contractCase.mutate);
		const result = await auditAgentAndSkillContracts(root);
		assertFailure(result, contractCase.failure);
		if (contractCase.alsoFailure)
			assertFailure(result, contractCase.alsoFailure);
	}

	const missingScriptRoot = await createContractFixture(t);
	await git(
		missingScriptRoot,
		"rm",
		"--cached",
		"--",
		".agents/skills/openapi-to-setup/scripts/inspect-project.mjs",
	);
	assertFailure(
		await auditAgentAndSkillContracts(missingScriptRoot),
		/setup Skill file is not tracked by Git: .*inspect-project\.mjs/,
	);

	const missingHelperRoot = await createContractFixture(t);
	await git(
		missingHelperRoot,
		"rm",
		"--cached",
		"--",
		".agents/skills/openapi-to-setup/scripts/secure-file-read.mjs",
	);
	assertFailure(
		await auditAgentAndSkillContracts(missingHelperRoot),
		/setup Skill file is not tracked by Git: .*secure-file-read\.mjs/,
	);
});

test("workspace parser accepts only quoted package entries", () => {
	assert.deepEqual(
		parseWorkspacePatterns(`packages:
  - 'packages/*'
  - "e2e/*"
`),
		["packages/*", "e2e/*"],
	);
	assert.deepEqual(
		parseWorkspacePatterns(`packages:
  - 'packages/*'
  - "e2e/*"

allowBuilds:
  esbuild: false

minimumReleaseAgeExclude:
  - '@biomejs/biome@2.5.13'
`),
		["packages/*", "e2e/*"],
	);
});

test("Skill metadata parsers enforce the documented repository subset", () => {
	assert.deepEqual(
		parseSkillFrontmatter(`---
name: fix-example
description: Use when a sufficiently specific example workflow needs focused validation and repair without unrelated changes.
---

# Fix example
`),
		{
			name: "fix-example",
			description:
				"Use when a sufficiently specific example workflow needs focused validation and repair without unrelated changes.",
		},
	);
	assert.deepEqual(
		parseOpenAiSkillYaml(`interface:
  display_name: "Fix Example"
  short_description: "Diagnose and repair one example workflow"
  default_prompt: "Use $fix-example to repair the example."
  icon_small: "./assets/icon-small.svg"
  icon_large: "./assets/icon-large.png"
  brand_color: "#A1B2C3"
dependencies:
  tools:
    - type: "mcp"
      value: "example"
      description: "Example MCP server"
      transport: "stdio"
`),
		{
			display_name: "Fix Example",
			short_description: "Diagnose and repair one example workflow",
			default_prompt: "Use $fix-example to repair the example.",
			icon_small: "./assets/icon-small.svg",
			icon_large: "./assets/icon-large.png",
			brand_color: "#A1B2C3",
			dependencies: {
				tools: [
					{
						type: "mcp",
						value: "example",
						description: "Example MCP server",
						transport: "stdio",
					},
				],
			},
		},
	);
	assert.throws(
		() =>
			parseSkillFrontmatter(`---
name: fix-example
description: Duplicate keys are invalid.
name: other
---
`),
		/duplicate frontmatter key/,
	);
	assert.throws(
		() =>
			parseOpenAiSkillYaml(`interface:
  display_name: Fix Example
`),
		/values must be double-quoted/,
	);
	assert.throws(
		() =>
			parseOpenAiSkillYaml(`interface:
  display_name: "Fix Example"
  display_name: "Duplicate"
  short_description: "Diagnose and repair one example workflow"
  default_prompt: "Use $fix-example to repair the example."
`),
		/duplicate agents\/openai\.yaml key/,
	);
	assert.throws(
		() =>
			parseOpenAiSkillYaml(`interface:
  display_name: "Fix Example"
  short_description: "Diagnose and repair one example workflow"
  default_prompt: "Use $fix-example to repair the example."
  future_field: "ignored"
`),
		/unsupported agents\/openai\.yaml interface field future_field; supported fields:/,
	);
});

test("Git-tracked AGENTS are discovered dynamically, sorted, and separated from untracked files", async (t) => {
	const root = await createContractFixture(t);
	await writeFixtureFile(root, "packages/zeta/AGENTS.md", "# zeta\n");
	await writeFixtureFile(root, "packages/alpha/AGENTS.md", "# alpha\n");
	await git(
		root,
		"add",
		"--",
		"packages/zeta/AGENTS.md",
		"packages/alpha/AGENTS.md",
	);
	await writeFixtureFile(root, "packages/local/AGENTS.md", "# untracked\n");

	const discovered = await discoverAgentDocuments(root);
	assert.deepEqual(discovered, [...discovered].sort());
	assert.ok(discovered.includes("packages/alpha/AGENTS.md"));
	assert.ok(discovered.includes("packages/zeta/AGENTS.md"));
	assert.ok(!discovered.includes("packages/local/AGENTS.md"));

	const result = await auditAgentAndSkillContracts(root);
	assert.deepEqual(result.failures, []);
	assert.deepEqual(result.agents, discovered);
});

test("required AGENTS remain mandatory even when Git discovery is dynamic", async (t) => {
	const root = await createContractFixture(t);
	await rm(join(root, "packages/core/AGENTS.md"));
	const result = await auditAgentAndSkillContracts(root);
	assertFailure(
		result,
		/missing tracked Agent instruction packages\/core\/AGENTS\.md/,
	);
});

test("repository references reject escapes, malformed URI encodings, and untracked files", async (t) => {
	const root = await createContractFixture(t);
	await writeFixtureFile(root, "docs/untracked.md", "# local only\n");
	await writeFixtureFile(
		root,
		"AGENTS.md",
		`# references

[escape](../../outside.md)
[malformed](docs/%ZZ.md)
[untracked](docs/untracked.md)
[windows](C:\\outside.md)
[unc](//server/share.md)
`,
	);
	await git(root, "add", "--", "AGENTS.md");

	const result = await auditAgentAndSkillContracts(root);
	assertFailure(
		result,
		/reference escapes repository boundary: \.\.\/\.\.\/outside\.md/,
	);
	assertFailure(
		result,
		/malformed percent encoding in reference docs\/%ZZ\.md/,
	);
	assertFailure(
		result,
		/references path not tracked by Git: docs\/untracked\.md/,
	);
	assertFailure(
		result,
		/reference escapes repository boundary: C:\\outside\.md/,
	);
	assertFailure(
		result,
		/reference escapes repository boundary: \/\/server\/share\.md/,
	);
});

test("repository references reject symlinks that leave the repository", async (t) => {
	const root = await createContractFixture(t);
	const outside = join(dirname(root), `${basename(root)}-outside.md`);
	t.after(async () => {
		await rm(outside, { force: true });
	});
	await writeFile(outside, "# outside\n");
	await mkdir(join(root, "docs"), { recursive: true });
	try {
		await symlink(outside, join(root, "docs/escape.md"));
	} catch (error) {
		if (error.code === "EPERM") {
			t.skip("symlink creation is not permitted on this platform");
			return;
		}
		throw error;
	}
	await writeFixtureFile(root, "AGENTS.md", "[escape](docs/escape.md)\n");
	await git(root, "add", "--", "AGENTS.md", "docs/escape.md");

	const result = await auditAgentAndSkillContracts(root);
	assertFailure(
		result,
		/reference must not traverse a symlink: docs\/escape\.md/,
	);
});

test("legal relative links, anchors, and tracked glob prefixes pass while missing prefixes fail", async (t) => {
	const root = await createContractFixture(t);
	await writeFixtureFile(root, "docs/valid.md", "# valid\n");
	await writeFixtureFile(
		root,
		"AGENTS.md",
		`${await readFile(join(root, "AGENTS.md"), "utf8")}

# references

[valid](docs/valid.md#heading)
[anchor](#heading)

\`packages/example-*\`
`,
	);
	await git(root, "add", "--", "AGENTS.md", "docs/valid.md");
	let result = await auditAgentAndSkillContracts(root);
	assert.deepEqual(result.failures, []);

	await writeFixtureFile(
		root,
		"AGENTS.md",
		`${await readFile(join(root, "AGENTS.md"), "utf8")}\n\`docs/missing/*\`\n`,
	);
	await git(root, "add", "--", "AGENTS.md");
	result = await auditAgentAndSkillContracts(root);
	assertFailure(result, /references missing path docs\/missing\/\*/);
});

test("Skill entrypoints, names, duplicate names, and interfaces fail with specific diagnostics", async (t) => {
	const missingInterfaceRoot = await createContractFixture(t);
	await rm(
		join(
			missingInterfaceRoot,
			".agents/skills/add-cli-command/agents/openai.yaml",
		),
	);
	let result = await auditAgentAndSkillContracts(missingInterfaceRoot);
	assertFailure(
		result,
		/missing tracked Skill interface .*add-cli-command\/agents\/openai\.yaml/,
	);

	const mismatchRoot = await createContractFixture(t);
	await writeFixtureFile(
		mismatchRoot,
		".agents/skills/add-cli-command/SKILL.md",
		skillContents("other"),
	);
	await git(
		mismatchRoot,
		"add",
		"--",
		".agents/skills/add-cli-command/SKILL.md",
	);
	result = await auditAgentAndSkillContracts(mismatchRoot);
	assertFailure(result, /name other must match directory add-cli-command/);

	const duplicateRoot = await createContractFixture(t);
	await writeFixtureFile(
		duplicateRoot,
		".agents/skills/other/SKILL.md",
		skillContents("add-cli-command"),
	);
	await writeFixtureFile(
		duplicateRoot,
		".agents/skills/other/agents/openai.yaml",
		skillInterface("other"),
	);
	await git(duplicateRoot, "add", "--", ".agents/skills/other");
	result = await auditAgentAndSkillContracts(duplicateRoot);
	assertFailure(result, /duplicate Skill name add-cli-command/);
});

test("Skill commands and repository references must resolve to tracked contract inputs", async (t) => {
	const root = await createContractFixture(t);
	await writeFixtureFile(root, "references/local.md", "# untracked\n");
	await writeFixtureFile(root, "scripts/local.mjs", "export {};\n");
	await writeFixtureFile(
		root,
		".agents/skills/add-cli-command/SKILL.md",
		skillContents(
			"add-cli-command",
			`[local reference](../../../references/local.md)

\`scripts/local.mjs\`

\`\`\`sh
pnpm missing-script
\`\`\`
`,
		),
	);
	await git(root, "add", "--", ".agents/skills/add-cli-command/SKILL.md");

	const result = await auditAgentAndSkillContracts(root);
	assertFailure(result, /names missing root script missing-script/);
	assertFailure(
		result,
		/references path not tracked by Git: \.\.\/\.\.\/\.\.\/references\/local\.md/,
	);
	assertFailure(
		result,
		/references path not tracked by Git: scripts\/local\.mjs/,
	);
});

test("Git-tracked SKILL.md mirrors outside the authoritative root fail", async (t) => {
	const root = await createContractFixture(t);
	await writeFixtureFile(root, "vendor/SKILL.md", skillContents("vendor"));
	await git(root, "add", "--", "vendor/SKILL.md");
	const result = await auditAgentAndSkillContracts(root);
	assertFailure(
		result,
		/tracked Skill mirror outside \.agents\/skills: vendor\/SKILL\.md/,
	);
});

test("Git discovery failures are reported without a filesystem-scan fallback", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-no-git-"));
	t.after(async () => {
		await rm(root, { recursive: true, force: true });
	});
	await writeFixtureFile(
		root,
		"package.json",
		'{"name":"not-a-repository","private":true}\n',
	);
	const result = await auditAgentAndSkillContracts(root);
	assertFailure(
		result,
		/unable to discover Git-tracked Agent and Skill files:/,
	);
	assert.deepEqual(result.agents, []);
	assert.deepEqual(result.skills, []);
});
