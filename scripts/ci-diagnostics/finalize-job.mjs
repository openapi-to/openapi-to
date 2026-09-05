#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
	appendFile,
	lstat,
	mkdir,
	readdir,
	realpath,
	rename,
	rm,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	atomicWrite,
	ensureSafeDirectory,
	readBoundedJsonFile,
	readBoundedRegularFile,
	repositoryRoot,
	safeChild,
} from "./filesystem.mjs";
import { getPlan } from "./plans.mjs";
import {
	markdownCell,
	sanitizeCommand,
	sanitizeLine,
	sanitizeText,
} from "./sanitize.mjs";
import {
	COMMAND_STATUSES,
	DIAGNOSTIC_KIND,
	jsonBytes,
	MAX_ARTIFACT_MANIFEST_BYTES,
	MAX_COMMAND_REPORT_BYTES,
	MAX_DIAGNOSTIC_BYTES,
	MAX_ERROR_CANDIDATES,
	MAX_KNOWN_REPORT_BYTES,
	MAX_NORMALIZED_REPORT_BYTES,
	MAX_PLAN_BYTES,
	MAX_SUMMARY_CHARS,
	SCHEMA_VERSION,
	STEP_STATUSES,
	stableObject,
} from "./schema.mjs";

const commandFailureStatuses = new Set([
	"failure",
	"timeout",
	"signalled",
	"cancelled",
	"infrastructure-error",
]);
const jobStatuses = new Set(["success", "failure", "cancelled"]);
const artifactManifestPath = "artifact-manifest.json";

export function parseFinalizeArguments(argv) {
	const result = { matrix: {}, steps: {} };
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (
			["--dir", "--plan", "--job-status", "--upload-dir"].includes(argument)
		) {
			const value = argv[index + 1];
			if (
				value === undefined ||
				value.startsWith("--") ||
				(argument !== "--upload-dir" && value.length === 0)
			) {
				throw new Error(`${argument} requires a value.`);
			}
			result[
				argument.slice(2).replace("-status", "Status").replace("-dir", "Dir")
			] = value;
			index += 1;
			continue;
		}
		if (argument === "--matrix" || argument === "--step") {
			const value = argv[index + 1];
			const separator = value?.indexOf("=") ?? -1;
			if (separator < 1) throw new Error(`${argument} requires key=value.`);
			const key = value.slice(0, separator);
			if (!/^[a-z][a-z0-9-]*$/.test(key)) {
				throw new Error(
					`${argument === "--matrix" ? "Matrix" : "Step"} keys must be stable lowercase identifiers.`,
				);
			}
			const collection = argument === "--matrix" ? result.matrix : result.steps;
			if (Object.hasOwn(collection, key)) {
				throw new Error(`${argument} key ${key} was provided more than once.`);
			}
			collection[key] = value.slice(separator + 1);
			index += 1;
			continue;
		}
		throw new Error(`Unknown finalize argument: ${argument}`);
	}
	if (!result.dir || !result.plan || result.uploadDir === undefined) {
		throw new Error("finalize-job requires --dir, --upload-dir, and --plan.");
	}
	return result;
}

function nullable(value, environment, maxChars = 500) {
	if (typeof value !== "string" || value.length === 0) return null;
	return sanitizeText(value, environment).slice(0, maxChars);
}

function sha(value) {
	return /^[0-9a-f]{7,40}$/i.test(value ?? "") ? value : null;
}

function within(root, candidate) {
	const relative = path.relative(root, candidate);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}

function workflowMetadata(plan, environment) {
	return {
		name: plan.workflow,
		eventName: nullable(environment.GITHUB_EVENT_NAME, environment),
		runId: nullable(environment.GITHUB_RUN_ID, environment),
		runAttempt: nullable(environment.GITHUB_RUN_ATTEMPT, environment),
		jobId: plan.jobId,
		jobName: plan.jobName,
		repository: nullable(environment.GITHUB_REPOSITORY, environment),
		ref: nullable(environment.GITHUB_REF, environment),
		commitSha: sha(environment.GITHUB_SHA),
		baseSha: sha(environment.CI_BASE_SHA),
		headSha: sha(environment.CI_HEAD_SHA),
	};
}

async function runnerMetadata(environment) {
	let pnpmVersion = null;
	let turboVersion = null;
	try {
		const { value: manifest } = await readBoundedJsonFile(
			path.join(repositoryRoot, "package.json"),
			{ maxBytes: MAX_PLAN_BYTES, rejectHardLinks: false },
		);
		pnpmVersion =
			typeof manifest.packageManager === "string"
				? manifest.packageManager.replace(/^pnpm@/, "")
				: null;
	} catch {
		pnpmVersion = null;
	}
	try {
		const turboManifestPath = await realpath(
			path.join(repositoryRoot, "node_modules", "turbo", "package.json"),
		);
		if (!within(repositoryRoot, turboManifestPath)) {
			throw new Error("Turbo manifest resolves outside the repository.");
		}
		const { value: turboManifest } = await readBoundedJsonFile(
			turboManifestPath,
			{ maxBytes: MAX_PLAN_BYTES, rejectHardLinks: false },
		);
		turboVersion =
			typeof turboManifest.version === "string"
				? sanitizeText(turboManifest.version, environment).slice(0, 100)
				: null;
	} catch {
		turboVersion = null;
	}
	return {
		os: nullable(environment.RUNNER_OS, environment) ?? process.platform,
		architecture:
			nullable(environment.RUNNER_ARCH, environment) ?? process.arch,
		nodeVersion: process.versions.node,
		pnpmVersion,
		turboVersion,
	};
}

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function createValidator(environment) {
	const errors = [];
	const issue = (field, expected) => {
		if (errors.length < 20) errors.push(`${field}: expected ${expected}`);
	};
	return {
		errors,
		issue,
		record(value, field, { optional = false } = {}) {
			if (optional && value === undefined) return null;
			if (!isRecord(value)) {
				issue(field, "object");
				return {};
			}
			return value;
		},
		array(value, field, { optional = false } = {}) {
			if (optional && value === undefined) return null;
			if (!Array.isArray(value)) {
				issue(field, "array");
				return [];
			}
			return value;
		},
		boolean(value, field, { optional = false } = {}) {
			if (optional && value === undefined) return null;
			if (typeof value !== "boolean") {
				issue(field, "boolean");
				return null;
			}
			return value;
		},
		integer(
			value,
			field,
			{
				min = 0,
				max = 1_000_000_000,
				nullable: allowNull = false,
				optional = false,
			} = {},
		) {
			if (optional && value === undefined) return null;
			if (allowNull && value === null) return null;
			if (!Number.isSafeInteger(value) || value < min || value > max) {
				issue(field, `safe integer from ${min} to ${max}`);
				return null;
			}
			return value;
		},
		number(
			value,
			field,
			{ min = 0, max = 24 * 60 * 60 * 1_000, optional = false } = {},
		) {
			if (optional && value === undefined) return null;
			if (!Number.isFinite(value) || value < min || value > max) {
				issue(field, `finite number from ${min} to ${max}`);
				return null;
			}
			return value;
		},
		string(
			value,
			field,
			{ maxChars = 500, nullable: allowNull = false, optional = false } = {},
		) {
			if (optional && value === undefined) return null;
			if (allowNull && value === null) return null;
			if (typeof value !== "string") {
				issue(field, "string");
				return null;
			}
			return sanitizeText(value, environment).slice(0, maxChars);
		},
		stringArray(
			value,
			field,
			{ maxItems = 10, maxCharsPerItem = 500, optional = false } = {},
		) {
			const items = this.array(value, field, { optional });
			if (items === null) return [];
			const result = [];
			for (const [index, item] of items.slice(0, 1_000).entries()) {
				const normalized = this.string(item, `${field}[${index}]`, {
					maxChars: maxCharsPerItem,
				});
				if (normalized !== null && result.length < maxItems) {
					result.push(normalized);
				}
			}
			if (items.length > 1_000) issue(field, "at most 1000 input items");
			return result;
		},
	};
}

