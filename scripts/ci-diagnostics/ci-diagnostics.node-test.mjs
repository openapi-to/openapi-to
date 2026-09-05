import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
	link,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename as renameFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
	atomicWrite,
	readBoundedJsonFile,
	readBoundedRegularFile,
	repositoryRoot,
} from "./filesystem.mjs";
import {
	finalize,
	finalizeInitializationFailure,
	renderSummary,
} from "./finalize-job.mjs";
import { initialize } from "./initialize.mjs";
import { getPlan } from "./plans.mjs";
import {
	buildChildEnvironment,
	resolveInvocation,
	resolvePnpmEntrypoint,
	runCommand,
} from "./run-command.mjs";
import { markdownCell, sanitizeCommand, sanitizeText } from "./sanitize.mjs";
import {
	DIAGNOSTIC_KIND,
	jsonBytes,
	MAX_COMMAND_REPORT_BYTES,
	MAX_DIAGNOSTIC_BYTES,
	MAX_KNOWN_REPORT_BYTES,
	MAX_LINE_CHARS,
	MAX_PLAN_BYTES,
	MAX_TAIL_LINES,
	SCHEMA_VERSION,
} from "./schema.mjs";

const execFileAsync = promisify(execFile);
const runCommandPath = path.join(
	repositoryRoot,
	"scripts/ci-diagnostics/run-command.mjs",
);
const finalizeJobPath = path.join(
	repositoryRoot,
	"scripts/ci-diagnostics/finalize-job.mjs",
);

async function fixture(t, planId = "quality-build") {
	const root = await mkdtemp(
		path.join(os.tmpdir(), "openapi-to-ci-diagnostics-"),
	);
	t.after(() => rm(root, { recursive: true, force: true }));
	const directory = path.join(root, "diagnostic");
	const environment = {
		...process.env,
		GITHUB_WORKSPACE: repositoryRoot,
		RUNNER_TEMP: root,
		HOME: path.join(root, "home"),
	};
	await initialize({ dir: directory, plan: planId }, environment);
	return { root, directory, environment, plan: getPlan(planId) };
}

async function pnpmActionSetupFixture(t) {
	const root = await mkdtemp(
		path.join(os.tmpdir(), "openapi-to-pnpm-action-setup-"),
	);
	t.after(() => rm(root, { recursive: true, force: true }));
	const pnpmHome = path.join(root, "node_modules", ".bin");
	const entrypoint = path.join(root, "node_modules", "pnpm", "bin", "pnpm.cjs");
	await mkdir(path.dirname(entrypoint), { recursive: true });
	await mkdir(pnpmHome, { recursive: true });
	return { root, pnpmHome, entrypoint };
}

function finalizationOptions(directory, plan, overrides = {}) {
	return {
		dir: directory,
		uploadDir: `${directory}-upload`,
		plan,
		jobStatus: "success",
		matrix: {},
		steps: {
			checkout: "success",
			"diagnostics-init": "success",
			setup: "success",
		},
		...overrides,
	};
}

function commandReport(expected, overrides = {}) {
	const exitCode = overrides.exitCode ?? 0;
	const signal = overrides.signal ?? null;
	return {
		schemaVersion: SCHEMA_VERSION,
		kind: "openapi-to-ci-command",
		id: expected.id,
		label: expected.label,
		status: "success",
		exitCode,
		signal,
		durationMs: 5,
		command: ["node", "--version"],
		cwd: ".",
		process: {
			wrapperPid: 100,
			wrapperParentPid: 50,
			childPid: 101,
			spawnEventObserved: true,
			errorEventObserved: false,
			exitEventObserved: true,
			exitEventCode: exitCode,
			exitEventSignal: signal,
			closeEventObserved: true,
			closeEventCode: exitCode,
			closeEventSignal: signal,
			stdoutEndObserved: true,
			stdoutCloseObserved: true,
			stderrEndObserved: true,
			stderrCloseObserved: true,
		},
		resources: {
			start: {
				hostTotalMemoryBytes: 1_000_000,
				hostFreeMemoryBytes: 500_000,
				wrapperRssBytes: 100_000,
				wrapperHeapUsedBytes: 50_000,
			},
			end: {
				hostTotalMemoryBytes: 1_000_000,
				hostFreeMemoryBytes: 450_000,
				wrapperRssBytes: 110_000,
				wrapperHeapUsedBytes: 55_000,
			},
		},
		evidence: {
			stdout: {
				tail: [],
				totalLines: 0,
				truncated: false,
				truncatedLines: 0,
				candidates: [],
			},
			stderr: {
				tail: [],
				totalLines: 0,
				truncated: false,
				truncatedLines: 0,
				candidates: [],
			},
			spawnError: null,
		},
		...overrides,
	};
}

async function writeCommandReports(directory, plan, overrides = {}) {
	for (const expected of plan.commands) {
		const report = commandReport(expected, overrides[expected.id] ?? {});
		await atomicWrite(
			path.join(directory, "commands", `${expected.id}.json`),
			`${JSON.stringify(report, null, 2)}\n`,
		);
	}
}

async function listFiles(directory, relativeDirectory = "") {
	const result = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const relativePath = relativeDirectory
			? `${relativeDirectory}/${entry.name}`
			: entry.name;
		if (entry.isDirectory()) {
			result.push(
				...(await listFiles(path.join(directory, entry.name), relativePath)),
			);
		} else {
			result.push(relativePath);
		}
	}
	return result.sort();
}

async function writeCliReports(reportDirectory, overrides = {}) {
	await mkdir(reportDirectory, { recursive: true });
	const reports = {
		"runtime.json": {
			platform: "linux",
			arch: "x64",
			node: "v20.0.0",
			pnpmEntrypoint: "pnpm.cjs",
		},
		"summary.json": {
			mode: "common",
			status: "passed",
			stage: "complete",
			commands: [],
			...overrides.summary,
		},
		"fixture.json": {
			kind: "local-json",
			path: "petstore.json",
			...overrides.fixture,
		},
	};
	for (const [name, value] of Object.entries(reports)) {
		await writeFile(
			path.join(reportDirectory, name),
			`${JSON.stringify(value, null, 2)}\n`,
		);
	}
	await writeFile(
		path.join(reportDirectory, "generated-files.txt"),
		"10\tpet.model.ts\n",
	);
}

async function writeA1Reports(reportDirectory, overrides = {}) {
	await mkdir(reportDirectory, { recursive: true });
	const reports = {
		"runtime.json": {
			platform: "linux",
			arch: "x64",
			node: "v20.0.0",
			pnpm: "10.14.0",
		},
		"summary.json": {
			exitCode: 0,
			signal: null,
			expectedFiles: 1,
			actualFiles: 1,
			expectedTests: 1,
			actualTests: 1,
			inventoryMatches: true,
			failedTests: [],
			...overrides.summary,
		},
		"vitest.json": {
			success: true,
			numTotalTests: 1,
			numPassedTests: 1,
			numFailedTests: 0,
			testResults: [{ assertionResults: [] }],
			...overrides.vitest,
		},
	};
	for (const [name, value] of Object.entries(reports)) {
		await writeFile(
			path.join(reportDirectory, name),
			`${JSON.stringify(value, null, 2)}\n`,
		);
	}
	await writeFile(
		path.join(reportDirectory, "test-files.txt"),
		"one.test.ts\n",
	);
}

async function withoutProcessOutput(operation) {
	const stdoutWrite = process.stdout.write;
	const stderrWrite = process.stderr.write;
	process.stdout.write = () => true;
	process.stderr.write = () => true;
	try {
		return await operation();
	} finally {
		process.stdout.write = stdoutWrite;
		process.stderr.write = stderrWrite;
	}
}

