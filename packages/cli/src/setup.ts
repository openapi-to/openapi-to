import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { stateDirectoryName } from "@openapi-to/core";

import { version } from "../../openapi/package.json";
import { ensureGitignore, init, inspectInit } from "./init.ts";
import {
	inspectCodexSkills,
	installCodexSkills,
	SkillsInstallError,
} from "./skillsInstall.ts";

const packageJsonByteLimit = 256 * 1024;
const codexConfigByteLimit = 256 * 1024;
const lockfileNames = [
	"pnpm-lock.yaml",
	"package-lock.json",
	"npm-shrinkwrap.json",
	"yarn.lock",
	"bun.lock",
	"bun.lockb",
] as const;
const stateIgnoreRule = `/${stateDirectoryName}/`;

export type SetupMode = "read-only";

export interface SetupDependencies {
	workingDirectory?: () => string;
	assetRoot?: string;
	platform?: NodeJS.Platform;
	nodeVersion?: string;
	beforeApply?: () => Promise<void>;
}

export interface SetupAction {
	action:
		| "create-config"
		| "update-gitignore"
		| "install-skills"
		| "create-codex-config"
		| "append-codex-config"
		| "update-codex-config";
	path: string;
}

export interface SetupOutput {
	success: boolean;
	command: "setup";
	mode: "dry-run" | "apply";
	host: "codex";
	scope: "project";
	setupMode: SetupMode;
	state: "DRY_RUN" | "RESTART_REQUIRED" | "READY";
	actions: SetupAction[];
	changedFiles: string[];
	restartRequired: boolean;
	diagnostics: Array<{
		code: string;
		severity: "error" | "warning" | "info";
		message: string;
	}>;
	summary: { errors: number; warnings: number; infos: number; text: string };
}

export class SetupError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "SetupError";
		this.code = code;
	}
}

interface SetupInspection {
	root: string;
	configPath?: string;
	configContent: string;
	configMissing: boolean;
	gitignoreMissing: boolean;
	codex: CodexConfigInspection;
	skills: Awaited<ReturnType<typeof inspectCodexSkills>>;
	stateHash: string;
}

interface CodexConfigInspection {
	status: "missing" | "needs-add" | "current" | "conflict" | "update";
	path: string;
	content?: string;
	proposedContent: string;
	conflictMessage?: string;
}

function fail(code: string, message: string): never {
	throw new SetupError(code, message);
}

function stableHash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function readHandleBytes(
	handle: Awaited<ReturnType<typeof open>>,
	size: number,
): Promise<Buffer> {
	const bytes = Buffer.alloc(size);
	let offset = 0;
	while (offset < size) {
		const result = await handle.read(bytes, offset, size - offset, offset);
		if (result.bytesRead === 0) return bytes.subarray(0, offset);
		offset += result.bytesRead;
	}
	return bytes;
}

async function regularFileBytes(
	target: string,
	limit: number,
): Promise<Buffer | undefined> {
	let expectedIdentity:
		| { dev: bigint | number; ino: bigint | number }
		| undefined;
	if (constants.O_NOFOLLOW === undefined) {
		try {
			const details = await lstat(target);
			if (details.isSymbolicLink() || !details.isFile())
				fail(
					"CONFIG_SETUP_UNSAFE_PATH",
					`Refusing to use a non-regular setup file: ${target}.`,
				);
			expectedIdentity = details;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			if (error instanceof SetupError) throw error;
			fail(
				"CONFIG_SETUP_READ_FAILED",
				`Unable to inspect setup file: ${path.basename(target)}.`,
			);
		}
	}
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(
			target,
			constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		fail(
			"CONFIG_SETUP_READ_FAILED",
			`Unable to inspect setup file: ${path.basename(target)}.`,
		);
	}
	try {
		const opened = await handle.stat();
		if (!opened.isFile())
			fail(
				"CONFIG_SETUP_UNSAFE_PATH",
				`Refusing to use a non-regular setup file: ${target}.`,
			);
		if (
			expectedIdentity &&
			(opened.dev !== expectedIdentity.dev ||
				opened.ino !== expectedIdentity.ino)
		)
			fail(
				"CONFIG_SETUP_STATE_CHANGED",
				`Setup file changed while it was being opened: ${path.basename(target)}.`,
			);
		if (opened.size > limit)
			fail(
				"CONFIG_SETUP_FILE_TOO_LARGE",
				`Setup file exceeds its safety limit: ${path.basename(target)}.`,
			);
		const bytes = await readHandleBytes(handle, Number(opened.size));
		const after = await handle.stat();
		if (
			after.dev !== opened.dev ||
			after.ino !== opened.ino ||
			after.size !== opened.size ||
			after.mtimeMs !== opened.mtimeMs
		)
			fail(
				"CONFIG_SETUP_STATE_CHANGED",
				`Setup file changed while being inspected: ${path.basename(target)}.`,
			);
		return bytes;
	} finally {
		await handle.close();
	}
}

