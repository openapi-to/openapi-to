import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { stateDirectoryName } from "../stateDirectoryName.ts";
import { DiagnosticError, type Diagnostic } from "../diagnostics.ts";
import type { OpenapiToConfigSingleOutput, OutputBase } from "../types";
import type { ConfiguredTarget } from "./configuredTargets.ts";

const WINDOWS_ABSOLUTE_OR_DRIVE_RELATIVE = /^(?:[a-zA-Z]:|\\\\)/;
const WINDOWS_RESERVED_DEVICE =
	/^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\.|$)/i;
const WINDOWS_RESERVED_CHARACTERS = new Set('<>:"|?*');
const CONTROL_OUTPUT_SEGMENTS = new Set([
	"selections",
	"transactions",
	"locks",
	"cache",
	"previews",
	"generation-intents",
]);

export interface ResolvedConfiguredOutputRoot {
	absolutePath: string;
	workspaceRelativePath: string;
	base: OutputBase;
}

function outputError(
	code: string,
	message: string,
	targetName?: string,
	hint?: string,
): DiagnosticError {
	const diagnostic: Diagnostic = {
		code,
		severity: "error",
		message,
		...(targetName
			? { location: { source: targetName, path: ["output"] } }
			: {}),
		...(hint ? { hint } : {}),
	};
	return new DiagnosticError("Configured output validation failed.", [
		diagnostic,
	]);
}

function portableRelativeDirectory(
	output: OpenapiToConfigSingleOutput,
	targetName?: string,
): string {
	if (!output || typeof output !== "object") {
		throw outputError(
			"CONFIG_OUTPUT_INVALID",
			"Configured output must be an object.",
			targetName,
		);
	}
	if (
		output.base !== undefined &&
		output.base !== "managed" &&
		output.base !== "workspace"
	) {
		throw outputError(
			"CONFIG_OUTPUT_BASE_INVALID",
			`Configured output base ${String(output.base)} is not supported.`,
			targetName,
			"Use managed or workspace.",
		);
	}
	if (typeof output.dir !== "string" || output.dir.trim().length === 0) {
		throw outputError(
			"CONFIG_OUTPUT_PATH_INVALID",
			"Configured output.dir must be a non-empty relative path.",
			targetName,
		);
	}
	const raw = output.dir;
	if (
		raw.includes("\0") ||
		path.posix.isAbsolute(raw.replaceAll("\\", "/")) ||
		WINDOWS_ABSOLUTE_OR_DRIVE_RELATIVE.test(raw)
	) {
		throw outputError(
			"CONFIG_OUTPUT_PATH_OUTSIDE_WORKSPACE",
			"Configured output.dir must be a relative path inside the Workspace.",
			targetName,
		);
	}
	const portableSegments = raw.replaceAll("\\", "/").split("/");
	for (const originalSegment of portableSegments) {
		if (originalSegment === "." || originalSegment === "..") continue;
		const segment = originalSegment.normalize("NFKC");
		let reason: string | undefined;
		if (segment.endsWith(".") || segment.endsWith(" "))
			reason = "segments may not end in a period or space";
		else if (
			[...segment].some((character) => {
				const code = character.charCodeAt(0);
				return (
					WINDOWS_RESERVED_CHARACTERS.has(character) ||
					code <= 0x1f ||
					code === 0x7f
				);
			})
		)
			reason =
				"segments may not contain Windows-reserved or control characters";
		else if (WINDOWS_RESERVED_DEVICE.test(segment))
			reason = "segments may not use a Windows reserved device name";
		else if (segment.includes("/") || segment.includes("\\"))
			reason = "Unicode normalization may not introduce a path separator";
		if (reason) {
			throw outputError(
				"CONFIG_OUTPUT_PATH_NOT_PORTABLE",
				`Configured output.dir segment ${JSON.stringify(originalSegment)} is not portable: ${reason}.`,
				targetName,
				"Choose a directory name that is valid on Linux, macOS, and Windows.",
			);
		}
	}
	const normalized = path.posix.normalize(
		portableSegments.map((segment) => segment.normalize("NFKC")).join("/"),
	);
	if (
		normalized === "." ||
		normalized === ".." ||
		normalized.startsWith("../")
	) {
		throw outputError(
			normalized === "."
				? "CONFIG_OUTPUT_WORKSPACE_ROOT"
				: "CONFIG_OUTPUT_PATH_OUTSIDE_WORKSPACE",
			normalized === "."
				? "Configured output.dir may not resolve to its output base root."
				: "Configured output.dir escapes its output base.",
			targetName,
		);
	}
	return normalized;
}

