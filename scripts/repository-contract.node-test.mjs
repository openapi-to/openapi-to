import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
	mkdir,
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
	auditAgentAndSkillContracts,
	auditAutonomousMaintenanceContracts,
	auditCiDiagnosticsContracts,
	auditCiFoundationContracts,
	auditCodexSkillInstallerContracts,
	auditConsumerAcceptanceContracts,
	auditGitHubWorkflowContexts,
	auditMergeQueueContracts,
	auditNodeRuntimeContracts,
	auditParallelDevelopmentContracts,
	auditPublicationContracts,
	auditRepositoryContracts,
	auditVersionPackagesContracts,
	auditVersionReadinessContracts,
	discoverAgentDocuments,
	EXPECTED_SKILL_ROLES,
	parseOpenAiSkillYaml,
	parseSkillFrontmatter,
	parseSkillRoutingTable,
	parseWorkspacePatterns,
	REQUIRED_AGENT_DOCUMENTS,
	REQUIRED_SKILLS,
	repositoryRoot,
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

function implementationSkillContents() {
	return readFile(
		join(repositoryRoot, ".agents/skills/implement-and-review/SKILL.md"),
		"utf8",
	);
}

function independentReviewSkillContents() {
	return readFile(
		join(
			repositoryRoot,
			".agents/skills/independent-p0-p1-review/SKILL.md",
		),
		"utf8",
	);
}

function consumerSkillFile(relativePath) {
	return readFile(
		join(repositoryRoot, ".agents/skills/openapi-to-generate", relativePath),
		"utf8",
	);
}

