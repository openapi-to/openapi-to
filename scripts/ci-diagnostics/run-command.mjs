#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
	atomicWrite,
	ensureSafeDirectory,
	readBoundedJsonFile,
	repositoryRoot,
	safeChild,
} from "./filesystem.mjs";
import { getPlan } from "./plans.mjs";
import {
	normalizeCwd,
	sanitizeCommand,
	sanitizeLine,
	sanitizeText,
} from "./sanitize.mjs";
import {
	assertCommandId,
	jsonBytes,
	MAX_COMMAND_REPORT_BYTES,
	MAX_ERROR_CANDIDATES,
	MAX_PLAN_BYTES,
	MAX_TAIL_LINES,
	SCHEMA_VERSION,
} from "./schema.mjs";

const errorCandidatePattern =
	/\b(?:error|failed|err_[a-z0-9_]+|assertionerror|typeerror|enoent|eperm|timed?\s*out|timeout)\b/i;

export const CHILD_ENV_DENYLIST = Object.freeze([
	"GITHUB_ENV",
	"GITHUB_PATH",
	"GITHUB_OUTPUT",
	"GITHUB_STEP_SUMMARY",
	"GITHUB_TOKEN",
	"GH_TOKEN",
	"NODE_AUTH_TOKEN",
	"NPM_TOKEN",
	"NPM_AUTH_TOKEN",
	"ACTIONS_ID_TOKEN_REQUEST_TOKEN",
	"ACTIONS_ID_TOKEN_REQUEST_URL",
	"ACTIONS_RUNTIME_TOKEN",
	"ACTIONS_RUNTIME_URL",
	"ACTIONS_RESULTS_URL",
	"ACTIONS_CACHE_URL",
	"GITHUB_EVENT_PATH",
	"CI_DIAGNOSTIC_DIR",
	"CI_DIAGNOSTIC_UPLOAD_DIR",
]);

export const CHILD_ENV_ALLOWLIST = Object.freeze([
	"PATH",
	"HOME",
	"USERPROFILE",
	"TMP",
	"TEMP",
	"TMPDIR",
	"SystemRoot",
	"ComSpec",
	"PATHEXT",
	"APPDATA",
	"LOCALAPPDATA",
	"NODE_OPTIONS",
	"CI",
	"RUNNER_OS",
	"RUNNER_ARCH",
	"LANG",
	"LC_ALL",
	"TZ",
	"TERM",
	"COLORTERM",
	"FORCE_COLOR",
	"NO_COLOR",
	"SHELL",
	"COREPACK_HOME",
	"PNPM_HOME",
	"NO_UPDATE_NOTIFIER",
	"npm_execpath",
	"npm_node_execpath",
	"npm_config_cache",
	"npm_config_store_dir",
	"npm_config_user_agent",
]);

function environmentEntry(environment, requested) {
	const key = Object.keys(environment).find(
		(candidate) => candidate.toLowerCase() === requested.toLowerCase(),
	);
	return key && environment[key] !== undefined ? [key, environment[key]] : null;
}

function within(root, candidate) {
	const relative = path.relative(root, candidate);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}

export async function buildChildEnvironment(environment, plan) {
	const child = {};
	for (const requested of CHILD_ENV_ALLOWLIST) {
		const entry = environmentEntry(environment, requested);
		if (entry) child[entry[0]] = entry[1];
	}
	const artifactRoots = [environment.GITHUB_WORKSPACE, environment.RUNNER_TEMP]
		.filter(Boolean)
		.map((root) => path.resolve(root));
	for (const sourceEnv of plan.childEnv) {
		const value = environment[sourceEnv];
		if (!value) continue;
		if (artifactRoots.length === 0) {
			throw new Error(
				`Domain artifact environment ${sourceEnv} requires GITHUB_WORKSPACE or RUNNER_TEMP.`,
			);
		}
		const resolved = path.resolve(value);
		if (!artifactRoots.some((root) => within(root, resolved))) {
			throw new Error(
				`Domain artifact environment ${sourceEnv} must stay within GITHUB_WORKSPACE or RUNNER_TEMP.`,
			);
		}
		const definition = plan.reports.find(
			(report) => report.sourceEnv === sourceEnv,
		);
		const directory =
			definition?.relativePath === "." ? path.dirname(resolved) : resolved;
		await ensureSafeDirectory(directory, environment);
		child[sourceEnv] = resolved;
	}
	return child;
}

