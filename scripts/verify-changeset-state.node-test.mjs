import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { verifyChangesetState } from "./verify-changeset-state.mjs";

const execFileAsync = promisify(execFile);
const fixtures = new Set();
const verifyScript = fileURLToPath(
	new URL("./verify-changeset-state.mjs", import.meta.url),
);

async function writeJson(path, value) {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function createFixture({ pre = true, changesets = {} } = {}) {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-changeset-state-"));
	fixtures.add(root);
	for (const directory of [
		".changeset",
		"packages/package-a",
		"packages/package-b",
		"e2e/private",
	]) {
		await mkdir(join(root, directory), { recursive: true });
	}
	await writeJson(join(root, "package.json"), {
		name: "fixture-root",
		private: true,
		packageManager: "pnpm@10.14.0",
		workspaces: { packages: ["packages/*", "e2e/*"] },
	});
	await writeFile(
		join(root, "pnpm-workspace.yaml"),
		"packages:\n  - 'packages/*'\n  - 'e2e/*'\n",
	);
	await writeJson(join(root, ".changeset/config.json"), {
		fixed: [["package-a", "package-b"]],
		linked: [],
		access: "public",
		baseBranch: "main",
		updateInternalDependencies: "patch",
		ignore: [],
	});
	await writeJson(join(root, "packages/package-a/package.json"), {
		name: "package-a",
		version: "4.0.0-rc.0",
	});
	await writeJson(join(root, "packages/package-b/package.json"), {
		name: "package-b",
		version: "4.0.0-rc.0",
	});
	await writeJson(join(root, "e2e/private/package.json"), {
		name: "private-e2e",
		version: "0.0.2-rc.0",
		private: true,
	});
	await writeFile(
		join(root, ".changeset/README.md"),
		"# Changesets fixture\n",
	);
	const defaultChangesets = {
		consumed:
			'---\n"package-a": major\n"package-b": major\n---\n\nConsumed.\n',
	};
	for (const [id, contents] of Object.entries({
		...defaultChangesets,
		...changesets,
	})) {
		await writeFile(join(root, `.changeset/${id}.md`), contents);
	}
	if (pre) {
		await writeJson(join(root, ".changeset/pre.json"), {
			mode: "pre",
			tag: "rc",
			initialVersions: {
				"package-a": "3.2.2",
				"package-b": "3.2.2",
				"private-e2e": "0.0.1",
			},
			changesets: ["consumed"],
		});
	}
	return root;
}

async function updateJson(path, update) {
	const value = JSON.parse(await readFile(path, "utf8"));
	update(value);
	await writeJson(path, value);
}

async function initializeGit(root) {
	await execFileAsync("git", ["init", "-b", "main"], { cwd: root });
	await execFileAsync("git", ["config", "user.email", "fixture@example.test"], {
		cwd: root,
	});
	await execFileAsync("git", ["config", "user.name", "Fixture"], { cwd: root });
	await execFileAsync("git", ["add", "."], { cwd: root });
	await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: root });
}

async function runCli(args) {
	try {
		const result = await execFileAsync(process.execPath, [verifyScript, ...args]);
		return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
	} catch (error) {
		return {
			exitCode: error.code,
			stdout: error.stdout,
			stderr: error.stderr,
		};
	}
}

test.after(async () => {
	await Promise.all(
		[...fixtures].map((fixture) => rm(fixture, { recursive: true, force: true })),
	);
});

test("normal mode preserves Changesets status for a valid changeset", async () => {
	const root = await createFixture({ pre: false });
	await initializeGit(root);
	const result = await verifyChangesetState(root);
	assert.equal(result.success, true);
	assert.equal(result.mode, "normal");
});

test("normal mode preserves the repository policy when no changeset exists", async () => {
	const root = await createFixture({ pre: false });
	await rm(join(root, ".changeset/consumed.md"));
	await initializeGit(root);
	const result = await verifyChangesetState(root);
	assert.equal(result.success, true);
});

