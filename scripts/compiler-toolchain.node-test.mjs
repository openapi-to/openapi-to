import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const coreRoot = path.join(repositoryRoot, "packages/core");

function runNode(cwd, source) {
	const result = spawnSync(process.execPath, ["-e", source], {
		cwd,
		encoding: "utf8",
	});
	assert.equal(
		result.status,
		0,
		`Node probe failed in ${cwd}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
	);
	return result.stdout.trim();
}

function runBinary(binary, args) {
	const result = spawnSync(binary, args, {
		cwd: repositoryRoot,
		encoding: "utf8",
	});
	assert.equal(
		result.status,
		0,
		`${binary} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
	);
	return result.stdout.trim();
}

test("repository tsc uses the TypeScript 7 native CLI", async () => {
	const binary = path.join(repositoryRoot, "node_modules/.bin/tsc");
	await access(binary);
	assert.match(runBinary(binary, ["--version"]), /^Version 7\.0\.2$/);
	assert.equal(
		requirePackage("typescript-7").name,
		"typescript",
		"typescript-7 must be an alias of the native TypeScript package",
	);
});

test("the bare TypeScript package and tsc6 expose the TypeScript 6 bridge", async () => {
	const binary = path.join(repositoryRoot, "node_modules/.bin/tsc6");
	await access(binary);
	assert.match(runBinary(binary, ["--version"]), /^Version 6\.0\.3$/);
	assert.deepEqual(
		JSON.parse(
			runNode(
				coreRoot,
				'const ts = require("typescript"); console.log(JSON.stringify({ version: ts.version, createProgram: typeof ts.createProgram, parseJsonConfigFileContent: typeof ts.parseJsonConfigFileContent }));',
			),
		),
		{
			version: "6.0.3",
			createProgram: "function",
			parseJsonConfigFileContent: "function",
		},
	);
});

test("ts-morph remains backed by its TypeScript 6 compiler API", () => {
	assert.deepEqual(
		JSON.parse(
			runNode(
				coreRoot,
				'const { Project, ts } = require("ts-morph"); console.log(JSON.stringify({ version: ts.version, project: typeof Project }));',
			),
		),
		{ version: "6.0.2", project: "function" },
	);
});

function requirePackage(name) {
	return JSON.parse(
		runNode(
			repositoryRoot,
			`console.log(JSON.stringify(require(${JSON.stringify(`${name}/package.json`)})))`,
		),
	);
}
