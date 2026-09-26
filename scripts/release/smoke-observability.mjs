import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";

const maxPhaseCount = 16;
const maxPhaseNameLength = 48;
const maxPhaseDurationMs = 2_147_483_647;
const commandOutputLimit = 2_048;
const phasePattern = /^[a-z][a-z0-9-]*$/;

export function redactReleaseSmokeText(value) {
	return String(value ?? "")
		.replace(/https?:\/\/[^\s<>"']+/gi, "<url>")
		.replace(/(bearer\s+)[^\s,;]+/gi, "$1<redacted>")
		.replace(
			/\b(authorization|cookie|set-cookie)\s*[:=]\s*[^\r\n]*/gi,
			"$1=<redacted>",
		)
		.replace(
			/\b(token|secret|password|api[_-]?key)\b([=:]\s*)[^\s,;]+/gi,
			"$1$2<redacted>",
		)
		.replace(
			/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|npm_[A-Za-z0-9_]+)/g,
			"<redacted>",
		);
}

function bounded(value, limit = commandOutputLimit) {
	const text = redactReleaseSmokeText(value);
	if (text.length <= limit) return text;
	return `${text.slice(0, limit)}… ${text.length - limit} characters omitted`;
}

export function runReleaseSmokeCommand(command, args, cwd, options = {}) {
	const environment = {
		...process.env,
		CI: "1",
		NO_UPDATE_NOTIFIER: "1",
		...options.env,
	};
	for (const name of options.unsetEnvironment ?? []) {
		delete environment[name];
	}
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		env: environment,
	});
	if (result.error) throw result.error;
	if (result.status !== (options.expectedStatus ?? 0)) {
		const safeCommand = bounded([command, ...args].join(" "), 1_024);
		const error = new Error(
			`${safeCommand} exited with ${result.status ?? result.signal ?? "unknown"}\nstdout:\n${bounded(result.stdout)}\nstderr:\n${bounded(result.stderr)}`,
		);
		error.exitCode = result.status;
		throw error;
	}
	return result;
}

export class ReleaseSmokeProgress {
	#stderr;
	#now;
	#active;
	#timings = [];

	constructor({
		stderr = process.stderr,
		now = () => process.hrtime.bigint(),
	} = {}) {
		this.#stderr = stderr;
		this.#now = now;
	}

	start(phase) {
		if (
			typeof phase !== "string" ||
			phase.length > maxPhaseNameLength ||
			!phasePattern.test(phase)
		) {
			throw new TypeError("Release smoke phase name is invalid.");
		}
		if (this.#active)
			throw new Error("A release smoke phase is already active.");
		if (this.#timings.length >= maxPhaseCount)
			throw new Error("Release smoke phase limit was exceeded.");
		this.#active = { phase, startedAt: this.#now() };
		this.#stderr.write(`[release-smoke] START ${phase}\n`);
	}

	finish(status = "PASS") {
		if (!this.#active) throw new Error("No release smoke phase is active.");
		if (status !== "PASS" && status !== "FAIL")
			throw new TypeError("Release smoke phase status is invalid.");
		const { phase, startedAt } = this.#active;
		const elapsedMs = Number(this.#now() - startedAt) / 1_000_000;
		const durationMs = Math.min(
			maxPhaseDurationMs,
			Math.max(0, Math.round(Number.isFinite(elapsedMs) ? elapsedMs : 0)),
		);
		const timing = { phase, durationMs, status };
		this.#timings.push(timing);
		this.#active = undefined;
		this.#stderr.write(
			`[release-smoke] ${status} ${phase} ${(durationMs / 1_000).toFixed(1)}s\n`,
		);
		return { ...timing };
	}

	failActive() {
		return this.#active ? this.finish("FAIL") : undefined;
	}

	async run(phase, operation) {
		this.start(phase);
		try {
			const result = await operation();
			this.finish("PASS");
			return result;
		} catch (error) {
			this.finish("FAIL");
			throw error;
		}
	}

	get timings() {
		return this.#timings.map((timing) => ({ ...timing }));
	}
}

export async function cleanupReleaseSmokeWorkspace({
	temporaryRoot,
	keep,
	succeeded,
	remoteFixtureChild,
	removeDirectory = rm,
	stderr = process.stderr,
}) {
	if (remoteFixtureChild && remoteFixtureChild.exitCode === null) {
		const child = remoteFixtureChild;
		const stopped = new Promise((resolveStopped) =>
			child.once("exit", resolveStopped),
		);
		child.kill("SIGTERM");
		await stopped;
	}
	if (!keep) {
		await removeDirectory(temporaryRoot, { recursive: true, force: true });
	} else if (!succeeded) {
		stderr.write(`Release smoke workspace retained at ${temporaryRoot}\n`);
	}
}