function boundedCandidate(value, source, environment) {
	if (typeof value !== "string" || value.length === 0) return null;
	return {
		source,
		kind: "structured-report",
		text: sanitizeText(value, environment).slice(0, 1_000),
	};
}

function runtimeSummary(value, validator) {
	return {
		platform: validator.string(value.platform, "platform", { maxChars: 50 }),
		architecture: validator.string(value.arch, "arch", { maxChars: 50 }),
		node: validator.string(value.node, "node", { maxChars: 100 }),
		pnpm: validator.string(value.pnpm ?? value.pnpmEntrypoint, "pnpm", {
			maxChars: 100,
		}),
	};
}

function a1Summary(value, validator, environment) {
	const failedTests = validator.array(value.failedTests, "failedTests");
	const candidates = [];
	for (const [index, rawFailure] of failedTests
		.slice(0, MAX_ERROR_CANDIDATES)
		.entries()) {
		const failure = validator.record(rawFailure, `failedTests[${index}]`);
		const title = validator.string(
			failure.title,
			`failedTests[${index}].title`,
			{
				maxChars: 500,
			},
		);
		const detail = validator.string(
			failure.failure,
			`failedTests[${index}].failure`,
			{ maxChars: 2_000 },
		);
		const candidate = boundedCandidate(
			`${title ?? "test failure"}: ${detail ?? ""}`,
			"a1-summary",
			environment,
		);
		if (candidate) candidates.push(candidate);
	}
	return {
		summary: {
			exitCode: validator.integer(value.exitCode, "exitCode", {
				min: 0,
				max: 255,
				nullable: true,
			}),
			signal: validator.string(value.signal, "signal", {
				maxChars: 50,
				nullable: true,
			}),
			expectedFiles: validator.integer(value.expectedFiles, "expectedFiles"),
			actualFiles: validator.integer(value.actualFiles, "actualFiles"),
			expectedTests: validator.integer(value.expectedTests, "expectedTests"),
			actualTests: validator.integer(value.actualTests, "actualTests"),
			inventoryMatches: validator.boolean(
				value.inventoryMatches,
				"inventoryMatches",
			),
			failedTests: Math.min(failedTests.length, MAX_ERROR_CANDIDATES),
		},
		candidates,
	};
}

function vitestSummary(id, value, validator, environment) {
	const testResults = validator.array(value.testResults, "testResults");
	const candidates = [];
	let scannedAssertions = 0;
	for (const [fileIndex, rawFile] of testResults.slice(0, 1_000).entries()) {
		const file = validator.record(rawFile, `testResults[${fileIndex}]`);
		const assertions = validator.array(
			file.assertionResults,
			`testResults[${fileIndex}].assertionResults`,
		);
		for (const [assertionIndex, rawAssertion] of assertions
			.slice(0, 1_000)
			.entries()) {
			scannedAssertions += 1;
			if (scannedAssertions > 10_000) break;
			const assertion = validator.record(
				rawAssertion,
				`testResults[${fileIndex}].assertionResults[${assertionIndex}]`,
			);
			const status = validator.string(
				assertion.status,
				`testResults[${fileIndex}].assertionResults[${assertionIndex}].status`,
				{ maxChars: 20 },
			);
			if (status !== "failed" || candidates.length >= MAX_ERROR_CANDIDATES) {
				continue;
			}
			const title = validator.string(
				assertion.fullName ?? assertion.title,
				`testResults[${fileIndex}].assertionResults[${assertionIndex}].title`,
				{ maxChars: 500 },
			);
			const messages = validator.stringArray(
				assertion.failureMessages,
				`testResults[${fileIndex}].assertionResults[${assertionIndex}].failureMessages`,
				{ maxItems: 1, maxCharsPerItem: 2_000, optional: true },
			);
			const candidate = boundedCandidate(
				`${title ?? "test failure"}: ${messages[0] ?? ""}`,
				id,
				environment,
			);
			if (candidate) candidates.push(candidate);
		}
	}
	return {
		summary: {
			success: validator.boolean(value.success, "success"),
			totalTests: validator.integer(value.numTotalTests, "numTotalTests"),
			passedTests: validator.integer(value.numPassedTests, "numPassedTests"),
			failedTests: validator.integer(value.numFailedTests, "numFailedTests"),
			testFiles: testResults.length,
		},
		candidates,
	};
}

function mcpRunnerSummary(definition, value, validator) {
	const group = validator.string(value.group, "group", { maxChars: 50 });
	if (group !== null && group !== definition.expectedGroup) {
		validator.issue(
			"group",
			`the static plan value ${definition.expectedGroup}`,
		);
	}
	const files = validator.array(value.files, "files");
	const scripts = validator.array(value.scripts, "scripts");
	return {
		summary: {
			group: group === definition.expectedGroup ? group : null,
			expectedTests: validator.integer(value.expectedTests, "expectedTests"),
			files: files.length,
			scripts: scripts.length,
		},
		candidates: [],
	};
}

