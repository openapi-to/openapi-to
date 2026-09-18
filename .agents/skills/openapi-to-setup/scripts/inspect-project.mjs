#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
	isInside,
	openVerifiedFile,
	unchangedDuringRead,
} from "./secure-file-read.mjs";

const SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_LOCKFILE_BYTES = 32 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_DEPENDENCY_RESULTS = 100;
const SUPPORTED_CONFIG_FILES = [
	"openapi.config.ts",
	"openapi.config.js",
	"openapi.config.cjs",
	"openapi.config.mjs",
];
const LOCK_FILES = new Map([
	["pnpm-lock.yaml", "pnpm"],
	["package-lock.json", "npm"],
	["npm-shrinkwrap.json", "npm"],
	["yarn.lock", "yarn"],
	["bun.lock", "bun"],
	["bun.lockb", "bun"],
]);
const DEPENDENCY_SECTIONS = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
];

function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
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

function canonicalJson(value) {
	return JSON.stringify(stable(value));
}

async function entryInfo(root, relativePath) {
	const candidate = path.resolve(root, relativePath);
	if (!isInside(root, candidate)) return { exists: false, unsafe: true };
	let entry;
	try {
		entry = await lstat(candidate, { bigint: true });
	} catch (error) {
		if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
			return { exists: false, unsafe: false };
		}
		if (error?.code === "ELOOP") return { exists: true, unsafe: true, symlink: true };
		throw error;
	}
	try {
		const resolved = await realpath(candidate);
		if (!isInside(root, resolved)) {
			return { exists: true, unsafe: true, symlink: entry.isSymbolicLink() };
		}
		return {
			exists: true,
			unsafe: entry.isSymbolicLink(),
			symlink: entry.isSymbolicLink(),
			isFile: entry.isFile(),
			isDirectory: entry.isDirectory(),
			stats: entry,
			path: candidate,
			realPath: resolved,
		};
	} catch (error) {
		if (
			error?.code === "ENOENT" ||
			error?.code === "ENOTDIR" ||
			error?.code === "ELOOP"
		) {
			return { exists: true, unsafe: true, symlink: entry.isSymbolicLink() };
		}
		throw error;
	}
}

async function readBoundedText(root, relativePath) {
	const info = await entryInfo(root, relativePath);
	if (!info.exists || info.unsafe) return { info };
	if (!info.isFile) return { info, readError: true };
	const openedFile = await openVerifiedFile(root, info);
	if (!openedFile.handle) return { info: { ...info, unsafe: openedFile.unsafe === true }, readError: openedFile.readError === true };
	const { handle, opened } = openedFile;
	try {
		if (opened.size > BigInt(MAX_FILE_BYTES)) return { info, tooLarge: true };
		const bytes = await handle.readFile();
		const after = await handle.stat({ bigint: true });
		if (BigInt(bytes.byteLength) !== opened.size || !unchangedDuringRead(opened, after)) {
			return { info, readError: true };
		}
		return { info, text: bytes.toString("utf8"), sha256: sha256(bytes) };
	} catch {
		return { info, readError: true };
	} finally {
		await handle.close();
	}
}

async function hashLockFile(root, relativePath) {
	const info = await entryInfo(root, relativePath);
	if (!info.exists || info.unsafe) return { info };
	if (!info.isFile) return { info, readError: true };
	const openedFile = await openVerifiedFile(root, info);
	if (!openedFile.handle) return { info: { ...info, unsafe: openedFile.unsafe === true }, readError: openedFile.readError === true };
	const { handle, opened } = openedFile;
	try {
		if (opened.size > BigInt(MAX_LOCKFILE_BYTES)) {
			return {
				info,
				size: opened.size <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(opened.size) : null,
				tooLarge: true,
			};
		}
		const hash = createHash("sha256");
		let size = 0;
		for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
			size += chunk.byteLength;
			if (size > MAX_LOCKFILE_BYTES) return { info, size, tooLarge: true };
			hash.update(chunk);
		}
		const after = await handle.stat({ bigint: true });
		if (BigInt(size) !== opened.size || !unchangedDuringRead(opened, after)) {
			return { info, size, readError: true };
		}
		return { info, size, sha256: hash.digest("hex") };
	} catch {
		return { info, readError: true };
	} finally {
		await handle.close();
	}
}