function assertInitializedPlan(manifest, planId, plan, directoryDetails) {
	const expectedReports = plan.reports.map(
		({ id, label, relativePath, format }) => ({
			id,
			label,
			relativePath,
			format,
		}),
	);
	if (
		manifest?.schemaVersion !== SCHEMA_VERSION ||
		manifest?.planId !== planId ||
		manifest.workflow !== plan.workflow ||
		manifest.jobId !== plan.jobId ||
		manifest.jobName !== plan.jobName ||
		JSON.stringify(manifest.commands) !== JSON.stringify(plan.commands) ||
		JSON.stringify(manifest.steps) !== JSON.stringify(plan.steps) ||
		JSON.stringify(manifest.reports) !== JSON.stringify(expectedReports) ||
		manifest.directoryIdentity?.dev !== String(directoryDetails.dev) ||
		manifest.directoryIdentity?.ino !== String(directoryDetails.ino)
	) {
		throw new Error(
			"Initialized diagnostic plan does not match its static plan.",
		);
	}
}

export function parseRunArguments(argv) {
	const separator = argv.indexOf("--");
	if (separator < 0 || separator === argv.length - 1) {
		throw new Error("run-command requires -- followed by a command.");
	}
	const options = {};
	for (let index = 0; index < separator; index += 1) {
		const argument = argv[index];
		if (
			["--dir", "--id", "--label", "--cwd", "--timeout-ms"].includes(argument)
		) {
			const value = argv[index + 1];
			if (!value || value === "--")
				throw new Error(`${argument} requires a value.`);
			options[argument.slice(2).replace("-ms", "Ms")] = value;
			index += 1;
			continue;
		}
		throw new Error(`Unknown run-command argument: ${argument}`);
	}
	if (!options.dir || !options.id) {
		throw new Error("run-command requires --dir and --id.");
	}
	assertCommandId(options.id);
	const timeoutMs =
		options.timeoutMs === undefined
			? null
			: Number.parseInt(options.timeoutMs, 10);
	if (
		timeoutMs !== null &&
		(!Number.isSafeInteger(timeoutMs) ||
			timeoutMs < 1 ||
			timeoutMs > 60 * 60 * 1_000)
	) {
		throw new Error("--timeout-ms must be between 1 and 3600000.");
	}
	return {
		...options,
		timeoutMs,
		command: argv.slice(separator + 1),
	};
}

async function isRegularFile(candidate) {
	try {
		const details = await lstat(candidate);
		return details.isFile() && !details.isSymbolicLink();
	} catch {
		return false;
	}
}

export async function resolvePnpmEntrypoint(environment = process.env) {
	const npmExecPath = environmentEntry(environment, "npm_execpath")?.[1];
	if (
		typeof npmExecPath === "string" &&
		npmExecPath.trim() &&
		/\.(?:c|m)?js$/i.test(npmExecPath)
	) {
		const candidate = path.resolve(npmExecPath);
		if (await isRegularFile(candidate)) return candidate;
	}

	const pnpmHome = environmentEntry(environment, "PNPM_HOME")?.[1];
	if (typeof pnpmHome !== "string" || !pnpmHome.trim()) return null;
	const binDirectory = path.resolve(pnpmHome);
	if (
		path.basename(binDirectory).toLowerCase() !== ".bin" ||
		path.basename(path.dirname(binDirectory)).toLowerCase() !== "node_modules"
	) {
		return null;
	}
	const actionSetupEntrypoint = path.join(
		path.dirname(binDirectory),
		"pnpm",
		"bin",
		"pnpm.cjs",
	);
	return (await isRegularFile(actionSetupEntrypoint))
		? actionSetupEntrypoint
		: null;
}

export async function resolveInvocation(
	command,
	args,
	{
		platform = process.platform,
		environment = process.env,
		execPath = process.execPath,
	} = {},
) {
	if (command !== "pnpm") return { command, args };
	const pnpmEntrypoint = await resolvePnpmEntrypoint(environment);
	if (pnpmEntrypoint) {
		return { command: execPath, args: [pnpmEntrypoint, ...args] };
	}
	if (platform === "win32") {
		throw new Error(
			"Unable to locate a safely executable pnpm JavaScript entrypoint on Windows.",
		);
	}
	return { command: "pnpm", args };
}

class BoundedOutput {
	constructor(stream, environment) {
		this.stream = stream;
		this.environment = environment;
		this.partial = "";
		this.discardingLongLine = false;
		this.lines = [];
		this.totalLines = 0;
		this.truncatedLines = 0;
		this.candidates = [];
	}

