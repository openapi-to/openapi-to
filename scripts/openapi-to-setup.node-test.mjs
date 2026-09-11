import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	openVerifiedFile,
	sameOpenedFile,
	selectReadFlags,
	unchangedDuringRead,
} from "../.agents/skills/openapi-to-setup/scripts/secure-file-read.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const inspector = join(repositoryRoot, ".agents/skills/openapi-to-setup/scripts/inspect-project.mjs");
const hasher = join(repositoryRoot, ".agents/skills/openapi-to-setup/scripts/hash-setup-plan.mjs");

async function fixture(t, manifest = { private: true, packageManager: "pnpm@10.14.0" }) {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-setup-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await write(root, "package.json", `${JSON.stringify(manifest, null, 2)}\n`);
	return root;
}

async function write(root, relativePath, contents) {
	const target = join(root, relativePath);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, contents);
}

async function inspect(root, nodeVersion) {
	const preload = join(root, "override-node-version.cjs");
	if (nodeVersion) {
		await write(
			root,
			"override-node-version.cjs",
			`Object.defineProperty(process.versions, "node", { configurable: true, value: ${JSON.stringify(nodeVersion)} });\n`,
		);
	}
	const { stdout, stderr } = await execFileAsync(process.execPath, [
		...(nodeVersion ? ["--require", preload] : []),
		inspector,
		"--root",
		root,
	]);
	assert.equal(stderr, "");
	return { output: stdout, value: JSON.parse(stdout) };
}

async function createFileSymlink(t, target, linkPath) {
	try {
		await symlink(target, linkPath, "file");
		return true;
	} catch (error) {
		if (
			process.platform === "win32" &&
			["EACCES", "EPERM"].includes(error?.code)
		) {
			t.skip(`Windows denied symlink creation (${error.code})`);
			return false;
		}
		throw error;
	}
}

function fakeStats(overrides = {}) {
	return {
		dev: 1n,
		ino: 2n,
		size: 12n,
		birthtimeNs: 10n,
		ctimeNs: 20n,
		mtimeNs: 30n,
		mode: 0o100644n,
		nlink: 1n,
		isFile: () => true,
		...overrides,
	};
}

function setupPlan(overrides = {}) {
	return {
		schemaVersion: 1,
		mode: "read-only",
		observedStateHash: "a".repeat(64),
		packageManager: "pnpm",
		actions: [],
		verification: [],
		restartRequired: true,
		...overrides,
	};
}

async function hash(plan) {
	const { stdout, stderr, code } = await runWithInput(hasher, JSON.stringify(plan));
	assert.equal(code, 0);
	assert.equal(stderr, "");
	return JSON.parse(stdout);
}

async function rejectHash(planOrSource, pattern) {
	const result = await runWithInput(hasher, typeof planOrSource === "string" ? planOrSource : JSON.stringify(planOrSource));
	assert.notEqual(result.code, 0);
	assert.match(result.stderr, pattern);
	assert.equal(result.stdout, "");
}

function runWithInput(script, input) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [script], { stdio: ["pipe", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => { stdout += chunk; });
		child.stderr.on("data", (chunk) => { stderr += chunk; });
		child.once("error", reject);
		child.once("close", (code) => resolve({ code, stdout, stderr }));
		child.stdin.end(input);
	});
}

test("secure reader selects O_NOFOLLOW when available and O_RDONLY otherwise", async (t) => {
	assert.equal(
		selectReadFlags({ readOnlyFlag: constants.O_RDONLY, noFollowFlag: 0x20000 }),
		constants.O_RDONLY | 0x20000,
	);
	assert.equal(
		selectReadFlags({ readOnlyFlag: constants.O_RDONLY, noFollowFlag: undefined }),
		constants.O_RDONLY,
	);

	const root = await fixture(t);
	const realRoot = await realpath(root);
	const candidate = join(realRoot, "package.json");
	const before = await lstat(candidate, { bigint: true });
	const openedFile = await openVerifiedFile(
		realRoot,
		{
			path: candidate,
			realPath: await realpath(candidate),
			stats: before,
		},
		{
			readOnlyFlag: constants.O_RDONLY,
			noFollowFlag: undefined,
			platform: process.platform,
		},
	);
	assert.ok(openedFile.handle);
	try {
		const bytes = await openedFile.handle.readFile();
		const after = await openedFile.handle.stat({ bigint: true });
		assert.match(bytes.toString("utf8"), /"private": true/);
		assert.equal(unchangedDuringRead(openedFile.opened, after), true);
	} finally {
		await openedFile.handle.close();
	}
});

