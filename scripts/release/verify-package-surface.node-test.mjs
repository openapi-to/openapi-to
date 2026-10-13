import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmod,
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const canonicalRoot = "https://github.com/openapi-to/openapi-to";

async function put(root, path, contents, executable = false) {
	const target = join(root, path);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, contents);
	if (executable) await chmod(target, 0o755);
}

function exportTargets(value) {
	if (typeof value === "string") return [value];
	if (!value || typeof value !== "object") return [];
	return Object.values(value).flatMap(exportTargets);
}

async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-package-surface-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	for (const path of [
		"scripts/release/verify-package-surface.mjs",
		"scripts/node-runtime-contract.mjs",
		".changeset/config.json",
	]) {
		const target = join(root, path);
		await mkdir(dirname(target), { recursive: true });
		await copyFile(join(repositoryRoot, path), target);
	}
	for (const name of ["common", "module"])
		await put(
			root,
			`e2e/${name}/package.json`,
			JSON.stringify({ dependencies: { "openapi-to": "workspace:*" } }),
		);
	await put(root, "packages/openapi/src/index.ts", "");
	await put(
		root,
		"README.md",
		"`openapi` and `openapi-to` are CLI aliases; `openapi-to-mcp` starts the stdio MCP server\ndocs/capability-matrix.md\n",
	);

	const manifests = new Map();
	const config = JSON.parse(
		await readFile(join(repositoryRoot, ".changeset/config.json"), "utf8"),
	);
	for (const name of config.fixed[0]) {
		const directory =
			name === "openapi-to" ? "openapi" : name.replace("@openapi-to/", "");
		const path = `packages/${directory}/package.json`;
		const manifest = JSON.parse(
			await readFile(join(repositoryRoot, path), "utf8"),
		);
		manifests.set(name, { manifest, path });
		await put(root, path, `${JSON.stringify(manifest)}\n`);
		const targets = [
			manifest.main,
			manifest.module,
			manifest.types,
			...exportTargets(manifest.exports),
		].filter((target) => typeof target === "string" && !target.includes("*"));
		for (const target of targets) {
			if (target.replace(/^\.\//, "") !== "package.json")
				await put(root, `packages/${directory}/${target}`, "");
		}
		for (const target of Object.values(manifest.bin ?? {}))
			await put(
				root,
				`packages/${directory}/${target}`,
				"#!/usr/bin/env node\n",
				true,
			);
	}
	for (const path of [
		"packages/openapi/bin/openapi-to-mcp.js",
		"packages/mcp/bin/openapi-to-mcp.js",
	])
		await copyFile(join(repositoryRoot, path), join(root, path));
	const cli = manifests.get("@openapi-to/cli").manifest;
	const asset = "fixture\n";
	await put(
		root,
		"packages/cli/dist/skills/openapi-to-generate/references/capability-matrix.md",
		asset,
	);
	await put(
		root,
		"packages/cli/dist/skills/manifest.json",
		JSON.stringify({
			schemaVersion: 1,
			packageVersion: cli.version,
			skills: [
				{
					name: "openapi-to-generate",
					files: [
						{
							path: "references/capability-matrix.md",
							size: Buffer.byteLength(asset),
							sha256: createHash("sha256").update(asset).digest("hex"),
						},
					],
				},
				{ name: "openapi-to-setup", files: [] },
			],
		}),
	);
	return { root, manifests };
}

async function runVerifier(root) {
	try {
		const { stdout, stderr } = await execFileAsync(
			process.execPath,
			["scripts/release/verify-package-surface.mjs"],
			{ cwd: root },
		);
		return { code: 0, stdout, stderr };
	} catch (error) {
		return { code: error.code, stdout: error.stdout, stderr: error.stderr };
	}
}

test("public package URLs pass the package-surface verifier", async (t) => {
	const { root } = await fixture(t);
	const result = await runVerifier(root);
	assert.equal(result.code, 0, result.stderr);
	assert.equal(JSON.parse(result.stdout).packages.length, 12);
});

for (const [field, mutate, expected] of [
	[
		"repository",
		(manifest) => {
			manifest.repository.url = "https://github.com/Vc-great/openapi-to.git";
		},
		`${canonicalRoot}.git`,
	],
	[
		"bugs.url",
		(manifest) => {
			manifest.bugs.url = "https://github.com/Vc-great/openapi-to/issues";
		},
		`${canonicalRoot}/issues`,
	],
	[
		"homepage",
		(manifest) => {
			manifest.homepage = "https://github.com/Vc-great/openapi-to#readme";
		},
		`${canonicalRoot}#readme`,
	],
]) {
	test(`package-surface verifier rejects an old ${field} URL without changing workspace files`, async (t) => {
		const { root, manifests } = await fixture(t);
		const { manifest, path } = manifests.get("@openapi-to/core");
		mutate(manifest);
		await put(root, path, `${JSON.stringify(manifest)}\n`);
		const result = await runVerifier(root);
		assert.equal(result.code, 1);
		assert.match(
			result.stderr,
			new RegExp(
				`@openapi-to/core: ${field.replace(".", "\\.")} must (?:use|be) ${expected.replaceAll(".", "\\.")}`,
			),
		);
	});
}