function protectedOutputPath(
	workspaceRelativePath: string,
	base: OutputBase,
	targetName?: string,
): void {
	const segments = workspaceRelativePath.split("/");
	const lower = segments.map((segment) => segment.toLowerCase());
	if (
		lower.includes(".git") ||
		lower.includes("node_modules") ||
		lower.some((segment) => segment.startsWith(".openapi-to-"))
	) {
		throw outputError(
			"CONFIG_OUTPUT_PROTECTED_PATH",
			`Configured output root ${workspaceRelativePath} overlaps a protected repository or transaction path.`,
			targetName,
		);
	}
	if (lower[0] === stateDirectoryName.toLowerCase()) {
		if (base === "workspace" || lower.length === 1) {
			throw outputError(
				"CONFIG_OUTPUT_PROTECTED_PATH",
				`Workspace output may not overlap the ${stateDirectoryName} state root.`,
				targetName,
			);
		}
		if (CONTROL_OUTPUT_SEGMENTS.has(lower[1] ?? "")) {
			throw outputError(
				"CONFIG_OUTPUT_PROTECTED_PATH",
				`Configured output root ${workspaceRelativePath} overlaps reserved ${stateDirectoryName} control state.`,
				targetName,
			);
		}
	}
}

/**
 * Resolve the deterministic lexical output root. This function does not create
 * directories. Call `validateConfiguredOutputRoot` before a write to reject
 * existing symlink/non-directory segments.
 */
export function resolveConfiguredOutputRoot({
	workspaceRoot,
	output,
	targetName,
}: {
	workspaceRoot: string;
	output: OpenapiToConfigSingleOutput;
	targetName?: string;
}): ResolvedConfiguredOutputRoot {
	const base = output.base ?? "managed";
	const configuredDir = portableRelativeDirectory(output, targetName);
	const workspaceRelativePath =
		base === "managed"
			? path.posix.join(stateDirectoryName, configuredDir)
			: configuredDir;
	protectedOutputPath(workspaceRelativePath, base, targetName);
	const absolutePath = path.resolve(
		workspaceRoot,
		...workspaceRelativePath.split("/"),
	);
	const relative = path.relative(path.resolve(workspaceRoot), absolutePath);
	if (
		relative === "" ||
		relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	) {
		throw outputError(
			relative === ""
				? "CONFIG_OUTPUT_WORKSPACE_ROOT"
				: "CONFIG_OUTPUT_PATH_OUTSIDE_WORKSPACE",
			"Configured output root must remain below the Workspace root.",
			targetName,
		);
	}
	return { absolutePath, workspaceRelativePath, base };
}