test("command wrapper streams stdout and records a successful command", async (t) => {
	const { directory, environment } = await fixture(t);
	const result = await execFileAsync(
		process.execPath,
		[
			runCommandPath,
			"--dir",
			directory,
			"--id",
			"build",
			"--",
			process.execPath,
			"-e",
			"process.stdout.write('visible-output\\n')",
		],
		{ env: environment },
	);
	assert.match(result.stdout, /visible-output/);
	const report = JSON.parse(
		await readFile(path.join(directory, "commands/build.json"), "utf8"),
	);
	assert.equal(report.status, "success");
	assert.equal(report.exitCode, 0);
	assert.equal(report.process.spawnEventObserved, true);
	assert.equal(report.process.exitEventObserved, true);
	assert.equal(report.process.closeEventObserved, true);
	assert.equal(report.process.stdoutEndObserved, true);
	assert.equal(report.process.stderrEndObserved, true);
	assert.ok(report.process.childPid > 0);
	assert.ok(report.resources.start.hostTotalMemoryBytes > 0);
});

test("command wrapper preserves a failing exit code", async (t) => {
	const { directory, environment } = await fixture(t);
	await assert.rejects(
		execFileAsync(
			process.execPath,
			[
				runCommandPath,
				"--dir",
				directory,
				"--id",
				"build",
				"--",
				process.execPath,
				"-e",
				"process.exit(7)",
			],
			{ env: environment },
		),
		(error) => error.code === 7,
	);
	const report = JSON.parse(
		await readFile(path.join(directory, "commands/build.json"), "utf8"),
	);
	assert.equal(report.status, "failure");
	assert.equal(report.exitCode, 7);
	assert.equal(report.process.exitEventCode, 7);
	assert.equal(report.process.closeEventCode, 7);
	assert.equal(report.process.exitEventSignal, null);
	assert.equal(report.process.closeEventSignal, null);
});

test("command wrapper preserves ordinary stderr beside a nonzero lifecycle", async (t) => {
	const { directory, environment } = await fixture(t);
	await assert.rejects(
		execFileAsync(
			process.execPath,
			[
				runCommandPath,
				"--dir",
				directory,
				"--id",
				"build",
				"--",
				process.execPath,
				"-e",
				"process.stderr.write('ordinary failure\\n'); process.exit(3)",
			],
			{ env: environment },
		),
		(error) => error.code === 3,
	);
	const report = JSON.parse(
		await readFile(path.join(directory, "commands/build.json"), "utf8"),
	);
	assert.equal(report.evidence.stderr.tail.at(-1), "ordinary failure");
	assert.equal(report.process.exitEventCode, 3);
	assert.equal(report.process.closeEventCode, 3);
});

test("command wrapper records a signal as a non-successful exit", {
	skip: process.platform === "win32",
}, async (t) => {
	const { directory, environment } = await fixture(t);
	await assert.rejects(
		execFileAsync(
			process.execPath,
			[
				runCommandPath,
				"--dir",
				directory,
				"--id",
				"build",
				"--",
				process.execPath,
				"-e",
				"process.kill(process.pid, 'SIGTERM')",
			],
			{ env: environment },
		),
	);
	const report = JSON.parse(
		await readFile(path.join(directory, "commands/build.json"), "utf8"),
	);
	assert.equal(report.status, "signalled");
	assert.equal(report.signal, "SIGTERM");
	assert.equal(report.process.exitEventSignal, "SIGTERM");
	assert.equal(report.process.closeEventSignal, "SIGTERM");
});

test("command wrapper distinguishes timeout and terminates the child", async (t) => {
	const { directory, environment } = await fixture(t);
	const started = Date.now();
	await assert.rejects(
		execFileAsync(
			process.execPath,
			[
				runCommandPath,
				"--dir",
				directory,
				"--id",
				"build",
				"--timeout-ms",
				"100",
				"--",
				process.execPath,
				"-e",
				"setInterval(() => {}, 1000)",
			],
			{ env: environment, timeout: 5_000 },
		),
	);
	assert.ok(Date.now() - started < 5_000);
	const report = JSON.parse(
		await readFile(path.join(directory, "commands/build.json"), "utf8"),
	);
	assert.equal(report.status, "timeout");
	assert.notEqual(report.exitCode, 0);
	assert.equal(report.process.spawnEventObserved, true);
	assert.equal(report.process.exitEventObserved, true);
	assert.equal(report.process.closeEventObserved, true);
});

test("command spawn failure is an infrastructure error", async (t) => {
	const { directory, environment } = await fixture(t);
	const result = await runCommand(
		{
			dir: directory,
			id: "build",
			command: ["definitely-missing-openapi-to-command"],
			timeoutMs: null,
		},
		environment,
	);
	assert.equal(result.exitCode, 1);
	assert.equal(result.report.status, "infrastructure-error");
	assert.match(result.report.evidence.spawnError, /ENOENT/);
	assert.equal(result.report.process.errorEventObserved, true);
	assert.equal(result.report.process.spawnEventObserved, false);
	assert.equal(result.report.process.childPid, null);
});

test("command report write failure cannot turn a gate failure into success", async (t) => {
	const { directory, environment } = await fixture(t);
	await assert.rejects(
		runCommand(
			{
				dir: directory,
				id: "build",
				command: [process.execPath, "-e", "process.exit(6)"],
				timeoutMs: null,
			},
			environment,
			{
				writeReport: async () => {
					throw new Error("simulated atomic write failure");
				},
			},
		),
		(error) =>
			error.message === "simulated atomic write failure" &&
			error.commandExitCode === 6,
	);
});

test("combined saturated stdout and stderr stays within the report limit", async (t) => {
	const root = await mkdtemp(
		path.join(repositoryRoot, ".ci-artifacts", "bounded-turbo-evidence-"),
	);
	t.after(() => rm(root, { recursive: true, force: true }));
	const directory = path.join(root, "diagnostic");
	const environment = {
		...process.env,
		GITHUB_WORKSPACE: repositoryRoot,
		RUNNER_TEMP: root,
		HOME: path.join(root, "home"),
	};
	await initialize({ dir: directory, plan: "quality-build" }, environment);
	const script = [
		"for(let i=0;i<250;i++){console.log('\\u001b[31mline-'+i+'-'+ 'x'.repeat(2000)+'\\u001b[0m');console.error('error-'+i+'-'+ 'y'.repeat(2000))}",
	].join(";");
	const result = await withoutProcessOutput(() =>
		runCommand(
			{
				dir: directory,
				id: "build",
				command: [process.execPath, "-e", script],
				timeoutMs: null,
			},
			environment,
		),
	);
	assert.equal(result.report.evidence.stdout.tail.length, MAX_TAIL_LINES);
	assert.equal(result.report.evidence.stderr.tail.length, MAX_TAIL_LINES);
	assert.equal(result.report.evidence.stdout.truncated, true);
	assert.equal(result.report.evidence.stderr.truncated, true);
	assert.ok(
		result.report.evidence.stdout.tail.every(
			(line) => line.length <= MAX_LINE_CHARS + 18,
		),
	);
	assert.ok(!JSON.stringify(result.report).includes("\u001b"));
	assert.ok(jsonBytes(result.report) <= MAX_COMMAND_REPORT_BYTES);
});

test("pnpm invocation uses an existing npm_execpath on every platform", async (t) => {
	const { entrypoint } = await pnpmActionSetupFixture(t);
	await writeFile(entrypoint, "process.exitCode = 0;\n");
	for (const platform of ["win32", "linux", "darwin"]) {
		assert.deepEqual(
			await resolveInvocation("pnpm", ["build"], {
				platform,
				environment: { npm_execpath: entrypoint },
				execPath: process.execPath,
			}),
			{
				command: process.execPath,
				args: [entrypoint, "build"],
			},
			platform,
		);
	}
});

test("pnpm invocation resolves the pnpm/action-setup PNPM_HOME layout", async (t) => {
	const { pnpmHome, entrypoint } = await pnpmActionSetupFixture(t);
	await writeFile(entrypoint, "process.exitCode = 0;\n");
	assert.equal(
		await resolvePnpmEntrypoint({
			npm_execpath: "",
			PNPM_HOME: pnpmHome,
		}),
		entrypoint,
	);
	assert.deepEqual(
		await resolveInvocation("pnpm", ["--version"], {
			platform: "win32",
			environment: { npm_execpath: "", PNPM_HOME: pnpmHome },
			execPath: process.execPath,
		}),
		{
			command: process.execPath,
			args: [entrypoint, "--version"],
		},
	);
});