function doctorSummary(value, validator, environment) {
	const summaryValue = validator.record(value.summary, "summary");
	const failureCodes = validator.stringArray(
		value.failureCodes,
		"failureCodes",
		{
			maxItems: MAX_ERROR_CANDIDATES,
			maxCharsPerItem: 100,
		},
	);
	const checks = validator.array(value.checks, "checks");
	const candidates = [];
	for (const [index, rawCheck] of checks.slice(0, 1_000).entries()) {
		const check = validator.record(rawCheck, `checks[${index}]`);
		const status = validator.string(check.status, `checks[${index}].status`, {
			maxChars: 20,
		});
		if (status !== "failed" || candidates.length >= MAX_ERROR_CANDIDATES) {
			continue;
		}
		const id = validator.string(check.id, `checks[${index}].id`, {
			maxChars: 100,
		});
		const detail = validator.string(
			check.detail ?? check.failureCode,
			`checks[${index}].detail`,
			{ maxChars: 2_000 },
		);
		const candidate = boundedCandidate(
			`${id ?? "doctor-check"}: ${detail ?? "failed"}`,
			"mcp-doctor",
			environment,
		);
		if (candidate) candidates.push(candidate);
	}
	return {
		summary: {
			success: validator.boolean(value.success, "success"),
			status: validator.string(value.status, "status", {
				maxChars: 50,
				optional: true,
			}),
			passed: validator.integer(summaryValue.passed, "summary.passed"),
			failed: validator.integer(summaryValue.failed, "summary.failed"),
			skipped: validator.integer(summaryValue.skipped, "summary.skipped"),
			total: validator.integer(summaryValue.total, "summary.total"),
			failureCodes,
		},
		candidates,
	};
}

function cliSummary(id, value, validator, environment) {
	const commands = validator.array(value.commands, "commands", {
		optional: true,
	});
	const aliases = validator.stringArray(value.aliases, "aliases", {
		maxItems: 10,
		maxCharsPerItem: 100,
		optional: true,
	});
	const error = validator.string(value.error, "error", {
		maxChars: 2_000,
		optional: true,
	});
	const candidate = boundedCandidate(error, id, environment);
	return {
		summary: {
			status: validator.string(value.status, "status", { maxChars: 50 }),
			stage: validator.string(value.stage, "stage", { maxChars: 100 }),
			mode: validator.string(value.mode, "mode", {
				maxChars: 50,
				optional: true,
			}),
			target: validator.string(value.target, "target", {
				maxChars: 100,
				optional: true,
			}),
			generatedFiles: validator.integer(
				value.generatedFiles,
				"generatedFiles",
				{ optional: true },
			),
			aliases,
			commands: commands?.length ?? 0,
		},
		candidates: candidate ? [candidate] : [],
	};
}

function smokeSummary(value, validator, environment) {
	const milestones = validator.stringArray(value.milestones, "milestones", {
		maxItems: 20,
		maxCharsPerItem: 100,
	});
	const error = validator.string(value.error, "error", {
		maxChars: 2_000,
		optional: true,
	});
	const candidate = boundedCandidate(error, "mcp-smoke", environment);
	return {
		summary: {
			status: validator.string(value.status, "status", { maxChars: 50 }),
			stage: validator.string(value.stage, "stage", { maxChars: 100 }),
			childExitCode: validator.integer(value.childExitCode, "childExitCode", {
				min: 0,
				max: 255,
				nullable: true,
			}),
			childSignal: validator.string(value.childSignal, "childSignal", {
				maxChars: 50,
				nullable: true,
			}),
			milestones,
		},
		candidates: candidate ? [candidate] : [],
	};
}

function fixtureSummary(value, validator) {
	const routes = validator.array(value.routes, "routes", { optional: true });
	return {
		summary: {
			kind: validator.string(value.kind, "kind", {
				maxChars: 100,
				optional: true,
			}),
			path: validator.string(value.path, "path", {
				maxChars: 500,
				optional: true,
			}),
			host: validator.string(value.host, "host", {
				maxChars: 100,
				optional: true,
			}),
			port: validator.string(value.port, "port", {
				maxChars: 50,
				optional: true,
			}),
			routes: routes?.length ?? 0,
		},
		candidates: [],
	};
}

function summarizeJson(definition, value, environment) {
	const validator = createValidator(environment);
	const root = validator.record(value, "report");
	let extracted;
	switch (definition.id) {
		case "a1-summary":
			extracted = a1Summary(root, validator, environment);
			break;
		case "a1-vitest":
		case "mcp-results":
			extracted = vitestSummary(definition.id, root, validator, environment);
			break;
		case "mcp-runner":
			extracted = mcpRunnerSummary(definition, root, validator);
			break;
		case "mcp-doctor":
			extracted = doctorSummary(root, validator, environment);
			break;
		case "cli-summary":
			extracted = cliSummary(definition.id, root, validator, environment);
			break;
		case "mcp-smoke":
			extracted = smokeSummary(root, validator, environment);
			break;
		case "a1-runtime":
		case "cli-runtime":
			extracted = {
				summary: runtimeSummary(root, validator),
				candidates: [],
			};
			break;
		case "cli-fixture":
			extracted = fixtureSummary(root, validator);
			break;
		default:
			validator.issue("report", `a known schema for ${definition.id}`);
			extracted = { summary: {}, candidates: [] };
	}
	return { ...extracted, errors: validator.errors };
}

function reportSource(definition, environment) {
	const configured = environment[definition.sourceEnv];
	if (!configured) return null;
	return definition.relativePath === "."
		? path.resolve(configured)
		: path.resolve(configured, definition.relativePath);
}

function boundedError(error, environment) {
	return sanitizeText(
		error?.message ?? "Diagnostic input was rejected.",
		environment,
	)
		.replace(/\r?\n/g, " ")
		.slice(0, 500);
}

