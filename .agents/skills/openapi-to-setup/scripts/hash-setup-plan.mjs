#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_ITEMS = 100;
const SENSITIVE_KEYS = new Set([
	"token",
	"authorization",
	"cookie",
	"secret",
	"password",
	"headers",
	"env",
]);
const PATH_KEYS = new Set(["file", "path", "target", "expectedwrites"]);
const MODES = new Set(["analysis-only", "developer", "read-only", "hardened"]);
const PACKAGE_MANAGERS = new Set(["pnpm", "npm", "yarn", "bun", "unknown", "conflict"]);
const ACTION_KINDS = new Set([
	"run-command",
	"create-file",
	"append-file",
	"update-gitignore",
	"manual-review",
]);
const PLAN_KEYS = new Set([
	"schemaVersion",
	"mode",
	"observedStateHash",
	"packageManager",
	"actions",
	"verification",
	"restartRequired",
]);
const ACTION_KEYS = new Map([
	["run-command", new Set(["kind", "command", "args", "network", "expectedWrites", "package", "version"])],
	["create-file", new Set(["kind", "path", "content", "sha256"])],
	["append-file", new Set(["kind", "path", "content", "sha256"])],
	["update-gitignore", new Set(["kind", "path", "rule", "sha256"])],
	["manual-review", new Set(["kind", "reason"])],
]);

function fail(message) {
	throw new Error(message);
}

function stable(value) {
	if (Array.isArray(value)) return value.map(stable);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, stable(value[key])]),
		);
	}
	return value;
}

function safeRelativePath(value, context) {
	if (typeof value !== "string" || value.length === 0 || value.length > 512) fail(`${context} must be a bounded relative path.`);
	if (
		path.posix.isAbsolute(value) ||
		path.win32.isAbsolute(value) ||
		/^[A-Za-z]:/.test(value) ||
		value.startsWith("\\\\") ||
		value.includes("\0")
	) fail(`${context} must not be absolute.`);
	const segments = value.replaceAll("\\", "/").split("/");
	if (segments.some((segment) => segment === ".." || segment === "")) fail(`${context} must stay inside the project root.`);
}

function isEscapingPath(value) {
	const segments = value.replaceAll("\\", "/").split("/");
	return segments.some((segment) => segment === "..");
}

function inspectValue(value, context = "plan", seen = new Set()) {
	if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
		if (typeof value === "number" && !Number.isFinite(value)) fail(`${context} contains a non-finite number.`);
		return;
	}
	if (typeof value !== "object") fail(`${context} contains an unsupported value.`);
	if (seen.has(value)) fail(`${context} contains a cycle.`);
	seen.add(value);
	if (Array.isArray(value)) {
		if (value.length > MAX_ITEMS) fail(`${context} contains too many items.`);
		for (const [index, item] of value.entries()) inspectValue(item, `${context}[${index}]`, seen);
		seen.delete(value);
		return;
	}
	for (const [key, child] of Object.entries(value)) {
		const normalizedKey = key.toLowerCase();
		if (SENSITIVE_KEYS.has(normalizedKey)) fail(`${context} contains forbidden sensitive field ${key}.`);
		if (PATH_KEYS.has(normalizedKey)) {
			const paths = Array.isArray(child) ? child : [child];
			for (const [index, candidate] of paths.entries()) safeRelativePath(candidate, `${context}.${key}[${index}]`);
		}
		inspectValue(child, `${context}.${key}`, seen);
	}
	seen.delete(value);
}