test("normal mode rejects an unknown package through Changesets status", async () => {
	const root = await createFixture({
		pre: false,
		changesets: {
			consumed: '---\n"missing-package": patch\n---\n\nInvalid.\n',
		},
	});
	await initializeGit(root);
	const result = await verifyChangesetState(root);
	assert.equal(result.success, false);
	assert.equal(result.diagnostics[0].code, "CHANGESET_STATUS_FAILED");
	assert.doesNotMatch(result.diagnostics[0].message, new RegExp(root));
});

test("normal mode rejects damaged frontmatter through Changesets status", async () => {
	const root = await createFixture({
		pre: false,
		changesets: { consumed: "not frontmatter\n" },
	});
	await initializeGit(root);
	const result = await verifyChangesetState(root);
	assert.equal(result.success, false);
	assert.equal(result.diagnostics[0].code, "CHANGESET_STATUS_FAILED");
});

test("pre mode accepts a versioned candidate and ignores private version parity", async () => {
	const root = await createFixture();
	const result = await verifyChangesetState(root);
	assert.deepEqual(result, {
		success: true,
		mode: "pre",
		tag: "rc",
		candidateVersion: "4.0.0-rc.0",
		publicPackages: 2,
		pendingChangesets: 0,
		emptyChangesets: 0,
		diagnostics: [],
	});
});

test("pre mode accepts the Changesets v3 prerelease state layout", async () => {
	const root = await createFixture();
	await mkdir(join(root, ".changeset/pre"), { recursive: true });
	await rename(
		join(root, ".changeset/consumed.md"),
		join(root, ".changeset/pre/consumed.md"),
	);
	await writeJson(join(root, ".changeset/pre.json"), {
		mode: "pre",
		tag: "rc",
	});
	const result = await verifyChangesetState(root);
	assert.deepEqual(result, {
		success: true,
		mode: "pre",
		tag: "rc",
		candidateVersion: "4.0.0-rc.0",
		publicPackages: 2,
		pendingChangesets: 0,
		emptyChangesets: 0,
		diagnostics: [],
	});
});

test("pre mode validates consumed Changesets v3 release entries", async () => {
	const root = await createFixture();
	await mkdir(join(root, ".changeset/pre"), { recursive: true });
	await rename(
		join(root, ".changeset/consumed.md"),
		join(root, ".changeset/pre/consumed.md"),
	);
	await writeFile(
		join(root, ".changeset/pre/consumed.md"),
		'---\n"missing-package": patch\n---\n\nInvalid.\n',
	);
	await writeJson(join(root, ".changeset/pre.json"), {
		mode: "pre",
		tag: "rc",
	});
	const result = await verifyChangesetState(root);
	assert.ok(
		result.diagnostics.some(
			({ code }) => code === "INVALID_CHANGESET_RELEASE",
		),
	);
});

test("pre mode rejects damaged pre.json", async () => {
	const root = await createFixture();
	await writeFile(join(root, ".changeset/pre.json"), "{");
	const result = await verifyChangesetState(root);
	assert.equal(result.success, false);
	assert.equal(result.diagnostics[0].code, "INVALID_PRE_JSON");
});

test("pre mode rejects a non-object pre.json", async () => {
	const root = await createFixture();
	await writeFile(join(root, ".changeset/pre.json"), "null\n");
	const result = await verifyChangesetState(root);
	assert.equal(result.success, false);
	assert.equal(result.diagnostics[0].code, "INVALID_PRE_STATE");
});

test("pre mode rejects damaged Changesets configuration", async () => {
	const root = await createFixture();
	await writeFile(join(root, ".changeset/config.json"), "{");
	const result = await verifyChangesetState(root);
	assert.equal(result.success, false);
	assert.equal(result.diagnostics[0].code, "INVALID_CHANGESET_CONFIG");
});

test("pre mode rejects a non-pre mode", async () => {
	const root = await createFixture();
	await updateJson(join(root, ".changeset/pre.json"), (value) => {
		value.mode = "exit";
	});
	const result = await verifyChangesetState(root);
	assert.ok(result.diagnostics.some(({ code }) => code === "INVALID_PRE_MODE"));
});