async function collectReport(
	definition,
	diagnosticDirectory,
	environment,
	onAfterLstat,
) {
	const source = reportSource(definition, environment);
	const base = {
		id: definition.id,
		label: definition.label,
		path: source
			? sanitizeText(source, environment)
			: `${definition.sourceEnv}/${definition.relativePath}`,
		exists: false,
		bytes: null,
		parseStatus: "missing",
		artifactPath: null,
		summary: {},
		candidates: [],
		artifact: null,
	};
	if (!source) return base;
	try {
		await ensureSafeDirectory(path.dirname(source), environment);
		const input =
			definition.format === "text"
				? await readBoundedRegularFile(source, {
						maxBytes: MAX_KNOWN_REPORT_BYTES,
						onAfterLstat,
					})
				: await readBoundedJsonFile(source, {
						maxBytes: MAX_KNOWN_REPORT_BYTES,
						onAfterLstat,
					});
		base.exists = true;
		base.bytes = input.bytes;
		let normalized;
		let schemaErrors = [];
		if (definition.format === "text") {
			const lines = input.contents.split(/\r?\n/).filter(Boolean);
			normalized = {
				lines: lines.length,
				truncated: lines.length > 1_000,
			};
		} else {
			const extracted = summarizeJson(definition, input.value, environment);
			normalized = extracted.summary;
			base.candidates = extracted.candidates;
			schemaErrors = extracted.errors;
		}
		base.parseStatus = schemaErrors.length > 0 ? "schema-invalid" : "parsed";
		base.summary = normalized;
		if (schemaErrors.length > 0) {
			base.error =
				`Rejected schema fields: ${schemaErrors.slice(0, 5).join("; ")}`.slice(
					0,
					500,
				);
		}
		base.artifactPath = `known-reports/${definition.id}.json`;
		const artifactValue = {
			schemaVersion: SCHEMA_VERSION,
			kind: "openapi-to-ci-known-report-summary",
			id: definition.id,
			sourceBytes: input.bytes,
			parseStatus: base.parseStatus,
			summary: normalized,
			candidates: base.candidates,
			...(schemaErrors.length > 0
				? { schemaErrors: schemaErrors.slice(0, 5) }
				: {}),
		};
		const contents = `${JSON.stringify(artifactValue, null, 2)}\n`;
		if (Buffer.byteLength(contents) > MAX_NORMALIZED_REPORT_BYTES) {
			throw new Error("Normalized known report exceeded its size limit.");
		}
		await atomicWrite(
			safeChild(diagnosticDirectory, base.artifactPath),
			contents,
		);
		base.artifact = {
			path: base.artifactPath,
			contents,
			maxBytes: MAX_NORMALIZED_REPORT_BYTES,
		};
		return base;
	} catch (error) {
		if (error?.code === "ENOENT") return base;
		base.exists =
			error?.diagnosticFileStatus === "too-large" ||
			error?.diagnosticFileStatus === "invalid";
		base.parseStatus = error?.diagnosticFileStatus ?? "rejected";
		base.error = boundedError(error, environment);
		return base;
	}
}

function notRun(expected) {
	return {
		id: expected.id,
		label: expected.label,
		status: "not-run",
		exitCode: null,
		signal: null,
		durationMs: null,
		command: null,
		cwd: null,
		process: null,
		resources: null,
		evidence: {
			stdout: { totalLines: 0, truncated: false, truncatedLines: 0 },
			stderr: { totalLines: 0, truncated: false, truncatedLines: 0 },
			candidates: [],
		},
	};
}

function normalizeStream(value, field, validator, environment) {
	const stream = validator.record(value, field);
	const rawTail = validator.array(stream.tail, `${field}.tail`);
	const tail = [];
	for (const [index, line] of rawTail.slice(-100).entries()) {
		const normalized = validator.string(line, `${field}.tail[${index}]`, {
			maxChars: 1_024,
		});
		if (normalized !== null)
			tail.push(sanitizeLine(normalized, environment).value);
	}
	const rawCandidates = validator.array(
		stream.candidates,
		`${field}.candidates`,
	);
	const candidates = [];
	for (const [index, rawCandidate] of rawCandidates
		.slice(0, MAX_ERROR_CANDIDATES)
		.entries()) {
		const candidate = validator.record(
			rawCandidate,
			`${field}.candidates[${index}]`,
		);
		const text = validator.string(
			candidate.text,
			`${field}.candidates[${index}].text`,
			{ maxChars: 1_000 },
		);
		if (text !== null) {
			candidates.push({ kind: "heuristic-candidate", text });
		}
	}
	return {
		tail,
		totalLines:
			validator.integer(stream.totalLines, `${field}.totalLines`) ?? 0,
		truncated:
			validator.boolean(stream.truncated, `${field}.truncated`) === true,
		truncatedLines:
			validator.integer(stream.truncatedLines, `${field}.truncatedLines`) ?? 0,
		candidates,
	};
}

function normalizeProcessLifecycle(value, validator) {
	const lifecycle = validator.record(value, "process");
	const nullableExitCode = (value, field) =>
		validator.integer(value, field, {
			min: -0x80000000,
			max: 0xffffffff,
			nullable: true,
		});
	const nullableSignal = (value, field) =>
		validator.string(value, field, { maxChars: 50, nullable: true });
	return {
		wrapperPid: validator.integer(lifecycle.wrapperPid, "process.wrapperPid", {
			max: Number.MAX_SAFE_INTEGER,
		}),
		wrapperParentPid: validator.integer(
			lifecycle.wrapperParentPid,
			"process.wrapperParentPid",
			{ max: Number.MAX_SAFE_INTEGER },
		),
		childPid: validator.integer(lifecycle.childPid, "process.childPid", {
			max: Number.MAX_SAFE_INTEGER,
			nullable: true,
		}),
		spawnEventObserved: validator.boolean(
			lifecycle.spawnEventObserved,
			"process.spawnEventObserved",
		),
		errorEventObserved: validator.boolean(
			lifecycle.errorEventObserved,
			"process.errorEventObserved",
		),
		exitEventObserved: validator.boolean(
			lifecycle.exitEventObserved,
			"process.exitEventObserved",
		),
		exitEventCode: nullableExitCode(
			lifecycle.exitEventCode,
			"process.exitEventCode",
		),
		exitEventSignal: nullableSignal(
			lifecycle.exitEventSignal,
			"process.exitEventSignal",
		),
		closeEventObserved: validator.boolean(
			lifecycle.closeEventObserved,
			"process.closeEventObserved",
		),
		closeEventCode: nullableExitCode(
			lifecycle.closeEventCode,
			"process.closeEventCode",
		),
		closeEventSignal: nullableSignal(
			lifecycle.closeEventSignal,
			"process.closeEventSignal",
		),
		stdoutEndObserved: validator.boolean(
			lifecycle.stdoutEndObserved,
			"process.stdoutEndObserved",
		),
		stdoutCloseObserved: validator.boolean(
			lifecycle.stdoutCloseObserved,
			"process.stdoutCloseObserved",
		),
		stderrEndObserved: validator.boolean(
			lifecycle.stderrEndObserved,
			"process.stderrEndObserved",
		),
		stderrCloseObserved: validator.boolean(
			lifecycle.stderrCloseObserved,
			"process.stderrCloseObserved",
		),
	};
}

