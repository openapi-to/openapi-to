import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import parseChangeset from "@changesets/parse";
import semver from "semver";

const require = createRequire(import.meta.url);

export const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
);

const changesetCli = resolve(
	dirname(require.resolve("@changesets/cli/package.json")),
	"bin.js",
);

async function exists(path) {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

function parseWorkspacePatterns(contents) {
	const packagesSection = [];
	let inPackagesSection = false;
	for (const line of contents.split(/\r?\n/)) {
		if (/^packages:\s*$/.test(line)) {
			inPackagesSection = true;
			continue;
		}
		if (inPackagesSection && /^\S/.test(line) && !/^#/.test(line)) break;
		if (inPackagesSection) packagesSection.push(line);
	}
	return packagesSection
		.join("\n")
		.split(/\r?\n/)
		.map((line) => line.match(/^\s*-\s*['"]([^'"]+)['"]\s*$/)?.[1])
		.filter(Boolean);
}

async function workspaceDirectories(root) {
	const patterns = parseWorkspacePatterns(
		await readFile(join(root, "pnpm-workspace.yaml"), "utf8"),
	);
	const directories = [];
	for (const pattern of patterns) {
		if (!pattern.endsWith("/*")) {
			if (await exists(join(root, pattern, "package.json")))
				directories.push(pattern);
			continue;
		}
		const parent = pattern.slice(0, -2);
		for (const entry of (
			await readdir(join(root, parent), { withFileTypes: true })
		).sort((left, right) => left.name.localeCompare(right.name))) {
			if (
				entry.isDirectory() &&
				(await exists(join(root, parent, entry.name, "package.json")))
			) {
				directories.push(`${parent}/${entry.name}`);
			}
		}
	}
	return [...new Set(directories)].sort();
}

async function readWorkspaces(root) {
	const workspaces = [];
	for (const directory of await workspaceDirectories(root)) {
		const manifest = await readJson(join(root, directory, "package.json"));
		workspaces.push({ directory, manifest });
	}
	return workspaces;
}

function diagnostic(code, message) {
	return { code, message };
}

function sanitizeOutput(value, root) {
	return value
		.replaceAll(root, "<workspace>")
		.replaceAll(resolve(root), "<workspace>")
		.replaceAll(repositoryRoot, "<tooling>")
		.replaceAll("/dev/tty", "<terminal>")
		.slice(0, 4000)
		.trim();
}

function runChangesetStatus(root) {
	return new Promise((resolveResult) => {
		const child = spawn(process.execPath, [changesetCli, "status"], {
			cwd: root,
			env: { ...process.env, CI: "1" },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			resolveResult({
				exitCode: 1,
				stdout,
				stderr: `${stderr}\n${error.message}`,
			});
		});
		child.on("close", (exitCode) => {
			resolveResult({ exitCode: exitCode ?? 1, stdout, stderr });
		});
	});
}

async function listChangesets(root) {
	const directory = join(root, ".changeset");
	const entries = await readdir(directory, { withFileTypes: true });
	const changesets = [];
	for (const entry of entries.sort((left, right) =>
		left.name.localeCompare(right.name),
	)) {
		if (
			!entry.isFile() ||
			!entry.name.endsWith(".md") ||
			/^README\.md$/i.test(entry.name)
		) {
			continue;
		}
		const id = entry.name.slice(0, -3);
		const contents = await readFile(join(directory, entry.name), "utf8");
		try {
			changesets.push({ id, ...parseChangeset(contents) });
		} catch {
			changesets.push({
				id,
				parseError: diagnostic(
					"INVALID_CHANGESET",
					`Changeset ${id} has invalid frontmatter.`,
				),
			});
		}
	}
	return changesets;
}

function baseVersion(version) {
	const parsed = typeof version === "string" ? semver.parse(version) : null;
	return parsed && `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

function validateFixedGroup(config, publicNames, diagnostics) {
	if (
		!Array.isArray(config.fixed) ||
		config.fixed.some(
			(group) =>
				!Array.isArray(group) ||
				group.some((packageName) => typeof packageName !== "string"),
		)
	) {
		diagnostics.push(
			diagnostic(
				"INVALID_FIXED_GROUP",
				"Changesets fixed groups must be arrays of package names.",
			),
		);
		return [];
	}

	const publicSet = new Set(publicNames);
	const matchingGroup = config.fixed.find(
		(group) =>
			group.length === publicSet.size &&
			new Set(group).size === group.length &&
			group.every((name) => publicSet.has(name)),
	);
	if (!matchingGroup) {
		diagnostics.push(
			diagnostic(
				"PUBLIC_FIXED_GROUP_MISMATCH",
				"All public workspace packages must form one exact Changesets fixed group.",
			),
		);
		return [];
	}
	return [...matchingGroup].sort();
}

async function verifyNormalMode(root) {
	const workspaces = await readWorkspaces(root);
	const native = await runChangesetStatus(root);
	const diagnostics = [];
	if (native.exitCode !== 0) {
		const details = sanitizeOutput(
			[native.stdout, native.stderr].filter(Boolean).join("\n"),
			root,
		);
		diagnostics.push(
			diagnostic(
				"CHANGESET_STATUS_FAILED",
				details
					? `Changesets status failed: ${details}`
					: "Changesets status failed.",
			),
		);
	}
	return {
		success: diagnostics.length === 0,
		mode: "normal",
		tag: null,
		candidateVersion: null,
		publicPackages: workspaces.filter(
			({ manifest }) => manifest.private !== true,
		).length,
		pendingChangesets: null,
		emptyChangesets: null,
		diagnostics,
	};
}

async function verifyPrereleaseMode(root, preState, { allowPending = false } = {}) {
	const diagnostics = [];
	let config;
	try {
		config = await readJson(join(root, ".changeset/config.json"));
	} catch {
		return {
			success: false,
			mode: "pre",
			tag: typeof preState.tag === "string" ? preState.tag : null,
			candidateVersion: null,
			publicPackages: 0,
			pendingChangesets: 0,
			emptyChangesets: 0,
			diagnostics: [
				diagnostic(
					"INVALID_CHANGESET_CONFIG",
					".changeset/config.json must contain valid JSON.",
				),
			],
		};
	}
	const workspaces = await readWorkspaces(root);
	const byName = new Map(
		workspaces.map((workspace) => [workspace.manifest.name, workspace]),
	);
	const publicNames = workspaces
		.filter(({ manifest }) => manifest.private !== true)
		.map(({ manifest }) => manifest.name)
		.sort();

	if (preState.mode !== "pre") {
		diagnostics.push(
			diagnostic("INVALID_PRE_MODE", 'pre.json mode must equal "pre".'),
		);
	}
	const validTag =
		typeof preState.tag === "string" &&
		/^[0-9A-Za-z-]+$/.test(preState.tag);
	if (!validTag) {
		diagnostics.push(
			diagnostic(
				"INVALID_PRE_TAG",
				"pre.json tag must be a non-empty prerelease identifier.",
			),
		);
	}
	if (
		!preState.initialVersions ||
		typeof preState.initialVersions !== "object" ||
		Array.isArray(preState.initialVersions)
	) {
		diagnostics.push(
			diagnostic(
				"INVALID_INITIAL_VERSIONS",
				"pre.json initialVersions must be an object.",
			),
		);
	}
	if (
		!Array.isArray(preState.changesets) ||
		preState.changesets.some((id) => typeof id !== "string")
	) {
		diagnostics.push(
			diagnostic(
				"INVALID_CONSUMED_CHANGESETS",
				"pre.json changesets must be an array of strings.",
			),
		);
	}

	const initialVersions =
		preState.initialVersions &&
		typeof preState.initialVersions === "object" &&
		!Array.isArray(preState.initialVersions)
			? preState.initialVersions
			: {};
	for (const name of byName.keys()) {
		if (!(name in initialVersions)) {
			diagnostics.push(
				diagnostic(
					"MISSING_INITIAL_VERSION",
					`pre.json initialVersions is missing workspace package ${name}.`,
				),
			);
		} else if (
			typeof initialVersions[name] !== "string" ||
			!semver.valid(initialVersions[name])
		) {
			diagnostics.push(
				diagnostic(
					"INVALID_INITIAL_VERSION",
					`Workspace package ${name} has an invalid initial version.`,
				),
			);
		}
	}
	for (const name of Object.keys(initialVersions)) {
		if (!byName.has(name)) {
			diagnostics.push(
				diagnostic(
					"UNKNOWN_INITIAL_VERSION_PACKAGE",
					`pre.json initialVersions names unknown workspace package ${name}.`,
				),
			);
		}
	}

	const consumed = Array.isArray(preState.changesets)
		? preState.changesets.filter((id) => typeof id === "string")
		: [];
	if (new Set(consumed).size !== consumed.length) {
		diagnostics.push(
			diagnostic(
				"DUPLICATE_CONSUMED_CHANGESET",
				"pre.json changesets must not contain duplicate IDs.",
			),
		);
	}
	const consumedSet = new Set(consumed);
	const fixedGroup = validateFixedGroup(
		config && typeof config === "object" && !Array.isArray(config)
			? config
			: {},
		publicNames,
		diagnostics,
	);

	let candidateVersion = null;
	if (fixedGroup.length > 0) {
		const versions = fixedGroup.map((name) => byName.get(name).manifest.version);
		for (const [index, version] of versions.entries()) {
			const packageName = fixedGroup[index];
			const parsed =
				typeof version === "string" ? semver.parse(version) : null;
			if (!parsed) {
				diagnostics.push(
					diagnostic(
						"INVALID_PACKAGE_VERSION",
						`Public package ${packageName} has an invalid SemVer version.`,
					),
				);
				continue;
			}
			if (
				!validTag ||
				parsed.prerelease.length !== 2 ||
				parsed.prerelease[0] !== preState.tag ||
				typeof parsed.prerelease[1] !== "number"
			) {
				diagnostics.push(
					diagnostic(
						"INVALID_CANDIDATE_VERSION",
						`Public package ${packageName} must use <base>-${validTag ? preState.tag : "tag"}.<number>.`,
					),
				);
			}
			const initial = initialVersions[packageName];
			if (
				typeof initial === "string" &&
				semver.valid(initial) &&
				!semver.gte(version, initial)
			) {
				diagnostics.push(
					diagnostic(
						"CANDIDATE_BELOW_INITIAL_VERSION",
						`Public package ${packageName} is below its initial version.`,
					),
				);
			}
		}

		const bases = new Set(versions.map(baseVersion));
		const tags = new Set(
			versions.map((version) =>
				typeof version === "string"
					? semver.parse(version)?.prerelease[0]
					: undefined,
			),
		);
		const sequences = new Set(
			versions.map((version) =>
				typeof version === "string"
					? semver.parse(version)?.prerelease[1]
					: undefined,
			),
		);
		if (bases.size !== 1) {
			diagnostics.push(
				diagnostic(
					"FIXED_GROUP_BASE_VERSION_SPLIT",
					"Public fixed-group packages must share one base version.",
				),
			);
		}
		if (tags.size !== 1) {
			diagnostics.push(
				diagnostic(
					"FIXED_GROUP_PRERELEASE_TAG_SPLIT",
					"Public fixed-group packages must share one prerelease tag.",
				),
			);
		}
		if (sequences.size !== 1) {
			diagnostics.push(
				diagnostic(
					"FIXED_GROUP_PRERELEASE_SEQUENCE_SPLIT",
					"Public fixed-group packages must share one prerelease sequence.",
				),
			);
		}
		if (new Set(versions).size !== 1) {
			diagnostics.push(
				diagnostic(
					"FIXED_GROUP_VERSION_SPLIT",
					"Public fixed-group packages must use one exact version.",
				),
			);
		}
		if (
			new Set(versions).size === 1 &&
			typeof versions[0] === "string" &&
			semver.valid(versions[0])
		)
			candidateVersion = versions[0];
	}

	const changesets = await listChangesets(root);
	let pendingChangesets = 0;
	let emptyChangesets = 0;
	for (const changeset of changesets) {
		if (changeset.parseError) {
			diagnostics.push(changeset.parseError);
			continue;
		}
		for (const release of changeset.releases) {
			if (
				!byName.has(release.name) ||
				!["major", "minor", "patch"].includes(release.type)
			) {
				diagnostics.push(
					diagnostic(
						"INVALID_CHANGESET_RELEASE",
						`Changeset ${changeset.id} has an invalid package or release type.`,
					),
				);
			}
		}
		if (changeset.releases.length === 0) {
			emptyChangesets += 1;
			diagnostics.push(
				diagnostic(
					"EMPTY_CHANGESET_NOT_ALLOWED",
					`Changeset ${changeset.id} does not request a package bump.`,
				),
			);
		} else if (!consumedSet.has(changeset.id)) {
			pendingChangesets += 1;
			if (!allowPending) {
				diagnostics.push(
					diagnostic(
						"NEXT_RC_REQUIRED",
						`Changeset ${changeset.id} is pending; version the next RC before publishing this candidate.`,
					),
				);
			}
		}
	}

	return {
		success: diagnostics.length === 0,
		mode: "pre",
		tag: typeof preState.tag === "string" ? preState.tag : null,
		candidateVersion,
		publicPackages: publicNames.length,
		pendingChangesets,
		emptyChangesets,
		diagnostics,
	};
}

export async function verifyChangesetState(
	root = repositoryRoot,
	{ allowPending = false } = {},
) {
	const prePath = join(root, ".changeset/pre.json");
	if (!(await exists(prePath))) return verifyNormalMode(root);

	let preState;
	try {
		preState = await readJson(prePath);
	} catch {
		return {
			success: false,
			mode: "pre",
			tag: null,
			candidateVersion: null,
			publicPackages: 0,
			pendingChangesets: 0,
			emptyChangesets: 0,
			diagnostics: [
				diagnostic(
					"INVALID_PRE_JSON",
					".changeset/pre.json must contain valid JSON.",
				),
			],
		};
	}
	if (!preState || typeof preState !== "object" || Array.isArray(preState)) {
		return {
			success: false,
			mode: "pre",
			tag: null,
			candidateVersion: null,
			publicPackages: 0,
			pendingChangesets: 0,
			emptyChangesets: 0,
			diagnostics: [
				diagnostic(
					"INVALID_PRE_STATE",
					".changeset/pre.json must contain an object.",
				),
			],
		};
	}
	try {
		return await verifyPrereleaseMode(root, preState, { allowPending });
	} catch {
		return {
			success: false,
			mode: "pre",
			tag: typeof preState.tag === "string" ? preState.tag : null,
			candidateVersion: null,
			publicPackages: 0,
			pendingChangesets: 0,
			emptyChangesets: 0,
			diagnostics: [
				diagnostic(
					"CHANGESET_STATE_VALIDATION_FAILED",
					"Changesets state could not be validated.",
				),
			],
		};
	}
}

function parseArguments(argv) {
	let root = repositoryRoot;
	let json = false;
	let allowPending = false;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--json") {
			json = true;
		} else if (argument === "--allow-pending") {
			allowPending = true;
		} else if (argument === "--root" && argv[index + 1]) {
			root = resolve(argv[index + 1]);
			index += 1;
		} else {
			throw new Error(`Unknown or incomplete argument: ${argument}`);
		}
	}
	return { root, json, allowPending };
}

export async function main(argv = process.argv.slice(2)) {
	let options;
	try {
		options = parseArguments(argv);
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		process.exitCode = 2;
		return;
	}
	const result = await verifyChangesetState(options.root, {
		allowPending: options.allowPending,
	});
	if (options.json || result.success) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	} else {
		for (const item of result.diagnostics)
			process.stderr.write(`${item.code}: ${item.message}\n`);
	}
	if (!result.success) process.exitCode = 1;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	await main();