test("Windows pnpm invocation rejects missing, directory, and symlink entrypoints", async (t) => {
	const stableError =
		/Unable to locate a safely executable pnpm JavaScript entrypoint on Windows\./;
	await assert.rejects(
		resolveInvocation("pnpm", ["--version"], {
			platform: "win32",
			environment: { npm_execpath: "", PNPM_HOME: "" },
		}),
		stableError,
	);

	const missing = await pnpmActionSetupFixture(t);
	await assert.rejects(
		resolveInvocation("pnpm", ["--version"], {
			platform: "win32",
			environment: {
				npm_execpath: path.join(missing.root, "missing.cjs"),
				PNPM_HOME: missing.pnpmHome,
			},
		}),
		stableError,
	);

	const directory = await pnpmActionSetupFixture(t);
	await mkdir(directory.entrypoint);
	await assert.rejects(
		resolveInvocation("pnpm", ["--version"], {
			platform: "win32",
			environment: { PNPM_HOME: directory.pnpmHome },
		}),
		stableError,
	);

	const linked = await pnpmActionSetupFixture(t);
	const target = path.join(linked.root, "target.cjs");
	await writeFile(target, "process.exitCode = 0;\n");
	try {
		await symlink(target, linked.entrypoint);
	} catch (error) {
		if (process.platform === "win32" && error.code === "EPERM") {
			t.diagnostic("file symlink creation is not permitted on this runner");
			return;
		}
		throw error;
	}
	await assert.rejects(
		resolveInvocation("pnpm", ["--version"], {
			platform: "win32",
			environment: { PNPM_HOME: linked.pnpmHome },
		}),
		stableError,
	);
});

test("pnpm JavaScript invocation preserves arguments without shell parsing", async (t) => {
	const { entrypoint } = await pnpmActionSetupFixture(t);
	await writeFile(entrypoint, "process.exitCode = 0;\n");
	for (const args of [
		["build", "--concurrency=1"],
		["test:mcp:smoke"],
		["--version"],
	]) {
		assert.deepEqual(
			await resolveInvocation("pnpm", args, {
				platform: "win32",
				environment: { npm_execpath: entrypoint },
				execPath: process.execPath,
			}),
			{ command: process.execPath, args: [entrypoint, ...args] },
		);
	}
});

test("command wrapper starts pnpm --version as a real process", async (t) => {
	const { directory, environment } = await fixture(t);
	const executionEnvironment = {
		...environment,
		HOME: process.env.HOME ?? environment.HOME,
	};
	const result = await withoutProcessOutput(() =>
		runCommand(
			{
				dir: directory,
				id: "build",
				command: ["pnpm", "--version"],
				timeoutMs: null,
			},
			executionEnvironment,
		),
	);
	assert.equal(result.exitCode, 0);
	assert.equal(result.report.status, "success");
	assert.deepEqual(result.report.command, ["pnpm", "--version"]);
	assert.match(result.report.evidence.stdout.tail.join("\n"), /\b10\.14\.0\b/);
});

test("command wrapper starts the pnpm/action-setup entrypoint for simulated Windows", async (t) => {
	const { directory, environment } = await fixture(t);
	const { pnpmHome, entrypoint } = await pnpmActionSetupFixture(t);
	await writeFile(
		entrypoint,
		"if (process.argv[2] !== '--version') process.exit(2);\nprocess.stdout.write('10.14.0\\n');\n",
	);
	const result = await withoutProcessOutput(() =>
		runCommand(
			{
				dir: directory,
				id: "build",
				command: ["pnpm", "--version"],
				timeoutMs: null,
			},
			{
				...environment,
				npm_execpath: "",
				PNPM_HOME: pnpmHome,
			},
			{ platform: "win32" },
		),
	);
	assert.equal(result.exitCode, 0);
	assert.equal(result.report.status, "success");
	assert.deepEqual(result.report.command, ["pnpm", "--version"]);
	assert.deepEqual(result.report.evidence.stdout.tail, ["10.14.0"]);
});

test("child environment removes GitHub control files and credentials while retaining execution and plan domain variables", async (t) => {
	const { root, directory, environment, plan } = await fixture(
		t,
		"a1-contracts",
	);
	const domainDirectory = path.join(root, "a1-domain");
	const observedPath = path.join(root, "observed-env.json");
	const controlPaths = Object.fromEntries(
		["GITHUB_ENV", "GITHUB_PATH", "GITHUB_OUTPUT", "GITHUB_STEP_SUMMARY"].map(
			(name) => [name, path.join(root, `${name}.txt`)],
		),
	);
	for (const controlPath of Object.values(controlPaths)) {
		await writeFile(controlPath, "parent\n");
	}
	const hostileEnvironment = {
		...environment,
		...controlPaths,
		CI: "true",
		A1_TEST_ARTIFACT_DIR: domainDirectory,
		CI_DIAGNOSTIC_UPLOAD_DIR: path.join(root, "must-not-leak"),
		GITHUB_EVENT_PATH: path.join(root, "event.json"),
		GITHUB_TOKEN: "github-token",
		GH_TOKEN: "gh-token",
		NODE_AUTH_TOKEN: "node-token",
		NPM_TOKEN: "npm-token",
		ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-token",
		ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.invalid",
		ACTIONS_RUNTIME_TOKEN: "runtime-token",
		ACTIONS_RUNTIME_URL: "https://runtime.invalid",
		ACTIONS_RESULTS_URL: "https://results.invalid",
		ACTIONS_CACHE_URL: "https://cache.invalid",
	};
	const childEnvironment = await buildChildEnvironment(
		hostileEnvironment,
		plan,
	);
	for (const key of [
		...Object.keys(controlPaths),
		"GITHUB_TOKEN",
		"GH_TOKEN",
		"NODE_AUTH_TOKEN",
		"NPM_TOKEN",
		"ACTIONS_ID_TOKEN_REQUEST_TOKEN",
		"ACTIONS_RUNTIME_TOKEN",
		"GITHUB_EVENT_PATH",
		"CI_DIAGNOSTIC_DIR",
		"CI_DIAGNOSTIC_UPLOAD_DIR",
	]) {
		assert.equal(childEnvironment[key], undefined, key);
	}
	assert.ok(childEnvironment.PATH);
	assert.equal(childEnvironment.CI, "true");
	assert.equal(childEnvironment.A1_TEST_ARTIFACT_DIR, domainDirectory);

	const script = `
		const fs = require("node:fs");
		for (const key of ["GITHUB_ENV","GITHUB_PATH","GITHUB_OUTPUT","GITHUB_STEP_SUMMARY"]) {
			if (process.env[key]) fs.appendFileSync(process.env[key], "child\\n");
		}
		const keys = ["PATH","TMP","TEMP","TMPDIR","CI","A1_TEST_ARTIFACT_DIR","GITHUB_TOKEN","GH_TOKEN","ACTIONS_RUNTIME_TOKEN","CI_DIAGNOSTIC_UPLOAD_DIR"];
		fs.writeFileSync(process.argv[1], JSON.stringify(Object.fromEntries(keys.map((key) => [key, process.env[key] ?? null]))));
	`;
	await runCommand(
		{
			dir: directory,
			id: "build",
			command: [process.execPath, "-e", script, observedPath],
			timeoutMs: null,
		},
		hostileEnvironment,
	);
	const observed = JSON.parse(await readFile(observedPath, "utf8"));
	assert.ok(observed.PATH);
	assert.ok(observed.TMP || observed.TEMP || observed.TMPDIR);
	assert.equal(observed.CI, "true");
	assert.equal(observed.A1_TEST_ARTIFACT_DIR, domainDirectory);
	assert.equal(observed.GITHUB_TOKEN, null);
	assert.equal(observed.GH_TOKEN, null);
	assert.equal(observed.ACTIONS_RUNTIME_TOKEN, null);
	assert.equal(observed.CI_DIAGNOSTIC_UPLOAD_DIR, null);
	for (const controlPath of Object.values(controlPaths)) {
		assert.equal(await readFile(controlPath, "utf8"), "parent\n");
	}
});