	push(chunk) {
		let value = String(chunk);
		if (this.discardingLongLine) {
			const newline = value.indexOf("\n");
			if (newline < 0) return;
			this.discardingLongLine = false;
			value = value.slice(newline + 1);
		}
		this.partial += value;
		while (true) {
			const newline = this.partial.indexOf("\n");
			if (newline < 0) {
				if (this.partial.length > 4_096) {
					this.emit(this.partial.slice(0, 4_096), true);
					this.partial = "";
					this.discardingLongLine = true;
				}
				return;
			}
			const line = this.partial.slice(0, newline).replace(/\r$/, "");
			this.partial = this.partial.slice(newline + 1);
			this.emit(line, true);
		}
	}

	emit(line, newline) {
		const sanitized = sanitizeLine(line, this.environment);
		this.totalLines += 1;
		if (sanitized.truncated) this.truncatedLines += 1;
		this.lines.push(sanitized.value);
		if (this.lines.length > MAX_TAIL_LINES) this.lines.shift();
		if (
			errorCandidatePattern.test(sanitized.value) &&
			this.candidates.length < MAX_ERROR_CANDIDATES
		) {
			this.candidates.push({
				kind: "heuristic-candidate",
				text: sanitized.value,
			});
		}
		this.stream.write(`${sanitized.value}${newline ? "\n" : ""}`);
	}

	finish() {
		if (this.partial && !this.discardingLongLine)
			this.emit(this.partial, false);
		this.partial = "";
		this.discardingLongLine = false;
		return {
			tail: this.lines,
			totalLines: this.totalLines,
			truncated: this.totalLines > this.lines.length || this.truncatedLines > 0,
			truncatedLines: this.truncatedLines,
			candidates: this.candidates,
		};
	}
}

async function terminate(child, force = false) {
	if (!child.pid || child.exitCode !== null || child.signalCode !== null)
		return;
	if (process.platform === "win32") {
		spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
			shell: false,
			stdio: "ignore",
		});
		return;
	}
	try {
		process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
	} catch {
		child.kill(force ? "SIGKILL" : "SIGTERM");
	}
}

function exitFor(report) {
	if (report.status === "success") return 0;
	if (Number.isInteger(report.exitCode) && report.exitCode > 0) {
		return report.exitCode;
	}
	return 1;
}

function processLifecycle() {
	return {
		wrapperPid: process.pid,
		wrapperParentPid: process.ppid,
		childPid: null,
		spawnEventObserved: false,
		errorEventObserved: false,
		exitEventObserved: false,
		exitEventCode: null,
		exitEventSignal: null,
		closeEventObserved: false,
		closeEventCode: null,
		closeEventSignal: null,
		stdoutEndObserved: false,
		stdoutCloseObserved: false,
		stderrEndObserved: false,
		stderrCloseObserved: false,
	};
}

function resourceSnapshot() {
	const memory = process.memoryUsage();
	return {
		hostTotalMemoryBytes: os.totalmem(),
		hostFreeMemoryBytes: os.freemem(),
		wrapperRssBytes: memory.rss,
		wrapperHeapUsedBytes: memory.heapUsed,
	};
}