function normalizeResourceSnapshot(value, field, validator) {
	const snapshot = validator.record(value, field);
	const bytes = (name) =>
		validator.integer(snapshot[name], `${field}.${name}`, {
			max: Number.MAX_SAFE_INTEGER,
		});
	return {
		hostTotalMemoryBytes: bytes("hostTotalMemoryBytes"),
		hostFreeMemoryBytes: bytes("hostFreeMemoryBytes"),
		wrapperRssBytes: bytes("wrapperRssBytes"),
		wrapperHeapUsedBytes: bytes("wrapperHeapUsedBytes"),
	};
}

function normalizeResources(value, validator) {
	const resources = validator.record(value, "resources");
	return {
		start: normalizeResourceSnapshot(
			resources.start,
			"resources.start",
			validator,
		),
		end: normalizeResourceSnapshot(resources.end, "resources.end", validator),
	};
}

function normalizeCommandReport(value, expected, environment) {
	const validator = createValidator(environment);
	const report = validator.record(value, "command");
	if (
		report.schemaVersion !== SCHEMA_VERSION ||
		report.kind !== "openapi-to-ci-command" ||
		report.id !== expected.id ||
		report.label !== expected.label
	) {
		validator.issue("command", "the initialized command identity");
	}
	if (
		!COMMAND_STATUSES.includes(report.status) ||
		report.status === "not-run"
	) {
		validator.issue("status", "an executed command status");
	}
	const rawCommand = validator.array(report.command, "command.command");
	const command = [];
	for (const [index, argument] of rawCommand.slice(0, 100).entries()) {
		const normalized = validator.string(argument, `command.command[${index}]`, {
			maxChars: 1_000,
		});
		if (normalized !== null) command.push(normalized);
	}
	if (rawCommand.length > 100)
		validator.issue("command.command", "at most 100 items");
	const evidence = validator.record(report.evidence, "evidence");
	const stdout = normalizeStream(
		evidence.stdout,
		"evidence.stdout",
		validator,
		environment,
	);
	const stderr = normalizeStream(
		evidence.stderr,
		"evidence.stderr",
		validator,
		environment,
	);
	const processDetails = normalizeProcessLifecycle(report.process, validator);
	const resources = normalizeResources(report.resources, validator);
	const normalized = {
		schemaVersion: SCHEMA_VERSION,
		kind: "openapi-to-ci-command",
		id: expected.id,
		label: expected.label,
		status: COMMAND_STATUSES.includes(report.status)
			? report.status
			: "failure",
		exitCode: validator.integer(report.exitCode, "exitCode", {
			min: -0x80000000,
			max: 0xffffffff,
			nullable: true,
		}),
		signal: validator.string(report.signal, "signal", {
			maxChars: 50,
			nullable: true,
		}),
		durationMs: validator.number(report.durationMs, "durationMs"),
		command: sanitizeCommand(command, environment),
		cwd: validator.string(report.cwd, "cwd", { maxChars: 500 }),
		process: processDetails,
		resources,
		evidence: {
			stdout,
			stderr,
			spawnError: validator.string(evidence.spawnError, "evidence.spawnError", {
				maxChars: 1_000,
				nullable: true,
			}),
		},
	};
	if (
		processDetails.exitEventObserved &&
		(processDetails.exitEventCode !== normalized.exitCode ||
			processDetails.exitEventSignal !== normalized.signal)
	) {
		validator.issue("process.exitEvent", "the command exit code and signal");
	}
	if (
		processDetails.closeEventObserved &&
		(processDetails.closeEventCode !== normalized.exitCode ||
			processDetails.closeEventSignal !== normalized.signal)
	) {
		validator.issue("process.closeEvent", "the command exit code and signal");
	}
	if (validator.errors.length > 0) {
		throw new Error(
			`Command report schema is invalid: ${validator.errors.slice(0, 5).join("; ")}`,
		);
	}
	return normalized;
}

async function collectCommands(plan, directory, environment) {
	const commands = [];
	const errors = [];
	const artifacts = [];
	await ensureSafeDirectory(safeChild(directory, "commands"), environment);
	for (const expected of plan.commands) {
		const filePath = safeChild(directory, "commands", `${expected.id}.json`);
		try {
			const input = await readBoundedJsonFile(filePath, {
				maxBytes: MAX_COMMAND_REPORT_BYTES,
			});
			const report = normalizeCommandReport(input.value, expected, environment);
			const contents = `${JSON.stringify(report, null, 2)}\n`;
			if (Buffer.byteLength(contents) > MAX_COMMAND_REPORT_BYTES) {
				throw new Error("Normalized command report exceeded its size limit.");
			}
			await atomicWrite(filePath, contents);
			artifacts.push({
				path: `commands/${expected.id}.json`,
				contents,
				maxBytes: MAX_COMMAND_REPORT_BYTES,
			});
			commands.push({
				id: report.id,
				label: report.label,
				status: report.status,
				exitCode: report.exitCode,
				signal: report.signal,
				durationMs: report.durationMs,
				command: report.command,
				cwd: report.cwd,
				process: report.process,
				resources: report.resources,
				evidence: {
					stdout: {
						totalLines: report.evidence.stdout.totalLines,
						truncated: report.evidence.stdout.truncated,
						truncatedLines: report.evidence.stdout.truncatedLines,
						lastLine: report.evidence.stdout.tail.at(-1) ?? "",
					},
					stderr: {
						totalLines: report.evidence.stderr.totalLines,
						truncated: report.evidence.stderr.truncated,
						truncatedLines: report.evidence.stderr.truncatedLines,
						lastLine: report.evidence.stderr.tail.at(-1) ?? "",
					},
					candidates: [
						...report.evidence.stderr.candidates.map((candidate) => ({
							...candidate,
							stream: "stderr",
						})),
						...report.evidence.stdout.candidates.map((candidate) => ({
							...candidate,
							stream: "stdout",
						})),
					].slice(0, MAX_ERROR_CANDIDATES),
					spawnError: report.evidence.spawnError,
				},
			});
		} catch (error) {
			if (error?.code !== "ENOENT") {
				errors.push(`${expected.id}: ${boundedError(error, environment)}`);
			}
			commands.push(notRun(expected));
		}
	}
	return { commands, errors, artifacts };
}