test("domain artifact paths allow the workspace or runner temp and reject other roots", async (t) => {
	const root = await mkdtemp(
		path.join(os.tmpdir(), "openapi-to-ci-artifact-roots-"),
	);
	t.after(() => rm(root, { recursive: true, force: true }));
	const workspace = path.join(root, "workspace");
	const runnerTemp = path.join(root, "runner-temp");
	const outside = path.join(root, "outside");
	await Promise.all([
		mkdir(workspace, { recursive: true }),
		mkdir(runnerTemp, { recursive: true }),
		mkdir(outside, { recursive: true }),
	]);
	const plan = getPlan("a1-contracts");
	const environment = {
		...process.env,
		GITHUB_WORKSPACE: workspace,
		RUNNER_TEMP: runnerTemp,
		A1_TEST_ARTIFACT_DIR: path.join(workspace, ".ci-artifacts", "a1-contracts"),
	};

	const childEnvironment = await buildChildEnvironment(environment, plan);
	assert.equal(
		childEnvironment.A1_TEST_ARTIFACT_DIR,
		environment.A1_TEST_ARTIFACT_DIR,
	);

	await assert.rejects(
		buildChildEnvironment(
			{
				...environment,
				A1_TEST_ARTIFACT_DIR: outside,
			},
			plan,
		),
		/must stay within GITHUB_WORKSPACE or RUNNER_TEMP/,
	);
});

test("a missing pnpm executable becomes infrastructure-error and remains visible to the finalizer", async (t) => {
	const { root, directory, environment } = await fixture(t);
	const emptyPath = path.join(root, "empty-path");
	await mkdir(emptyPath);
	const isolatedEnvironment = {
		...environment,
		PATH: emptyPath,
		npm_execpath: "",
		PNPM_HOME: path.join(root, "missing-pnpm-home"),
	};
	const command = await runCommand(
		{
			dir: directory,
			id: "build",
			command: ["pnpm", "--version"],
			timeoutMs: null,
		},
		isolatedEnvironment,
		{ platform: "win32" },
	);
	assert.equal(command.report.status, "infrastructure-error");
	assert.match(
		command.report.evidence.spawnError,
		/Unable to locate a safely executable pnpm JavaScript entrypoint on Windows\./,
	);
	const result = await finalize(
		finalizationOptions(directory, "quality-build", {
			jobStatus: "failure",
		}),
		isolatedEnvironment,
	);
	assert.equal(result.diagnostic.commands[0].status, "infrastructure-error");
	assert.equal(result.diagnostic.status, "failure");
});

test("bounded readers reject oversize, replacement, symlink, hard-link, invalid UTF-8, and invalid JSON inputs", async (t) => {
	const { root } = await fixture(t);
	const oversized = path.join(root, "oversized.txt");
	await writeFile(oversized, Buffer.alloc(33, 0x61));
	await assert.rejects(
		readBoundedRegularFile(oversized, { maxBytes: 32 }),
		(error) => error.diagnosticFileStatus === "too-large",
	);

	const replaced = path.join(root, "replaced.txt");
	const replacement = path.join(root, "replacement.txt");
	await writeFile(replaced, "before");
	await writeFile(replacement, "after");
	await assert.rejects(
		readBoundedRegularFile(replaced, {
			maxBytes: 32,
			onAfterLstat: async () => {
				await rm(replaced);
				await renameFile(replacement, replaced);
			},
		}),
		/replaced|changed|opened|symlink/i,
	);

	const target = path.join(root, "target.txt");
	const regularToLink = path.join(root, "regular-to-link.txt");
	const symlinkProbe = path.join(root, "symlink-probe.txt");
	await writeFile(target, "target");
	await writeFile(regularToLink, "regular");
	let canCreateSymlink = true;
	try {
		await symlink(target, symlinkProbe);
		await rm(symlinkProbe);
	} catch (error) {
		if (process.platform === "win32" && error.code === "EPERM") {
			canCreateSymlink = false;
			t.diagnostic("file symlink creation is not permitted on this runner");
		} else {
			throw error;
		}
	}
	if (canCreateSymlink) {
		await assert.rejects(
			readBoundedRegularFile(regularToLink, {
				maxBytes: 32,
				onAfterLstat: async () => {
					await rm(regularToLink);
					await symlink(target, regularToLink);
				},
			}),
			/symlink|changed|opened/i,
		);
		const symlinkToRegular = path.join(root, "symlink-to-regular.txt");
		await symlink(target, symlinkToRegular);
		await assert.rejects(
			readBoundedRegularFile(symlinkToRegular, { maxBytes: 32 }),
			/symlink/,
		);
		await rm(symlinkToRegular);
		await writeFile(symlinkToRegular, "now-regular");
		assert.equal(
			(
				await readBoundedRegularFile(symlinkToRegular, {
					maxBytes: 32,
				})
			).contents,
			"now-regular",
		);
	}

	const hardLink = path.join(root, "hard-link.txt");
	await link(target, hardLink);
	await assert.rejects(
		readBoundedRegularFile(hardLink, { maxBytes: 32 }),
		/hard-linked/,
	);

	const invalidUtf8 = path.join(root, "invalid-utf8.json");
	await writeFile(invalidUtf8, Buffer.from([0xc3, 0x28]));
	await assert.rejects(
		readBoundedRegularFile(invalidUtf8, { maxBytes: 32 }),
		/valid UTF-8/,
	);
	await rm(invalidUtf8);

	const invalidJson = path.join(root, "invalid.json");
	await writeFile(invalidJson, "{broken");
	await assert.rejects(
		readBoundedJsonFile(invalidJson, { maxBytes: 32 }),
		(error) =>
			error.diagnosticFileStatus === "invalid" && error.message.length < 100,
	);
});

test("command ids and diagnostic path traversal are rejected", async (t) => {
	const { directory, environment } = await fixture(t);
	await assert.rejects(
		runCommand(
			{
				dir: directory,
				id: "../build",
				command: [process.execPath, "--version"],
				timeoutMs: null,
			},
			environment,
		),
		/Command id/,
	);
	await assert.rejects(
		initialize(
			{ dir: path.join(directory, "../../../outside"), plan: "quality-build" },
			{ ...environment, RUNNER_TEMP: directory },
		),
		/outside the authorized roots/,
	);
});

test("symlink diagnostic directories are rejected", async (t) => {
	const { root, environment } = await fixture(t);
	const real = path.join(root, "real");
	const link = path.join(root, "link");
	await mkdir(real);
	try {
		await symlink(
			real,
			link,
			process.platform === "win32" ? "junction" : "dir",
		);
	} catch (error) {
		if (process.platform === "win32" && error.code === "EPERM") {
			t.skip("Creating junctions is not permitted on this runner.");
			return;
		}
		throw error;
	}
	await assert.rejects(
		initialize({ dir: link, plan: "quality-build" }, environment),
		/symlink/,
	);
});

test("replaced command and known-report directories are rejected", async (t) => {
	const commandFixture = await fixture(t);
	const outsideCommands = path.join(commandFixture.root, "outside-commands");
	await mkdir(outsideCommands);
	await rm(path.join(commandFixture.directory, "commands"), {
		recursive: true,
		force: true,
	});
	try {
		await symlink(
			outsideCommands,
			path.join(commandFixture.directory, "commands"),
			process.platform === "win32" ? "junction" : "dir",
		);
	} catch (error) {
		if (process.platform === "win32" && error.code === "EPERM") {
			t.skip("Creating junctions is not permitted on this runner.");
			return;
		}
		throw error;
	}
	await assert.rejects(
		runCommand(
			{
				dir: commandFixture.directory,
				id: "build",
				command: [process.execPath, "--version"],
				timeoutMs: null,
			},
			commandFixture.environment,
		),
		/symlink/,
	);
	await assert.rejects(
		readFile(path.join(outsideCommands, "build.json")),
		/ENOENT/,
	);

	const reportFixture = await fixture(t);
	const outsideReports = path.join(reportFixture.root, "outside-reports");
	await mkdir(outsideReports);
	await rm(path.join(reportFixture.directory, "known-reports"), {
		recursive: true,
		force: true,
	});
	await symlink(
		outsideReports,
		path.join(reportFixture.directory, "known-reports"),
		process.platform === "win32" ? "junction" : "dir",
	);
	await assert.rejects(
		finalize(
			finalizationOptions(reportFixture.directory, "quality-build"),
			reportFixture.environment,
		),
		/symlink/,
	);
});