test("pre mode rejects a missing tag", async () => {
	const root = await createFixture();
	await updateJson(join(root, ".changeset/pre.json"), (value) => {
		delete value.tag;
	});
	const result = await verifyChangesetState(root);
	assert.ok(result.diagnostics.some(({ code }) => code === "INVALID_PRE_TAG"));
});

test("pre mode rejects a missing initial version", async () => {
	const root = await createFixture();
	await updateJson(join(root, ".changeset/pre.json"), (value) => {
		delete value.initialVersions["package-b"];
	});
	const result = await verifyChangesetState(root);
	assert.ok(
		result.diagnostics.some(({ code }) => code === "MISSING_INITIAL_VERSION"),
	);
});

test("pre mode rejects a public version below its initial version", async () => {
	const root = await createFixture();
	await updateJson(join(root, ".changeset/pre.json"), (value) => {
		value.initialVersions["package-a"] = "5.0.0";
	});
	const result = await verifyChangesetState(root);
	assert.ok(
		result.diagnostics.some(
			({ code }) => code === "CANDIDATE_BELOW_INITIAL_VERSION",
		),
	);
});

test("pre mode rejects duplicate consumed changeset IDs", async () => {
	const root = await createFixture();
	await updateJson(join(root, ".changeset/pre.json"), (value) => {
		value.changesets.push("consumed");
	});
	const result = await verifyChangesetState(root);
	assert.ok(
		result.diagnostics.some(
			({ code }) => code === "DUPLICATE_CONSUMED_CHANGESET",
		),
	);
});

test("pre mode rejects a fixed-group base version split", async () => {
	const root = await createFixture();
	await updateJson(join(root, "packages/package-b/package.json"), (value) => {
		value.version = "4.0.1-rc.0";
	});
	const result = await verifyChangesetState(root);
	assert.ok(
		result.diagnostics.some(
			({ code }) => code === "FIXED_GROUP_BASE_VERSION_SPLIT",
		),
	);
});

test("pre mode rejects a prerelease tag split", async () => {
	const root = await createFixture();
	await updateJson(join(root, "packages/package-b/package.json"), (value) => {
		value.version = "4.0.0-beta.0";
	});
	const result = await verifyChangesetState(root);
	assert.ok(
		result.diagnostics.some(
			({ code }) => code === "FIXED_GROUP_PRERELEASE_TAG_SPLIT",
		),
	);
});

test("pre mode rejects a prerelease sequence split", async () => {
	const root = await createFixture();
	await updateJson(join(root, "packages/package-b/package.json"), (value) => {
		value.version = "4.0.0-rc.1";
	});
	const result = await verifyChangesetState(root);
	assert.ok(
		result.diagnostics.some(
			({ code }) => code === "FIXED_GROUP_PRERELEASE_SEQUENCE_SPLIT",
		),
	);
});

test("pre mode reports NEXT_RC_REQUIRED for a pending non-empty changeset", async () => {
	const root = await createFixture({
		changesets: {
			pending: '---\n"package-a": patch\n---\n\nNext candidate.\n',
		},
	});
	const result = await verifyChangesetState(root);
	assert.equal(result.success, false);
	assert.equal(result.pendingChangesets, 1);
	assert.ok(result.diagnostics.some(({ code }) => code === "NEXT_RC_REQUIRED"));
});

test("development mode accepts a pending non-empty changeset", async () => {
	const root = await createFixture({
		changesets: {
			pending: '---\n"package-a": patch\n---\n\nNext candidate.\n',
		},
	});
	const result = await verifyChangesetState(root, { allowPending: true });
	assert.equal(result.success, true);
	assert.equal(result.pendingChangesets, 1);
	assert.equal(result.diagnostics.length, 0);
});

test("pre mode rejects an empty changeset", async () => {
	const root = await createFixture({
		changesets: { empty: "---\n---\n\nPlaceholder.\n" },
	});
	const result = await verifyChangesetState(root);
	assert.equal(result.emptyChangesets, 1);
	assert.ok(
		result.diagnostics.some(
			({ code }) => code === "EMPTY_CHANGESET_NOT_ALLOWED",
		),
	);
});