test("secure reader rejects identity and read-stability mismatches deterministically", () => {
	const before = fakeStats();
	assert.equal(sameOpenedFile(before, fakeStats({ ino: 3n })), false);
	assert.equal(sameOpenedFile(before, fakeStats({ dev: undefined })), false);
	assert.equal(sameOpenedFile(before, fakeStats({ ino: undefined })), false);
	assert.equal(unchangedDuringRead(before, fakeStats({ size: 13n })), false);
	assert.equal(unchangedDuringRead(before, fakeStats({ mtimeNs: 31n })), false);
	assert.equal(unchangedDuringRead(before, fakeStats({ nlink: undefined })), false);

	const windowsBefore = fakeStats({ dev: 0n });
	assert.equal(sameOpenedFile(windowsBefore, fakeStats({ dev: 0n }), "win32"), true);
	assert.equal(
		sameOpenedFile(windowsBefore, fakeStats({ dev: 0n, ino: 0n }), "win32"),
		false,
	);
	for (const field of ["size", "birthtimeNs", "ctimeNs", "mtimeNs", "mode"]) {
		assert.equal(
			sameOpenedFile(windowsBefore, fakeStats({ dev: 0n, [field]: undefined }), "win32"),
			false,
		);
	}
});

test("inspector hashes every bounded setup file without portable read failures", async (t) => {
	const root = await fixture(t, {
		private: true,
		packageManager: "pnpm@10.14.0",
		devDependencies: { "openapi-to": "4.2.0" },
	});
	await write(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
	await write(root, ".gitignore", "/.openapi-to/\n");
	await write(root, "openapi.config.ts", "export default {};\n");
	await write(
		root,
		".codex/config.toml",
		'[mcp_servers.openapi_to]\ncommand = "pnpm"\nargs = ["exec", "--", "openapi-to-mcp", "--workspace-root", ".", "--config", "openapi.config.ts"]\n',
	);
	const { value } = await inspect(root);
	assert.equal(value.state, "HOST_CONFIG_READY");
	assert.equal(value.blockingReasons.some((reason) => reason.endsWith("_READ_FAILED")), false);
	for (const digest of [
		value.workspace.packageJson.sha256,
		value.packageManager.lockFiles[0].sha256,
		value.runtimeState.gitignoreSha256,
		value.generationConfig.files[0].sha256,
		value.codex.sha256,
	]) {
		assert.match(digest, /^[a-f0-9]{64}$/);
	}
});

test("consumer fixture advances only through the setup states and binds every transition", async (t) => {
	const root = await fixture(t, {
		private: true,
		packageManager: "pnpm@10.14.0",
	});
	const packageMissing = (await inspect(root)).value;
	assert.equal(packageMissing.state, "PACKAGE_MISSING");

	await write(root, "package.json", `${JSON.stringify({
		private: true,
		packageManager: "pnpm@10.14.0",
		devDependencies: { "openapi-to": "4.2.0" },
	}, null, 2)}\n`);
	const configMissing = (await inspect(root)).value;
	assert.equal(configMissing.state, "CONFIG_MISSING");
	assert.notEqual(configMissing.observedStateHash, packageMissing.observedStateHash);

	await write(root, "openapi.config.ts", "export default {};\n");
	const hostMissing = (await inspect(root)).value;
	assert.equal(hostMissing.state, "HOST_CONFIG_MISSING");
	assert.notEqual(hostMissing.observedStateHash, configMissing.observedStateHash);

	await write(
		root,
		".codex/config.toml",
		'[mcp_servers.openapi_to]\ncommand = "pnpm"\nargs = ["exec", "--", "openapi-to-mcp", "--workspace-root", ".", "--config", "openapi.config.ts"]\n',
	);
	const hostReady = (await inspect(root)).value;
	assert.equal(hostReady.state, "HOST_CONFIG_READY");
	assert.equal(hostReady.codex.inferredMode, "read-only");
	assert.notEqual(hostReady.observedStateHash, hostMissing.observedStateHash);

	await write(root, "openapi.config.ts", "export default { changed: true };\n");
	const drifted = (await inspect(root)).value;
	assert.equal(drifted.state, "HOST_CONFIG_READY");
	assert.notEqual(drifted.observedStateHash, hostReady.observedStateHash);

	const missingManifestRoot = await mkdtemp(join(tmpdir(), "openapi-to-setup-no-manifest-"));
	t.after(() => rm(missingManifestRoot, { recursive: true, force: true }));
	const blocked = (await inspect(missingManifestRoot)).value;
	assert.equal(blocked.state, "BLOCKED");
	assert.ok(blocked.blockingReasons.includes("PACKAGE_JSON_MISSING"));
});

test("inspector reports a clean pnpm project with all setup capabilities missing", async (t) => {
	const root = await fixture(t);
	await write(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
	const { value, output } = await inspect(root);
	assert.equal(value.schemaVersion, 1);
	assert.equal(value.state, "PACKAGE_MISSING");
	assert.equal(value.packageManager.value, "pnpm");
	assert.equal(value.packageManager.evidence, "packageManager");
	assert.match(value.workspace.packageJson.sha256, /^[a-f0-9]{64}$/);
	assert.match(value.packageManager.lockFiles[0].sha256, /^[a-f0-9]{64}$/);
	assert.equal(value.packageManager.lockFiles[0].size, 23);
	assert.equal(value.dependencies.aggregate, null);
	assert.equal(value.generationConfig.status, "missing");
	assert.equal(value.runtimeState.ignored, false);
	assert.equal(value.codex.configPresent, false);
	assert.match(value.observedStateHash, /^[a-f0-9]{64}$/);
	assert.ok(Buffer.byteLength(output) < 64 * 1024);
	assert.doesNotMatch(output, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("inspector blocks Node 20 while accepting Node 22 and Node 24", async (t) => {
	for (const [nodeVersion, supported] of [
		["20.20.2", false],
		["22.0.0", true],
		["24.0.0", true],
	]) {
		const root = await fixture(t);
		const { value } = await inspect(root, nodeVersion);
		assert.equal(value.workspace.node.major, Number.parseInt(nodeVersion, 10));
		assert.equal(value.workspace.node.supported, supported);
		assert.equal(
			value.blockingReasons.includes("NODE_VERSION_UNSUPPORTED"),
			!supported,
		);
		assert.equal(value.state, supported ? "PACKAGE_MISSING" : "BLOCKED");
	}
});

test("inspector blocks a directory without package.json", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-setup-empty-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const { value } = await inspect(root);
	assert.equal(value.state, "BLOCKED");
	assert.ok(value.blockingReasons.includes("PACKAGE_JSON_MISSING"));
	assert.deepEqual(value.workspace.packageJson, {
		exists: false,
		valid: false,
		sha256: null,
	});
});

test("inspector binds manifest raw bytes even when setup diagnostics do not change", async (t) => {
	const root = await fixture(t);
	const before = (await inspect(root)).value;
	await write(root, "package.json", `${JSON.stringify({
		private: true,
		packageManager: "pnpm@10.14.0",
		scripts: { preinstall: "node changed.js" },
	}, null, 2)}\n`);
	const after = (await inspect(root)).value;
	assert.deepEqual(after.packageManager, before.packageManager);
	assert.deepEqual(after.dependencies, before.dependencies);
	assert.notEqual(after.workspace.packageJson.sha256, before.workspace.packageJson.sha256);
	assert.notEqual(after.observedStateHash, before.observedStateHash);
});

test("inspector hashes invalid package.json raw bytes while blocking it", async (t) => {
	const root = await fixture(t);
	await write(root, "package.json", '{"private":true\n');
	const { value, output } = await inspect(root);
	assert.equal(value.state, "BLOCKED");
	assert.equal(value.workspace.packageJson.valid, false);
	assert.match(value.workspace.packageJson.sha256, /^[a-f0-9]{64}$/);
	assert.ok(value.blockingReasons.includes("PACKAGE_JSON_INVALID"));
	assert.doesNotMatch(output, /\{"private":true/);
});

test("inspector distinguishes aggregate and MCP-only dependency boundaries", async (t) => {
	const aggregateRoot = await fixture(t, {
		private: true,
		packageManager: "pnpm@10.14.0",
		devDependencies: { "openapi-to": "4.2.0" },
	});
	const aggregate = (await inspect(aggregateRoot)).value;
	assert.equal(aggregate.state, "CONFIG_MISSING");
	assert.equal(aggregate.dependencies.aggregate.name, "openapi-to");
	assert.equal(aggregate.dependencies.mcpOnly, null);

	const mcpRoot = await fixture(t, {
		private: true,
		packageManager: "pnpm@10.14.0",
		devDependencies: { "@openapi-to/mcp": "4.2.0" },
	});
	const mcp = (await inspect(mcpRoot)).value;
	assert.equal(mcp.state, "PACKAGE_MISSING");
	assert.equal(mcp.dependencies.aggregate, null);
	assert.equal(mcp.dependencies.mcpOnly.name, "@openapi-to/mcp");
});

test("inspector blocks package-manager and openapi-to version conflicts", async (t) => {
	const managerRoot = await fixture(t);
	await write(managerRoot, "yarn.lock", "# yarn lockfile v1\n");
	const manager = (await inspect(managerRoot)).value;
	assert.equal(manager.state, "BLOCKED");
	assert.equal(manager.packageManager.value, "conflict");
	assert.ok(manager.blockingReasons.includes("PACKAGE_MANAGER_CONFLICT"));

	const locksRoot = await fixture(t, { private: true });
	await write(locksRoot, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
	await write(locksRoot, "package-lock.json", "{}\n");
	assert.ok((await inspect(locksRoot)).value.blockingReasons.includes("PACKAGE_MANAGER_CONFLICT"));

	const versionsRoot = await fixture(t, {
		private: true,
		packageManager: "pnpm@10.14.0",
		devDependencies: { "openapi-to": "4.2.0", "@openapi-to/mcp": "4.1.0" },
	});
	assert.ok((await inspect(versionsRoot)).value.blockingReasons.includes("OPENAPI_TO_VERSION_CONFLICT"));

	const unknownRoot = await fixture(t, { private: true, packageManager: "other@1.0.0" });
	await write(unknownRoot, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
	const unknown = (await inspect(unknownRoot)).value;
	assert.equal(unknown.packageManager.value, "unknown");
	assert.equal(unknown.packageManager.evidence, "unrecognized-packageManager");
	assert.ok(unknown.blockingReasons.includes("PACKAGE_MANAGER_UNKNOWN"));
});

test("inspector blocks multiple same-manager lockfiles instead of deduplicating them", async (t) => {
	for (const [manager, first, second] of [
		["npm", "package-lock.json", "npm-shrinkwrap.json"],
		["bun", "bun.lock", "bun.lockb"],
	]) {
		for (const manifest of [
			{ private: true },
			{ private: true, packageManager: `${manager}@1.0.0` },
		]) {
			const root = await fixture(t, manifest);
			await write(root, first, "first lock\n");
			await write(root, second, "second lock\n");
			const { value } = await inspect(root);
			assert.equal(value.state, "BLOCKED");
			assert.equal(value.packageManager.value, "conflict");
			assert.equal(value.packageManager.lockFiles.length, 2);
			assert.ok(
				value.packageManager.lockFiles.every(({ sha256 }) =>
					/^[a-f0-9]{64}$/.test(sha256),
				),
			);
			assert.ok(value.blockingReasons.includes("PACKAGE_MANAGER_CONFLICT"));
		}
	}
});

test("inspector binds lockfile raw bytes without changing manager evidence", async (t) => {
	const root = await fixture(t);
	await write(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
	const before = (await inspect(root)).value;
	await write(root, "pnpm-lock.yaml", "lockfileVersion: '9.1'\n");
	const after = (await inspect(root)).value;
	assert.equal(after.packageManager.value, before.packageManager.value);
	assert.equal(after.packageManager.evidence, before.packageManager.evidence);
	assert.equal(after.packageManager.lockFiles[0].file, before.packageManager.lockFiles[0].file);
	assert.equal(after.packageManager.lockFiles[0].manager, before.packageManager.lockFiles[0].manager);
	assert.notEqual(after.packageManager.lockFiles[0].sha256, before.packageManager.lockFiles[0].sha256);
	assert.notEqual(after.observedStateHash, before.observedStateHash);
});

test("inspector blocks oversized lockfiles without loading their contents", async (t) => {
	const root = await fixture(t);
	const lockfile = join(root, "pnpm-lock.yaml");
	await write(root, "pnpm-lock.yaml", "");
	await truncate(lockfile, 32 * 1024 * 1024 + 1);
	const { value } = await inspect(root);
	assert.equal(value.state, "BLOCKED");
	assert.ok(value.blockingReasons.includes("LOCKFILE_TOO_LARGE"));
	assert.equal(value.packageManager.lockFiles[0].size, 32 * 1024 * 1024 + 1);
	assert.equal(value.packageManager.lockFiles[0].sha256, null);
});

test("inspector blocks a non-regular lockfile", async (t) => {
	const root = await fixture(t);
	await mkdir(join(root, "pnpm-lock.yaml"));
	const { value } = await inspect(root);
	assert.equal(value.state, "BLOCKED");
	assert.ok(value.blockingReasons.includes("LOCKFILE_READ_FAILED"));
	assert.equal(value.packageManager.lockFiles[0].sha256, null);
});

test("inspector does not follow a lockfile symlink outside the project", async (t) => {
	const root = await fixture(t);
	const outside = await mkdtemp(join(tmpdir(), "openapi-to-setup-lock-outside-"));
	t.after(() => rm(outside, { recursive: true, force: true }));
	await write(outside, "pnpm-lock.yaml", "external-lock-secret\n");
	if (!(await createFileSymlink(t, join(outside, "pnpm-lock.yaml"), join(root, "pnpm-lock.yaml")))) return;
	const { value, output } = await inspect(root);
	assert.equal(value.state, "BLOCKED");
	assert.ok(value.blockingReasons.includes("LOCKFILE_OUTSIDE_ROOT"));
	assert.equal(value.packageManager.lockFiles[0].sha256, null);
	assert.doesNotMatch(output, /external-lock-secret/);
});

test("inspector fails closed on a dangling lockfile symlink", async (t) => {
	const root = await fixture(t);
	if (!(await createFileSymlink(t, "missing-lock-target", join(root, "pnpm-lock.yaml")))) return;
	const { value } = await inspect(root);
	assert.equal(value.state, "BLOCKED");
	assert.ok(value.blockingReasons.includes("LOCKFILE_OUTSIDE_ROOT"));
	assert.equal(value.packageManager.lockFiles[0].sha256, null);
});

test("inspector hashes one supported config without executing it and blocks multiples", async (t) => {
	const root = await fixture(t, {
		private: true,
		packageManager: "pnpm@10.14.0",
		devDependencies: { "openapi-to": "4.2.0" },
	});
	const marker = join(root, "executed.txt");
	const source = `await import("node:fs/promises").then((fs) => fs.writeFile(${JSON.stringify(marker)}, "bad"));\nexport default {};\n`;
	await write(root, "openapi.config.ts", source);
	const one = (await inspect(root)).value;
	assert.equal(one.generationConfig.status, "ready");
	assert.equal(one.generationConfig.files[0].path, "openapi.config.ts");
	assert.match(one.generationConfig.files[0].sha256, /^[a-f0-9]{64}$/);
	await assert.rejects(readFile(marker), /ENOENT/);

	await write(root, "openapi.config.js", "module.exports = {};\n");
	const multiple = (await inspect(root)).value;
	assert.equal(multiple.state, "BLOCKED");
	assert.equal(multiple.generationConfig.status, "multiple");
	assert.ok(multiple.blockingReasons.includes("MULTIPLE_GENERATION_CONFIGS"));
});

test("inspector invalidates state when generation config bytes drift", async (t) => {
	const root = await fixture(t);
	await write(root, "openapi.config.ts", "export default {};\n");
	const before = (await inspect(root)).value;
	await write(root, "openapi.config.ts", "export default { changed: true };\n");
	const after = (await inspect(root)).value;
	assert.notEqual(after.generationConfig.files[0].sha256, before.generationConfig.files[0].sha256);
	assert.notEqual(after.observedStateHash, before.observedStateHash);
});

test("inspector reports ignore state and conservative Codex modes without returning config bodies", async (t) => {
	const root = await fixture(t, {
		private: true,
		packageManager: "pnpm@10.14.0",
		devDependencies: { "openapi-to": "4.2.0" },
	});
	await write(root, "openapi.config.ts", "export default {};\n");
	await write(root, ".gitignore", "dist/\n/.openapi-to/\n");
	await mkdir(join(root, ".openapi-to"));
	await write(root, ".openapi-to/private-state.json", '{"token":"state-secret"}\n');
	await write(root, ".codex/config.toml", `[mcp_servers.other]\ncommand = "other"\n\n[mcp_servers.openapi_to]\ncommand = "pnpm"\nargs = ["exec", "--", "openapi-to-mcp", "--workspace-root", ".", "--config", "openapi.config.ts"]\n# private-value-123\n`);
	const { value, output } = await inspect(root);
	assert.equal(value.runtimeState.directoryPresent, true);
	assert.equal(value.runtimeState.ignored, true);
	assert.match(value.runtimeState.gitignoreSha256, /^[a-f0-9]{64}$/);
	assert.equal(value.codex.serverSectionCount, 1);
	assert.equal(value.codex.inferredMode, "read-only");
	assert.equal(value.codex.manualReviewRequired, true);
	assert.equal(value.codex.configurationBlocked, false);
	assert.equal(value.state, "HOST_CONFIG_READY");
	assert.equal(value.codex.parser, "conservative-text-inspection");
	assert.doesNotMatch(output, /private-value-123|state-secret|command =/);

	const unrelatedRoot = await fixture(t);
	await write(unrelatedRoot, ".codex/config.toml", `[mcp_servers.other]\ncommand = "other"\n`);
	const unrelated = (await inspect(unrelatedRoot)).value.codex;
	assert.equal(unrelated.configPresent, true);
	assert.equal(unrelated.serverSectionCount, 0);
	assert.equal(unrelated.inferredMode, "missing");
});

test("inspector binds gitignore and Codex raw bytes even when diagnostics stay unchanged", async (t) => {
	const root = await fixture(t);
	await write(root, ".gitignore", "/.openapi-to/\n");
	await write(root, ".codex/config.toml", "[mcp_servers.other]\ncommand = \"other\"\n");
	const before = (await inspect(root)).value;

	await write(root, ".gitignore", "/.openapi-to/\ndist/\n");
	await write(root, ".codex/config.toml", "# unrelated comment\n[mcp_servers.other]\ncommand = \"other\"\n");
	const after = (await inspect(root)).value;

	assert.equal(after.runtimeState.ignored, true);
	assert.equal(after.runtimeState.ignoreEvidence, before.runtimeState.ignoreEvidence);
	assert.notEqual(after.runtimeState.gitignoreSha256, before.runtimeState.gitignoreSha256);
	assert.equal(after.codex.inferredMode, before.codex.inferredMode);
	assert.notEqual(after.codex.sha256, before.codex.sha256);
	assert.notEqual(after.observedStateHash, before.observedStateHash);
});

test("inspector flags duplicate, absolute, and unsafe write-enabled Codex sections", async (t) => {
	const root = await fixture(t);
	await write(root, ".codex/config.toml", `[mcp_servers.openapi_to]\ncommand = "/usr/local/bin/pnpm"\nargs = ["exec", "--", "openapi-to-mcp", "--config", "openapi.config.ts", "--allow-write"]\n\n[mcp_servers.openapi_to]\ncommand = "pnpm"\n`);
	const duplicate = (await inspect(root)).value;
	assert.equal(duplicate.state, "BLOCKED");
	assert.equal(duplicate.codex.serverSectionCount, 2);
	assert.equal(duplicate.codex.absolutePathDetected, true);
	assert.equal(duplicate.codex.manualReviewRequired, true);

	const promptRoot = await fixture(t);
	await write(promptRoot, ".codex/config.toml", `[mcp_servers.openapi_to]\ncommand = "pnpm"\nargs = ["exec", "--", "openapi-to-mcp", "--config", "openapi.config.ts", "--allow-write"]\n\n[mcp_servers.openapi_to.tools.openapi_apply_generation]\napproval_mode = "prompt"\n`);
	const prompt = (await inspect(promptRoot)).value;
	assert.equal(prompt.codex.inferredMode, "write-enabled");
	assert.equal(prompt.codex.applyPromptDetected, true);
	assert.equal(prompt.state, "PACKAGE_MISSING");

	const unsafeWriteRoot = await fixture(t);
	await write(unsafeWriteRoot, ".codex/config.toml", `[mcp_servers.openapi_to]\ncommand = "pnpm"\nargs = ["exec", "--", "openapi-to-mcp", "--config", "openapi.config.ts", "--allow-write"]\n`);
	const unsafeWrite = (await inspect(unsafeWriteRoot)).value;
	assert.equal(unsafeWrite.state, "BLOCKED");
	assert.equal(unsafeWrite.codex.configurationBlocked, true);
	assert.ok(unsafeWrite.blockingReasons.includes("CODEX_CONFIG_MANUAL_REVIEW_REQUIRED"));

	const windowsRoot = await fixture(t);
	await write(windowsRoot, ".codex/config.toml", `[mcp_servers.openapi_to]\ncommand = "cmd.exe"\nargs = ["/d", "/s", "/c", "pnpm exec -- openapi-to-mcp --workspace-root . --config openapi.config.ts --allow-write"]\n\n[mcp_servers.openapi_to.tools.openapi_apply_generation]\napproval_mode = "prompt"\n`);
	const windows = (await inspect(windowsRoot)).value;
	assert.equal(windows.codex.inferredMode, "write-enabled");
	assert.equal(windows.codex.absolutePathDetected, false);
	assert.equal(windows.codex.configurationBlocked, false);
	assert.equal(windows.state, "PACKAGE_MISSING");

	const absoluteWindowsRoot = await fixture(t);
	await write(absoluteWindowsRoot, ".codex/config.toml", `[mcp_servers.openapi_to]\ncommand = "cmd.exe"\nargs = ["/d", "/s", "/c", "node C:\\\\tools\\\\openapi-to-mcp --workspace-root ."]\n`);
	const absoluteWindows = (await inspect(absoluteWindowsRoot)).value;
	assert.equal(absoluteWindows.state, "BLOCKED");
	assert.equal(absoluteWindows.codex.absolutePathDetected, true);

	const uncWindowsRoot = await fixture(t);
	await write(uncWindowsRoot, ".codex/config.toml", `[mcp_servers.openapi_to]\ncommand = "cmd.exe"\nargs = ["/d", "/s", "/c", "node \\\\server\\share\\openapi-to-mcp --workspace-root ."]\n`);
	const uncWindows = (await inspect(uncWindowsRoot)).value;
	assert.equal(uncWindows.state, "BLOCKED");
	assert.equal(uncWindows.codex.absolutePathDetected, true);

	const noncanonicalRoot = await fixture(t);
	await write(noncanonicalRoot, ".codex/config.toml", `["mcp_servers"."openapi_to"]\ncommand = "pnpm"\n`);
	const noncanonical = (await inspect(noncanonicalRoot)).value.codex;
	assert.equal(noncanonical.inferredMode, "unknown");
	assert.equal(noncanonical.manualReviewRequired, true);
});

test("inspector does not follow a supported config symlink outside the project", async (t) => {
	const root = await fixture(t);
	const outside = await mkdtemp(join(tmpdir(), "openapi-to-setup-outside-"));
	t.after(() => rm(outside, { recursive: true, force: true }));
	await write(outside, "secret-config.ts", "export default 'do-not-read';\n");
	if (!(await createFileSymlink(t, join(outside, "secret-config.ts"), join(root, "openapi.config.ts")))) return;
	const { value, output } = await inspect(root);
	assert.equal(value.state, "BLOCKED");
	assert.ok(value.blockingReasons.includes("GENERATION_CONFIG_OUTSIDE_ROOT"));
	assert.doesNotMatch(output, /do-not-read/);
});

test("inspector output remains bounded for many matching dependency declarations", async (t) => {
	const dependencies = { "openapi-to": "4.2.0" };
	for (let index = 0; index < 500; index += 1) dependencies[`@openapi-to/example-${index}`] = "4.2.0";
	const root = await fixture(t, { private: true, packageManager: "pnpm@10.14.0", devDependencies: dependencies });
	const { value, output } = await inspect(root);
	assert.equal(value.dependencies.total, 501);
	assert.equal(value.dependencies.packages.length, 100);
	assert.equal(value.dependencies.omitted, 401);
	assert.ok(Buffer.byteLength(output) < 64 * 1024);
});

test("plan hash is canonical for object keys, deterministic, and array-order sensitive", async () => {
	const firstPlan = setupPlan({
		actions: [{ kind: "run-command", command: "pnpm", args: ["exec", "openapi", "init"], network: false, expectedWrites: ["openapi.config.ts", ".gitignore"] }],
		verification: ["config", "ignore"],
	});
	const reordered = {
		verification: ["config", "ignore"],
		actions: [{ expectedWrites: ["openapi.config.ts", ".gitignore"], network: false, args: ["exec", "openapi", "init"], command: "pnpm", kind: "run-command" }],
		packageManager: "pnpm",
		restartRequired: true,
		observedStateHash: "a".repeat(64),
		mode: "read-only",
		schemaVersion: 1,
	};
	const first = await hash(firstPlan);
	const second = await hash(reordered);
	const repeated = await hash(firstPlan);
	assert.equal(first.setupPlanId, second.setupPlanId);
	assert.equal(first.setupPlanId, repeated.setupPlanId);
	assert.equal(JSON.parse(first.canonicalJson).schemaVersion, 1);
	const reversed = await hash({ ...firstPlan, verification: ["ignore", "config"] });
	assert.notEqual(first.setupPlanId, reversed.setupPlanId);
});

test("plan hash rejects sensitive fields, absolute paths, shell expressions, and escaping paths", async () => {
	for (const key of ["token", "authorization", "cookie", "secret", "password", "headers", "env"]) {
		await rejectHash(setupPlan({ [key]: "private" }), /forbidden sensitive field/);
	}
	await rejectHash(setupPlan({ actions: [{ kind: "create-file", path: "/tmp/config.toml" }] }), /must not be absolute/);
	await rejectHash(setupPlan({ actions: [{ kind: "create-file", path: "../config.toml" }] }), /stay inside the project root/);
	await rejectHash(setupPlan({ actions: [{ kind: "run-command", command: "pnpm && curl", args: [], network: false }] }), /program name/);
	await rejectHash(setupPlan({ actions: [{ kind: "run-command", command: "pnpm", args: ["--dir", "C:\\temp"], network: false }] }), /absolute or escaping target path/);
	await rejectHash(setupPlan({ actions: [{ kind: "run-command", command: "pnpm", args: ["--dir", "../outside"], network: false }] }), /absolute or escaping target path/);
	await rejectHash(setupPlan({ actions: [{ kind: "create-file", path: "openapi.config.ts", content: "export default {};", sha256: "not-a-hash" }] }), /sha256 must be a lowercase SHA-256/);
});

test("plan hash rejects oversized and invalid schemas", async () => {
	await rejectHash("x".repeat(256 * 1024 + 1), /exceeds the input size limit/);
	await rejectHash({ ...setupPlan(), schemaVersion: 2 }, /schemaVersion must equal 1/);
	await rejectHash({ ...setupPlan(), observedStateHash: "not-a-hash" }, /observedStateHash/);
	await rejectHash({ ...setupPlan(), actions: "install" }, /actions must be a bounded array/);
	await rejectHash({ ...setupPlan(), futureAuthority: true }, /unsupported field futureAuthority/);
});

test("plan hash accepts an explicit JSON file without modifying it", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-setup-plan-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const planPath = join(root, "plan.json");
	const source = `${JSON.stringify(setupPlan())}\n`;
	await writeFile(planPath, source);
	const { stdout, stderr } = await execFileAsync(process.execPath, [hasher, "--file", planPath]);
	assert.equal(stderr, "");
	assert.match(JSON.parse(stdout).setupPlanId, /^[a-f0-9]{64}$/);
	assert.equal(await readFile(planPath, "utf8"), source);
});