test("sanitization redacts headers, tokens, URLs, and known paths", () => {
	const environment = {
		GITHUB_WORKSPACE: "/work/repo",
		RUNNER_TEMP: "/runner/temp",
		HOME: "/home/runner",
	};
	const value = sanitizeText(
		[
			"Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
			"Cookie: session=secret",
			"Set-Cookie: session=secret",
			"ghp_abcdefghijklmnopqrstuvwxyz123456",
			"npm_abcdefghijklmnopqrstuvwxyz123456",
			"https://alice:password@example.test/private?token=secret",
			"/work/repo/file.ts /runner/temp/out /home/runner/.npmrc",
		].join("\n"),
		environment,
	);
	assert.doesNotMatch(
		value,
		/abcdefghijklmnopqrstuvwxyz|session=secret|password|token=secret/,
	);
	assert.match(value, /Authorization: \[REDACTED\]/);
	assert.match(value, /<workspace>\/file\.ts/);
	assert.match(value, /<runner-temp>\/out/);
	assert.match(value, /<home>\/\.npmrc/);
});

test("sanitization preserves ordinary errors and redacts command secret arguments", () => {
	assert.equal(
		sanitizeText("TypeError: expected widget to exist"),
		"TypeError: expected widget to exist",
	);
	assert.deepEqual(
		sanitizeCommand([
			"tool",
			"--token",
			"secret-value",
			"--api-key=secret",
			"https://example.test/a?q=secret",
		]),
		[
			"tool",
			"--token",
			"[REDACTED]",
			"--api-key=[REDACTED]",
			"https://example.test/a?[REDACTED]",
		],
	);
});

