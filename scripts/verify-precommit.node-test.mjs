import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { main } from "./verify-precommit.mjs";

async function fixture() {
	const cwd = await mkdtemp(join(tmpdir(), "openapi-to-precommit-test-"));
	const command = (name, args) => {
		const result = spawnSync(name, args, { cwd, encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr || result.stdout);
		return result;
	};
	command("git", ["init", "-q"]);
	command("git", ["config", "user.email", "test@example.com"]);
	command("git", ["config", "user.name", "Test"]);
	await writeFile(join(cwd, "biome.json"), '{"linter":{"enabled":true}}\n');
	await writeFile(join(cwd, "base.ts"), "export const base = true;\n");
	await writeFile(join(cwd, "deleted.ts"), "export const deleted = true;\n");
	await writeFile(join(cwd, "old.ts"), "export const oldName = true;\n");
	command("git", [
		"add",
		"--",
		"biome.json",
		"base.ts",
		"deleted.ts",
		"old.ts",
	]);
	command("git", ["commit", "-qm", "base"]);
	return { cwd, command };
}

function fakeBiome(spawn, inspect) {
	return (command, args, options) => {
		if (command !== process.execPath) return spawn(command, args, options);
		assert.equal(args[1], "lint");
		inspect(args, options);
		return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
	};
}

test("lints exact staged blobs for partially staged files and preserves spaces and Unicode", async (t) => {
	const { cwd, command } = await fixture();
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const special = "space name ü.ts";
	const staged = "export const stagedValue = true;\n";
	await writeFile(join(cwd, special), staged);
	command("git", ["add", "--", special]);
	await writeFile(join(cwd, special), "export const workingValue = ;\n");
	await writeFile(join(cwd, "unstaged.ts"), "export const ignored = true;\n");
	const seen = [];
	const spawn = fakeBiome(spawnSync, (args) => {
		const config = args
			.find((arg) => arg.startsWith("--config-path="))
			?.slice("--config-path=".length);
		const files = args.slice(args.indexOf("--") + 1);
		seen.push({
			config: readFileSync(config, "utf8"),
			files: files.map((file) => [file, readFileSync(file, "utf8")]),
		});
	});
	const status = await main({ cwd, spawn, biomeCli: "test-biome" });
	assert.equal(status, 0);
	assert.equal(seen.length, 1);
	assert.deepEqual(
		seen[0].files.map(([file]) => file.split("/").at(-1)),
		[special],
	);
	assert.equal(seen[0].files[0][1], staged);
});

test("lints rename destinations, skips deletions and excludes generated fixtures", async (t) => {
	const { cwd, command } = await fixture();
	t.after(() => rm(cwd, { recursive: true, force: true }));
	command("git", ["mv", "old.ts", "renamed.ts"]);
	command("git", ["rm", "-q", "deleted.ts"]);
	await mkdir(join(cwd, "packages/plugin-zod/mock/zodModels"), {
		recursive: true,
	});
	await writeFile(
		join(cwd, "packages/plugin-zod/mock/zodModels/generated.ts"),
		"export const generated = true;\n",
	);
	command("git", [
		"add",
		"--",
		"packages/plugin-zod/mock/zodModels/generated.ts",
	]);
	let linted = [];
	const spawn = fakeBiome(spawnSync, (args) => {
		linted = args
			.slice(args.indexOf("--") + 1)
			.map((file) => file.split("/").at(-1));
	});
	assert.equal(await main({ cwd, spawn, biomeCli: "test-biome" }), 0);
	assert.deepEqual(linted, ["renamed.ts"]);
});

test("returns quickly for empty or non-lintable staged changes", async (t) => {
	const { cwd, command } = await fixture();
	t.after(() => rm(cwd, { recursive: true, force: true }));
	let invoked = false;
	const spawn = fakeBiome(spawnSync, () => {
		invoked = true;
	});
	assert.equal(await main({ cwd, spawn, biomeCli: "test-biome" }), 0);
	await writeFile(join(cwd, "README.md"), "documentation\n");
	command("git", ["add", "--", "README.md"]);
	assert.equal(await main({ cwd, spawn, biomeCli: "test-biome" }), 0);
	assert.equal(invoked, false);
});

test("runs the full gate for tooling and unknown configuration changes", async (t) => {
	const { cwd, command } = await fixture();
	t.after(() => rm(cwd, { recursive: true, force: true }));
	await writeFile(join(cwd, "biome.json"), '{"linter":{"enabled":false}}\n');
	await writeFile(join(cwd, "unknown-settings.yaml"), "quality: unknown\n");
	await writeFile(join(cwd, "unknown-script.py"), "print('unknown')\n");
	await mkdir(join(cwd, ".husky"), { recursive: true });
	await mkdir(join(cwd, "scripts"), { recursive: true });
	await writeFile(
		join(cwd, ".husky/pre-commit"),
		"node scripts/verify-precommit.mjs\n",
	);
	await writeFile(
		join(cwd, "scripts/verify-precommit.mjs"),
		"process.exitCode = 1;\n",
	);
	command("git", [
		"add",
		"--",
		"biome.json",
		"unknown-settings.yaml",
		"unknown-script.py",
		".husky/pre-commit",
		"scripts/verify-precommit.mjs",
	]);
	let fullRuns = 0;
	let lintRuns = 0;
	const spawn = fakeBiome(spawnSync, () => {
		lintRuns += 1;
	});
	const runFull = (_cwd, _spawn) => {
		fullRuns += 1;
		return { status: 0 };
	};
	assert.equal(await main({ cwd, spawn, runFull, biomeCli: "test-biome" }), 0);
	assert.equal(fullRuns, 1);
	assert.equal(lintRuns, 0);
});

test("fails closed when critical staged configuration differs from the working tree", async (t) => {
	const { cwd, command } = await fixture();
	t.after(() => rm(cwd, { recursive: true, force: true }));
	await writeFile(join(cwd, "biome.json"), '{"linter":{"enabled":false}}\n');
	command("git", ["add", "--", "biome.json"]);
	await writeFile(join(cwd, "biome.json"), '{"linter":{"enabled":true}}\n');
	let fullRuns = 0;
	await assert.rejects(
		main({
			cwd,
			spawn: spawnSync,
			runFull: () => {
				fullRuns += 1;
				return { status: 0 };
			},
		}),
		/unstaged edits/,
	);
	assert.equal(fullRuns, 0);
});

test("dispatches critical changes to full verification plus the gate regression tests", async (t) => {
	const { cwd, command } = await fixture();
	t.after(() => rm(cwd, { recursive: true, force: true }));
	await writeFile(join(cwd, "unknown-settings.yaml"), "quality: unknown\n");
	command("git", ["add", "--", "unknown-settings.yaml"]);
	let fullArgs;
	const spawn = (name, args, options) => {
		if (name === "pnpm") {
			fullArgs = args;
			return { status: 0 };
		}
		return spawnSync(name, args, options);
	};
	assert.equal(await main({ cwd, spawn }), 0);
	assert.deepEqual(fullArgs, ["run", "verify:precommit:tooling"]);
});

test("propagates Biome and full-verification failures", async (t) => {
	const { cwd, command } = await fixture();
	t.after(() => rm(cwd, { recursive: true, force: true }));
	await writeFile(join(cwd, "base.ts"), "export const base = false;\n");
	command("git", ["add", "--", "base.ts"]);
	const failedBiome = (name, args, options) =>
		name === process.execPath
			? { status: 7, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
			: spawnSync(name, args, options);
	assert.equal(
		await main({ cwd, spawn: failedBiome, biomeCli: "test-biome" }),
		7,
	);

	await writeFile(join(cwd, "package.json"), '{"scripts":{}}\n');
	command("git", ["add", "--", "package.json"]);
	const failedFull = (_cwd, _spawn) => ({ status: 9 });
	assert.equal(await main({ cwd, spawn: spawnSync, runFull: failedFull }), 9);
});

test("fails closed when the lint tool cannot be started", async (t) => {
	const { cwd, command } = await fixture();
	t.after(() => rm(cwd, { recursive: true, force: true }));
	await writeFile(
		join(cwd, "missing-tool.ts"),
		"export const missing = true;\n",
	);
	command("git", ["add", "--", "missing-tool.ts"]);
	const missing = await main({
		cwd,
		biomeCli: resolve(cwd, "not-installed.mjs"),
		spawn: (name, args, options) =>
			name === process.execPath
				? { status: null, error: new Error("lint tool missing") }
				: spawnSync(name, args, options),
	});
	assert.equal(missing, 1);
});

test("fails closed for staged symbolic links", async (t) => {
	if (process.platform === "win32") {
		t.skip("Creating a symbolic link may require elevated Windows privileges.");
		return;
	}
	const { cwd, command } = await fixture();
	t.after(() => rm(cwd, { recursive: true, force: true }));
	await symlink("base.ts", join(cwd, "linked.ts"));
	command("git", ["add", "--", "linked.ts"]);
	await assert.rejects(
		main({ cwd, spawn: spawnSync, biomeCli: "test-biome" }),
		/unsupported file mode/,
	);
});

test("runs the installed Biome CLI against staged source files", async (t) => {
	const { cwd, command } = await fixture();
	t.after(() => rm(cwd, { recursive: true, force: true }));
	await writeFile(join(cwd, "linted.ts"), "export const linted = true;\n");
	command("git", ["add", "--", "linted.ts"]);
	const biomeCli = resolve(
		process.cwd(),
		"node_modules/@biomejs/biome/bin/biome",
	);
	assert.equal(await main({ cwd, biomeCli }), 0);
	await writeFile(join(cwd, "linted.ts"), "export const linted = ;\n");
	command("git", ["add", "--", "linted.ts"]);
	assert.notEqual(await main({ cwd, biomeCli }), 0);
});