function validatePlan(plan) {
	if (!plan || typeof plan !== "object" || Array.isArray(plan)) fail("Setup Plan must be a JSON object.");
	inspectValue(plan);
	for (const key of Object.keys(plan)) {
		if (!PLAN_KEYS.has(key)) fail(`Setup Plan contains unsupported field ${key}.`);
	}
	if (plan.schemaVersion !== 1) fail("schemaVersion must equal 1.");
	if (!MODES.has(plan.mode)) fail("mode must be analysis-only, developer, read-only, or hardened.");
	if (typeof plan.observedStateHash !== "string" || !/^[a-f0-9]{64}$/.test(plan.observedStateHash)) {
		fail("observedStateHash must be a lowercase SHA-256 value.");
	}
	if (!PACKAGE_MANAGERS.has(plan.packageManager)) fail("packageManager is invalid.");
	if (!Array.isArray(plan.actions) || plan.actions.length > MAX_ITEMS) fail("actions must be a bounded array.");
	if (
		!Array.isArray(plan.verification) ||
		plan.verification.length > MAX_ITEMS ||
		plan.verification.some((item) => typeof item !== "string" || item.length === 0 || item.length > 1024)
	) fail("verification must be a bounded string array.");
	if (typeof plan.restartRequired !== "boolean") fail("restartRequired must be boolean.");
	for (const [index, action] of plan.actions.entries()) {
		if (!action || typeof action !== "object" || Array.isArray(action) || !ACTION_KINDS.has(action.kind)) {
			fail(`actions[${index}] has an unsupported kind.`);
		}
		for (const key of Object.keys(action)) {
			if (!ACTION_KEYS.get(action.kind).has(key)) fail(`actions[${index}] contains unsupported field ${key}.`);
		}
		if (action.kind === "run-command") {
			if (typeof action.command !== "string" || !/^[A-Za-z0-9._-]+$/.test(action.command)) {
				fail(`actions[${index}].command must be a program name, not a shell expression.`);
			}
			if (!Array.isArray(action.args) || action.args.some((arg) => typeof arg !== "string" || arg.length > 1024 || arg.includes("\0"))) {
				fail(`actions[${index}].args must be a bounded argv array.`);
			}
			for (const [argIndex, arg] of action.args.entries()) {
				if (path.posix.isAbsolute(arg) || path.win32.isAbsolute(arg) || /^[A-Za-z]:/.test(arg) || arg.startsWith("\\\\") || isEscapingPath(arg)) {
					fail(`actions[${index}].args[${argIndex}] must not contain an absolute or escaping target path.`);
				}
			}
			if (typeof action.network !== "boolean") fail(`actions[${index}].network must be boolean.`);
			if (!Array.isArray(action.expectedWrites) || action.expectedWrites.length > MAX_ITEMS) {
				fail(`actions[${index}].expectedWrites must be a bounded path array.`);
			}
			for (const field of ["package", "version"]) {
				if (action[field] !== undefined && (typeof action[field] !== "string" || action[field].length === 0 || action[field].length > 256)) {
					fail(`actions[${index}].${field} must be a bounded string.`);
				}
			}
		} else if (["create-file", "append-file"].includes(action.kind)) {
			if (typeof action.path !== "string" || typeof action.content !== "string" || action.content.length > MAX_INPUT_BYTES) {
				fail(`actions[${index}] must contain a bounded path and content.`);
			}
		} else if (action.kind === "update-gitignore") {
			if (typeof action.path !== "string" || typeof action.rule !== "string" || action.rule.length === 0 || action.rule.length > 512) {
				fail(`actions[${index}] must contain a bounded path and ignore rule.`);
			}
		} else if (typeof action.reason !== "string" || action.reason.length === 0 || action.reason.length > 1024) {
			fail(`actions[${index}].reason must be a bounded string.`);
		}
		if (action.sha256 !== undefined && (typeof action.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(action.sha256))) {
			fail(`actions[${index}].sha256 must be a lowercase SHA-256 value.`);
		}
	}
}

async function readStdin() {
	const chunks = [];
	let size = 0;
	for await (const chunk of process.stdin) {
		size += chunk.length;
		if (size > MAX_INPUT_BYTES) fail("Setup Plan exceeds the input size limit.");
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}

async function readInput(argv) {
	if (argv.length === 0) return readStdin();
	if (argv.length !== 2 || argv[0] !== "--file") fail("Usage: hash-setup-plan.mjs [--file <plan.json>]");
	const info = await readFile(argv[1]);
	if (info.length > MAX_INPUT_BYTES) fail("Setup Plan exceeds the input size limit.");
	return info.toString("utf8");
}

try {
	const source = await readInput(process.argv.slice(2));
	let plan;
	try {
		plan = JSON.parse(source);
	} catch {
		fail("Setup Plan must be valid JSON.");
	}
	validatePlan(plan);
	const canonicalJson = JSON.stringify(stable(plan));
	const setupPlanId = createHash("sha256").update(canonicalJson).digest("hex");
	process.stdout.write(`${JSON.stringify({ schemaVersion: 1, setupPlanId, canonicalJson })}\n`);
} catch (error) {
	process.stderr.write(`openapi-to setup plan rejected: ${error?.message ?? "unknown error"}\n`);
	process.exitCode = 1;
}