test("development mode still rejects an empty changeset", async () => {
	const root = await createFixture({
		changesets: { empty: "---\n---\n\nPlaceholder.\n" },
	});
	const result = await verifyChangesetState(root, { allowPending: true });
	assert.equal(result.success, false);
	assert.equal(result.emptyChangesets, 1);
	assert.ok(
		result.diagnostics.some(
			({ code }) => code === "EMPTY_CHANGESET_NOT_ALLOWED",
		),
	);
});

test("development mode still rejects an unknown package", async () => {
	const root = await createFixture({
		changesets: {
			pending: '---\n"missing-package": patch\n---\n\nInvalid.\n',
		},
	});
	const result = await verifyChangesetState(root, { allowPending: true });
	assert.equal(result.success, false);
	assert.equal(result.pendingChangesets, 1);
	assert.ok(
		result.diagnostics.some(
			({ code }) => code === "INVALID_CHANGESET_RELEASE",
		),
	);
});

test("development mode still rejects damaged frontmatter", async () => {
	const root = await createFixture({
		changesets: { pending: "not frontmatter\n" },
	});
	const result = await verifyChangesetState(root, { allowPending: true });
	assert.equal(result.success, false);
	assert.ok(
		result.diagnostics.some(({ code }) => code === "INVALID_CHANGESET"),
	);
});

test("development mode still rejects a fixed-group version split", async () => {
	const root = await createFixture();
	await updateJson(join(root, "packages/package-b/package.json"), (value) => {
		value.version = "4.0.1-rc.0";
	});
	const result = await verifyChangesetState(root, { allowPending: true });
	assert.equal(result.success, false);
	assert.ok(
		result.diagnostics.some(
			({ code }) => code === "FIXED_GROUP_VERSION_SPLIT",
		),
	);
});

test("development mode still rejects a prerelease sequence split", async () => {
	const root = await createFixture();
	await updateJson(join(root, "packages/package-b/package.json"), (value) => {
		value.version = "4.0.0-rc.1";
	});
	const result = await verifyChangesetState(root, { allowPending: true });
	assert.equal(result.success, false);
	assert.ok(
		result.diagnostics.some(
			({ code }) => code === "FIXED_GROUP_PRERELEASE_SEQUENCE_SPLIT",
		),
	);
});

test("CLI defaults to strict mode and --allow-pending opts into development mode", async () => {
	const root = await createFixture({
		changesets: {
			pending: '---\n"package-a": patch\n---\n\nNext candidate.\n',
		},
	});
	const strict = await runCli(["--root", root]);
	assert.equal(strict.exitCode, 1);
	assert.equal(strict.stdout, "");
	assert.match(strict.stderr, /NEXT_RC_REQUIRED/);

	const development = await runCli(["--root", root, "--allow-pending"]);
	assert.equal(development.exitCode, 0);
	assert.equal(development.stderr, "");
	const result = JSON.parse(development.stdout);
	assert.equal(result.success, true);
	assert.equal(result.pendingChangesets, 1);
});

test("CLI rejects unknown and incomplete arguments with exit code 2", async () => {
	for (const args of [["--unknown"], ["--root"]]) {
		const result = await runCli(args);
		assert.equal(result.exitCode, 2);
		assert.equal(result.stdout, "");
		assert.match(result.stderr, /Unknown or incomplete argument/);
	}
});

test("--json and --allow-pending produce stable valid JSON", async () => {
	const root = await createFixture({
		changesets: {
			pending: '---\n"package-a": patch\n---\n\nNext candidate.\n',
		},
	});
	const args = ["--allow-pending", "--json", "--root", root];
	const first = await runCli(args);
	const second = await runCli(args);
	assert.equal(first.exitCode, 0);
	assert.equal(first.stderr, "");
	assert.equal(first.stdout, second.stdout);
	assert.deepEqual(JSON.parse(first.stdout), {
		success: true,
		mode: "pre",
		tag: "rc",
		candidateVersion: "4.0.0-rc.0",
		publicPackages: 2,
		pendingChangesets: 1,
		emptyChangesets: 0,
		diagnostics: [],
	});
});