function collectSteps(plan, supplied) {
	const steps = [];
	const errors = [];
	const known = new Set(plan.steps.map(({ id }) => id));
	for (const key of Object.keys(supplied)) {
		if (!known.has(key)) errors.push(`unknown action step: ${key}`);
	}
	for (const expected of plan.steps) {
		const raw = supplied[expected.id];
		const status = STEP_STATUSES.includes(raw) ? raw : "unknown";
		if (status === "unknown") {
			errors.push(`${expected.id}: missing or invalid action outcome`);
		}
		steps.push({
			id: expected.id,
			label: expected.label,
			kind: "action",
			status,
		});
	}
	return { steps, errors };
}

function selectEvidence(steps, commands, reports) {
	const actionEvidence = steps
		.filter(({ status }) => ["failure", "cancelled"].includes(status))
		.map((step) => ({
			source: step.id,
			kind: "action-outcome",
			text: `${step.label} finished with ${step.status}.`,
		}));
	const structured = reports.flatMap(({ candidates }) => candidates ?? []);
	const commandCandidates = commands.flatMap((command) =>
		(command.evidence?.candidates ?? []).map((candidate) => ({
			source: `${command.id}/${candidate.stream ?? "output"}`,
			kind: "heuristic-candidate",
			text: candidate.text,
		})),
	);
	const exitEvidence = commands
		.filter(({ status }) => commandFailureStatuses.has(status))
		.map((command) => ({
			source: command.id,
			kind: "command-exit",
			text: `${command.label} exited with ${
				command.exitCode ?? command.signal ?? command.status
			}.`,
		}));
	const fallbackTails = commands
		.filter(({ status }) => commandFailureStatuses.has(status))
		.flatMap((command) =>
			[
				["stderr-tail", command.evidence?.stderr?.lastLine],
				["stdout-tail", command.evidence?.stdout?.lastLine],
			]
				.filter(([, text]) => text)
				.map(([kind, text]) => ({
					source: command.id,
					kind,
					text,
				})),
		);
	return [
		...actionEvidence,
		...structured,
		...exitEvidence,
		...commandCandidates,
		...fallbackTails,
	].slice(0, MAX_ERROR_CANDIDATES);
}

function duration(value) {
	if (!Number.isFinite(value)) return "—";
	return `${(value / 1_000).toFixed(1)}s`;
}

export function renderSummary(diagnostic, artifactName) {
	const lines = [
		"## CI diagnostics",
		"",
		"| Field | Value |",
		"| --- | --- |",
		`| Status | ${markdownCell(diagnostic.status)} |`,
		`| Workflow | ${markdownCell(diagnostic.workflow.name)} |`,
		`| Job | ${markdownCell(diagnostic.workflow.jobName)} |`,
		`| Runner | ${markdownCell(`${diagnostic.runner.os} / ${diagnostic.runner.architecture}`)} |`,
		`| Commit | ${markdownCell(diagnostic.workflow.commitSha?.slice(0, 7) ?? "unavailable")} |`,
		`| Diagnostic schema | ${SCHEMA_VERSION} |`,
		"",
		"### Action steps",
		"",
		"| Step | Status |",
		"| --- | --- |",
	];
	for (const step of diagnostic.steps) {
		lines.push(
			`| ${markdownCell(step.label)} | ${markdownCell(step.status)} |`,
		);
	}
	lines.push(
		"",
		"### Commands",
		"",
		"| Command | Status | Exit | Duration |",
		"| --- | --- | ---: | ---: |",
	);
	for (const command of diagnostic.commands) {
		lines.push(
			`| ${markdownCell(command.label)} | ${markdownCell(command.status)} | ${
				command.exitCode ?? "—"
			} | ${duration(command.durationMs)} |`,
		);
	}
	lines.push("", "### Failure evidence", "");
	if (diagnostic.summary.failureEvidence.length === 0) {
		lines.push("- No failure evidence was collected.");
	} else {
		for (const evidence of diagnostic.summary.failureEvidence.slice(0, 3)) {
			lines.push(
				`- Source: ${markdownCell(evidence.source)}; ${markdownCell(evidence.kind)}: ${markdownCell(evidence.text)}`,
			);
		}
	}
	lines.push(
		`- Output truncated: ${diagnostic.summary.outputTruncated ? "yes" : "no"}`,
		"",
		"### Artifact",
		"",
		markdownCell(artifactName),
		"",
	);
	const rendered = lines.join("\n");
	return rendered.length <= MAX_SUMMARY_CHARS
		? rendered
		: `${rendered.slice(0, MAX_SUMMARY_CHARS)}\n\n_Summary truncated._\n`;
}

export function artifactAllowlist(paths) {
	return [...new Set([...paths, artifactManifestPath])].sort();
}

async function listUploadFiles(root) {
	const files = [];
	async function visit(directory, relativeDirectory = "") {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const relativePath = relativeDirectory
				? `${relativeDirectory}/${entry.name}`
				: entry.name;
			const absolutePath = safeChild(root, ...relativePath.split("/"));
			if (entry.isSymbolicLink()) {
				throw new Error("Upload directory must not contain symlinks.");
			}
			if (entry.isDirectory()) {
				await visit(absolutePath, relativePath);
			} else if (entry.isFile()) {
				files.push(relativePath);
			} else {
				throw new Error("Upload directory must contain only regular files.");
			}
		}
	}
	await visit(root);
	return files.sort();
}

function pathsOverlap(left, right) {
	const relative = path.relative(left, right);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}