function setupSkillFile(relativePath) {
	return readFile(
		join(repositoryRoot, ".agents/skills/openapi-to-setup", relativePath),
		"utf8",
	);
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

function roleLabel(role) {
	return {
		"general-primary": "Primary",
		"review-gate": "Review gate",
		"specialized-primary": "Specialized primary",
		"domain-support": "Support",
		"validation-helper": "Validation helper",
	}[role];
}

function routingRow(name, role, task = `${name} task`) {
	return `| ${task} | ${roleLabel(role)}: \`.agents/skills/${name}/SKILL.md\` |`;
}

function rootAgentContents() {
	const routes = [...EXPECTED_SKILL_ROLES].map(([name, role]) =>
		routingRow(name, role),
	);
	return `# AGENTS

## Skill routing

| Task | Primary or supporting Skill |
| --- | --- |
${routes.join("\n")}

## Independent review gate

Every non-trivial behavior-changing write task must run an independent P0/P1
review after implementation, focused validation, and the primary agent's
complete task-diff review. Use
\`.agents/skills/independent-p0-p1-review/SKILL.md\` in a fresh read-only
sub-agent context before reporting \`READY\`. The reviewer must not modify,
create, delete, format, stage, or commit files; the primary agent remains the
sole writer and independently validates every finding.

Pure documentation, comments, formatting, or behavior-neutral work may skip
with a recorded reason. After a material fix, the primary agent must use a new
reviewer context. Unresolved P0/P1 or a materially incomplete independent
review scope block \`READY\`.

## Definition of done

### All tasks

- Re-read the request and report external operations.

### Read-only tasks

- Do not modify files.
- Finding a P1 does not grant automatic repair authorization.

### Write tasks

- A clean worktree preserves pre-existing changes or uses an isolated worktree.
- A combined diff must not claim agent ownership.
- Record the task base with \`git rev-parse HEAD\`.
- Review the task-base-to-current tree and task-base-to-HEAD diff.
- Run \`git ls-files --others --exclude-standard\` and read each task-created untracked text file in full.
`;
}

function architectureContents() {
	const roles = [...EXPECTED_SKILL_ROLES].map(
		([name, role]) => `| \`${name}\` | ${role} |`,
	);
	return `# Architecture

## Contract-verified Skill roles

Tracked Skill count: \`${EXPECTED_SKILL_ROLES.size}\`.

| Skill | Contract role |
| --- | --- |
${roles.join("\n")}

### Independent review gate

\`independent-p0-p1-review\` is a read-only gate in a fresh sub-agent context.
It never repairs, stages, commits, or performs remote writes.

## \`implement-and-review\` lifecycle

after the first or second automatic repair round, use a new reviewer
at most three automatic finding-confirm-repair rounds
after a material third repair, run exactly one terminal read-only reviewer

Reviews without a confirmed file-changing repair do not consume the three-round
budget. exactly one additional terminal reviewer uses a fresh context to inspect
the complete task-base-to-current-state diff. It is strictly read-only, is
outside the automatic repair budget, and cannot trigger another automatic
repair. Only \`VERDICT: READY\` together with \`No P0/P1 findings.\` passes.
A finding stops the task as \`NOT READY\`. The primary agent cannot rename
rounds, reset counters, or start a second terminal reviewer.

## Real-task Pilot PR gate

Draft PR
local validation complete
autonomous primary diff review complete
independent read-only P0/P1 review complete
repair P0/P1
push the latest commit
Ready for review
wait for remote required checks
human review of the PR diff
user decides whether to merge

Local \`PASS\` is not remote CI \`PASS\`.
\`Draft\` status is not completed remote acceptance.
\`REMOTE CI UNVERIFIED\`
Only the user may decide whether to merge.
`;
}

async function createContractFixture(t) {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-contract-"));
	t.after(async () => {
		await rm(root, { recursive: true, force: true });
	});
	await git(root, "init", "--quiet");
	await writeFixtureFile(
		root,
		"package.json",
		`${JSON.stringify(
			{
				name: "contract-fixture",
				private: true,
				scripts: { known: "node scripts/known.mjs" },
			},
			null,
			2,
		)}\n`,
	);
	for (const document of REQUIRED_AGENT_DOCUMENTS)
		await writeFixtureFile(root, document, `# ${document}\n`);
	for (const skillName of EXPECTED_SKILL_ROLES.keys()) {
		await writeFixtureFile(
			root,
			`.agents/skills/${skillName}/SKILL.md`,
			skillName === "implement-and-review"
				? await implementationSkillContents()
				: skillName === "independent-p0-p1-review"
					? await independentReviewSkillContents()
				: skillName === "openapi-to-generate"
					? await consumerSkillFile("SKILL.md")
					: skillName === "openapi-to-setup"
						? await setupSkillFile("SKILL.md")
				: skillName === "release-monorepo"
					? releaseSkillContents()
					: skillContents(skillName),
		);
		await writeFixtureFile(
			root,
			`.agents/skills/${skillName}/agents/openai.yaml`,
			skillName === "openapi-to-generate"
				? await consumerSkillFile("agents/openai.yaml")
				: skillName === "openapi-to-setup"
					? await setupSkillFile("agents/openai.yaml")
				: skillInterface(skillName),
		);
	}
	for (const relativePath of [
		"references/mcp-workflow.md",
		"references/controlled-write.md",
		"references/evaluation-matrix.yaml",
	]) {
		await writeFixtureFile(
			root,
			`.agents/skills/openapi-to-generate/${relativePath}`,
			await consumerSkillFile(relativePath),
		);
	}
	for (const relativePath of [
		"references/diagnosis.md",
		"references/codex-setup.md",
		"references/safe-writes.md",
		"references/evaluation-matrix.yaml",
		"scripts/inspect-project.mjs",
		"scripts/secure-file-read.mjs",
		"scripts/hash-setup-plan.mjs",
	]) {
		await writeFixtureFile(
			root,
			`.agents/skills/openapi-to-setup/${relativePath}`,
			await setupSkillFile(relativePath),
		);
	}
	await writeFixtureFile(root, "AGENTS.md", rootAgentContents());
	await writeFixtureFile(
		root,
		"docs/agents/agents-and-skills-architecture.md",
		architectureContents(),
	);
	await writeFixtureFile(
		root,
		"docs/skills.md",
		await readFile(join(repositoryRoot, "docs/skills.md"), "utf8"),
	);
	await writeFixtureFile(
		root,
		"docs/setup-skill.md",
		await readFile(join(repositoryRoot, "docs/setup-skill.md"), "utf8"),
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
		"scripts/ci-diagnostics/schema.mjs",
		"scripts/ci-diagnostics/sanitize.mjs",
		"scripts/ci-diagnostics/filesystem.mjs",
		"scripts/ci-diagnostics/plans.mjs",
		"scripts/ci-diagnostics/initialize.mjs",
		"scripts/ci-diagnostics/run-command.mjs",
		"scripts/ci-diagnostics/finalize-job.mjs",
		"scripts/ci-diagnostics/ci-diagnostics.node-test.mjs",
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

async function createAutonomousMaintenanceContractFixture(t) {
	const root = await mkdtemp(
		join(tmpdir(), "openapi-to-autonomous-maintenance-contract-"),
	);
	t.after(() => rm(root, { recursive: true, force: true }));
	await git(root, "init", "--quiet");
	for (const relativePath of [
		"AGENTS.md",
		".github/ISSUE_TEMPLATE/development-task.yml",
		".github/pull_request_template.md",
		"docs/maintainers/autonomous-maintenance.md",
		"docs/maintainers/parallel-development.md",
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
	assert.ok(result.skills.includes("implement-and-review"));
	assert.ok(result.skills.includes("openapi-to-generate"));
	assert.ok(result.skills.includes("openapi-to-setup"));
	assert.deepEqual(REQUIRED_SKILLS, [
		"implement-and-review",
		"independent-p0-p1-review",
		"openapi-to-generate",
		"openapi-to-setup",
	]);
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
					contents.replace(
						"  workflow_dispatch:\n",
						dispatchCase.replacement,
					),
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
		"      # uses: changesets/action@a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d # v1.9.0";
	const versionMarker = "      # version: pnpm run version";
	const tokenMarker =
		`      # GITHUB_TOKEN: ${DOLLAR_SIGN}{{ secrets.GITHUB_TOKEN }}`;

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
					"          version: pnpm run version\n",
					"          # version: pnpm run version\n",
				),
			failure: /maintained Version Packages inputs and root version command/,
		},
		{
			name: "comment-only repository token",
			mutate: (contents) =>
				contents.replace(
					`          GITHUB_TOKEN: ${DOLLAR_SIGN}{{ secrets.GITHUB_TOKEN }}\n`,
					`          # GITHUB_TOKEN: ${DOLLAR_SIGN}{{ secrets.GITHUB_TOKEN }}\n`,
				),
			failure: /scope only the repository GITHUB_TOKEN and HUSKY=0/,
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
			from: "changesets/action@a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d # v1.9.0",
			to: "changesets/action@v1",
			failure: /full-SHA pinned Changesets Action step/,
		},
		{
			name: "publish input",
			from: "          version: pnpm run version\n",
			to: "          version: pnpm run version\n          publish: pnpm run publish\n",
			failure: /maintained Version Packages inputs and root version command/,
		},
		{
			name: "missing scoped Husky bypass",
			from: '          HUSKY: "0"\n',
			to: "",
			failure: /scope only the repository GITHUB_TOKEN and HUSKY=0/,
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

test("parallel development contracts accept the repository-backed workflow", async () => {
	assert.deepEqual(await auditParallelDevelopmentContracts(repositoryRoot), []);
});

test("development handoff contracts reject missing durable carriers", async (t) => {
	const cases = [
		{
			path: ".github/ISSUE_TEMPLATE/development-task.yml",
			from: "Task Contract",
			to: "task record",
			failure: /missing durable task-context marker Task Contract/,
		},
		{
			path: "docs/maintainers/parallel-development.md",
			from: "**Implementation Contract**",
			to: "**Change Summary**",
			failure: /missing orchestration invariant \*\*Implementation Contract\*\*/,
		},
		{
			path: "docs/maintainers/parallel-development.md",
			from: "Normal Agent execution records remain outside the repository",
			to: "Agent execution records may be committed",
			failure: /missing orchestration invariant Normal Agent execution records/,
		},
		{
			path: "docs/maintainers/parallel-development.md",
			from: "Refresh the PR Handoff after head verification",
			to: "Leave the initial PR Handoff unchanged after verification",
			failure: /missing orchestration invariant Refresh the PR Handoff/,
		},
		{
			path: ".github/pull_request_template.md",
			from: "## Candidate identity",
			to: "## Candidate notes",
			failure: /missing orchestration field ## Candidate identity/,
		},
		{
			path: ".github/pull_request_template.md",
			from: "Exact-head relationship",
			to: "CI relationship",
			failure: /missing orchestration field Exact-head relationship/,
		},
		{
			path: ".github/pull_request_template.md",
			from: "Repository-setting changes",
			to: "Remote configuration summary",
			failure: /missing orchestration field Repository-setting changes/,
		},
	];

	for (const contractCase of cases) {
		const root = await createAutonomousMaintenanceContractFixture(t);
		await mutateTrackedFixture(root, contractCase.path, (contents) =>
			contents.replace(contractCase.from, contractCase.to),
		);
		assertFailure(
			{ failures: await auditParallelDevelopmentContracts(root) },
			contractCase.failure,
		);
	}
});

test("autonomous maintenance contracts accept the governance-only future model", async () => {
	assert.deepEqual(
		await auditAutonomousMaintenanceContracts(repositoryRoot),
		[],
	);
});

test("development task authorization modes stay closed and non-operational", async (t) => {
	const invalidModeRoot = await createAutonomousMaintenanceContractFixture(t);
	await mutateTrackedFixture(
		invalidModeRoot,
		".github/ISSUE_TEMPLATE/development-task.yml",
		(contents) => contents.replace("        - Autonomous\n", "        - Agent Decides\n"),
	);
	assertFailure(
		{ failures: await auditParallelDevelopmentContracts(invalidModeRoot) },
		/field authorization-mode must offer Manual, Design Approved, Autonomous/,
	);

	const grantingDescriptionRoot =
		await createAutonomousMaintenanceContractFixture(t);
	await mutateTrackedFixture(
		grantingDescriptionRoot,
		".github/ISSUE_TEMPLATE/development-task.yml",
		(contents) =>
			contents.replace(
				"does not grant runtime authority or trigger automation",
				"grants runtime authority and triggers automation",
			),
	);
	assertFailure(
		{
			failures: await auditParallelDevelopmentContracts(
				grantingDescriptionRoot,
			),
		},
		/authorization mode must not grant runtime authority or trigger automation/,
	);
});

test("autonomous maintenance contracts reject self-authorizing governance drift", async (t) => {
	const cases = [
		{
			path: "docs/maintainers/autonomous-maintenance.md",
			mutate: (contents) =>
				contents.replace(
					"\n## Risk and eligibility\n",
					"\n   ## Authorization modes ##\n\n### `AGENT_DECIDES`\n\nA duplicate unsafe authorization section.\n\n## Risk and eligibility\n",
				),
			failure: /must contain exactly one section ## Authorization modes/,
		},
		{
			path: "docs/maintainers/autonomous-maintenance.md",
			mutate: (contents) =>
				contents.replace(
					"\n## Trust and threat model\n",
					"\n## Status and current authority\n\nAutonomous execution is implemented.\n\n## Trust and threat model\n",
				),
			failure: /must contain exactly one section ## Status and current authority/,
		},
		{
			path: "docs/maintainers/autonomous-maintenance.md",
			mutate: (contents) =>
				contents.replace(
					"\n## Risk and eligibility\n",
					"\n### `AGENT_DECIDES`\n\nAn unsafe fourth mode.\n\n## Risk and eligibility\n",
				),
			failure: /must define exactly MANUAL, DESIGN_APPROVED, and AUTONOMOUS/,
		},
		{
			path: "docs/maintainers/autonomous-maintenance.md",
			mutate: (contents) =>
				contents.replace(
					"\n## Risk and eligibility\n",
					"\n   ### `AGENT_DECIDES`\n\nAn indented unsafe fourth mode.\n\n## Risk and eligibility\n",
				),
			failure: /must define exactly MANUAL, DESIGN_APPROVED, and AUTONOMOUS/,
		},
		{
			path: "docs/maintainers/autonomous-maintenance.md",
			mutate: (contents) =>
				contents.replace(
					"| Authorization model | DEFINED |",
					"| Authorization model | IMPLEMENTED |",
				),
			failure: /status for Authorization model must be exactly DEFINED/,
		},
		{
			path: "docs/maintainers/autonomous-maintenance.md",
			mutate: (contents) =>
				contents.replace(
					"There is no self-approval path.",
					"A candidate may approve its own policy change.",
				),
			failure: /missing governance invariant There is no self-approval path/,
		},
		{
			path: "docs/maintainers/autonomous-maintenance.md",
			mutate: (contents) =>
				contents.replace("**Review authority**", "**Review guidance**"),
			failure: /missing governance invariant \*\*Review authority\*\*/,
		},
		{
			path: "docs/maintainers/autonomous-maintenance.md",
			mutate: (contents) =>
				contents.replace(
					/it must not produce or\s+exercise `DIRECT_MERGE`/,
					"it may produce and exercise `DIRECT_MERGE`",
				),
			failure: /missing governance invariant it must not produce or exercise `DIRECT_MERGE`/,
		},
		{
			path: "AGENTS.md",
			mutate: (contents) =>
				contents.replace(
					"Root-of-Trust changes cannot authorize themselves",
					"Root-of-Trust changes may authorize themselves",
				),
			failure: /missing autonomous governance marker Root-of-Trust changes cannot authorize themselves/,
		},
		{
			path: ".github/pull_request_template.md",
			mutate: (contents) =>
				contents.replace(
					"this PR text does not grant runtime authority",
					"this PR text grants runtime authority",
				),
			failure: /missing autonomous governance field this PR text does not grant runtime authority/,
		},
		{
			path: ".github/pull_request_template.md",
			mutate: (contents) =>
				contents.replace(
					"Independent review: READY / NOT READY / not applicable",
					"Implementer self-review: READY",
				),
			failure: /missing autonomous governance field Independent review/,
		},
	];

	for (const contractCase of cases) {
		const root = await createAutonomousMaintenanceContractFixture(t);
		await mutateTrackedFixture(root, contractCase.path, contractCase.mutate);
		assertFailure(
			{ failures: await auditAutonomousMaintenanceContracts(root) },
			contractCase.failure,
		);
	}
});

test("parallel development contracts reject incomplete task intake", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-parallel-contract-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	for (const relativePath of [
		"AGENTS.md",
		".github/ISSUE_TEMPLATE/development-task.yml",
		".github/pull_request_template.md",
		"docs/maintainers/parallel-development.md",
	]) {
		await writeFixtureFile(
			root,
			relativePath,
			await readFile(join(repositoryRoot, relativePath), "utf8"),
		);
	}
	await git(root, "init");
	await mutateTrackedFixture(
		root,
		".github/ISSUE_TEMPLATE/development-task.yml",
		(contents) =>
			contents
				.replace("        - Shared Surface\n", "")
				.replace("      label: Goal\n", "")
				.replace("      required: true\n", "      required: false\n"),
	);
	const result = await auditParallelDevelopmentContracts(root);
	assertFailure({ failures: result }, /field goal must be required/);
	assertFailure({ failures: result }, /field goal must have a non-empty label/);
	assertFailure(
		{ failures: result },
		/field parallelization must offer Parallel Safe, Shared Surface, Dependent/,
	);

	const issueFormPath = join(
		root,
		".github/ISSUE_TEMPLATE/development-task.yml",
	);
	await writeFile(issueFormPath, "null\n");
	assertFailure(
		{ failures: await auditParallelDevelopmentContracts(root) },
		/must be a YAML mapping/,
	);
	await writeFile(
		issueFormPath,
		(
			await readFile(
				join(repositoryRoot, ".github/ISSUE_TEMPLATE/development-task.yml"),
				"utf8",
			)
		).replace(
			"description: Define a durable, reviewable openapi-to implementation task.\n",
			"",
		),
	);
	assertFailure(
		{ failures: await auditParallelDevelopmentContracts(root) },
		/must have a non-empty description/,
	);
});

test("parallel development contracts reject collapsed completion and authority gates", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-parallel-contract-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	for (const relativePath of [
		"AGENTS.md",
		".github/ISSUE_TEMPLATE/development-task.yml",
		".github/pull_request_template.md",
		"docs/maintainers/parallel-development.md",
	]) {
		await writeFixtureFile(
			root,
			relativePath,
			await readFile(join(repositoryRoot, relativePath), "utf8"),
		);
	}
	await git(root, "init");
	await mutateTrackedFixture(
		root,
		"docs/maintainers/parallel-development.md",
		(contents) =>
			`${contents}\n\`LOCAL READY\` equals remote CI \`PASS\`. **Codex** may automatically merge.\n`,
	);
	const result = await auditParallelDevelopmentContracts(root);
	assertFailure({ failures: result }, /must not equate LOCAL READY/);
	assertFailure({ failures: result }, /must not grant Codex automatic merge/);

	await writeFile(
		join(root, "docs/maintainers/parallel-development.md"),
		`${await readFile(join(repositoryRoot, "docs/maintainers/parallel-development.md"), "utf8")}\n[LOCAL READY][local] equals remote CI [PASS][pass]. [Codex][agent] may automatically merge.\n\n[local]: #local-ready\n[pass]: #remote-ci\n[agent]: #authority\n`,
	);
	const referenceLinkResult = await auditParallelDevelopmentContracts(root);
	assertFailure(
		{ failures: referenceLinkResult },
		/must not equate LOCAL READY/,
	);
	assertFailure(
		{ failures: referenceLinkResult },
		/must not grant Codex automatic merge/,
	);

	await writeFile(
		join(root, "docs/maintainers/parallel-development.md"),
		`${await readFile(join(repositoryRoot, "docs/maintainers/parallel-development.md"), "utf8")}\n[LOCAL READY](#local-ready) equals remote CI [PASS](#remote-ci). [Codex](#authority) may automatically merge.\n`,
	);
	const inlineLinkResult = await auditParallelDevelopmentContracts(root);
	assertFailure({ failures: inlineLinkResult }, /must not equate LOCAL READY/);
	assertFailure(
		{ failures: inlineLinkResult },
		/must not grant Codex automatic merge/,
	);

	await writeFile(
		join(root, "docs/maintainers/parallel-development.md"),
		`${await readFile(join(repositoryRoot, "docs/maintainers/parallel-development.md"), "utf8")}\nLOCAL READY <!-- gap --> is remote CI PASS. Codex <em> may </em> automatically merge.\n`,
	);
	const htmlMarkupResult = await auditParallelDevelopmentContracts(root);
	assertFailure({ failures: htmlMarkupResult }, /must not equate LOCAL READY/);
	assertFailure(
		{ failures: htmlMarkupResult },
		/must not grant Codex automatic merge/,
	);

	for (const contradiction of [
		"LOCAL REA<!-- gap -->DY is remote CI PASS. Co<!-- gap -->dex may automatically merge.",
		"LOCAL READY<br>is remote CI PASS. Codex<br>may automatically merge.",
		`LOCAL READY<br title=">">is remote CI PASS. Codex<br data-gap='>'>may automatically merge.`,
		"LOCAL READY<center>is remote CI PASS.</center> Codex<center>may automatically merge.</center>",
		"LOCAL REA&#x200B;DY is remote CI PASS. Cod&#x200B;ex may automatically merge.",
		"LOCAL REA&#129;DY is remote CI PASS. Cod&#129;ex may automatically merge.",
		"LOCAL REA&shy;DY is remote CI PASS. Cod&shy;ex may automatically merge.",
		"LOCAL READY&af;is remote CI PASS. Codex&af;may automatically merge.",
		"LOCAL READY&it;is remote CI PASS. Codex&ic;may automatically merge.",
	]) {
		await writeFile(
			join(root, "docs/maintainers/parallel-development.md"),
			`${await readFile(join(repositoryRoot, "docs/maintainers/parallel-development.md"), "utf8")}\n${contradiction}\n`,
		);
		const renderedEquivalentResult =
			await auditParallelDevelopmentContracts(root);
		assertFailure(
			{ failures: renderedEquivalentResult },
			/must not equate LOCAL READY/,
		);
		assertFailure(
			{ failures: renderedEquivalentResult },
			/must not grant Codex automatic merge/,
		);
	}
});

test("parallel development contracts reject character-reference bypasses safely", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-parallel-contract-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	for (const relativePath of [
		"AGENTS.md",
		".github/ISSUE_TEMPLATE/development-task.yml",
		".github/pull_request_template.md",
		"docs/maintainers/parallel-development.md",
	]) {
		await writeFixtureFile(
			root,
			relativePath,
			await readFile(join(repositoryRoot, relativePath), "utf8"),
		);
	}
	await git(root, "init");
	const developmentDocument = await readFile(
		join(repositoryRoot, "docs/maintainers/parallel-development.md"),
		"utf8",
	);
	for (const encodedSpace of [
		"&nbsp;",
		"&#32;",
		"&#x20;",
		"&Tab;",
		"&NonBreakingSpace;",
		"&ThinSpace;",
	]) {
		await writeFile(
			join(root, "docs/maintainers/parallel-development.md"),
			`${developmentDocument}\nLOCAL READY${encodedSpace}is remote CI PASS. Codex${encodedSpace}may automatically merge.\n`,
		);
		const result = await auditParallelDevelopmentContracts(root);
		assertFailure({ failures: result }, /must not equate LOCAL READY/);
		assertFailure({ failures: result }, /must not grant Codex automatic merge/);
	}

	await writeFile(
		join(root, "docs/maintainers/parallel-development.md"),
		`${developmentDocument}\nMalformed references remain inert: &#0; &#xD800; &#x110000; &#xZZ;.\n`,
	);
	assert.deepEqual(await auditParallelDevelopmentContracts(root), []);
});

test("Node runtime contracts reject a split workspace baseline", async () => {
	const rootManifest = JSON.parse(
		await readFile(join(repositoryRoot, "package.json"), "utf8"),
	);
	const failures = await auditNodeRuntimeContracts(repositoryRoot, [
		[".", rootManifest],
		[
			"packages/split-runtime",
			{ name: "@openapi-to/split-runtime", engines: { node: ">=20" } },
		],
	]);
	assert.deepEqual(failures, [
		"packages/split-runtime/package.json must declare engines.node >=22",
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
		"packages/openapi/bin/openapi.js",
		"scripts/build-consumer-skill-assets.mjs",
		"scripts/build-consumer-skill-assets.node-test.mjs",
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
		await readFile(
			join(repositoryRoot, "packages/cli/src/index.ts"),
			"utf8",
		),
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
	assert.match(a1, /run:\s*node --test scripts\/openapi-to-setup\.node-test\.mjs/);
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
				"common",
				"module",
				"remote",
				"mcp-stdio-e2e",
				"mcp-cross-platform",
				"mcp-transaction-safety",
			],
		},
		{
			workflow: ".github/workflows/a1-cross-platform.yml",
			job: "required-a1",
			dependencies: ["contracts"],
		},
	];

	for (const contract of contracts) {
		await t.test(contract.job, async () => {
			const source = await readFile(join(repositoryRoot, contract.workflow), "utf8");
			const workflow = loadYaml(source);
			const run = workflow.jobs[contract.job].steps[0].run.trim();
			const match = /^node -e '([\s\S]+)'$/.exec(run);
			assert.ok(match, `${contract.job} must contain one executable node gate`);

			const results = Object.fromEntries(
				contract.dependencies.map((dependency) => [
					dependency,
					{ outputs: {}, result: "success" },
				]),
			);
			const env = {
				...process.env,
				CI_REQUIRED_JOBS: contract.dependencies.join(","),
				CI_REQUIRED_RESULTS: JSON.stringify(results),
			};
			await execFileAsync(process.execPath, ["-e", match[1]], { env });

			for (const result of ["failure", "cancelled", "skipped"]) {
				results[contract.dependencies[0]].result = result;
				await assert.rejects(
					execFileAsync(process.execPath, ["-e", match[1]], {
						env: {
							...env,
							CI_REQUIRED_RESULTS: JSON.stringify(results),
						},
					}),
					(error) => {
						assert.equal(error.code, 1);
						assert.match(error.stderr, new RegExp(`=${result}`));
						return true;
					},
				);
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
					"    if: github.event_name != 'schedule'\n",
					"    if: github.event_name == 'pull_request'\n",
				),
			failure: /must run for pull_request, push, merge_group, and workflow_dispatch/,
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
			failure: /merge_group lint must validate the event head, fail closed without a base/,
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
			name: "A1 aggregate accepts skipped dependencies",
			workflow: ".github/workflows/a1-cross-platform.yml",
			mutate: (contents) =>
				contents.replace(
					'value.result !== "success"',
					'value.result === "failure"',
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
			assert.notEqual(mutated, contents, "fixture mutation must change workflow");
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
			failure: /must retain its pull_request main-branch and version-state path triggers/,
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
			.replaceAll("resourceSnapshot", "REMOVED_RESOURCE_SNAPSHOT")}\n// TURBO_LOG_FILE\n`,
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
	assertFailure(
		{ failures },
		/process evidence is missing resourceSnapshot/,
	);
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
			failure: /finish preflight with consecutive prepare, smoke, artifact-name/,
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
			failure: /outputs\.artifact_name must come from steps\.artifact\.outputs\.name/,
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

	await t.test("dependency installation moves before the first guard", async (t) => {
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
	});

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
	await mutateTrackedFixture(packageRoot, "package.json", (contents) =>
		contents.replace(
			'"@changesets/cli": "2.31.1"',
			'"@changesets/cli": "^2.31.1"',
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
				"changesets/action@a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d # v1.9.0",
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
				"actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
				"actions/checkout@v6",
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

test("Skill contracts reject removal of remote handoff and two-phase release safety", async (t) => {
	const implementationRoot = await createContractFixture(t);
	await mutateTrackedFixture(
		implementationRoot,
		".agents/skills/implement-and-review/SKILL.md",
		(contents) =>
			contents.replaceAll("`REMOTE CI UNVERIFIED`", "`REMOTE CI UNKNOWN`"),
	);
	assertFailure(
		await auditAgentAndSkillContracts(implementationRoot),
		/missing required lifecycle marker `REMOTE CI UNVERIFIED`/,
	);

	const releaseRoot = await createContractFixture(t);
	await mutateTrackedFixture(
		releaseRoot,
		".agents/skills/release-monorepo/SKILL.md",
		(contents) =>
			contents.replace(
				"partial publication recovery",
				"publication troubleshooting",
			),
	);
	assertFailure(
		await auditAgentAndSkillContracts(releaseRoot),
		/missing safety marker partial publication recovery/,
	);
});

test("implementation Skill preserves the structured evidence handoff", async (t) => {
	for (const [from, to, failure] of [
		[
			"structured PR Handoff",
			"free-form PR description",
			/missing required lifecycle marker structured PR Handoff/,
		],
		[
			"concise evidence index",
			"complete execution record",
			/missing required lifecycle marker concise evidence index/,
		],
		[
			"each exact validation command",
			"a validation summary",
			/missing required lifecycle marker each exact validation command/,
		],
		[
			"Refresh the PR Handoff after head verification",
			"Leave the initial PR Handoff unchanged after verification",
			/missing required lifecycle marker Refresh the PR Handoff/,
		],
		[
			"post-merge completion as separate states",
			"post-merge completion as one state",
			/missing required lifecycle marker post-merge completion as separate states/,
		],
	]) {
		const root = await createContractFixture(t);
		await mutateTrackedFixture(
			root,
			".agents/skills/implement-and-review/SKILL.md",
			(contents) => contents.replace(from, to),
		);
		assertFailure(await auditAgentAndSkillContracts(root), failure);
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
				contents.replace('"type": "operations"', '"type": "full"'),
			failure: /missing required workflow marker "type": "operations"/,
		},
		{
			path: ".agents/skills/openapi-to-generate/SKILL.md",
			mutate: (contents) =>
				contents.replace(
					/Never silently substitute a\s+global installation/,
					"Use any available installation",
				),
			failure: /missing required workflow marker Never silently substitute/,
		},
		{
			path: ".agents/skills/openapi-to-generate/SKILL.md",
			mutate: (contents) =>
				contents.replace(
					"Never automate Prepare followed by Apply",
					"Automate Prepare followed by Apply",
				),
			failure: /missing required workflow marker Never automate Prepare/,
		},
		{
			path: ".agents/skills/openapi-to-generate/SKILL.md",
			mutate: (contents) =>
				contents.replace(
					"Tool existence and Tool count do not prove",
					"Tool names and counts prove",
				),
			failure: /missing required workflow marker Tool existence and Tool count do not prove/,
		},
		{
			path: ".agents/skills/openapi-to-generate/SKILL.md",
			mutate: (contents) =>
				contents.replace("| Any other state |", "| `MCP_ANALYSIS_ONLY` |"),
			failure:
				/must allow only verified read-only and write-enabled states, then deny any other state/,
		},
		{
			path: ".agents/skills/openapi-to-generate/references/mcp-workflow.md",
			mutate: (contents) =>
				contents.replace('  "targets": ["<exact-target>"],\n', ""),
			failure: /operation-scoped Dry Run JSON example 1 must pass exactly one/,
		},
		{
			path: ".agents/skills/openapi-to-generate/agents/openai.yaml",
			mutate: (contents) =>
				contents.replace(
					"Discover API operations and safely generate client code",
					"Generate API clients for consumer projects",
				),
			failure: /short_description must equal/,
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
	];
	for (const contractCase of cases) {
		const root = await createContractFixture(t);
		await mutateTrackedFixture(root, contractCase.path, contractCase.mutate);
		assertFailure(
			await auditAgentAndSkillContracts(root),
			contractCase.failure,
		);
	}

	for (const relativePath of [
		".agents/skills/openapi-to-generate/SKILL.md",
		"docs/skills.md",
	]) {
		const root = await createContractFixture(t);
		await mutateTrackedFixture(root, relativePath, (contents) =>
			`${contents}\nLegacy: \`.OpenAPI/openapi.config.ts\`.\n`,
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
		/must allow only verified read-only and write-enabled states, then deny any other state/,
	);
});

test("consumer setup Skill preserves routing, safety, files, and evaluation contracts", async (t) => {
	const cases = [
		{
			path: ".agents/skills/openapi-to-setup/SKILL.md",
			mutate: (contents) => contents.replace("Use `read-only` when the request is ambiguous", "Use `write-enabled` when the request is ambiguous"),
			failure: /missing required workflow marker Use `read-only` when the request is ambiguous/,
		},
		{
			path: ".agents/skills/openapi-to-setup/SKILL.md",
			mutate: (contents) => contents.replace("Never choose `latest`", "Choose `latest`"),
			failure: /missing required workflow marker Never choose `latest`/,
		},
		{
			path: ".agents/skills/openapi-to-setup/SKILL.md",
			mutate: (contents) => contents.replace("re-inspect, create a new plan and ID", "reuse the old plan"),
			failure: /missing required workflow marker re-inspect, create a new plan and ID/,
		},
		{
			path: ".agents/skills/openapi-to-setup/SKILL.md",
			mutate: (contents) => contents.replace("`PACKAGE_JSON_MISSING`", "`PACKAGE_MISSING`"),
			failure: /missing required workflow marker `PACKAGE_JSON_MISSING`/,
		},
		{
			path: ".agents/skills/openapi-to-setup/SKILL.md",
			mutate: (contents) =>
				contents.replace(
					"No Generate handoff; finish or repair setup first.",
					"Generate handoff may be inferred.",
				),
			failure:
				/must allow only verified read-only and write-enabled states, then deny any other state/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/diagnosis.md",
			mutate: (contents) => contents.replace("Multiple actual lockfiles", "Multiple manager types"),
			failure: /missing setup state-binding marker Multiple actual lockfiles/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/safe-writes.md",
			mutate: (contents) => contents.replace("new `setupPlanId`", "existing `setupPlanId`"),
			failure: /missing setup state-binding marker new `setupPlanId`/,
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
			mutate: (contents) => contents.replace("Diagnose and configure local openapi-to and Codex MCP", "Configure openapi-to"),
			failure: /short_description must equal/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/evaluation-matrix.yaml",
			mutate: (contents) => contents.replace("degraded-count-schema-mismatch", "degraded-count-only"),
			failure: /missing required case degraded-count-schema-mismatch/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/evaluation-matrix.yaml",
			mutate: (contents) => contents.replace("degraded-package-json-missing", "degraded-manifest-absent"),
			failure: /missing required case degraded-package-json-missing/,
		},
		{
			path: ".agents/skills/openapi-to-setup/references/evaluation-matrix.yaml",
			mutate: (contents) => contents.replace("degraded-windows-no-nofollow", "degraded-windows-portable-read"),
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
	];
	for (const contractCase of cases) {
		const root = await createContractFixture(t);
		await mutateTrackedFixture(root, contractCase.path, contractCase.mutate);
		assertFailure(await auditAgentAndSkillContracts(root), contractCase.failure);
	}

	const missingScriptRoot = await createContractFixture(t);
	await git(missingScriptRoot, "rm", "--cached", "--", ".agents/skills/openapi-to-setup/scripts/inspect-project.mjs");
	assertFailure(
		await auditAgentAndSkillContracts(missingScriptRoot),
		/setup Skill file is not tracked by Git: .*inspect-project\.mjs/,
	);

	const missingHelperRoot = await createContractFixture(t);
	await git(missingHelperRoot, "rm", "--cached", "--", ".agents/skills/openapi-to-setup/scripts/secure-file-read.mjs");
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

test("Skill routing parser accepts only the repository two-column role format", () => {
	const routes = parseSkillRoutingTable(rootAgentContents());
	assert.equal(routes.length, EXPECTED_SKILL_ROLES.size);
	assert.deepEqual(routes[0], {
		task: "implement-and-review task",
		role: "general-primary",
		roleLabel: "Primary",
		skillPath: ".agents/skills/implement-and-review/SKILL.md",
		skillName: "implement-and-review",
	});
	assert.throws(
		() =>
			parseSkillRoutingTable(
				rootAgentContents().replace("## Skill routing", "## Other routing"),
			),
		/missing ## Skill routing section/,
	);
	assert.throws(
		() =>
			parseSkillRoutingTable(
				rootAgentContents().replace(
					"| Task | Primary or supporting Skill |",
					"| Request | Skill |",
				),
			),
		/must use the header "Task \| Primary or supporting Skill"/,
	);
	assert.throws(
		() =>
			parseSkillRoutingTable(
				rootAgentContents().replace(
					"Support: `.agents/skills/add-cli-command/SKILL.md`",
					"support: `.agents/skills/add-cli-command/SKILL.md`",
				),
			),
		/invalid role or Skill path/,
	);
	assert.throws(
		() =>
			parseSkillRoutingTable(
				rootAgentContents().replace(
					"Support: `.agents/skills/add-cli-command/SKILL.md`",
					"Support: `.agents/skills/add-cli-command/SKILL.md` and `.agents/skills/add-mcp-tool/SKILL.md`",
				),
			),
		/must reference exactly one Skill path/,
	);
	assert.throws(
		() =>
			parseSkillRoutingTable(
				rootAgentContents().replace(
					".agents/skills/add-cli-command/SKILL.md",
					".agents/skills/../SKILL.md",
				),
			),
		/invalid role or Skill path/,
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
		/missing required Agent instruction packages\/core\/AGENTS\.md/,
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
		/missing Skill interface .*add-cli-command\/agents\/openai\.yaml/,
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

test("implementation orchestration lifecycle and routing are mandatory and unique", async (t) => {
	const missingRequiredRoot = await createContractFixture(t);
	await git(
		missingRequiredRoot,
		"rm",
		"--cached",
		"-r",
		"--",
		".agents/skills/implement-and-review",
	);
	await rm(join(missingRequiredRoot, ".agents/skills/implement-and-review"), {
		recursive: true,
		force: true,
	});
	let result = await auditAgentAndSkillContracts(missingRequiredRoot);
	assertFailure(
		result,
		/missing required repository Skill implement-and-review/,
	);

	const missingLifecycleRoot = await createContractFixture(t);
	await writeFixtureFile(
		missingLifecycleRoot,
		".agents/skills/implement-and-review/SKILL.md",
		skillContents("implement-and-review", "## Primary orchestrator\n"),
	);
	await git(
		missingLifecycleRoot,
		"add",
		"--",
		".agents/skills/implement-and-review/SKILL.md",
	);
	result = await auditAgentAndSkillContracts(missingLifecycleRoot);
	assertFailure(
		result,
		/implement-and-review is missing required lifecycle marker ## 1\. Rule discovery/,
	);

	const duplicatePrimaryRoot = await createContractFixture(t);
	await writeFixtureFile(
		duplicatePrimaryRoot,
		".agents/skills/add-cli-command/SKILL.md",
		skillContents("add-cli-command", "## Primary orchestrator\n"),
	);
	await git(
		duplicatePrimaryRoot,
		"add",
		"--",
		".agents/skills/add-cli-command/SKILL.md",
	);
	result = await auditAgentAndSkillContracts(duplicatePrimaryRoot);
	assertFailure(
		result,
		/add-cli-command must not use the formal ## Primary orchestrator heading/,
	);

	const missingRouteRoot = await createContractFixture(t);
	const rootAgent = await readFile(join(missingRouteRoot, "AGENTS.md"), "utf8");
	await writeFixtureFile(
		missingRouteRoot,
		"AGENTS.md",
		rootAgent.replace(
			"| add-cli-command task | Support: `.agents/skills/add-cli-command/SKILL.md` |\n",
			"",
		),
	);
	await git(missingRouteRoot, "add", "--", "AGENTS.md");
	result = await auditAgentAndSkillContracts(missingRouteRoot);
	assertFailure(
		result,
		/AGENTS\.md Skill routing must include add-cli-command exactly once, found 0/,
	);
});

test("independent P0/P1 review is a required read-only review gate", async (t) => {
	const missingRequiredRoot = await createContractFixture(t);
	await git(
		missingRequiredRoot,
		"rm",
		"--cached",
		"-r",
		"--",
		".agents/skills/independent-p0-p1-review",
	);
	await rm(
		join(
			missingRequiredRoot,
			".agents/skills/independent-p0-p1-review",
		),
		{ recursive: true, force: true },
	);
	assertFailure(
		await auditAgentAndSkillContracts(missingRequiredRoot),
		/missing required repository Skill independent-p0-p1-review/,
	);

	const cases = [
		[
			"fresh sub-agent context",
			"existing author context",
			/missing required marker fresh sub-agent context/,
		],
		[
			"edit, create, delete, rename, or format files",
			"edit files when convenient",
			/missing required marker edit, create, delete, rename, or format files/,
		],
		[
			'git diff "$TASK_BASE_SHA"',
			"git diff HEAD",
			/missing required read-only diff command git diff "\$TASK_BASE_SHA"/,
		],
		[
			"Report only P0 and P1",
			"Report all severities",
			/missing required marker Report only P0 and P1/,
		],
		[
			"scope is materially incomplete",
			"scope has limitations",
			/missing required marker scope is materially incomplete/,
		],
		[
			"You must not:",
			"You may:",
			/must prohibit repository mutations/,
		],
		[
			"* edit, create, delete, rename, or format files;",
			"* may edit, create, delete, rename, or format files;",
			/missing read-only prohibition \* edit, create, delete, rename, or format files;/,
		],
		[
			"Use `NOT READY` when at least one P0 or P1 finding exists, or when the review scope is materially incomplete.",
			"Use `READY` when at least one P0 or P1 finding exists, or when the review scope is materially incomplete.",
			/must make P0\/P1 findings or incomplete scope block readiness/,
		],
	];
	for (const [from, to, failure] of cases) {
		const root = await createContractFixture(t);
		await mutateTrackedFixture(
			root,
			".agents/skills/independent-p0-p1-review/SKILL.md",
			(contents) => contents.replace(from, to),
		);
		assertFailure(await auditAgentAndSkillContracts(root), failure);
	}

	const crlfRoot = await createContractFixture(t);
	await mutateTrackedFixture(
		crlfRoot,
		".agents/skills/independent-p0-p1-review/SKILL.md",
		(contents) =>
			contents.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"),
	);
	assert.deepEqual(
		(await auditAgentAndSkillContracts(crlfRoot)).failures,
		[],
	);
});

test("implementation lifecycle preserves independent review delegation and ratchet", async (t) => {
	const cases = [
		[
			"### Independent review gate",
			"### Optional review",
			/missing independent review marker ### Independent review gate/,
		],
		[
			"original user request",
			"implementation summary",
			/missing independent review marker original user request/,
		],
		[
			"Do not provide a long defense",
			"Provide a defense",
			/missing independent review marker Do not provide a long defense/,
		],
		[
			"independently verify every reviewer finding",
			"accept every reviewer finding",
			/missing independent review marker independently verify every reviewer finding/,
		],
		[
			"start a new fresh reviewer",
			"reuse the previous reviewer",
			/missing independent review marker start a new fresh reviewer/,
		],
		[
			"materially incomplete",
			"partially incomplete",
			/missing independent review marker materially incomplete/,
		],
		[
			"every non-trivial behavior-changing write task must run",
			"every non-trivial behavior-changing write task may run",
			/must preserve mandatory semantics every non-trivial behavior-changing write task must run/,
		],
		[
			"The primary agent must:",
			"The primary agent may:",
			/finding repair loop must preserve mandatory semantics The primary agent must:/,
		],
		[
			"report `NOT READY`",
			"report `READY`",
			/terminal verification must preserve mandatory semantics the primary agent must stop and report `NOT READY`/,
		],
		[
			"every required independent review completed in a fresh read-only context",
			"independent review may be omitted",
			/completion gate must preserve independent review requirement every required independent review completed/,
		],
		[
			"Automatically repair every confirmed, in-scope P0/P1.",
			"Automatically repair every P0/P1.",
			/repair scope must preserve authorization boundary Automatically repair every confirmed, in-scope P0\/P1\./,
		],
		[
			"A confirmed\nout-of-scope P0/P1 remains a blocker and requires separate authorization",
			"Automatically repair confirmed out-of-scope P0/P1",
			/repair scope must preserve authorization boundary A confirmed out-of-scope P0\/P1 remains a blocker/,
		],
	];
	for (const [from, to, failure] of cases) {
		const root = await createContractFixture(t);
		await mutateTrackedFixture(
			root,
			".agents/skills/implement-and-review/SKILL.md",
			(contents) => contents.replaceAll(from, to),
		);
		assertFailure(await auditAgentAndSkillContracts(root), failure);
	}
});

test("implementation review budget accepts ordinary re-review and one terminal verification", async (t) => {
	const root = await createContractFixture(t);
	const result = await auditAgentAndSkillContracts(root);
	assert.deepEqual(result.failures, []);

	const skill = (
		await readFile(
			join(root, ".agents/skills/implement-and-review/SKILL.md"),
			"utf8",
		)
	).replace(/\s+/g, " ");
	assert.match(
		skill,
		/After the first or second automatic repair round, a material repair must receive another fresh independent review/,
	);
	assert.match(
		skill,
		/After the third automatic repair round, the primary agent must run exactly one additional terminal verification reviewer/,
	);
	assert.match(
		skill,
		/The terminal gate passes only with both `VERDICT: READY` and `No P0\/P1 findings\.`/,
	);
});

test("implementation review budget rejects missing or repeatable terminal verification", async (t) => {
	const cases = [
		[
			"the primary agent must run exactly one\nadditional terminal verification reviewer",
			"the primary agent may run one additional terminal verification reviewer",
			/terminal verification must preserve mandatory semantics After the third automatic repair round, the primary agent must run exactly one/,
		],
		[
			"The primary agent must not start more than one terminal verification reviewer.",
			"The primary agent may start a second terminal verification reviewer.",
			/terminal verification must preserve mandatory semantics The primary agent must not start more than one terminal verification reviewer/,
		],
		[
			"must remain strictly read-only and must not modify, create, delete, rename,\n  format, stage, commit, or push files;",
			"may modify, stage, commit, or push files;",
			/terminal verification must preserve mandatory semantics must remain strictly read-only/,
		],
		[
			"Do not rename rounds, reset either counter, or repeat the terminal reviewer to\nbypass the limit.",
			"Rename rounds or reset a counter to obtain another reviewer.",
			/terminal verification must preserve mandatory semantics Do not rename rounds, reset either counter/,
		],
	];
	for (const [from, to, failure] of cases) {
		const root = await createContractFixture(t);
		await mutateTrackedFixture(
			root,
			".agents/skills/implement-and-review/SKILL.md",
			(contents) => contents.replace(from, to),
		);
		assertFailure(await auditAgentAndSkillContracts(root), failure);
	}
});

test("implementation terminal verification findings block readiness and cannot be auto-repaired", async (t) => {
	const cases = [
		[
			"the\nprimary agent must stop and report `NOT READY`.",
			"the primary agent may continue and report `READY`.",
			/terminal verification must preserve mandatory semantics the primary agent must stop and report `NOT READY`/,
		],
		[
			"The primary agent must not\nrepair a terminal finding in the current automatic loop;",
			"The primary agent may repair a terminal finding in the current automatic loop;",
			/terminal verification must preserve mandatory semantics The primary agent must not repair a terminal finding/,
		],
		[
			"reports any P0/P1 finding, or has materially incomplete review scope",
			"reports only a P0 finding",
			/terminal verification must preserve mandatory semantics reports any P0\/P1 finding/,
		],
		[
			"The terminal gate passes only with both `VERDICT: READY` and\n`No P0/P1 findings.`.",
			"The terminal gate passes with either `VERDICT: READY` or no findings.",
			/terminal verification must preserve mandatory semantics The terminal gate passes only with both/,
		],
	];
	for (const [from, to, failure] of cases) {
		const root = await createContractFixture(t);
		await mutateTrackedFixture(
			root,
			".agents/skills/implement-and-review/SKILL.md",
			(contents) => contents.replace(from, to),
		);
		assertFailure(await auditAgentAndSkillContracts(root), failure);
	}
});

test("implementation automatic repair budget rejects permissive or non-modifying round semantics", async (t) => {
	const cases = [
		[
			"The primary agent must run no more than three automatic repair rounds.",
			"The primary agent may run four automatic repair rounds.",
			/automatic repair budget must preserve mandatory semantics The primary agent must run no more than three/,
		],
		[
			"After the first or second automatic repair round, a material repair must\nreceive another fresh independent review",
			"After the first or second automatic repair round, a material repair may skip another independent review",
			/automatic repair budget must preserve mandatory semantics After the first or second automatic repair round/,
		],
		[
			"does not result in a file modification, does not consume an automatic repair\nround.",
			"does not result in a file modification, still consumes an automatic repair round.",
			/automatic repair budget must preserve mandatory semantics does not result in a file modification/,
		],
		[
			"does not count as an automatic repair round;",
			"counts as a fourth automatic repair round;",
			/terminal verification must preserve mandatory semantics does not count as an automatic repair round/,
		],
	];
	for (const [from, to, failure] of cases) {
		const root = await createContractFixture(t);
		await mutateTrackedFixture(
			root,
			".agents/skills/implement-and-review/SKILL.md",
			(contents) => contents.replace(from, to),
		);
		assertFailure(await auditAgentAndSkillContracts(root), failure);
	}
});

test("implementation review budget contract accepts CRLF checkout", async (t) => {
	const root = await createContractFixture(t);
	for (const relativePath of [
		".agents/skills/implement-and-review/SKILL.md",
		"docs/agents/agents-and-skills-architecture.md",
	]) {
		await mutateTrackedFixture(root, relativePath, (contents) =>
			contents.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"),
		);
	}
	assert.deepEqual((await auditAgentAndSkillContracts(root)).failures, []);
});

test("root rules preserve the independent review readiness gate", async (t) => {
	const cases = [
		[
			"## Independent review gate",
			"## Optional review",
			/missing ## Independent review gate section/,
		],
		[
			"fresh read-only",
			"existing writable",
			/independent review gate is missing marker fresh read-only/,
		],
		[
			"primary agent remains the\nsole writer",
			"reviewer may write",
			/independent review gate is missing marker primary agent remains the sole writer/,
		],
		[
			"materially incomplete independent\nreview scope block `READY`",
			"incomplete review may be READY",
			/independent review gate is missing marker materially incomplete/,
		],
		[
			"must run an independent P0/P1\nreview",
			"may run an independent P0/P1 review",
			/must preserve mandatory semantics Every non-trivial behavior-changing write task must run/,
		],
		[
			"The reviewer must not modify",
			"The reviewer may modify",
			/must preserve mandatory semantics The reviewer must not modify/,
		],
		[
			"the primary agent must use a new",
			"the primary agent may reuse the old",
			/must preserve mandatory semantics the primary agent must use a new reviewer context/,
		],
	];
	for (const [from, to, failure] of cases) {
		const root = await createContractFixture(t);
		await mutateTrackedFixture(root, "AGENTS.md", (contents) =>
			contents.replace(from, to),
		);
		assertFailure(await auditAgentAndSkillContracts(root), failure);
	}
});

test("implementation lifecycle rejects unsafe discovery and incomplete task-base review", async (t) => {
	const cases = [
		{
			mutate: (contents) =>
				contents.replace(
					"git ls-files '*AGENTS.md'",
					"find .. -name AGENTS.md -print",
				),
			failure: /must not discover Agent rules with a parent-directory find/,
		},
		{
			mutate: (contents) =>
				contents.replace(
					"If Git discovery fails, report a blocker.",
					"If rule discovery fails, continue carefully.",
				),
			failure: /block on Git discovery failure without a filesystem fallback/,
		},
		{
			mutate: (contents) =>
				contents
					.replaceAll("task base", "starting point")
					.replaceAll("task-base", "starting-point"),
			failure: /must record an immutable task base/,
		},
		{
			mutate: (contents) =>
				contents.replaceAll("git rev-parse HEAD", "git show HEAD"),
			failure: /record the task base with git rev-parse HEAD/,
		},
		{
			mutate: (contents) =>
				contents.replace('git diff "$TASK_BASE_SHA"\n', "git diff\n"),
			failure:
				/missing required task-base diff command git diff "\$TASK_BASE_SHA"/,
		},
		{
			mutate: (contents) =>
				contents.replace('git diff "$TASK_BASE_SHA"..HEAD', "git diff HEAD"),
			failure:
				/missing required task-base diff command git diff "\$TASK_BASE_SHA"\.\.HEAD/,
		},
		{
			mutate: (contents) =>
				contents
					.replace("After a commit", "After implementation")
					.replace("clean post-commit", "clean final"),
			failure: /require complete diff review after a commit/,
		},
		{
			mutate: (contents) =>
				contents.replaceAll(
					"git branch --show-current",
					"git symbolic-ref --short HEAD",
				),
			failure: /missing final Git state command git branch --show-current/,
		},
	];
	for (const contractCase of cases) {
		const root = await createContractFixture(t);
		await mutateTrackedFixture(
			root,
			".agents/skills/implement-and-review/SKILL.md",
			contractCase.mutate,
		);
		assertFailure(
			await auditAgentAndSkillContracts(root),
			contractCase.failure,
		);
	}
});

test("implementation lifecycle enforces clean-worktree ownership boundaries", async (t) => {
	const cases = [
		[
			"A clean worktree is the default precondition",
			"A dirty worktree is acceptable",
			/missing required lifecycle marker A clean worktree/,
		],
		[
			"pre-existing changes",
			"earlier edits",
			/missing required lifecycle marker pre-existing changes/,
		],
		[
			"must not claim agent ownership",
			"may claim agent ownership",
			/missing required lifecycle marker must not claim agent ownership/,
		],
		[
			"isolated worktree",
			"temporary checkout",
			/missing required lifecycle marker isolated worktree/,
		],
		[
			"Never automatically remove or overwrite",
			"Automatically remove or overwrite",
			/missing required lifecycle marker Never automatically remove/,
		],
		[
			"",
			"\n```sh\ngit clean -fd\n```",
			/must not recommend destructive command git clean/,
		],
		[
			"",
			"\n```sh\ngit reset --hard\n```",
			/must not recommend destructive command git reset --hard/,
		],
	];
	for (const [from, to, failure] of cases) {
		const root = await createContractFixture(t);
		await mutateTrackedFixture(
			root,
			".agents/skills/implement-and-review/SKILL.md",
			(contents) =>
				from ? contents.replaceAll(from, to) : `${contents}${to}\n`,
		);
		assertFailure(await auditAgentAndSkillContracts(root), failure);
	}
});

test("implementation lifecycle fully reviews untracked and staged files", async (t) => {
	const cases = [
		[
			"git ls-files --others --exclude-standard",
			"git status --short",
			/missing required task-base diff command git ls-files/,
		],
		[
			"Read every task-created untracked text file in full",
			"Review every untracked filename",
			/missing required lifecycle marker Read every task-created/,
		],
		[
			"untracked file prevents `READY`",
			"untracked file is acceptable",
			/missing required lifecycle marker untracked file prevents/,
		],
		[
			"Unexpected untracked files prevent `READY`",
			"Unexpected files may be silently ignored",
			/missing required lifecycle marker Unexpected untracked/,
		],
		[
			"",
			"\n```sh\ngit add .\n```",
			/must not allow unbounded staging command git add \./,
		],
		[
			"git diff --cached --stat",
			"git diff --cached --name-only",
			/missing required task-base diff command git diff --cached --stat/,
		],
		[
			"After a commit, repeat untracked file discovery",
			"After a commit, skip untracked discovery",
			/missing required lifecycle marker After a commit/,
		],
	];
	for (const [from, to, failure] of cases) {
		const root = await createContractFixture(t);
		await mutateTrackedFixture(
			root,
			".agents/skills/implement-and-review/SKILL.md",
			(contents) =>
				from ? contents.replaceAll(from, to) : `${contents}${to}\n`,
		);
		assertFailure(await auditAgentAndSkillContracts(root), failure);
	}
});

test("architecture contract enforces the Pilot Draft-to-Ready evidence gate", async (t) => {
	const cases = [
		[
			"Ready for review",
			"Open for discussion",
			/ordered Pilot PR gate through Ready for review/,
		],
		[
			"Local `PASS` is not remote CI `PASS`",
			"Local and remote PASS are equivalent",
			/missing Pilot PR evidence marker Local/,
		],
		[
			"`Draft` status is not",
			"Draft status is",
			/missing Pilot PR evidence marker `Draft`/,
		],
		[
			"`REMOTE CI UNVERIFIED`",
			"`PASS`",
			/missing Pilot PR evidence marker `REMOTE CI UNVERIFIED`/,
		],
		[
			"Only the user may decide whether to merge",
			"The service may automatically merge",
			/must not allow automatic merge/,
		],
	];
	for (const [from, to, failure] of cases) {
		const root = await createContractFixture(t);
		await mutateTrackedFixture(
			root,
			"docs/agents/agents-and-skills-architecture.md",
			(contents) => contents.replaceAll(from, to),
		);
		assertFailure(await auditAgentAndSkillContracts(root), failure);
	}
});

test("root Definition of done distinguishes all, read-only, and write tasks", async (t) => {
	const cases = [
		{
			mutate: (contents) => contents.replace("### All tasks", "### Every task"),
			failure: /Definition of done is missing ### All tasks/,
		},
		{
			mutate: (contents) =>
				contents.replace("### Read-only tasks", "### Analysis tasks"),
			failure: /Definition of done is missing ### Read-only tasks/,
		},
		{
			mutate: (contents) =>
				contents.replace("### Write tasks", "### Implementation tasks"),
			failure: /Definition of done is missing ### Write tasks/,
		},
		{
			mutate: (contents) =>
				contents.replace("Do not modify files.", "Modify files when useful."),
			failure: /read-only tasks must prohibit file writes/,
		},
		{
			mutate: (contents) =>
				contents.replace(
					"does not grant automatic repair authorization",
					"grants automatic repair authorization",
				),
			failure: /must not grant automatic repair authorization/,
		},
		{
			mutate: (contents) =>
				contents.replace("task-base-to-HEAD", "current HEAD"),
			failure:
				/write tasks must require task-base-to-current and task-base-to-HEAD review/,
		},
	];
	for (const contractCase of cases) {
		const root = await createContractFixture(t);
		await mutateTrackedFixture(root, "AGENTS.md", contractCase.mutate);
		assertFailure(
			await auditAgentAndSkillContracts(root),
			contractCase.failure,
		);
	}
});

test("Skill routing audit rejects missing, duplicate, unknown, untracked, and prose-only routes", async (t) => {
	const missingRoot = await createContractFixture(t);
	await mutateTrackedFixture(missingRoot, "AGENTS.md", (contents) =>
		contents.replace("## Skill routing", "## Workflow routing"),
	);
	assertFailure(
		await auditAgentAndSkillContracts(missingRoot),
		/missing ## Skill routing section/,
	);

	const brokenHeaderRoot = await createContractFixture(t);
	await mutateTrackedFixture(brokenHeaderRoot, "AGENTS.md", (contents) =>
		contents.replace(
			"| Task | Primary or supporting Skill |",
			"| Request | Workflow |",
		),
	);
	assertFailure(
		await auditAgentAndSkillContracts(brokenHeaderRoot),
		/must use the header "Task \| Primary or supporting Skill"/,
	);

	const duplicateRoot = await createContractFixture(t);
	await mutateTrackedFixture(duplicateRoot, "AGENTS.md", (contents) =>
		contents.replace(
			"\n\n## Independent review gate",
			`\n${routingRow("add-cli-command", "domain-support", "duplicate CLI task")}\n\n## Independent review gate`,
		),
	);
	assertFailure(
		await auditAgentAndSkillContracts(duplicateRoot),
		/must include add-cli-command exactly once, found 2/,
	);

	const proseOnlyRoot = await createContractFixture(t);
	await mutateTrackedFixture(
		proseOnlyRoot,
		"AGENTS.md",
		(contents) =>
			`${contents.replace(`${routingRow("add-cli-command", "domain-support")}\n`, "")}

The Skill \`.agents/skills/add-cli-command/SKILL.md\` is discussed here.
`,
	);
	assertFailure(
		await auditAgentAndSkillContracts(proseOnlyRoot),
		/must include add-cli-command exactly once, found 0/,
	);

	const unknownRoot = await createContractFixture(t);
	await mutateTrackedFixture(unknownRoot, "AGENTS.md", (contents) =>
		contents.replace(
			"\n\n## Independent review gate",
			`\n${routingRow("unknown", "domain-support")}\n\n## Independent review gate`,
		),
	);
	assertFailure(
		await auditAgentAndSkillContracts(unknownRoot),
		/references unknown or untracked Skill .*unknown\/SKILL\.md/,
	);

	const untrackedRoot = await createContractFixture(t);
	await writeFixtureFile(
		untrackedRoot,
		".agents/skills/local-only/SKILL.md",
		skillContents("local-only"),
	);
	await mutateTrackedFixture(untrackedRoot, "AGENTS.md", (contents) =>
		contents.replace(
			"\n\n## Independent review gate",
			`\n${routingRow("local-only", "domain-support")}\n\n## Independent review gate`,
		),
	);
	assertFailure(
		await auditAgentAndSkillContracts(untrackedRoot),
		/references unknown or untracked Skill .*local-only\/SKILL\.md/,
	);
});

test("Skill routing audit enforces every explicit role", async (t) => {
	const cases = [
		{
			name: "implement-and-review",
			from: "Primary",
			to: "Support",
			failure:
				/role for implement-and-review must be general-primary, found domain-support/,
		},
		{
			name: "independent-p0-p1-review",
			from: "Review gate",
			to: "Support",
			failure:
				/role for independent-p0-p1-review must be review-gate, found domain-support/,
		},
		{
			name: "openapi-to-generate",
			from: "Specialized primary",
			to: "Support",
			failure:
				/role for openapi-to-generate must be specialized-primary, found domain-support/,
		},
		{
			name: "openapi-to-setup",
			from: "Specialized primary",
			to: "Support",
			failure:
				/role for openapi-to-setup must be specialized-primary, found domain-support/,
		},
		{
			name: "fix-github-actions",
			from: "Specialized primary",
			to: "Support",
			failure:
				/role for fix-github-actions must be specialized-primary, found domain-support/,
		},
		{
			name: "release-monorepo",
			from: "Specialized primary",
			to: "Primary",
			failure:
				/role for release-monorepo must be specialized-primary, found general-primary/,
		},
		{
			name: "run-codegen-tests",
			from: "Validation helper",
			to: "Specialized primary",
			failure:
				/role for run-codegen-tests must be validation-helper, found specialized-primary/,
		},
		{
			name: "add-mcp-tool",
			from: "Support",
			to: "Primary",
			failure:
				/role for add-mcp-tool must be domain-support, found general-primary/,
		},
	];
	for (const contractCase of cases) {
		const root = await createContractFixture(t);
		await mutateTrackedFixture(root, "AGENTS.md", (contents) =>
			contents.replace(
				`${contractCase.from}: \`.agents/skills/${contractCase.name}/SKILL.md\``,
				`${contractCase.to}: \`.agents/skills/${contractCase.name}/SKILL.md\``,
			),
		);
		assertFailure(
			await auditAgentAndSkillContracts(root),
			contractCase.failure,
		);
	}
});

test("Skill role mapping is independent of prose and covers exactly tracked Skills", async (t) => {
	const proseRoot = await createContractFixture(t);
	await mutateTrackedFixture(
		proseRoot,
		".agents/skills/add-cli-command/SKILL.md",
		(contents) =>
			`${contents}\nThis support Skill may discuss the phrase Primary orchestrator without changing its role.\n`,
	);
	assert.deepEqual((await auditAgentAndSkillContracts(proseRoot)).failures, []);

	const missingHeadingRoot = await createContractFixture(t);
	await mutateTrackedFixture(
		missingHeadingRoot,
		".agents/skills/implement-and-review/SKILL.md",
		(contents) =>
			contents.replace("## Primary orchestrator", "## General workflow"),
	);
	assertFailure(
		await auditAgentAndSkillContracts(missingHeadingRoot),
		/missing required lifecycle marker ## Primary orchestrator/,
	);

	const unmappedTrackedRoot = await createContractFixture(t);
	await writeFixtureFile(
		unmappedTrackedRoot,
		".agents/skills/new-domain/SKILL.md",
		skillContents("new-domain"),
	);
	await writeFixtureFile(
		unmappedTrackedRoot,
		".agents/skills/new-domain/agents/openai.yaml",
		skillInterface("new-domain"),
	);
	await git(unmappedTrackedRoot, "add", "--", ".agents/skills/new-domain");
	assertFailure(
		await auditAgentAndSkillContracts(unmappedTrackedRoot),
		/EXPECTED_SKILL_ROLES is missing tracked Skill new-domain/,
	);

	const nonexistentMappedRoot = await createContractFixture(t);
	await git(
		nonexistentMappedRoot,
		"rm",
		"--cached",
		"-r",
		"--",
		".agents/skills/release-monorepo",
	);
	await rm(join(nonexistentMappedRoot, ".agents/skills/release-monorepo"), {
		recursive: true,
		force: true,
	});
	assertFailure(
		await auditAgentAndSkillContracts(nonexistentMappedRoot),
		/EXPECTED_SKILL_ROLES contains nonexistent Skill release-monorepo/,
	);
});

test("architecture role inventory stays aligned with tracked Skills and routing guarantees", async (t) => {
	const countRoot = await createContractFixture(t);
	await mutateTrackedFixture(
		countRoot,
		"docs/agents/agents-and-skills-architecture.md",
		(contents) =>
			contents.replace(
				"Tracked Skill count: `13`.",
				"Tracked Skill count: `12`.",
			),
	);
	assertFailure(
		await auditAgentAndSkillContracts(countRoot),
		/tracked Skill count must equal 13/,
	);

	const roleRoot = await createContractFixture(t);
	await mutateTrackedFixture(
		roleRoot,
		"docs/agents/agents-and-skills-architecture.md",
		(contents) =>
			contents.replace(
				"| `run-codegen-tests` | validation-helper |",
				"| `run-codegen-tests` | specialized-primary |",
			),
	);
	assertFailure(
		await auditAgentAndSkillContracts(roleRoot),
		/role for run-codegen-tests must be validation-helper, found specialized-primary/,
	);

	const duplicateRoot = await createContractFixture(t);
	await mutateTrackedFixture(
		duplicateRoot,
		"docs/agents/agents-and-skills-architecture.md",
		(contents) =>
			contents.replace(
				"| `run-codegen-tests` | validation-helper |",
				"| `run-codegen-tests` | validation-helper |\n| `run-codegen-tests` | validation-helper |",
			),
	);
	assertFailure(
		await auditAgentAndSkillContracts(duplicateRoot),
		/must document run-codegen-tests exactly once, found 2/,
	);
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