test("Markdown and HTML from untrusted text cannot change summary structure", () => {
	const escaped = markdownCell(
		"` `` ``` ```` </code></td></tr><script>alert(1)</script> | [click](javascript:alert(1))\n# injected\n<details>",
	);
	assert.doesNotMatch(escaped, /<script>|\[click\]\(javascript:/);
	assert.match(escaped, /&lt;\/td&gt;/);
	assert.match(escaped, /\\\|/);
	assert.match(escaped, /&#96;/);
	assert.doesNotMatch(escaped, /\r|\n/);
});

test("finalizer records all-success commands in plan order", async (t) => {
	const { directory, environment, plan } = await fixture(
		t,
		"quality-typecheck",
	);
	await writeCommandReports(directory, plan);
	const result = await finalize(
		finalizationOptions(directory, "quality-typecheck", {
			matrix: { zeta: "two", alpha: "one" },
		}),
		environment,
	);
	assert.equal(result.exitCode, 0);
	assert.equal(result.diagnostic.status, "success");
	assert.deepEqual(
		result.diagnostic.commands.map(({ id }) => id),
		plan.commands.map(({ id }) => id),
	);
	assert.deepEqual(Object.keys(result.diagnostic.matrix), ["alpha", "zeta"]);
	assert.equal(result.diagnostic.schemaVersion, SCHEMA_VERSION);
	assert.equal(result.diagnostic.kind, DIAGNOSTIC_KIND);
	assert.match(result.diagnostic.runner.turboVersion, /^\d+\.\d+\.\d+/);
	assert.ok(jsonBytes(result.diagnostic) <= MAX_DIAGNOSTIC_BYTES);
});

test("finalizer records a failure followed by explicit not-run commands", async (t) => {
	const { directory, environment, plan } = await fixture(
		t,
		"quality-typecheck",
	);
	await atomicWrite(
		path.join(directory, "commands/build.json"),
		`${JSON.stringify(
			commandReport(plan.commands[0], { status: "failure", exitCode: 2 }),
			null,
			2,
		)}\n`,
	);
	const result = await finalize(
		finalizationOptions(directory, "quality-typecheck", {
			jobStatus: "failure",
		}),
		environment,
	);
	assert.equal(result.exitCode, 0);
	assert.equal(result.diagnostic.status, "failure");
	assert.deepEqual(
		result.diagnostic.commands.map(({ status }) => status),
		["failure", "not-run", "not-run"],
	);
	assert.equal(result.diagnostic.commands[1].process, null);
});

test("finalizer preserves Windows native exit status and lifecycle boundary", async (t) => {
	const { directory, environment, plan } = await fixture(t);
	const nativeStatus = 0xc000001d;
	const report = commandReport(plan.commands[0], {
		status: "failure",
		exitCode: nativeStatus,
	});
	await atomicWrite(
		path.join(directory, "commands/build.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	const result = await finalize(
		finalizationOptions(directory, "quality-build", { jobStatus: "failure" }),
		environment,
	);
	assert.equal(result.diagnostic.commands[0].exitCode, nativeStatus);
	assert.equal(
		result.diagnostic.commands[0].process.exitEventCode,
		nativeStatus,
	);
	assert.equal(result.diagnostic.commands[0].process.closeEventCode, nativeStatus);
});

test("missing, corrupt, and symlink known reports are distinguished", async (t) => {
	const { root, directory, environment, plan } = await fixture(t, "e2e-common");
	await writeCommandReports(directory, plan);
	const reportDirectory = path.join(root, "cli");
	await mkdir(reportDirectory);
	await writeFile(path.join(reportDirectory, "runtime.json"), "{broken");
	const outside = path.join(root, "outside.json");
	await writeFile(outside, "{}\n");
	try {
		await symlink(
			outside,
			path.join(reportDirectory, "summary.json"),
			process.platform === "win32" ? "file" : undefined,
		);
	} catch (error) {
		if (process.platform === "win32" && error.code === "EPERM") {
			t.skip("Creating file symlinks is not permitted on this runner.");
			return;
		}
		throw error;
	}
	const result = await finalize(finalizationOptions(directory, "e2e-common"), {
		...environment,
		CLI_E2E_ARTIFACT_DIR: reportDirectory,
	});
	assert.equal(result.exitCode, 1);
	assert.deepEqual(
		result.diagnostic.reports.slice(0, 2).map(({ parseStatus }) => parseStatus),
		["invalid", "rejected"],
	);
});

test("a known report replaced after lstat is rejected by the same-handle reader", async (t) => {
	const { root, directory, environment, plan } = await fixture(t, "e2e-common");
	await writeCommandReports(directory, plan);
	const reportDirectory = path.join(root, "race-reports");
	await writeCliReports(reportDirectory);
	const replacement = path.join(root, "replacement-runtime.json");
	await writeFile(
		replacement,
		'{"platform":"spoofed","arch":"x64","node":"v20","pnpmEntrypoint":"pnpm"}\n',
	);
	let replaced = false;
	const result = await finalize(
		finalizationOptions(directory, "e2e-common", {
			onKnownReportAfterLstat: async (definition) => {
				if (definition.id !== "cli-runtime" || replaced) return;
				replaced = true;
				await rm(path.join(reportDirectory, "runtime.json"));
				await renameFile(
					replacement,
					path.join(reportDirectory, "runtime.json"),
				);
			},
		}),
		{ ...environment, CLI_E2E_ARTIFACT_DIR: reportDirectory },
	);
	assert.equal(result.exitCode, 1);
	assert.equal(result.diagnostic.reports[0].parseStatus, "rejected");
	assert.ok(
		!result.diagnostic.summary.artifactFiles.includes(
			"known-reports/cli-runtime.json",
		),
	);
});

test("plan, command, and known-report byte ceilings fail closed before upload", async (t) => {
	const planFixture = await fixture(t);
	await writeFile(
		path.join(planFixture.directory, "plan.json"),
		Buffer.alloc(MAX_PLAN_BYTES + 1, 0x20),
	);
	await assert.rejects(
		runCommand(
			{
				dir: planFixture.directory,
				id: "build",
				command: [process.execPath, "--version"],
				timeoutMs: null,
			},
			planFixture.environment,
		),
		(error) => error.diagnosticFileStatus === "too-large",
	);
	await assert.rejects(
		finalize(
			finalizationOptions(planFixture.directory, "quality-build"),
			planFixture.environment,
		),
		(error) => error.diagnosticFileStatus === "too-large",
	);
	await assert.rejects(readdir(`${planFixture.directory}-upload`), /ENOENT/);

	const commandFixture = await fixture(t);
	await writeFile(
		path.join(commandFixture.directory, "commands/build.json"),
		Buffer.alloc(MAX_COMMAND_REPORT_BYTES + 1, 0x20),
	);
	const commandResult = await finalize(
		finalizationOptions(commandFixture.directory, "quality-build", {
			jobStatus: "failure",
		}),
		commandFixture.environment,
	);
	assert.equal(commandResult.diagnostic.commands[0].status, "not-run");
	assert.ok(
		!commandResult.diagnostic.summary.artifactFiles.includes(
			"commands/build.json",
		),
	);

	const reportFixture = await fixture(t, "e2e-common");
	const reportDirectory = path.join(reportFixture.root, "oversized-known");
	await mkdir(reportDirectory);
	await writeFile(
		path.join(reportDirectory, "runtime.json"),
		Buffer.alloc(MAX_KNOWN_REPORT_BYTES + 1, 0x20),
	);
	const reportResult = await finalize(
		finalizationOptions(reportFixture.directory, "e2e-common", {
			jobStatus: "failure",
		}),
		{
			...reportFixture.environment,
			CLI_E2E_ARTIFACT_DIR: reportDirectory,
		},
	);
	assert.equal(reportResult.diagnostic.reports[0].parseStatus, "too-large");
});

test("A1 and Vitest schemas reject special numbers, wrong primitives, nested objects, and bound failure text", async (t) => {
	const { root, directory, environment, plan } = await fixture(
		t,
		"a1-contracts",
	);
	await writeCommandReports(directory, plan);
	const reportDirectory = path.join(root, "a1-reports");
	await writeA1Reports(reportDirectory);
	await writeFile(
		path.join(reportDirectory, "summary.json"),
		`{
  "exitCode": 0,
  "signal": null,
  "expectedFiles": {},
  "actualFiles": -1,
  "expectedTests": 1e309,
  "actualTests": 9007199254740992,
  "inventoryMatches": "true",
  "failedTests": [{"title":"failure","failure":"${"x".repeat(5_000)}","unknown":{"secret":"never-copy"}}],
  "unknown":{"nested":"never-copy"}
}\n`,
	);
	await writeFile(
		path.join(reportDirectory, "vitest.json"),
		`{"success":"true","numTotalTests":-1,"numPassedTests":{},"numFailedTests":1e309,"testResults":[],"unknown":{"secret":"never-copy"}}\n`,
	);
	const result = await finalize(
		finalizationOptions(directory, "a1-contracts"),
		{ ...environment, A1_TEST_ARTIFACT_DIR: reportDirectory },
	);
	assert.equal(result.exitCode, 1);
	assert.deepEqual(
		result.diagnostic.reports.slice(1).map(({ parseStatus }) => parseStatus),
		["schema-invalid", "parsed", "schema-invalid"],
	);
	const summaryReport = result.diagnostic.reports[1];
	assert.equal(summaryReport.summary.expectedFiles, null);
	assert.equal(summaryReport.summary.actualFiles, null);
	assert.equal(summaryReport.summary.inventoryMatches, null);
	assert.ok(result.diagnostic.summary.failureEvidence[0].text.length <= 1_000);
	const normalized = await readFile(
		path.join(`${directory}-upload`, "known-reports/a1-summary.json"),
		"utf8",
	);
	assert.doesNotMatch(normalized, /never-copy|unknown/);
});

test("CLI and MCP Doctor schemas copy only bounded allowlisted fields", async (t) => {
	const cli = await fixture(t, "e2e-common");
	await writeCommandReports(cli.directory, cli.plan);
	const cliReports = path.join(cli.root, "cli-reports");
	await writeCliReports(cliReports, {
		summary: {
			status: { spoofed: true },
			error: { nested: "not-a-string" },
			unknown: { secret: "never-copy" },
		},
	});
	const cliResult = await finalize(
		finalizationOptions(cli.directory, "e2e-common"),
		{ ...cli.environment, CLI_E2E_ARTIFACT_DIR: cliReports },
	);
	assert.equal(cliResult.exitCode, 1);
	assert.equal(cliResult.diagnostic.reports[1].parseStatus, "schema-invalid");
	assert.doesNotMatch(
		await readFile(
			path.join(`${cli.directory}-upload`, "known-reports/cli-summary.json"),
			"utf8",
		),
		/never-copy|spoofed/,
	);

	const mcp = await fixture(t, "e2e-mcp-stdio");
	await writeCommandReports(mcp.directory, mcp.plan);
	const mcpReports = path.join(mcp.root, "mcp-reports");
	await mkdir(mcpReports);
	await writeFile(
		path.join(mcpReports, "runner.json"),
		'{"group":"stdio","expectedTests":1,"files":["one"],"scripts":[]}\n',
	);
	await writeFile(
		path.join(mcpReports, "results.json"),
		'{"success":true,"numTotalTests":1,"numPassedTests":1,"numFailedTests":0,"testResults":[{"assertionResults":[]}]}\n',
	);
	const doctorPath = path.join(mcp.root, "doctor.json");
	await writeFile(
		doctorPath,
		`${JSON.stringify({
			success: false,
			summary: { passed: 1, failed: 1, skipped: 0, total: 2 },
			failureCodes: [{ object: true }],
			checks: [
				{
					id: "doctor-check",
					status: "failed",
					detail: "x".repeat(5_000),
				},
			],
			unknown: { secret: "never-copy" },
		})}\n`,
	);
	const mcpResult = await finalize(
		finalizationOptions(mcp.directory, "e2e-mcp-stdio"),
		{
			...mcp.environment,
			MCP_TEST_ARTIFACT_DIR: mcpReports,
			MCP_DOCTOR_REPORT: doctorPath,
		},
	);
	const doctor = mcpResult.diagnostic.reports[2];
	assert.equal(doctor.parseStatus, "schema-invalid");
	assert.deepEqual(doctor.summary.failureCodes, []);
	assert.ok(
		mcpResult.diagnostic.summary.failureEvidence[0].text.length <= 1_000,
	);
	assert.doesNotMatch(
		await readFile(
			path.join(`${mcp.directory}-upload`, "known-reports/mcp-doctor.json"),
			"utf8",
		),
		/never-copy/,
	);
});

test("finalizer handles no command reports without guessing success", async (t) => {
	const { directory, environment } = await fixture(t, "quality-tests");
	const result = await finalize(
		finalizationOptions(directory, "quality-tests", {
			jobStatus: "failure",
		}),
		environment,
	);
	assert.equal(result.diagnostic.status, "failure");
	assert.deepEqual(
		result.diagnostic.commands.map(({ status }) => status),
		["not-run", "not-run"],
	);
});

test("Action outcomes distinguish setup, checkout, skipped, and invalid infrastructure states", async (t) => {
	const setupFixture = await fixture(t, "quality-tests");
	const setupResult = await finalize(
		finalizationOptions(setupFixture.directory, "quality-tests", {
			jobStatus: "failure",
			steps: {
				checkout: "success",
				"diagnostics-init": "success",
				setup: "failure",
			},
		}),
		setupFixture.environment,
	);
	assert.equal(setupResult.diagnostic.status, "failure");
	assert.deepEqual(
		setupResult.diagnostic.commands.map(({ status }) => status),
		["not-run", "not-run"],
	);
	assert.equal(
		setupResult.diagnostic.summary.failureEvidence[0].source,
		"setup",
	);

	const checkoutFixture = await fixture(t);
	const checkoutResult = await finalize(
		finalizationOptions(checkoutFixture.directory, "quality-build", {
			jobStatus: "failure",
			steps: {
				checkout: "failure",
				"diagnostics-init": "skipped",
				setup: "skipped",
			},
		}),
		checkoutFixture.environment,
	);
	assert.equal(checkoutResult.diagnostic.steps[0].status, "failure");
	assert.equal(checkoutResult.diagnostic.steps[1].status, "skipped");
	assert.equal(
		checkoutResult.diagnostic.summary.failureEvidence[0].source,
		"checkout",
	);

	const invalidFixture = await fixture(t);
	await writeCommandReports(invalidFixture.directory, invalidFixture.plan);
	const invalidResult = await finalize(
		finalizationOptions(invalidFixture.directory, "quality-build", {
			steps: {
				checkout: "success",
				"diagnostics-init": "success",
				setup: "not-a-status",
			},
		}),
		invalidFixture.environment,
	);
	assert.equal(invalidResult.exitCode, 1);
	assert.equal(invalidResult.diagnostic.steps[2].status, "unknown");
	assert.equal(invalidResult.diagnostic.status, "failure");
});

test("initialization failure writes an emergency Summary without materializing an upload directory", async (t) => {
	const root = await mkdtemp(
		path.join(os.tmpdir(), "openapi-to-ci-diagnostics-emergency-"),
	);
	t.after(() => rm(root, { recursive: true, force: true }));
	const summaryPath = path.join(root, "github-summary.md");
	const uploadDirectory = path.join(root, "must-not-exist");
	await writeFile(summaryPath, "");
	const result = await finalizeInitializationFailure(
		{
			dir: path.join(root, "missing-diagnostic"),
			uploadDir: "",
			plan: "quality-tests",
			jobStatus: "failure",
			matrix: {},
			steps: {
				checkout: "success",
				"diagnostics-init": "failure",
				setup: "skipped",
			},
		},
		{
			...process.env,
			GITHUB_STEP_SUMMARY: summaryPath,
		},
	);
	const summary = await readFile(summaryPath, "utf8");
	assert.match(summary, /CI diagnostics initialization failure/);
	assert.match(summary, /diagnostics-init \\| failure/);
	assert.match(summary, /No diagnostic artifact was materialized/);
	assert.equal(result.steps[1].status, "failure");
	await assert.rejects(readFile(uploadDirectory), /ENOENT/);
});

test("finalizer CLI accepts an empty initialization output only for the no-artifact emergency path", async (t) => {
	const root = await mkdtemp(
		path.join(os.tmpdir(), "openapi-to-ci-diagnostics-emergency-cli-"),
	);
	t.after(() => rm(root, { recursive: true, force: true }));
	const summaryPath = path.join(root, "github-summary.md");
	await writeFile(summaryPath, "");
	await assert.rejects(
		execFileAsync(
			process.execPath,
			[
				finalizeJobPath,
				"--dir",
				path.join(root, "missing-diagnostic"),
				"--upload-dir",
				"",
				"--plan",
				"quality-tests",
				"--job-status",
				"failure",
				"--step",
				"checkout=success",
				"--step",
				"diagnostics-init=failure",
				"--step",
				"setup=skipped",
			],
			{
				env: {
					...process.env,
					GITHUB_STEP_SUMMARY: summaryPath,
				},
			},
		),
		(error) => error?.code === 1,
	);
	const summary = await readFile(summaryPath, "utf8");
	assert.match(summary, /diagnostics-init \\| failure/);
	assert.match(summary, /No diagnostic artifact was materialized/);
	assert.deepEqual(await readdir(root), ["github-summary.md"]);
});

test("upload directory symlinks and symlink entries are rejected", async (t) => {
	const rootLinkFixture = await fixture(t);
	await writeCommandReports(rootLinkFixture.directory, rootLinkFixture.plan);
	const realUpload = path.join(rootLinkFixture.root, "real-upload");
	await mkdir(realUpload);
	try {
		await symlink(
			realUpload,
			`${rootLinkFixture.directory}-upload`,
			process.platform === "win32" ? "junction" : "dir",
		);
	} catch (error) {
		if (process.platform === "win32" && error.code === "EPERM") {
			t.skip("Creating upload symlinks is not permitted on this runner.");
			return;
		}
		throw error;
	}
	await assert.rejects(
		finalize(
			finalizationOptions(rootLinkFixture.directory, "quality-build"),
			rootLinkFixture.environment,
		),
		/symlink/,
	);

	const entryFixture = await fixture(t);
	await writeCommandReports(entryFixture.directory, entryFixture.plan);
	const uploadDirectory = `${entryFixture.directory}-upload`;
	await mkdir(uploadDirectory);
	await symlink(
		path.join(entryFixture.directory, "plan.json"),
		path.join(uploadDirectory, "unsafe-link"),
	);
	await assert.rejects(
		finalize(
			finalizationOptions(entryFixture.directory, "quality-build"),
			entryFixture.environment,
		),
		/must not contain symlinks/,
	);
});

test("validated artifact sources cannot be replaced or removed before materialization", async (t) => {
	const replacedFixture = await fixture(t);
	await writeCommandReports(replacedFixture.directory, replacedFixture.plan);
	await assert.rejects(
		finalize(
			finalizationOptions(replacedFixture.directory, "quality-build", {
				onBeforeMaterialize: async () => {
					await writeFile(
						path.join(replacedFixture.directory, "commands/build.json"),
						'{"malicious":true}\n',
					);
				},
			}),
			replacedFixture.environment,
		),
		/changed after validation/,
	);
	await assert.rejects(
		readdir(`${replacedFixture.directory}-upload`),
		/ENOENT/,
	);

	const missingFixture = await fixture(t);
	await writeCommandReports(missingFixture.directory, missingFixture.plan);
	await assert.rejects(
		finalize(
			finalizationOptions(missingFixture.directory, "quality-build", {
				onBeforeMaterialize: async () => {
					await rm(path.join(missingFixture.directory, "commands/build.json"));
				},
			}),
			missingFixture.environment,
		),
		/ENOENT/,
	);
	await assert.rejects(readdir(`${missingFixture.directory}-upload`), /ENOENT/);
});

test("isolated upload materialization excludes unknown files and matches its manifest", async (t) => {
	const { directory, environment, plan } = await fixture(t);
	await writeCommandReports(directory, plan);
	await writeFile(path.join(directory, "unknown-secret.txt"), "do not upload");
	await writeFile(path.join(directory, "unknown.json"), '{"secret":"no"}\n');
	const result = await finalize(
		finalizationOptions(directory, "quality-build"),
		environment,
	);
	const uploadDirectory = `${directory}-upload`;
	const actualFiles = await listFiles(uploadDirectory);
	assert.deepEqual(actualFiles, result.diagnostic.summary.artifactFiles);
	assert.ok(!actualFiles.includes("unknown-secret.txt"));
	assert.ok(!actualFiles.includes("unknown.json"));
	assert.equal(
		await readFile(path.join(directory, "unknown-secret.txt"), "utf8"),
		"do not upload",
	);
	const manifest = JSON.parse(
		await readFile(
			path.join(uploadDirectory, "artifact-manifest.json"),
			"utf8",
		),
	);
	assert.deepEqual(
		manifest.files.map(({ path: filePath }) => filePath).sort(),
		actualFiles.filter((filePath) => filePath !== "artifact-manifest.json"),
	);
	for (const entry of manifest.files) {
		assert.match(entry.sha256, /^[0-9a-f]{64}$/);
		assert.equal(
			entry.bytes,
			(await readFile(path.join(uploadDirectory, entry.path))).length,
		);
	}
});

test("a background child writing unknown JSON cannot contaminate the isolated upload", async (t) => {
	const { root, directory, environment } = await fixture(t);
	const unknownPath = path.join(directory, "background-unknown.json");
	const pidPath = path.join(root, "background.pid");
	const writer = `
		const fs = require("node:fs");
		const target = process.argv[1];
		setInterval(() => fs.writeFileSync(target, JSON.stringify({unknown:true})), 5);
	`;
	const launcher = `
		const fs = require("node:fs");
		const { spawn } = require("node:child_process");
		const child = spawn(process.execPath, ["-e", ${JSON.stringify(writer)}, process.argv[1]], {detached:true, stdio:"ignore"});
		fs.writeFileSync(process.argv[2], String(child.pid));
		child.unref();
	`;
	await runCommand(
		{
			dir: directory,
			id: "build",
			command: [process.execPath, "-e", launcher, unknownPath, pidPath],
			timeoutMs: null,
		},
		environment,
	);
	const backgroundPid = Number.parseInt(await readFile(pidPath, "utf8"), 10);
	t.after(async () => {
		if (!Number.isSafeInteger(backgroundPid)) return;
		if (process.platform === "win32") {
			await execFileAsync("taskkill.exe", [
				"/pid",
				String(backgroundPid),
				"/t",
				"/f",
			]).catch(() => {});
		} else {
			try {
				process.kill(backgroundPid, "SIGTERM");
			} catch {}
		}
	});
	for (let attempt = 0; attempt < 50; attempt += 1) {
		try {
			await readFile(unknownPath);
			break;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}
	const result = await finalize(
		finalizationOptions(directory, "quality-build"),
		environment,
	);
	assert.ok(
		!result.diagnostic.summary.artifactFiles.includes(
			"background-unknown.json",
		),
	);
	assert.ok(
		!(await listFiles(`${directory}-upload`)).includes(
			"background-unknown.json",
		),
	);
});

test("local finalization creates summary.md without GITHUB_STEP_SUMMARY", async (t) => {
	const { directory, environment, plan } = await fixture(t);
	await writeCommandReports(directory, plan);
	delete environment.GITHUB_STEP_SUMMARY;
	await finalize(finalizationOptions(directory, "quality-build"), environment);
	assert.match(
		await readFile(path.join(directory, "summary.md"), "utf8"),
		/## CI diagnostics/,
	);
});

test("finalizer creates and appends the GitHub Job Summary file", async (t) => {
	const { root, directory, environment, plan } = await fixture(t);
	await writeCommandReports(directory, plan);
	const summaryPath = path.join(root, "github-summary.md");
	const result = await finalize(
		finalizationOptions(directory, "quality-build"),
		{ ...environment, GITHUB_STEP_SUMMARY: summaryPath },
	);
	assert.equal(result.exitCode, 0);
	assert.match(await readFile(summaryPath, "utf8"), /## CI diagnostics/);
});

test("Job Summary append failure is explicit and preserves command evidence", async (t) => {
	const { root, directory, environment, plan } = await fixture(t);
	await writeCommandReports(directory, plan, {
		build: { status: "failure", exitCode: 9 },
	});
	const result = await finalize(
		finalizationOptions(directory, "quality-build", {
			jobStatus: "failure",
		}),
		{
			...environment,
			GITHUB_STEP_SUMMARY: path.join(root, "missing-parent", "summary.md"),
		},
	);
	assert.equal(result.exitCode, 1);
	assert.match(result.appendError, /ENOENT/);
	assert.equal(result.diagnostic.commands[0].exitCode, 9);
	assert.equal(result.diagnostic.status, "failure");
});

test("rendered summaries stay bounded and escape report-controlled evidence", () => {
	const diagnostic = {
		status: "failure",
		workflow: {
			name: "Quality",
			jobName: "Tests",
			commitSha: null,
		},
		runner: { os: "Linux", architecture: "x64" },
		steps: [],
		commands: [
			{
				label: "bad | </td>",
				status: "failure",
				exitCode: 1,
				durationMs: 1,
			},
		],
		summary: {
			failureEvidence: Array.from({ length: 100 }, () => ({
				source: "report",
				kind: "structured-report",
				text: "` `` ``` </code></td></tr> [link](javascript:alert(1)) | fake column |\n# injected\n<details>".repeat(
					100,
				),
			})),
			outputTruncated: true,
		},
	};
	const summary = renderSummary(diagnostic, "ci-diagnostics-quality-tests");
	assert.ok(summary.length <= 24 * 1024 + 30);
	assert.doesNotMatch(
		summary,
		/<\/code>|<\/td>|\[link\]\(javascript:|<details>|^# injected/m,
	);
	assert.equal([...summary.matchAll(/^## CI diagnostics$/gm)].length, 1);
	assert.equal([...summary.matchAll(/^### Failure evidence$/gm)].length, 1);
});

test("workflow contract keeps finalizers, failure artifacts, gates, and matrices", async () => {
	const workflows = await Promise.all(
		[
			["quality.yml", 5],
			["a1-cross-platform.yml", 1],
			["e2e.yaml", 7],
			["version-readiness.yml", 1],
		].map(async ([name, jobs]) => ({
			name,
			jobs,
			contents: await readFile(
				path.join(repositoryRoot, ".github/workflows", name),
				"utf8",
			),
		})),
	);
	for (const { name, jobs, contents } of workflows) {
		assert.equal(
			[...contents.matchAll(/- name: Finalize CI diagnostics/g)].length,
			jobs,
			name,
		);
		assert.equal(
			[
				...contents.matchAll(
					/- name: Finalize CI diagnostics\s*\n\s+if: always\(\)/g,
				),
			].length,
			jobs,
			name,
		);
		assert.equal(
			[
				...contents.matchAll(
					/- name: Upload CI failure diagnostics\s*\n\s+if: failure\(\)/g,
				),
			].length,
			jobs,
			name,
		);
		assert.doesNotMatch(contents, /continue-on-error/);
		assert.doesNotMatch(
			contents,
			/pnpm exec node (?:\.\.\/\.\.\/)?scripts\/ci-diagnostics\/run-command\.mjs/,
		);
		assert.doesNotMatch(contents, /path: \$\{\{ env\.CI_DIAGNOSTIC_DIR }}/);
		assert.equal(
			[
				...contents.matchAll(
					/path: \$\{\{ steps\.diagnostics-init\.outputs\.upload-dir }}/g,
				),
			].length,
			jobs,
			name,
		);
		assert.equal(
			[...contents.matchAll(/persist-credentials: false/g)].length,
			jobs,
			name,
		);
		for (const id of ["checkout", "diagnostics-init", "setup"]) {
			assert.equal(
				[...contents.matchAll(new RegExp(`id: ${id}`, "g"))].length,
				jobs,
				`${name}:${id}`,
			);
		}
		assert.match(contents, /retention-days: 14/);
	}
	const quality = workflows.find(({ name }) => name === "quality.yml").contents;
	for (const command of [
		"pnpm build --concurrency=1",
		"pnpm typecheck --concurrency=1",
		"pnpm exec tsc -b",
		"pnpm test:vitest",
		"pnpm lint:changed --base",
		"pnpm release:smoke",
	]) {
		assert.match(
			quality,
			new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
		);
	}
	const a1 = workflows.find(
		({ name }) => name === "a1-cross-platform.yml",
	).contents;
	assert.match(a1, /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
	assert.match(a1, /fail-fast: false/);
	assert.match(
		a1,
		/- name: Verify pnpm launcher\s+run: .* --id pnpm-launcher -- pnpm --version/,
	);
	assert.deepEqual(getPlan("a1-contracts").commands[0], {
		id: "pnpm-launcher",
		label: "Verify pnpm launcher",
	});
	assert.deepEqual(
		getPlan("a1-contracts").commands.slice(2, 4),
		[
			{
				id: "codex-skills-installer-tests",
				label: "Run focused Codex Skill installer tests",
			},
			{
				id: "codex-skills-installer-built-bin",
				label: "Run built Codex Skill installer smoke",
			},
		],
	);
	const e2e = workflows.find(({ name }) => name === "e2e.yaml").contents;
	assert.equal(
		[...e2e.matchAll(/os: \[ubuntu-latest, windows-latest, macos-latest\]/g)]
			.length,
		4,
	);
	assert.equal([...e2e.matchAll(/fail-fast: false/g)].length, 4);
	assert.match(
		e2e,
		/mcp-performance:[\s\S]*if: github\.event_name != 'pull_request'/,
	);
	const versionPackages = await readFile(
		path.join(repositoryRoot, ".github/workflows/version-packages.yml"),
		"utf8",
	);
	assert.doesNotMatch(
		versionPackages,
		/ci-diagnostics|Finalize CI diagnostics|openai|codex/i,
	);
});