function packageManagerName(value) {
	if (typeof value !== "string") return undefined;
	const match = value.match(/^(pnpm|npm|yarn|bun)(?:@|$)/);
	return match?.[1];
}

function exactVersion(value) {
	if (typeof value !== "string") return undefined;
	const normalized = value.replace(/^workspace:/, "").replace(/^npm:/, "");
	return /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalized)
		? normalized.replace(/^v/, "")
		: undefined;
}

function collectDependencies(manifest) {
	const packages = [];
	for (const section of DEPENDENCY_SECTIONS) {
		const values = manifest?.[section];
		if (!values || typeof values !== "object" || Array.isArray(values)) continue;
		for (const name of Object.keys(values).sort()) {
			if (name !== "openapi-to" && !name.startsWith("@openapi-to/")) continue;
			const range = typeof values[name] === "string" ? values[name] : "invalid";
			packages.push({
				name,
				section,
				range,
				aggregate: name === "openapi-to",
				mcpOnly: name === "@openapi-to/mcp",
			});
		}
	}
	const exactVersions = new Set(packages.map(({ range }) => exactVersion(range)).filter(Boolean));
	return {
		aggregate: packages.find(({ aggregate }) => aggregate) ?? null,
		mcpOnly: packages.find(({ mcpOnly }) => mcpOnly) ?? null,
		packages: packages.slice(0, MAX_DEPENDENCY_RESULTS),
		total: packages.length,
		omitted: Math.max(0, packages.length - MAX_DEPENDENCY_RESULTS),
		versionConflict: exactVersions.size > 1,
	};
}

function gitignoreStatus(text) {
	if (typeof text !== "string") return { ignored: false, evidence: "missing" };
	let ignored = false;
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		if ([".openapi-to", ".openapi-to/", "/.openapi-to", "/.openapi-to/"].includes(line)) ignored = true;
		if (line.startsWith("!.openapi-to") || line.startsWith("!/.openapi-to")) ignored = false;
	}
	return { ignored, evidence: ignored ? "explicit-root-rule" : "not-detected" };
}

function tomlSections(text) {
	const sections = [];
	for (const match of text.matchAll(/^\s*\[([^\]\r\n]+)]\s*(?:#.*)?$/gm)) {
		sections.push({ name: match[1].trim(), start: match.index, end: text.length });
	}
	for (let index = 0; index < sections.length - 1; index += 1) sections[index].end = sections[index + 1].start;
	return sections;
}

function tomlStringValue(value) {
	if (value.startsWith('"')) {
		try {
			const parsed = JSON.parse(value);
			return typeof parsed === "string" ? parsed : undefined;
		} catch {
			return undefined;
		}
	}
	return value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1) : undefined;
}