/** Reject existing output path segments that are symlinks or non-directories. */
export async function validateConfiguredOutputRoot(
	workspaceRoot: string,
	resolved: ResolvedConfiguredOutputRoot,
	targetName?: string,
): Promise<void> {
	const lexicalRoot = path.resolve(workspaceRoot);
	const canonicalRoot = await realpath(lexicalRoot);
	const relative = path.relative(lexicalRoot, resolved.absolutePath);
	let current = lexicalRoot;
	for (const segment of relative.split(path.sep).filter(Boolean)) {
		current = path.join(current, segment);
		try {
			const metadata = await lstat(current);
			if (metadata.isSymbolicLink()) {
				throw outputError(
					"CONFIG_OUTPUT_SYMLINK",
					"Configured output roots and their existing parent directories may not be symbolic links.",
					targetName,
				);
			}
			if (!metadata.isDirectory()) {
				throw outputError(
					"CONFIG_OUTPUT_NOT_DIRECTORY",
					"Configured output root has an existing path segment that is not a directory.",
					targetName,
				);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
			throw error;
		}
	}
	let ancestor = resolved.absolutePath;
	for (;;) {
		try {
			const canonicalAncestor = await realpath(ancestor);
			const canonicalRelative = path.relative(canonicalRoot, canonicalAncestor);
			if (
				canonicalRelative === ".." ||
				canonicalRelative.startsWith(`..${path.sep}`) ||
				path.isAbsolute(canonicalRelative)
			) {
				throw outputError(
					"CONFIG_OUTPUT_SYMLINK_ESCAPE",
					"Configured output root escapes the Workspace through an existing path.",
					targetName,
				);
			}
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			const parent = path.dirname(ancestor);
			if (parent === ancestor) {
				throw outputError(
					"CONFIG_OUTPUT_PATH_OUTSIDE_WORKSPACE",
					"Unable to establish a safe configured output root.",
					targetName,
				);
			}
			ancestor = parent;
		}
	}
}

function foldedPath(value: string): string {
	return value.normalize("NFKC").toLowerCase();
}

function pathsOverlap(left: string, right: string): boolean {
	const foldedLeft = foldedPath(path.resolve(left));
	const foldedRight = foldedPath(path.resolve(right));
	if (foldedLeft === foldedRight) return true;
	const leftToRight = path.relative(foldedLeft, foldedRight);
	const rightToLeft = path.relative(foldedRight, foldedLeft);
	return (
		(leftToRight !== "" &&
			leftToRight !== ".." &&
			!leftToRight.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(leftToRight)) ||
		(rightToLeft !== "" &&
			rightToLeft !== ".." &&
			!rightToLeft.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(rightToLeft))
	);
}

/**
 * Resolve and validate every configured target output, then reject equal,
 * parent, or child roots before any selected target writes.
 */
export async function resolveConfiguredTargetOutputs(
	workspaceRoot: string,
	targets: readonly ConfiguredTarget[],
): Promise<Map<string, ResolvedConfiguredOutputRoot>> {
	return resolveEffectiveTargetOutputs(workspaceRoot, targets);
}

/**
 * Resolve configured outputs with an optional caller-selected Workspace-relative
 * root or a Core-validated persisted identity for a trusted target. Caller
 * overrides remain Workspace roots; persisted managed identities retain their
 * configured base semantics. Both paths use the same portability, protected-path,
 * symlink, and overlap validation.
 */
export async function resolveEffectiveTargetOutputs(
	workspaceRoot: string,
	targets: readonly ConfiguredTarget[],
	overrides: ReadonlyMap<string, string> = new Map(),
	trustedOutputRoots: ReadonlyMap<string, string> = new Map(),
): Promise<Map<string, ResolvedConfiguredOutputRoot>> {
	const targetNames = new Set(targets.map(({ name }) => name));
	for (const name of [...overrides.keys(), ...trustedOutputRoots.keys()]) {
		if (!targetNames.has(name)) {
			throw outputError(
				"CONFIG_TARGET_UNKNOWN",
				`Requested output override target ${name} is not configured.`,
				name,
			);
		}
	}
	const outputs = new Map<string, ResolvedConfiguredOutputRoot>();
	for (const target of targets) {
		const override = overrides.get(target.name);
		const trustedRoot = trustedOutputRoots.get(target.name);
		if (override !== undefined && trustedRoot !== undefined) {
			throw outputError(
				"CONFIG_OUTPUT_INVALID",
				"A target cannot combine a caller-selected output override with a persisted output identity.",
				target.name,
			);
		}
		const configured = resolveConfiguredOutputRoot({
			workspaceRoot,
			output: target.server.output,
			targetName: target.name,
		});
		let resolved = configured;
		if (override !== undefined) {
			resolved = resolveConfiguredOutputRoot({
				workspaceRoot,
				output: { ...target.server.output, base: "workspace", dir: override },
				targetName: target.name,
			});
		} else if (trustedRoot !== undefined && trustedRoot !== configured.workspaceRelativePath) {
			if (trustedRoot.startsWith(`${stateDirectoryName}/`)) {
				throw outputError(
					"GENERATION_OUTPUT_RELOCATION_REQUIRED",
					"Persisted Generation Intent is bound to a different managed output root; explicit relocation is required.",
					target.name,
				);
			}
			resolved = resolveConfiguredOutputRoot({
				workspaceRoot,
				output: { ...target.server.output, base: "workspace", dir: trustedRoot },
				targetName: target.name,
			});
		}
		await validateConfiguredOutputRoot(workspaceRoot, resolved, target.name);
		outputs.set(target.name, resolved);
	}
	for (let leftIndex = 0; leftIndex < targets.length; leftIndex += 1) {
		const left = targets[leftIndex];
		const leftOutput = left ? outputs.get(left.name) : undefined;
		if (!left || !leftOutput) continue;
		for (
			let rightIndex = leftIndex + 1;
			rightIndex < targets.length;
			rightIndex += 1
		) {
			const right = targets[rightIndex];
			const rightOutput = right ? outputs.get(right.name) : undefined;
			if (
				right &&
				rightOutput &&
				pathsOverlap(leftOutput.absolutePath, rightOutput.absolutePath)
			) {
				throw outputError(
					"CONFIG_OUTPUT_OVERLAP",
					`Configured target outputs overlap: ${left.name} (${leftOutput.workspaceRelativePath}) and ${right.name} (${rightOutput.workspaceRelativePath}).`,
					right.name,
					"Give every target an independent output root.",
				);
			}
		}
	}
	return outputs;
}