export async function runCommand(
	options,
	environment = process.env,
	{
		writeReport = atomicWrite,
		platform = process.platform,
		execPath = process.execPath,
	} = {},
) {
	assertCommandId(options.id);
	const directory = await ensureSafeDirectory(options.dir, environment);
	const { value: manifest } = await readBoundedJsonFile(
		safeChild(directory, "plan.json"),
		{ maxBytes: MAX_PLAN_BYTES },
	);
	const plan = getPlan(manifest.planId);
	assertInitializedPlan(
		manifest,
		manifest.planId,
		plan,
		await lstat(directory),
	);
	const expected = plan.commands.find(({ id }) => id === options.id);
	if (!expected)
		throw new Error(
			`Command ${options.id} is not present in the initialized plan.`,
		);
	if (options.label && options.label !== expected.label) {
		throw new Error(
			`Command label for ${options.id} does not match the initialized plan.`,
		);
	}
	const cwd = path.resolve(options.cwd ?? repositoryRoot);
	const displayCommand = sanitizeCommand(options.command, environment);
	const childEnvironment = await buildChildEnvironment(environment, plan);
	const stdout = new BoundedOutput(process.stdout, environment);
	const stderr = new BoundedOutput(process.stderr, environment);
	const lifecycle = processLifecycle();
	const resourcesAtStart = resourceSnapshot();
	const started = performance.now();
	let timedOut = false;
	let spawnError = null;
	let timer;
	let forceTimer;
	let invocation;
	try {
		invocation = await resolveInvocation(
			options.command[0],
			options.command.slice(1),
			{ environment, execPath, platform },
		);
	} catch (error) {
		spawnError = error;
	}
	const outcome = invocation
		? await new Promise((resolve) => {
				let settled = false;
				const child = spawn(invocation.command, invocation.args, {
					cwd,
					env: childEnvironment,
					detached: process.platform !== "win32",
					shell: false,
					stdio: ["ignore", "pipe", "pipe"],
				});
				lifecycle.childPid = child.pid ?? null;
				child.once("spawn", () => {
					lifecycle.spawnEventObserved = true;
					lifecycle.childPid = child.pid ?? lifecycle.childPid;
				});
				child.stdout?.on("data", (chunk) => stdout.push(chunk));
				child.stderr?.on("data", (chunk) => stderr.push(chunk));
				child.stdout?.once("end", () => {
					lifecycle.stdoutEndObserved = true;
				});
				child.stdout?.once("close", () => {
					lifecycle.stdoutCloseObserved = true;
				});
				child.stderr?.once("end", () => {
					lifecycle.stderrEndObserved = true;
				});
				child.stderr?.once("close", () => {
					lifecycle.stderrCloseObserved = true;
				});
				child.once("error", (error) => {
					lifecycle.errorEventObserved = true;
					spawnError = error;
					if (!settled) {
						settled = true;
						resolve({ exitCode: null, signal: null });
					}
				});
				child.once("exit", (exitCode, signal) => {
					lifecycle.exitEventObserved = true;
					lifecycle.exitEventCode = exitCode;
					lifecycle.exitEventSignal = signal;
				});
				child.once("close", (exitCode, signal) => {
					lifecycle.closeEventObserved = true;
					lifecycle.closeEventCode = exitCode;
					lifecycle.closeEventSignal = signal;
					if (!settled) {
						settled = true;
						resolve({ exitCode, signal });
					}
				});
				if (options.timeoutMs !== null) {
					timer = setTimeout(() => {
						timedOut = true;
						terminate(child).catch(() => {});
						forceTimer = setTimeout(() => {
							terminate(child, true).catch(() => {});
						}, 1_000);
						forceTimer.unref();
					}, options.timeoutMs);
					timer.unref();
				}
			})
		: { exitCode: null, signal: null };
	clearTimeout(timer);
	clearTimeout(forceTimer);
	const stdoutEvidence = stdout.finish();
	const stderrEvidence = stderr.finish();
	const status = spawnError
		? "infrastructure-error"
		: timedOut
			? "timeout"
			: outcome.signal
				? "signalled"
				: outcome.exitCode === 0
					? "success"
					: "failure";
	const report = {
		schemaVersion: SCHEMA_VERSION,
		kind: "openapi-to-ci-command",
		id: options.id,
		label: expected.label,
		status,
		exitCode: outcome.exitCode,
		signal: outcome.signal,
		durationMs: Math.max(0, Math.round(performance.now() - started)),
		command: displayCommand,
		cwd: normalizeCwd(cwd, repositoryRoot, environment),
		process: lifecycle,
		resources: {
			start: resourcesAtStart,
			end: resourceSnapshot(),
		},
		evidence: {
			stdout: stdoutEvidence,
			stderr: stderrEvidence,
			spawnError: spawnError
				? sanitizeText(spawnError.message, environment).slice(0, 1_000)
				: null,
		},
	};
	if (jsonBytes(report) > MAX_COMMAND_REPORT_BYTES) {
		throw new Error(
			"Bounded command report unexpectedly exceeded its size limit.",
		);
	}
	try {
		await ensureSafeDirectory(directory, environment);
		await ensureSafeDirectory(safeChild(directory, "commands"), environment);
		await writeReport(
			safeChild(directory, "commands", `${options.id}.json`),
			`${JSON.stringify(report, null, 2)}\n`,
		);
	} catch (error) {
		error.commandExitCode = exitFor(report);
		throw error;
	}
	return { report, exitCode: exitFor(report) };
}

async function main() {
	let options;
	try {
		options = parseRunArguments(process.argv.slice(2));
		const result = await runCommand(options);
		process.exitCode = result.exitCode;
	} catch (error) {
		process.stderr.write(
			`[ci-diagnostics] command wrapper failed: ${sanitizeText(error instanceof Error ? error.message : String(error))}\n`,
		);
		process.exitCode =
			Number.isInteger(error?.commandExitCode) && error.commandExitCode > 0
				? error.commandExitCode
				: 1;
	}
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	await main();
}