async function materializeUploadDirectory({
	directory,
	uploadDirectory,
	sources,
	environment,
}) {
	const resolvedUpload = path.resolve(uploadDirectory);
	if (
		pathsOverlap(directory, resolvedUpload) ||
		pathsOverlap(resolvedUpload, directory)
	) {
		throw new Error(
			"Upload directory must be separate from the working diagnostic directory.",
		);
	}
	await ensureSafeDirectory(path.dirname(resolvedUpload), environment);
	let existing = null;
	try {
		existing = await lstat(resolvedUpload);
		if (existing.isSymbolicLink() || !existing.isDirectory()) {
			throw new Error(
				"Upload directory must be a real directory, not a symlink.",
			);
		}
		await listUploadFiles(resolvedUpload);
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}

	const staging = `${resolvedUpload}.staging-${process.pid}-${randomUUID()}`;
	let published = false;
	try {
		await mkdir(staging, { recursive: false, mode: 0o700 });
		const files = [];
		for (const source of [...sources.values()].sort((left, right) =>
			left.path.localeCompare(right.path),
		)) {
			const input = await readBoundedRegularFile(
				safeChild(directory, ...source.path.split("/")),
				{ maxBytes: source.maxBytes },
			);
			const expected = Buffer.from(source.contents);
			if (!input.contents || !Buffer.from(input.contents).equals(expected)) {
				throw new Error(
					`Artifact source changed after validation: ${source.path}`,
				);
			}
			const destination = safeChild(staging, ...source.path.split("/"));
			await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
			await atomicWrite(destination, expected);
			const copied = await readBoundedRegularFile(destination, {
				maxBytes: source.maxBytes,
				encoding: null,
			});
			files.push({
				path: source.path,
				bytes: copied.bytes,
				sha256: createHash("sha256").update(copied.contents).digest("hex"),
			});
		}
		const manifest = {
			schemaVersion: SCHEMA_VERSION,
			kind: "openapi-to-ci-artifact-manifest",
			files,
		};
		const manifestContents = `${JSON.stringify(manifest, null, 2)}\n`;
		if (Buffer.byteLength(manifestContents) > MAX_ARTIFACT_MANIFEST_BYTES) {
			throw new Error("Artifact manifest exceeded its size limit.");
		}
		await atomicWrite(
			safeChild(staging, artifactManifestPath),
			manifestContents,
		);
		const expectedFiles = artifactAllowlist(sources.keys());
		const stagedFiles = await listUploadFiles(staging);
		if (JSON.stringify(stagedFiles) !== JSON.stringify(expectedFiles)) {
			throw new Error("Upload directory did not match its static allowlist.");
		}
		if (existing) {
			await rm(resolvedUpload, { recursive: true, force: true });
		}
		await rename(staging, resolvedUpload);
		published = true;
		const actualFiles = await listUploadFiles(resolvedUpload);
		if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
			throw new Error("Published upload directory did not match its manifest.");
		}
		return { manifest, files: actualFiles };
	} catch (error) {
		await rm(staging, { recursive: true, force: true }).catch(() => {});
		if (published) {
			await rm(resolvedUpload, { recursive: true, force: true }).catch(
				() => {},
			);
		}
		throw error;
	}
}

function overallStatus(jobStatus, steps, commands, finalizationErrors) {
	if (jobStatus === "cancelled") return "cancelled";
	if (
		jobStatus === "failure" ||
		steps.some(({ status }) => ["failure", "cancelled"].includes(status)) ||
		commands.some(({ status }) => commandFailureStatuses.has(status))
	) {
		return "failure";
	}
	if (
		finalizationErrors.length > 0 ||
		commands.some(({ status }) => status === "not-run")
	) {
		return "failure";
	}
	return "success";
}

function assertInitializedPlan(manifest, options, plan, directoryDetails) {
	const expectedReports = plan.reports.map(
		({ id, label, relativePath, format }) => ({
			id,
			label,
			relativePath,
			format,
		}),
	);
	if (
		manifest?.planId !== options.plan ||
		manifest.schemaVersion !== SCHEMA_VERSION ||
		manifest.workflow !== plan.workflow ||
		manifest.jobId !== plan.jobId ||
		manifest.jobName !== plan.jobName ||
		JSON.stringify(manifest.steps) !== JSON.stringify(plan.steps) ||
		JSON.stringify(manifest.commands) !== JSON.stringify(plan.commands) ||
		JSON.stringify(manifest.reports) !== JSON.stringify(expectedReports) ||
		manifest.directoryIdentity?.dev !== String(directoryDetails.dev) ||
		manifest.directoryIdentity?.ino !== String(directoryDetails.ino)
	) {
		throw new Error(
			"Initialized diagnostic plan does not match finalizer input.",
		);
	}
}

async function appendJobSummary(summaryPath, summary) {
	const details = await lstat(summaryPath).catch((error) => {
		if (error?.code === "ENOENT") return null;
		throw error;
	});
	if (details && (details.isSymbolicLink() || !details.isFile())) {
		throw new Error("GITHUB_STEP_SUMMARY is not a regular file.");
	}
	await appendFile(summaryPath, summary);
}

export async function finalizeInitializationFailure(
	options,
	environment = process.env,
) {
	const plan = getPlan(options.plan);
	const { steps } = collectSteps(plan, options.steps ?? {});
	const initialization = steps.find(({ id }) => id === "diagnostics-init");
	const summary = [
		"# CI diagnostics initialization failure",
		"",
		`Workflow: ${markdownCell(plan.workflow, environment)}`,
		`Job: ${markdownCell(plan.jobName, environment)}`,
		"",
		"| Step | Status |",
		"| --- | --- |",
		...steps.map(
			({ id, status }) =>
				`| ${markdownCell(id, environment)} | ${markdownCell(status, environment)} |`,
		),
		"",
		`Failure evidence: diagnostics-init is ${markdownCell(initialization?.status ?? "unknown", environment)}.`,
		"",
		"No diagnostic artifact was materialized because initialization did not produce a trusted upload directory.",
		"",
	].join("\n");
	if (!environment.GITHUB_STEP_SUMMARY) {
		throw new Error(
			"Initialization failed and GITHUB_STEP_SUMMARY is unavailable.",
		);
	}
	await appendJobSummary(environment.GITHUB_STEP_SUMMARY, summary);
	return { summary, steps };
}

