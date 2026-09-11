import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	createPackedOverrides,
	createWorkspaceOverridesYaml,
	packReleasePackages,
} from "./release/pack-smoke-helpers.mjs";

const repositoryRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

function run(label, executable, args, cwd, expectedStatus = 0) {
	const result = spawnSync(executable, args, {
		cwd,
		encoding: "utf8",
		env: { ...process.env, NO_COLOR: "1" },
	});
	assert.equal(
		result.status,
		expectedStatus,
		`${label} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
	);
	return result;
}

function pnpm(args, cwd) {
	return run("pnpm", "pnpm", args, cwd);
}

const temporaryRoot = await mkdtemp(
	path.join(os.tmpdir(), "openapi-to-phase2-packed-"),
);
try {
	const tarballDirectory = path.join(temporaryRoot, "tarballs");
	const installationRoot = path.join(temporaryRoot, "installation");
	await mkdir(tarballDirectory);
	await mkdir(installationRoot);
	const packed = await packReleasePackages({
		repositoryRoot,
		tarballDirectory,
		pnpm,
	});
	const aggregate = packed.find(({ name }) => name === "openapi-to");
	assert(aggregate, "Packed aggregate archive is missing.");
	const overrides = createPackedOverrides(packed);
	await writeFile(
		path.join(installationRoot, "package.json"),
		`${JSON.stringify(
			{
				name: "openapi-to-phase2-packed-consumer",
				private: true,
				type: "module",
				dependencies: {
					"@tanstack/vue-query": "5.71.10",
					"@types/react": "^19.2.18",
					axios: "^1.19.0",
					msw: "^2.15.0",
					"openapi-to": `file:${aggregate.archive}`,
					react: "^19.2.8",
					swr: "2.5.0",
					"typescript-baseline": "npm:typescript@6.0.3",
					"typescript-current": "npm:typescript@7.0.2",
					"typescript-legacy": "npm:typescript@5.6.2",
					vue: "^3.5.41",
					zod: "^4.4.3",
				},
			},
			null,
			2,
		)}\n`,
	);
	await writeFile(
		path.join(installationRoot, "pnpm-workspace.yaml"),
		createWorkspaceOverridesYaml(overrides),
	);
	pnpm(
		[
			"install",
			"--ignore-scripts",
			"--prefer-offline",
			"--frozen-lockfile=false",
		],
		installationRoot,
	);

	run(
		"packed ESM import",
		process.execPath,
		[
			"--input-type=module",
			"-e",
			'import("openapi-to").then((module) => { if (typeof module.defineConfig !== "function") process.exit(1); })',
		],
		installationRoot,
	);
	run(
		"packed CommonJS require",
		process.execPath,
		[
			"-e",
			'if (typeof require("openapi-to").defineConfig !== "function") process.exit(1)',
		],
		installationRoot,
	);
	const bin = path.join(
		installationRoot,
		"node_modules/.bin",
		process.platform === "win32" ? "openapi.cmd" : "openapi",
	);
	run("packed bin", bin, ["--help"], installationRoot);

	const regression = run(
		"packed phase2 regression matrix",
		process.execPath,
		[
			path.join(repositoryRoot, "scripts/phase2-regression-smoke.mjs"),
			"--openapi-package-root",
			path.join(installationRoot, "node_modules/openapi-to"),
			"--dependency-root",
			path.join(installationRoot, "node_modules"),
			"--tsc",
			path.join(installationRoot, "node_modules/typescript-legacy/bin/tsc"),
			"--tsc",
			path.join(installationRoot, "node_modules/typescript-baseline/bin/tsc"),
			"--tsc",
			path.join(installationRoot, "node_modules/typescript-current/bin/tsc"),
		],
		installationRoot,
	);
	const report = JSON.parse(regression.stdout);
	assert.equal(report.success, true);
	process.stdout.write(
		`${JSON.stringify({
			success: true,
			packageVersion: aggregate.version,
			tarballs: packed.length,
			esm: true,
			commonjs: true,
			bin: true,
			regressions: report.tests,
			compilerVersions: report.compilerVersions,
		})}\n`,
	);
} finally {
	await rm(temporaryRoot, { recursive: true, force: true });
}
