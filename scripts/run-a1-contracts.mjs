import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sanitizeText } from "./ci-diagnostics/sanitize.mjs";
import { MAX_KNOWN_REPORT_BYTES } from "./ci-diagnostics/schema.mjs";

const repositoryRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const files = [
	"packages/core/src/config/configuredTargets.test.ts",
	"packages/core/src/config/inputPath.windows.test.ts",
	"packages/core/src/config/outputRoot.test.ts",
	"packages/core/src/config/preflight.test.ts",
	"packages/core/src/config/remotePolicy.test.ts",
	"packages/core/src/openapi/sourceLoader.test.ts",
	"packages/core/src/openapi/sourceLoader.remote.test.ts",
	"packages/core/src/openapi/sourceLoader.redirect-security.test.ts",
	"packages/cli/src/generate.test.ts",
	"packages/cli/src/cli.integration.test.ts",
	"packages/mcp/src/options.test.ts",
	"packages/mcp/src/lifecycle.integration.test.ts",
	"packages/mcp/src/server.integration.test.ts",
];
const expectedTests = 154;
const artifactDirectory = path.resolve(
	process.env.A1_TEST_ARTIFACT_DIR ??
		path.join(repositoryRoot, ".ci-artifacts", "a1"),
);
const reportPath = path.join(artifactDirectory, "vitest.json");

function pnpmInvocation(args) {
	const entrypoint = process.env.npm_execpath;
	if (entrypoint && /\.(?:c|m)?js$/i.test(entrypoint)) {
		return { command: process.execPath, args: [entrypoint, ...args] };
	}
	return {
		command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
		args,
	};
}

function pnpmVersion() {
	const invocation = pnpmInvocation(["--version"]);
	const result = spawnSync(invocation.command, invocation.args, {
		cwd: repositoryRoot,
		encoding: "utf8",
		shell: false,
	});
	return result.status === 0 ? result.stdout.trim() : "unknown";
}

await rm(artifactDirectory, { recursive: true, force: true });
await mkdir(artifactDirectory, { recursive: true });
await Promise.all([
	writeFile(
		path.join(artifactDirectory, "test-files.txt"),
		`${files.join("\n")}\n`,
	),
	writeFile(
		path.join(artifactDirectory, "runtime.json"),
		`${JSON.stringify(
			{
				platform: process.platform,
				arch: process.arch,
				node: process.version,
				pnpm: pnpmVersion(),
			},
			null,
			2,
		)}\n`,
	),
]);

const invocation = pnpmInvocation([
	"exec",
	"vitest",
	"run",
	"--config",
	"./configs/vitest.config.ts",
	...files,
	"--reporter=default",
	"--reporter=json",
	`--outputFile=${reportPath}`,
]);
const result = await new Promise((resolve, reject) => {
	const child = spawn(invocation.command, invocation.args, {
		cwd: repositoryRoot,
		env: process.env,
		shell: false,
		stdio: "inherit",
	});
	child.once("error", reject);
	child.once("close", (code, signal) => resolve({ code, signal }));
});

let report;
try {
	const details = await stat(reportPath);
	if (details.size > MAX_KNOWN_REPORT_BYTES) {
		throw new Error("A1 Vitest report exceeded its bounded read limit.");
	}
	report = JSON.parse(await readFile(reportPath, "utf8"));
} catch {
	report = undefined;
}
const actualFiles = Array.isArray(report?.testResults)
	? report.testResults.length
	: 0;
const actualTests = Number(report?.numTotalTests ?? 0);
const failedTests = (report?.testResults ?? [])
	.flatMap((file) =>
		(file.assertionResults ?? [])
			.filter((test) => test.status === "failed")
			.map((test) => ({
				file: path
					.relative(repositoryRoot, file.name)
					.split(path.sep)
					.join("/"),
				title: sanitizeText(test.fullName ?? test.title).slice(0, 500),
				failure: sanitizeText(test.failureMessages?.[0] ?? "").slice(0, 2_000),
			})),
	)
	.slice(0, 10);
const inventoryMatches =
	actualFiles === files.length && actualTests === expectedTests;
await writeFile(
	path.join(artifactDirectory, "summary.json"),
	`${JSON.stringify(
		{
			exitCode: result.code,
			signal: result.signal,
			expectedFiles: files.length,
			actualFiles,
			expectedTests,
			actualTests,
			inventoryMatches,
			failedTests,
		},
		null,
		2,
	)}\n`,
);

if (result.code !== 0) {
	process.exitCode = result.code ?? 1;
} else if (!inventoryMatches || report?.success !== true) {
	process.stderr.write(
		`[a1-tests] Collected inventory changed: expected ${files.length} files/${expectedTests} tests, received ${actualFiles} files/${actualTests} tests.\n`,
	);
	process.exitCode = 1;
} else {
	process.stdout.write(
		`[a1-tests] verified actualVitestFiles=${actualFiles} actualVitestTests=${actualTests}\n`,
	);
}