export async function finalize(options, environment = process.env) {
	const directory = await ensureSafeDirectory(options.dir, environment);
	const planInput = await readBoundedJsonFile(
		safeChild(directory, "plan.json"),
		{ maxBytes: MAX_PLAN_BYTES },
	);
	const plan = getPlan(options.plan);
	assertInitializedPlan(planInput.value, options, plan, await lstat(directory));
	await ensureSafeDirectory(safeChild(directory, "known-reports"), environment);
	const {
		commands,
		errors: commandErrors,
		artifacts: commandArtifacts,
	} = await collectCommands(plan, directory, environment);
	const reports = [];
	for (const definition of plan.reports) {
		reports.push(
			await collectReport(
				definition,
				directory,
				environment,
				options.onKnownReportAfterLstat
					? (details) => options.onKnownReportAfterLstat(definition, details)
					: undefined,
			),
		);
	}
	const { steps, errors: stepErrors } = collectSteps(plan, options.steps ?? {});
	const missingReports = reports
		.filter(({ parseStatus }) => parseStatus !== "parsed")
		.map(({ id, parseStatus }) => `${id}: ${parseStatus}`);
	const normalizedJobStatus = jobStatuses.has(options.jobStatus)
		? options.jobStatus
		: "failure";
	const successfulAuthority =
		normalizedJobStatus === "success" &&
		steps.every(({ status }) => status === "success") &&
		commands.every(({ status }) => status === "success");
	const finalizationErrors = [
		...commandErrors,
		...stepErrors,
		...(options.jobStatus && !jobStatuses.has(options.jobStatus)
			? ["job-status: invalid"]
			: []),
		...(successfulAuthority ? missingReports : []),
	];
	const matrix = stableObject(
		Object.entries(options.matrix ?? {}).map(([key, value]) => [
			key,
			nullable(value, environment),
		]),
	);
	const artifactName = `ci-diagnostics-${plan.workflow
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")}-${plan.jobId}${
		matrix.os
			? `-${String(matrix.os)
					.toLowerCase()
					.replace(/[^a-z0-9-]+/g, "-")}`
			: ""
	}`;
	const sources = new Map();
	sources.set("plan.json", {
		path: "plan.json",
		contents: planInput.contents,
		maxBytes: MAX_PLAN_BYTES,
	});
	for (const artifact of commandArtifacts) sources.set(artifact.path, artifact);
	for (const report of reports) {
		if (report.artifact) sources.set(report.artifact.path, report.artifact);
	}
	const expectedArtifactFiles = artifactAllowlist([
		...sources.keys(),
		"ci-diagnostic.json",
		"summary.md",
	]);
	const diagnostic = {
		schemaVersion: SCHEMA_VERSION,
		kind: DIAGNOSTIC_KIND,
		status: "success",
		workflow: workflowMetadata(plan, environment),
		runner: await runnerMetadata(environment),
		matrix,
		steps,
		commands,
		reports: reports.map(({ candidates, artifact, ...report }) => report),
		summary: {
			failureEvidence: selectEvidence(steps, commands, reports),
			outputTruncated: commands.some(
				({ evidence }) =>
					evidence.stdout.truncated || evidence.stderr.truncated,
			),
			missingReports,
			finalizationErrors,
			artifactName,
			artifactFiles: expectedArtifactFiles,
			artifactManifest: artifactManifestPath,
		},
		sanitization: {
			applied: true,
			bestEffort: true,
			fullEnvironmentCollected: false,
			eventPayloadCollected: false,
			fullLogsCollected: false,
			limits: {
				commandTailLines: 100,
				lineCharacters: 1_024,
				errorCandidates: MAX_ERROR_CANDIDATES,
				diagnosticBytes: MAX_DIAGNOSTIC_BYTES,
				planBytes: MAX_PLAN_BYTES,
				knownReportBytes: MAX_KNOWN_REPORT_BYTES,
			},
		},
	};
	diagnostic.status = overallStatus(
		normalizedJobStatus,
		steps,
		commands,
		finalizationErrors,
	);
	let summary = renderSummary(diagnostic, artifactName);
	if (jsonBytes(diagnostic) > MAX_DIAGNOSTIC_BYTES) {
		diagnostic.summary.failureEvidence =
			diagnostic.summary.failureEvidence.slice(0, 3);
		for (const command of diagnostic.commands) {
			command.evidence.candidates = command.evidence.candidates.slice(0, 1);
		}
	}
	if (jsonBytes(diagnostic) > MAX_DIAGNOSTIC_BYTES) {
		throw new Error("Final diagnostic exceeded its size limit.");
	}
	let diagnosticContents = `${JSON.stringify(diagnostic, null, 2)}\n`;
	await atomicWrite(
		safeChild(directory, "ci-diagnostic.json"),
		diagnosticContents,
	);
	await atomicWrite(safeChild(directory, "summary.md"), summary);
	let appendError = null;
	if (environment.GITHUB_STEP_SUMMARY) {
		try {
			await appendJobSummary(environment.GITHUB_STEP_SUMMARY, summary);
		} catch (error) {
			appendError = boundedError(error, environment);
			diagnostic.status = "failure";
			diagnostic.summary.finalizationErrors.push(
				`summary-append: ${appendError}`,
			);
			summary = renderSummary(diagnostic, artifactName);
			diagnosticContents = `${JSON.stringify(diagnostic, null, 2)}\n`;
			await atomicWrite(
				safeChild(directory, "ci-diagnostic.json"),
				diagnosticContents,
			);
			await atomicWrite(safeChild(directory, "summary.md"), summary);
		}
	}
	sources.set("ci-diagnostic.json", {
		path: "ci-diagnostic.json",
		contents: diagnosticContents,
		maxBytes: MAX_DIAGNOSTIC_BYTES,
	});
	sources.set("summary.md", {
		path: "summary.md",
		contents: summary,
		maxBytes: Buffer.byteLength(summary),
	});
	await options.onBeforeMaterialize?.({ directory, sources });
	const upload = await materializeUploadDirectory({
		directory,
		uploadDirectory: options.uploadDir,
		sources,
		environment,
	});
	return {
		diagnostic,
		appendError,
		upload,
		exitCode:
			appendError ||
			(!["failure", "cancelled"].includes(normalizedJobStatus) &&
				finalizationErrors.length > 0)
				? 1
				: 0,
	};
}

async function main() {
	try {
		const options = parseFinalizeArguments(process.argv.slice(2));
		if (!options.uploadDir) {
			await finalizeInitializationFailure(options);
			process.stderr.write(
				`[ci-diagnostics] initialization failed for ${options.plan}; wrote emergency Job Summary and materialized no upload directory.\n`,
			);
			process.exitCode = 1;
			return;
		}
		const result = await finalize(options);
		if (result.appendError) {
			process.stderr.write(
				`[ci-diagnostics] finalize failed while appending Job Summary: ${result.appendError}\n`,
			);
		} else {
			process.stdout.write(
				`[ci-diagnostics] finalized ${options.plan}: ${result.diagnostic.status}; upload files=${result.upload.files.length}\n`,
			);
		}
		if (result.diagnostic.summary.finalizationErrors.length > 0) {
			const errors = sanitizeText(
				result.diagnostic.summary.finalizationErrors.join("; "),
			)
				.replace(/\r?\n/g, " ")
				.slice(0, 2_000);
			process.stderr.write(
				`[ci-diagnostics] finalize evidence errors: ${errors}\n`,
			);
		}
		process.exitCode = result.exitCode;
	} catch (error) {
		process.stderr.write(
			`[ci-diagnostics] finalize failed: ${sanitizeText(error instanceof Error ? error.message : String(error))}\n`,
		);
		process.exitCode = 1;
	}
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	await main();
}
