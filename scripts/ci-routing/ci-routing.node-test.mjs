import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { classifyChangedSurface } from "./changed-surface.mjs";
import { validateRequiredJobResults } from "./require-job-results.mjs";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);

async function eventFile(t, value) {
	const directory = await mkdtemp(path.join(os.tmpdir(), "ci-routing-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const file = path.join(directory, "event.json");
	await writeFile(file, JSON.stringify(value));
	return file;
}

function gitWithDiff(output, { fail = false } = {}) {
	return async (binary, args) => {
		assert.equal(binary, "git");
		if (args[0] === "cat-file") {
			if (fail) throw new Error("missing object");
			return { stdout: "", stderr: "" };
		}
		if (args[0] === "diff") {
			if (fail) throw new Error("diff failed");
			return { stdout: output, stderr: "" };
		}
		throw new Error(`unexpected git operation: ${args[0]}`);
	};
}

test("only pull request maintainer Markdown changes use the docs-only route", async (t) => {
	const eventPath = await eventFile(t, {
		pull_request: { base: { sha: BASE }, head: { sha: HEAD } },
	});
	const result = await classifyChangedSurface({
		eventName: "pull_request",
		eventPath,
		githubSha: HEAD,
		exec: gitWithDiff(
			`M\0docs/maintainers/parallel-development.md\0A\0docs/maintainers/ci/routing.md\0`,
		),
	});
	assert.equal(result.route, "docs-only");
	assert.equal(result.reason, "trusted-maintainer-docs-only");
	assert.deepEqual(result.surfaces, ["maintainer-docs"]);
});

test("workflow, source, root configuration, and other documentation changes route full", async (t) => {
	const eventPath = await eventFile(t, {
		pull_request: { base: { sha: BASE }, head: { sha: HEAD } },
	});
	for (const [file, surface] of [
		[".github/workflows/e2e.yaml", "e2e"],
		[".github/workflows/a1-cross-platform.yml", "a1"],
		[".github/workflows/quality.yml", "workflow"],
		["packages/core/src/index.ts", "core"],
		["packages/cli/src/index.ts", "cli"],
		["packages/mcp/src/index.ts", "mcp"],
		["packages/plugin-zod/src/index.ts", "plugin"],
		["package.json", "root-config"],
		["pnpm-lock.yaml", "root-config"],
		["scripts/ci-routing/changed-surface.mjs", "workflow"],
		["scripts/release/pack-install-smoke.mjs", "release"],
		["docs/testing/ci-diagnostics.md", "unknown"],
		["unclassified/thing.txt", "unknown"],
	]) {
		const result = await classifyChangedSurface({
			eventName: "pull_request",
			eventPath,
			githubSha: HEAD,
			exec: gitWithDiff(`M\0${file}\0`),
		});
		assert.equal(result.route, "full", file);
		assert.deepEqual(result.surfaces, [surface], file);
	}
});

test("merge group, push, workflow dispatch, and schedule always use full routing", async (t) => {
	const cases = [
		["merge_group", { merge_group: { base_sha: BASE, head_sha: HEAD } }],
		["push", { before: BASE }],
		["workflow_dispatch", {}],
		["schedule", {}],
	];
	for (const [eventName, payload] of cases) {
		const eventPath = await eventFile(t, payload);
		const result = await classifyChangedSurface({
			eventName,
			eventPath,
			githubSha: HEAD,
			exec: gitWithDiff("M\0docs/maintainers/parallel-development.md\0"),
		});
		assert.equal(result.route, "full", eventName);
	}
});

test("missing SHAs, unavailable ranges, renames, deletions, and empty diffs fail to full", async (t) => {
	const validEvent = await eventFile(t, {
		pull_request: { base: { sha: BASE }, head: { sha: HEAD } },
	});
	for (const [eventPath, exec, reason] of [
		[
			await eventFile(t, {
				pull_request: { base: { sha: "bad" }, head: { sha: HEAD } },
			}),
			gitWithDiff(""),
			"missing-or-invalid-sha",
		],
		[validEvent, gitWithDiff("", { fail: true }), "git-range-unavailable"],
		[
			validEvent,
			gitWithDiff("R100\0docs/maintainers/old.md\0docs/maintainers/new.md\0"),
			"unsupported-change-status",
		],
		[
			validEvent,
			gitWithDiff("D\0docs/maintainers/old.md\0"),
			"non-docs-or-universal-event",
		],
		[validEvent, gitWithDiff(""), "empty-or-oversized-diff"],
	]) {
		const result = await classifyChangedSurface({
			eventName: "pull_request",
			eventPath,
			githubSha: HEAD,
			exec,
		});
		assert.equal(result.route, "full");
		assert.equal(result.reason, reason);
	}
});

test("merge-group head mismatch and malformed event payload fail to full", async (t) => {
	const eventPath = await eventFile(t, {
		merge_group: { base_sha: BASE, head_sha: "c".repeat(40) },
	});
	const mismatch = await classifyChangedSurface({
		eventName: "merge_group",
		eventPath,
		githubSha: HEAD,
		exec: gitWithDiff(""),
	});
	assert.equal(mismatch.reason, "merge-group-head-mismatch");
	const malformedPath = await eventFile(t, { broken: true });
	const missing = await classifyChangedSurface({
		eventName: "pull_request",
		eventPath: malformedPath,
		githubSha: HEAD,
		exec: gitWithDiff(""),
	});
	assert.equal(missing.reason, "missing-or-invalid-sha");
	const invalidJsonDir = await mkdtemp(
		path.join(os.tmpdir(), "ci-routing-json-"),
	);
	t.after(() => rm(invalidJsonDir, { recursive: true, force: true }));
	const invalidJsonPath = path.join(invalidJsonDir, "event.json");
	await writeFile(invalidJsonPath, "{");
	const malformedJson = await classifyChangedSurface({
		eventName: "pull_request",
		eventPath: invalidJsonPath,
		githubSha: HEAD,
		exec: gitWithDiff(""),
	});
	assert.equal(malformedJson.reason, "invalid-event-payload");
	await writeFile(
		invalidJsonPath,
		JSON.stringify({ padding: "x".repeat(1024 * 1024) }),
	);
	const oversized = await classifyChangedSurface({
		eventName: "pull_request",
		eventPath: invalidJsonPath,
		githubSha: HEAD,
		exec: gitWithDiff(""),
	});
	assert.equal(oversized.reason, "oversized-event-payload");
});

const fullClassification = {
	route: "full",
	classification: "full",
	reason: "non-docs-or-universal-event",
};
const docsClassification = {
	route: "docs-only",
	classification: "docs-only",
	reason: "trusted-maintainer-docs-only",
};

test("required job validator accepts success and exact docs-only skips", () => {
	const jobs = ["classify-surface", "cli", "mcp", "contracts"];
	const success = Object.fromEntries(
		jobs.map((name) => [name, { result: "success" }]),
	);
	assert.equal(
		validateRequiredJobResults({
			requiredJobs: jobs,
			results: success,
			classification: fullClassification,
			eventName: "merge_group",
		}).ok,
		true,
	);
	const skipped = {
		...success,
		cli: { result: "skipped" },
		mcp: { result: "skipped" },
		contracts: { result: "skipped" },
	};
	assert.equal(
		validateRequiredJobResults({
			requiredJobs: jobs,
			results: skipped,
			classification: docsClassification,
			eventName: "pull_request",
			skippableJobs: ["cli", "mcp", "contracts"],
		}).ok,
		true,
	);
	assert.equal(
		validateRequiredJobResults({
			requiredJobs: jobs,
			results: success,
			classification: docsClassification,
			eventName: "pull_request",
			skippableJobs: ["cli", "mcp", "contracts"],
		}).ok,
		false,
	);
});

test("required job validator fails closed on missing, failed, cancelled, and unauthorized skips", () => {
	const jobs = ["classify-surface", "cli", "contracts"];
	const base = Object.fromEntries(
		jobs.map((name) => [name, { result: "success" }]),
	);
	const check = (
		results,
		classification = fullClassification,
		eventName = "pull_request",
		skippableJobs = ["cli", "contracts"],
	) =>
		validateRequiredJobResults({
			requiredJobs: jobs,
			results,
			classification,
			eventName,
			skippableJobs,
		});
	assert.equal(
		check({ ...base, "classify-surface": { result: "failure" } }).ok,
		false,
	);
	assert.equal(check({ ...base, cli: { result: "failure" } }).ok, false);
	assert.equal(check({ ...base, cli: { result: "cancelled" } }).ok, false);
	assert.equal(check({ ...base, cli: { result: "skipped" } }).ok, false);
	assert.equal(
		check(
			{ ...base, cli: { result: "skipped" } },
			docsClassification,
			"merge_group",
		).ok,
		false,
	);
	assert.equal(
		check(
			{ ...base, cli: { result: "skipped" } },
			docsClassification,
			"pull_request",
			["contracts"],
		).ok,
		false,
	);
	assert.equal(
		check(base, fullClassification, "pull_request", ["unknown-job"]).ok,
		false,
	);
	assert.equal(
		check({ "classify-surface": base["classify-surface"], cli: base.cli }).ok,
		false,
	);
	assert.equal(check({ ...base, unexpected: { result: "success" } }).ok, false);
});