function isAbsolutePath(value) {
	return path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

async function sameProjectRoot(left, right) {
	let resolvedLeft;
	try {
		resolvedLeft = await realpath(left);
	} catch {
		return false;
	}
	if (process.platform === "win32") {
		const normalize = (value) => path.win32.normalize(value).replace(/[\\/]+$/u, "").toLowerCase();
		return normalize(resolvedLeft) === normalize(right);
	}
	return path.resolve(resolvedLeft) === path.resolve(right);
}

function absolutePathInValues(values) {
	return values.some((value) => {
		const nativeCmdFlag = ["/d", "/s", "/c"].includes(value.toLowerCase());
		if ((!nativeCmdFlag && value.startsWith("/")) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("//")) return true;
		return /(?:^|\s)[A-Za-z]:[\\/]/.test(value) || /(?:^|\s)\\\\[^\s]/.test(value) || /(?:^|\s)\/[^\s/]+\//.test(value);
	});
}

async function inspectCodexToml(text, projectRoot, expectedConfigPath) {
	const sections = tomlSections(text);
	const serverSections = sections.filter(({ name }) => name === "mcp_servers.openapi_to");
	const applySections = sections.filter(({ name }) => name === "mcp_servers.openapi_to.tools.openapi_apply_generation");
	const serverText = serverSections.map(({ start, end }) => text.slice(start, end)).join("\n");
	const applyText = applySections.map(({ start, end }) => text.slice(start, end)).join("\n");
	const quotedValues = [...serverText.matchAll(/["']([^"'\r\n]*)["']/g)].map((match) => match[1]);
	const absolutePathDetected = quotedValues.some((value) => {
		const nativeCmdFlag = ["/d", "/s", "/c"].includes(value.toLowerCase());
		if ((!nativeCmdFlag && value.startsWith("/")) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("//")) return true;
		return /(?:^|\s)[A-Za-z]:[\\/]/.test(value) || /(?:^|\s)\\\\[^\s]/.test(value) || /(?:^|\s)\/[^\s/]+\//.test(value);
	});
	const cwdMatches = [...serverText.matchAll(/^\s*cwd\s*=\s*((?:"(?:\\.|[^"\\\r\n])*")|(?:'[^'\r\n]*'))\s*$/gmu)];
	const cwdValue = cwdMatches.length === 1 ? tomlStringValue(cwdMatches[0][1]) : undefined;
	const cwdKind =
		cwdMatches.length !== 1 || cwdValue === undefined
			? "missing"
			: isAbsolutePath(cwdValue)
				? "absolute"
				: "relative";
	const serverWithoutCwd = serverText.replace(/^\s*cwd\s*=.*$/gmu, "");
	const unexpectedAbsolutePathDetected = absolutePathInValues(
		[...serverWithoutCwd.matchAll(/["']([^"'\r\n]*)["']/g)].map((match) => match[1]),
	);
	const cwdMatchesProjectRoot = cwdKind === "absolute" && await sameProjectRoot(cwdValue, projectRoot);
	const legacyRelativeCwdDetected = cwdValue === ".";
	const flagValue = (flag) => {
		const index = quotedValues.indexOf(flag);
		if (index >= 0) return quotedValues[index + 1];
		const inline = quotedValues
			.map((value) => value.match(new RegExp(`(?:^|\\s)${flag.replaceAll("-", "\\-")}\\s+([^\\s]+)`)))
			.find(Boolean);
		return inline?.[1];
	};
	const hasFlag = (flag) => quotedValues.some((value) => new RegExp(`(?:^|\\s)${flag.replaceAll("-", "\\-")}(?:\\s|$)`).test(value));
	const allowWrite = hasFlag("--allow-write");
	const hasConfig = hasFlag("--config");
	const workspaceRoot = flagValue("--workspace-root");
	const configPath = flagValue("--config");
	const serverKeys = [...serverText.matchAll(/^[^\S\n]*([A-Za-z0-9_-]+)[^\S\n]*=/gmu)].map(
		(match) => match[1],
	);
	const canonicalKeys = ["args", "command", "cwd", "startup_timeout_sec", "tool_timeout_sec"];
	const keysAreCanonical =
		serverKeys.length === canonicalKeys.length &&
		[...serverKeys].sort().every((key, index) => key === [...canonicalKeys].sort()[index]);
	const commandMatch = serverText.match(
		/^[^\S\n]*command[^\S\n]*=[^\S\n]*((?:"(?:\\.|[^"\\\r\n])*")|(?:'[^'\r\n]*'))[^\S\n]*$/mu,
	);
	const command = commandMatch?.[1] ? tomlStringValue(commandMatch[1]) : undefined;
	const argsMatch = serverText.match(/^[^\S\n]*args[^\S\n]*=[^\S\n]*\[([\s\S]*?)\][^\S\n]*$/mu);
	const argsBody = argsMatch?.[1] ?? "";
	const argsTokens = [...argsBody.matchAll(/("(?:\\.|[^"\\\r\n])*"|'[^'\r\n]*')/g)].map(
		(match) => tomlStringValue(match[1]),
	);
	const argsAreStringArray =
		argsMatch !== null &&
		argsTokens.every((value) => typeof value === "string") &&
		argsBody.replace(/("(?:\\.|[^"\\\r\n])*"|'[^'\r\n]*')/g, "").replace(/[\s,]/gu, "") === "";
	const configPathIsCanonical =
		!hasConfig ||
		(expectedConfigPath !== undefined
			? configPath === expectedConfigPath
			: SUPPORTED_CONFIG_FILES.includes(configPath));
	const expectedConfig = configPathIsCanonical ? configPath : undefined;
	const expectedArguments = [
		"exec",
		"--",
		"openapi-to-mcp",
		"--workspace-root",
		".",
		...(hasConfig && expectedConfig ? ["--config", expectedConfig] : []),
		...(allowWrite ? ["--allow-write"] : []),
	];
	const windowsCommand = [
		"pnpm exec -- openapi-to-mcp --workspace-root .",
		...(hasConfig && expectedConfig ? [`--config ${expectedConfig}`] : []),
		...(allowWrite ? ["--allow-write"] : []),
	].join(" ");
	const packedWindowsCommand = [
		"pnpm exec -- ./node_modules/.bin/openapi-to-mcp.cmd --workspace-root .",
		...(hasConfig && expectedConfig ? [`--config ${expectedConfig}`] : []),
		...(allowWrite ? ["--allow-write"] : []),
	].join(" ");
	const commandAndArgumentsAreCanonical =
		argsAreStringArray &&
		((command === "pnpm" && JSON.stringify(argsTokens) === JSON.stringify(expectedArguments)) ||
			(command === "node" &&
				JSON.stringify(argsTokens) ===
					JSON.stringify(["node_modules/openapi-to/bin/openapi-to-mcp.js", ...expectedArguments.slice(3)])) ||
			(command === "cmd.exe" &&
				[windowsCommand, packedWindowsCommand].some(
					(value) => JSON.stringify(argsTokens) === JSON.stringify(["/d", "/s", "/c", value]),
				)));
	const timeoutValuesAreCanonical =
		/^[^\S\n]*startup_timeout_sec[^\S\n]*=[^\S\n]*10[^\S\n]*$/mu.test(serverText) &&
		/^[^\S\n]*tool_timeout_sec[^\S\n]*=[^\S\n]*60[^\S\n]*$/mu.test(serverText);
	const canonicalServerShape =
		keysAreCanonical && commandAndArgumentsAreCanonical && timeoutValuesAreCanonical;
	const applyPrompt = /\bapproval_mode\s*=\s*["']prompt["']/.test(applyText);
	const applyFields = [...applyText.matchAll(/^[^\S\n]*([A-Za-z0-9_-]+)[^\S\n]*=/gmu)].map(
		(match) => match[1],
	);
	const applyShape =
		applySections.length === 0
			? !allowWrite
			: allowWrite &&
				applySections.length === 1 &&
				applyPrompt &&
				applyFields.every((field) => field === "approval_mode");
	let inferredMode = "unknown";
	if (serverSections.length === 0 && /\bopenapi_to\b/.test(text)) inferredMode = "unknown";
	else if (serverSections.length === 0) inferredMode = "missing";
	else if (serverSections.length > 1) inferredMode = "unknown";
	else if (allowWrite && applyPrompt) inferredMode = "write-enabled";
	else if (allowWrite) inferredMode = "unknown";
	else if (hasConfig) inferredMode = "read-only";
	else inferredMode = "analysis-only";
	const configurationBlocked =
		(serverSections.length === 0 && /\bopenapi_to\b/.test(text)) ||
		serverSections.length > 1 ||
		(allowWrite && !applyPrompt) ||
		unexpectedAbsolutePathDetected ||
		!applyShape ||
		cwdKind !== "absolute" ||
		!cwdMatchesProjectRoot ||
		(workspaceRoot !== undefined && workspaceRoot !== ".") ||
		(hasConfig && expectedConfigPath !== undefined && configPath !== expectedConfigPath) ||
		!canonicalServerShape;
	return {
		serverSectionCount: serverSections.length,
		applyPromptSectionCount: applySections.length,
		applyPromptDetected: applyPrompt,
		absolutePathDetected,
		cwdKind,
		cwdMatchesProjectRoot,
		unexpectedAbsolutePathDetected,
		legacyRelativeCwdDetected,
		inferredMode,
		manualReviewRequired: serverSections.length > 0 || configurationBlocked,
		configurationBlocked,
		parser: "conservative-text-inspection",
	};
}

async function inspect(rootArgument) {
	const root = await realpath(path.resolve(rootArgument));
	const blockingReasons = [];
	const nodeMajor = Number(process.versions.node.split(".")[0]);
	if (nodeMajor < 22) blockingReasons.push("NODE_VERSION_UNSUPPORTED");
	const packageRead = await readBoundedText(root, "package.json");
	let manifest;
	let packageJsonValid = false;
	if (!packageRead.info.exists) blockingReasons.push("PACKAGE_JSON_MISSING");
	else if (packageRead.info.unsafe) blockingReasons.push("PACKAGE_JSON_OUTSIDE_ROOT");
	else if (packageRead.tooLarge) blockingReasons.push("PACKAGE_JSON_TOO_LARGE");
	else if (packageRead.readError) blockingReasons.push("PACKAGE_JSON_READ_FAILED");
	else if (packageRead.text !== undefined) {
		try {
			manifest = JSON.parse(packageRead.text);
			packageJsonValid = Boolean(manifest && typeof manifest === "object" && !Array.isArray(manifest));
			if (!packageJsonValid) blockingReasons.push("PACKAGE_JSON_INVALID");
		} catch {
			blockingReasons.push("PACKAGE_JSON_INVALID");
		}
	}

	const hasDeclaredManager = Boolean(manifest && Object.hasOwn(manifest, "packageManager"));
	const declaredManager = packageManagerName(manifest?.packageManager);
	const lockFiles = [];
	for (const [file, manager] of LOCK_FILES) {
		const result = await hashLockFile(root, file);
		if (!result.info.exists) continue;
		lockFiles.push({
			file,
			manager,
			sha256: result.sha256 ?? null,
			size: result.size ?? null,
		});
		if (result.info.unsafe) blockingReasons.push("LOCKFILE_OUTSIDE_ROOT");
		else if (result.tooLarge) blockingReasons.push("LOCKFILE_TOO_LARGE");
		else if (result.readError) blockingReasons.push("LOCKFILE_READ_FAILED");
	}
	let detectedManager = "unknown";
	let managerEvidence = "none";
	if (hasDeclaredManager && !declaredManager) {
		detectedManager = "unknown";
		managerEvidence = "unrecognized-packageManager";
		blockingReasons.push("PACKAGE_MANAGER_UNKNOWN");
	} else if (declaredManager) {
		detectedManager = declaredManager;
		managerEvidence = "packageManager";
	} else if (!hasDeclaredManager && lockFiles.length === 1) {
		detectedManager = lockFiles[0].manager;
		managerEvidence = "unique-lockfile-manager";
	}
	const lockfileConflict =
		(!declaredManager && lockFiles.length > 1) ||
		(declaredManager &&
			(lockFiles.some(({ manager }) => manager !== declaredManager) ||
				lockFiles.filter(({ manager }) => manager === declaredManager).length > 1));
	if (lockfileConflict) {
		detectedManager = "conflict";
		managerEvidence = "conflicting-evidence";
		blockingReasons.push("PACKAGE_MANAGER_CONFLICT");
	}

	const dependencies = collectDependencies(manifest);
	if (dependencies.versionConflict) blockingReasons.push("OPENAPI_TO_VERSION_CONFLICT");
	const configFiles = [];
	for (const file of SUPPORTED_CONFIG_FILES) {
		const read = await readBoundedText(root, file);
		if (read.info.unsafe) {
			blockingReasons.push("GENERATION_CONFIG_OUTSIDE_ROOT");
			continue;
		}
		if (!read.info.exists) continue;
		if (read.tooLarge) {
			blockingReasons.push("GENERATION_CONFIG_TOO_LARGE");
			configFiles.push({ path: file, sha256: null });
		} else if (read.readError) {
			blockingReasons.push("GENERATION_CONFIG_READ_FAILED");
			configFiles.push({ path: file, sha256: null });
		} else if (read.text !== undefined) configFiles.push({ path: file, sha256: read.sha256 });
	}
	if (configFiles.length > 1) blockingReasons.push("MULTIPLE_GENERATION_CONFIGS");

	const stateDirectory = await entryInfo(root, ".openapi-to");
	if (stateDirectory.unsafe) blockingReasons.push("STATE_DIRECTORY_OUTSIDE_ROOT");
	const gitignoreRead = await readBoundedText(root, ".gitignore");
	if (gitignoreRead.info.unsafe) blockingReasons.push("GITIGNORE_OUTSIDE_ROOT");
	if (gitignoreRead.tooLarge) blockingReasons.push("GITIGNORE_TOO_LARGE");
	if (gitignoreRead.readError) blockingReasons.push("GITIGNORE_READ_FAILED");
	const ignore = gitignoreStatus(gitignoreRead.text);
	const codexRead = await readBoundedText(root, ".codex/config.toml");
	if (codexRead.info.unsafe) blockingReasons.push("CODEX_CONFIG_OUTSIDE_ROOT");
	if (codexRead.tooLarge) blockingReasons.push("CODEX_CONFIG_TOO_LARGE");
	if (codexRead.readError) blockingReasons.push("CODEX_CONFIG_READ_FAILED");
	const codexInspection = codexRead.text === undefined
		? null
		: await inspectCodexToml(
				codexRead.text,
				root,
				configFiles.length === 1 ? configFiles[0].path : undefined,
			);
	if (codexInspection?.serverSectionCount > 1) blockingReasons.push("DUPLICATE_CODEX_SERVER_SECTION");
	if (codexInspection?.configurationBlocked) blockingReasons.push("CODEX_CONFIG_MANUAL_REVIEW_REQUIRED");
	const gitEntry = await entryInfo(root, ".git");
	if (gitEntry.unsafe) blockingReasons.push("GIT_METADATA_OUTSIDE_ROOT");

	let state = "PACKAGE_READY";
	if (blockingReasons.length > 0) state = "BLOCKED";
	else if (!dependencies.aggregate) state = "PACKAGE_MISSING";
	else if (configFiles.length === 0) state = "CONFIG_MISSING";
	else if (!codexInspection || codexInspection.serverSectionCount === 0) state = "HOST_CONFIG_MISSING";
	else state = "HOST_CONFIG_READY";

	const observation = {
		schemaVersion: SCHEMA_VERSION,
		state,
		blockingReasons: [...new Set(blockingReasons)].sort(),
		workspace: {
			root: ".",
			packageJson: {
				exists: packageRead.info.exists === true,
				valid: packageJsonValid,
				sha256: packageRead.sha256 ?? null,
			},
			node: { major: nodeMajor, supported: nodeMajor >= 22 },
			gitRepository: gitEntry.exists === true && !gitEntry.unsafe,
		},
		packageManager: {
			value: detectedManager,
			evidence: managerEvidence,
			declared: declaredManager ?? null,
			lockFiles,
			automaticInstallSupported:
				detectedManager === "pnpm" &&
				packageJsonValid &&
				!blockingReasons.some((reason) => reason.startsWith("LOCKFILE_")),
		},
		dependencies,
		generationConfig: {
			status: configFiles.length === 0 ? "missing" : configFiles.length === 1 ? "ready" : "multiple",
			supportedFileNames: SUPPORTED_CONFIG_FILES,
			files: configFiles,
		},
		runtimeState: {
			directoryPresent: stateDirectory.exists === true && !stateDirectory.unsafe,
			gitignorePresent: gitignoreRead.info.exists === true && !gitignoreRead.info.unsafe,
			gitignoreSha256: gitignoreRead.sha256 ?? null,
			ignored: ignore.ignored,
			ignoreEvidence: ignore.evidence,
		},
		codex: {
			configPresent: codexRead.info.exists === true && !codexRead.info.unsafe,
			sha256: codexRead.sha256 ?? null,
			...(codexInspection ?? {
				serverSectionCount: 0,
				applyPromptSectionCount: 0,
				applyPromptDetected: false,
				absolutePathDetected: false,
				cwdKind: "missing",
				cwdMatchesProjectRoot: false,
				unexpectedAbsolutePathDetected: false,
				legacyRelativeCwdDetected: false,
				inferredMode: "missing",
				manualReviewRequired: false,
				configurationBlocked: false,
				parser: "conservative-text-inspection",
			}),
		},
	};
	return { ...observation, observedStateHash: sha256(canonicalJson(observation)) };
}

function parseArguments(argv) {
	let root = process.cwd();
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] !== "--root" || index + 1 >= argv.length) throw new Error("Usage: inspect-project.mjs [--root <path>]");
		root = argv[index + 1];
		index += 1;
	}
	return root;
}

try {
	const result = await inspect(parseArguments(process.argv.slice(2)));
	const output = `${JSON.stringify(result)}\n`;
	if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) throw new Error("Inspection output exceeded its size limit.");
	process.stdout.write(output);
} catch (error) {
	process.stderr.write(`openapi-to setup inspection failed: ${error?.message ?? "unknown error"}\n`);
	process.exitCode = 1;
}