async function assertDirectory(target: string): Promise<void> {
	const details = await lstat(target);
	if (details.isSymbolicLink() || !details.isDirectory())
		fail(
			"CONFIG_SETUP_UNSAFE_PATH",
			`Setup directory is not a real directory: ${target}.`,
		);
}

async function assertOptionalDirectory(target: string): Promise<void> {
	try {
		await assertDirectory(target);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
}

async function ensureDirectory(target: string): Promise<void> {
	try {
		await mkdir(target, { recursive: true, mode: 0o700 });
	} catch {
		fail(
			"CONFIG_SETUP_WRITE_FAILED",
			`Unable to create the bounded setup directory: ${path.basename(target)}.`,
		);
	}
	await assertDirectory(target);
}

function nodeMajor(versionText: string): number | undefined {
	const match = /^(\d+)(?:\.|$)/.exec(versionText);
	return match ? Number(match[1]) : undefined;
}

function dependencyMap(
	packageJson: Record<string, unknown>,
): Record<string, string> {
	return {
		...(packageJson.dependencies as Record<string, string> | undefined),
		...(packageJson.devDependencies as Record<string, string> | undefined),
	};
}

function packageManagerName(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	return /^([a-z][a-z0-9-]*)@\d/.exec(value)?.[1];
}

async function packageEvidence(
	root: string,
	nodeVersion: string,
): Promise<void> {
	const packagePath = path.join(root, "package.json");
	const bytes = await regularFileBytes(packagePath, packageJsonByteLimit);
	if (!bytes)
		fail(
			"CONFIG_SETUP_PACKAGE_JSON_MISSING",
			"A project package.json is required in the current directory.",
		);
	let packageJson: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(bytes.toString("utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			throw new Error();
		packageJson = parsed as Record<string, unknown>;
	} catch {
		fail(
			"CONFIG_SETUP_PACKAGE_JSON_INVALID",
			"The project package.json is not valid bounded JSON.",
		);
	}
	const major = nodeMajor(nodeVersion);
	if (major === undefined || major < 22)
		fail(
			"CONFIG_SETUP_NODE_UNSUPPORTED",
			"openapi setup requires Node.js 22 or newer.",
		);
	const dependency = dependencyMap(packageJson)["openapi-to"];
	if (typeof dependency !== "string" || dependency.length === 0)
		fail(
			"CONFIG_SETUP_PACKAGE_MISSING",
			"The local project must declare the openapi-to aggregate package first.",
		);
	const locks: string[] = [];
	for (const name of lockfileNames) {
		if (await regularFileBytes(path.join(root, name), 32 * 1024 * 1024))
			locks.push(name);
	}
	if (locks.length > 1)
		fail(
			"CONFIG_SETUP_PACKAGE_MANAGER_AMBIGUOUS",
			`Multiple package-manager lockfiles were found: ${locks.join(", ")}.`,
		);
	const declaredManager = packageManagerName(packageJson.packageManager);
	const lockManager =
		locks[0] === "pnpm-lock.yaml"
			? "pnpm"
			: locks[0] === "package-lock.json" || locks[0] === "npm-shrinkwrap.json"
				? "npm"
				: locks[0] === "yarn.lock"
					? "yarn"
					: locks[0] === "bun.lock" || locks[0] === "bun.lockb"
						? "bun"
						: undefined;
	if (declaredManager !== undefined && declaredManager !== "pnpm")
		fail(
			"CONFIG_SETUP_PNPM_REQUIRED",
			"This setup version supports pnpm projects only; the declared package manager is not pnpm.",
		);
	if (lockManager !== undefined && lockManager !== "pnpm")
		fail(
			"CONFIG_SETUP_PNPM_REQUIRED",
			"This setup version supports pnpm projects only; the detected lockfile is not a pnpm lockfile.",
		);
	if (declaredManager === undefined && lockManager === undefined)
		fail(
			"CONFIG_SETUP_PNPM_REQUIRED",
			"This setup version requires pnpm evidence (packageManager or pnpm-lock.yaml).",
		);
}

function canonicalCodexSection(
	configPath: string,
	platform: NodeJS.Platform,
	root: string,
): string {
	const cwd = tomlString(root);
	if (platform === "win32") {
		return `[mcp_servers.openapi_to]\ncommand = "cmd.exe"\nargs = ["/d", "/s", "/c", "pnpm exec -- openapi-to-mcp --workspace-root . --config ${configPath}"]\ncwd = ${cwd}\nstartup_timeout_sec = 10\ntool_timeout_sec = 60\n`;
	}
	return `[mcp_servers.openapi_to]\ncommand = "pnpm"\nargs = [\n  "exec",\n  "--",\n  "openapi-to-mcp",\n  "--workspace-root",\n  ".",\n  "--config",\n  "${configPath}"\n]\ncwd = ${cwd}\nstartup_timeout_sec = 10\ntool_timeout_sec = 60\n`;
}

export function tomlString(value: string): string {
	return JSON.stringify(value);
}

function isAbsolutePath(value: string, platform: NodeJS.Platform): boolean {
	return platform === "win32"
		? path.win32.isAbsolute(value)
		: path.posix.isAbsolute(value);
}

function withoutTrailingNewlines(value: string): string {
	return value.replace(/\r\n/g, "\n").replace(/\n+$/u, "");
}

function inspectCodexContent(
	filePath: string,
	content: string | undefined,
	section: string,
	legacySection: string,
	platform: NodeJS.Platform,
): CodexConfigInspection {
	const proposedContent = content
		? `${content}${content.endsWith("\n") ? "" : "\n"}${section}`
		: section;
	if (content === undefined)
		return { status: "missing", path: filePath, proposedContent };
	const sectionHeader = /^[^\S\n]*\[mcp_servers\.openapi_to\][^\S\n]*(?:#.*)?$/gmu;
	const anyOpenapiHeader = /^[^\S\n]*\[\[?mcp_servers\.openapi_to(?:\.|\])/gmu;
	const anySectionHeader = /^[^\S\n]*\[\[?.+\]\]?[^\S\n]*(?:#.*)?$/gmu;
	const sectionMatches = [...content.matchAll(sectionHeader)];
	const openapiMatches = [...content.matchAll(anyOpenapiHeader)];
	const allSectionMatches = [...content.matchAll(anySectionHeader)];
	const hasMcpArray = /^[^\S\n]*\[\[mcp_servers\]\]/mu.test(content);
	const starts = sectionMatches.map((match) => match.index ?? 0);
	const hasAmbiguousOpenapiHeader = openapiMatches.some(
		(match) => !sectionMatches.some(({ index }) => index === match.index),
	);
	if (
		starts.length > 1 ||
		hasAmbiguousOpenapiHeader ||
		hasMcpArray ||
		(starts.length === 0 &&
			(openapiMatches.length > 0 ||
				content.includes("openapi_to")))
	) {
		return {
			status: "conflict",
			path: filePath,
			proposedContent,
			conflictMessage:
				"The existing Codex config contains an ambiguous or unsafe openapi_to entry.",
		};
	}
	if (starts.length === 1) {
		const start = starts[0] ?? 0;
		const end =
			allSectionMatches.find(({ index }) => (index ?? 0) > start)?.index ??
			content.length;
		const existingSection = content.slice(start, end);
		if (
			withoutTrailingNewlines(existingSection.replace(/\r\n/g, "\n")) ===
			withoutTrailingNewlines(section)
		)
			return { status: "current", path: filePath, content, proposedContent };
		const cwdLine = /^[^\S\n]*cwd[^\S\n]*=[^\S\n]*("(?:\\.|[^"\\\r\n])*")[^\S\n]*$/mu;
		const cwdMatch = cwdLine.exec(existingSection);
		let cwdValue: string | undefined;
		if (cwdMatch?.[1]) {
			try {
				const parsed: unknown = JSON.parse(cwdMatch[1]);
				if (typeof parsed === "string") cwdValue = parsed;
			} catch {
				cwdValue = undefined;
			}
		}
		const canonicalShape = cwdMatch
			? withoutTrailingNewlines(
				existingSection.replace(cwdLine, 'cwd = "."').replace(/\r\n/g, "\n"),
			)
			: undefined;
		const legacyShape = withoutTrailingNewlines(
			legacySection.replace(/\r\n/g, "\n"),
		);
		if (
			canonicalShape === legacyShape &&
			cwdValue !== undefined &&
			(cwdValue === "." || isAbsolutePath(cwdValue, platform))
		) {
			const trailingWhitespace = existingSection.match(/\s*$/u)?.[0] ?? "";
			const lineEnding = trailingWhitespace.endsWith("\r\n") ? "\r\n" : "\n";
			const preservedSeparator = trailingWhitespace.endsWith(lineEnding)
				? trailingWhitespace.slice(0, -lineEnding.length)
				: trailingWhitespace;
			const updatedContent =
				content.slice(0, start) + section + preservedSeparator + content.slice(end);
			return {
				status: "update",
				path: filePath,
				content,
				proposedContent: updatedContent,
			};
		}
		return {
			status: "conflict",
			path: filePath,
			content,
			proposedContent,
			conflictMessage:
				"The existing openapi_to Codex section is not the canonical read-only configuration.",
		};
	}
	return { status: "needs-add", path: filePath, content, proposedContent };
}

async function inspectSetup(
	dependencies: SetupDependencies = {},
): Promise<SetupInspection> {
	const root = path.resolve(dependencies.workingDirectory?.() ?? process.cwd());
	if (root === path.parse(root).root)
		fail(
			"CONFIG_SETUP_PROJECT_INVALID",
			"The project root must not be a filesystem root.",
		);
	await assertDirectory(root);
	await packageEvidence(
		root,
		dependencies.nodeVersion ?? process.versions.node,
	);
	const initInspection = await inspectInit(root);
	if (initInspection.existingConfigPaths.length > 1)
		fail(
			"CONFIG_SETUP_CONFIG_AMBIGUOUS",
			`Multiple OpenAPI configurations were found: ${initInspection.existingConfigPaths.join(", ")}.`,
		);
	const configPath =
		initInspection.configPath ??
		`openapi.config.${initInspection.moduleType === "module" ? "ts" : "js"}`;
	if (initInspection.configPath) {
		const details = await lstat(path.join(root, configPath));
		if (details.isSymbolicLink() || !details.isFile())
			fail(
				"CONFIG_SETUP_UNSAFE_PATH",
				`OpenAPI configuration is not a regular file: ${configPath}.`,
			);
	}
	const gitignorePath = path.join(root, ".gitignore");
	const gitignore = await regularFileBytes(gitignorePath, codexConfigByteLimit);
	const gitignoreMissing = !gitignore;
	const gitignoreHasRule =
		gitignore
			?.toString("utf8")
			.split(/\r?\n/u)
			.some((line) => line.trim() === stateIgnoreRule) ?? false;
	await assertOptionalDirectory(path.join(root, ".codex"));
	const codexPath = path.join(root, ".codex", "config.toml");
	const codexBytes = await regularFileBytes(codexPath, codexConfigByteLimit);
	const codex = inspectCodexContent(
		codexPath,
		codexBytes?.toString("utf8"),
		canonicalCodexSection(
			configPath ??
				`openapi.config.${initInspection.moduleType === "module" ? "ts" : "js"}`,
			dependencies.platform ?? process.platform,
			root,
		),
		canonicalCodexSection(
			configPath ??
				`openapi.config.${initInspection.moduleType === "module" ? "ts" : "js"}`,
			dependencies.platform ?? process.platform,
			".",
		),
		dependencies.platform ?? process.platform,
	);
	if (codex.status === "conflict")
		fail(
			"CONFIG_SETUP_CODEX_CONFLICT",
			codex.conflictMessage ??
				"The project Codex config requires manual review.",
		);
	const skills = await inspectCodexSkills("project", version, {
		assetRoot: dependencies.assetRoot,
		workingDirectory: () => root,
	});
	if (skills.status === "conflict")
		fail(
			"CONFIG_SETUP_SKILLS_CONFLICT",
			`Existing packaged Skill targets require manual inspection: ${skills.conflicting.join(", ")}.`,
		);
	const stateHash = stableHash({
		packageJson: (
			await regularFileBytes(
				path.join(root, "package.json"),
				packageJsonByteLimit,
			)
		)?.toString("base64"),
		lockfiles: await Promise.all(
			lockfileNames.map(async (name) => [
				name,
				(
					await regularFileBytes(path.join(root, name), 32 * 1024 * 1024)
				)?.toString("base64") ?? null,
			]),
		),
		configPath: initInspection.configPath,
		config: configPath
			? (
					await regularFileBytes(
						path.join(root, configPath),
						codexConfigByteLimit,
					)
				)?.toString("base64")
			: null,
		gitignore: gitignore?.toString("base64") ?? null,
		codex: codexBytes?.toString("base64") ?? null,
		skills: skills.status,
	});
	return {
		root,
		configPath,
		configContent: initInspection.configContent,
		configMissing: !initInspection.configPath,
		gitignoreMissing: gitignoreMissing || !gitignoreHasRule,
		codex,
		skills,
		stateHash,
	};
}

function plannedActions(inspection: SetupInspection): SetupAction[] {
	const actions: SetupAction[] = [];
	if (inspection.configMissing)
		actions.push({
			action: "create-config",
			path: inspection.configPath ?? "openapi.config.js",
		});
	if (inspection.gitignoreMissing)
		actions.push({ action: "update-gitignore", path: ".gitignore" });
	if (inspection.skills.status === "missing")
		actions.push({ action: "install-skills", path: ".agents/skills" });
	if (inspection.codex.status === "missing")
		actions.push({ action: "create-codex-config", path: ".codex/config.toml" });
	if (inspection.codex.status === "needs-add")
		actions.push({ action: "append-codex-config", path: ".codex/config.toml" });
	if (inspection.codex.status === "update")
		actions.push({ action: "update-codex-config", path: ".codex/config.toml" });
	return actions;
}

function makeOutput(
	mode: "dry-run" | "apply",
	actions: SetupAction[],
): SetupOutput {
	const restartRequired = actions.some(
		({ action }) =>
			action === "install-skills" ||
			action === "create-codex-config" ||
			action === "append-codex-config" ||
			action === "update-codex-config",
	);
	const changedFiles = actions.map(({ path: filePath }) => filePath);
	return {
		success: true,
		command: "setup",
		mode,
		host: "codex",
		scope: "project",
		setupMode: "read-only",
		state:
			mode === "dry-run"
				? "DRY_RUN"
				: restartRequired
					? "RESTART_REQUIRED"
					: "READY",
		actions,
		changedFiles,
		restartRequired,
		diagnostics: [],
		summary: {
			errors: 0,
			warnings: 0,
			infos: 0,
			text: restartRequired
				? "Project bootstrap completed; restart Codex before capability verification."
				: "Project bootstrap is already current.",
		},
	};
}

async function appendExact(
	target: string,
	expected: string,
	updated: string,
): Promise<void> {
	let expectedIdentity:
		| { dev: bigint | number; ino: bigint | number }
		| undefined;
	if (constants.O_NOFOLLOW === undefined) {
		const details = await lstat(target);
		if (details.isSymbolicLink() || !details.isFile())
			fail(
				"CONFIG_SETUP_UNSAFE_PATH",
				`Refusing to update a non-regular setup file: ${target}.`,
			);
		expectedIdentity = details;
	}
	const handle = await open(
		target,
		constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
	);
	try {
		const opened = await handle.stat();
		if (!opened.isFile())
			fail(
				"CONFIG_SETUP_UNSAFE_PATH",
				`Refusing to update a non-regular setup file: ${target}.`,
			);
		if (opened.size > codexConfigByteLimit)
			fail(
				"CONFIG_SETUP_FILE_TOO_LARGE",
				`Setup file exceeds its safety limit: ${path.basename(target)}.`,
			);
		if (
			expectedIdentity &&
			(opened.dev !== expectedIdentity.dev ||
				opened.ino !== expectedIdentity.ino)
		)
			fail(
				"CONFIG_SETUP_STATE_CHANGED",
				`Setup file changed while it was being opened: ${path.basename(target)}.`,
			);
		const currentBytes = await readHandleBytes(handle, Number(opened.size));
		const after = await handle.stat();
		if (
			after.dev !== opened.dev ||
			after.ino !== opened.ino ||
			after.size !== opened.size ||
			after.mtimeMs !== opened.mtimeMs
		)
			fail(
				"CONFIG_SETUP_STATE_CHANGED",
				`Setup file changed while it was being inspected: ${path.basename(target)}.`,
			);
		const current = currentBytes.toString("utf8");
		if (current !== expected)
			fail(
				"CONFIG_SETUP_STATE_CHANGED",
				`Setup state changed before writing ${path.basename(target)}; rerun setup.`,
			);
		const bytes = Buffer.from(updated, "utf8");
		await handle.write(bytes, 0, bytes.byteLength, 0);
		await handle.truncate(Buffer.byteLength(updated));
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function applyCodexConfig(
	root: string,
	inspection: SetupInspection,
): Promise<void> {
	if (inspection.codex.status === "current") return;
	const target = path.join(root, ".codex", "config.toml");
	await ensureDirectory(path.dirname(target));
	if (inspection.codex.status === "missing") {
		await writeFile(target, inspection.codex.proposedContent, {
			encoding: "utf8",
			flag: "wx",
			mode: 0o600,
		});
		return;
	}
	await appendExact(
		target,
		inspection.codex.content ?? "",
		inspection.codex.proposedContent,
	);
}

export async function setup(
	options: { dryRun?: boolean } = {},
	dependencies: SetupDependencies = {},
): Promise<SetupOutput> {
	const inspection = await inspectSetup(dependencies);
	const actions = plannedActions(inspection);
	if (options.dryRun) return makeOutput("dry-run", actions);
	const fresh = await inspectSetup(dependencies);
	if (fresh.stateHash !== inspection.stateHash)
		fail(
			"CONFIG_SETUP_STATE_CHANGED",
			"Project setup state changed during preflight; rerun setup.",
		);
	await dependencies.beforeApply?.();
	const applyInspection = await inspectSetup(dependencies);
	if (applyInspection.stateHash !== inspection.stateHash)
		fail(
			"CONFIG_SETUP_STATE_CHANGED",
			"Project setup state changed before apply; rerun setup.",
		);
	try {
		if (applyInspection.configMissing) {
			await init({ quiet: true });
		} else if (applyInspection.gitignoreMissing) {
			await ensureGitignore(true);
		}
		if (applyInspection.skills.status === "missing") {
			await installCodexSkills(
				{ dryRun: false, json: false, scope: "project" },
				version,
				{
					assetRoot: dependencies.assetRoot,
					workingDirectory: () => applyInspection.root,
					detectLegacyInstallation: false,
				},
			);
		}
		await applyCodexConfig(applyInspection.root, applyInspection);
		return makeOutput("apply", actions);
	} catch (error) {
		if (error instanceof SetupError) throw error;
		if (error instanceof SkillsInstallError)
			throw new SetupError(error.code, error.message);
		throw new SetupError(
			"CONFIG_SETUP_WRITE_FAILED",
			"Project setup stopped after a bounded write; inspect the reported files and rerun safely.",
		);
	}
}

export function setupHumanOutput(output: SetupOutput): string[] {
	if (output.actions.length === 0) return ["openapi setup: already current."];
	return [
		`openapi setup: ${output.mode === "dry-run" ? "dry-run" : "completed"}`,
		...output.actions.map(
			({ action, path: filePath }) => `- ${action}: ${filePath}`,
		),
		output.mode === "dry-run"
			? "No files were written."
			: output.restartRequired
				? "Restart Codex before verifying MCP capabilities (RESTART_REQUIRED)."
				: "No Codex restart is required.",
	];
}

export function parseSetupRequest(options: Record<string, unknown>): {
	dryRun: boolean;
} {
	const host = options.host;
	const hosts = Array.isArray(host) ? host : host === undefined ? [] : [host];
	if (hosts.length === 0)
		fail(
			"CONFIG_SETUP_HOST_REQUIRED",
			"`--host codex` is required; only the Codex Host is supported.",
		);
	if (hosts.length !== 1 || hosts[0] !== "codex")
		fail("CONFIG_SETUP_HOST_UNSUPPORTED", "Only `--host codex` is supported.");
	const scope = options.scope;
	const scopes = Array.isArray(scope)
		? scope
		: scope === undefined
			? []
			: [scope];
	if (scopes.length === 0)
		fail(
			"CONFIG_SETUP_SCOPE_REQUIRED",
			"`--scope project` is required; only project scope is supported.",
		);
	if (scopes.length !== 1 || scopes[0] !== "project")
		fail(
			"CONFIG_SETUP_SCOPE_UNSUPPORTED",
			"Only `--scope project` is supported.",
		);
	return { dryRun: options.dryRun === true };
}
