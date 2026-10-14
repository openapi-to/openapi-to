import { constants } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import parseChangeset from "@changesets/parse";
import semver from "semver";

export const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
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

async function listChangesetsInDirectory(directory) {
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

async function listChangesets(root) {
	return listChangesetsInDirectory(join(root, ".changeset"));
}

async function listPrereleaseChangesets(root) {
	const directory = join(root, ".changeset/pre");
	if (!(await exists(directory))) return [];
	return listChangesetsInDirectory(directory);
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

function validateChangeset(changeset, packageNames, diagnostics) {
	if (changeset.parseError) {
		diagnostics.push(changeset.parseError);
		return false;
	}
	for (const release of changeset.releases) {
		if (
			!packageNames.has(release.name) ||
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
	return true;
}

async function verifyNormalMode(root, { allowPending = false } = {}) {
	const workspaces = await readWorkspaces(root);
	const diagnostics = [];
	const byName = new Map(
		workspaces.map((workspace) => [workspace.manifest.name, workspace]),
	);
	const publicPackages = workspaces.filter(
		({ manifest }) => manifest.private !== true,
	);
	const versions = new Set(
		publicPackages.map(({ manifest }) => manifest.version),
	);
	if (publicPackages.length === 0) {
		diagnostics.push(
			diagnostic(
				"NO_PUBLIC_PACKAGES",
				"At least one public package is required.",
			),
		);
	} else if (versions.size !== 1) {
		diagnostics.push(
			diagnostic(
				"FIXED_GROUP_VERSION_SPLIT",
				"Public fixed-group packages must use one exact version.",
			),
		);
	}
	for (const { manifest } of publicPackages) {
		if (!semver.valid(manifest.version)) {
			diagnostics.push(
				diagnostic(
					"INVALID_PUBLIC_VERSION",
					`${manifest.name} must use an exact SemVer version.`,
				),
			);
		}
	}
	let config;
	try {
		config = await readJson(join(root, ".changeset/config.json"));
	} catch {
		diagnostics.push(
			diagnostic(
				"INVALID_CHANGESET_CONFIG",
				".changeset/config.json must contain valid JSON.",
			),
		);
	}
	if (config) {
		validateFixedGroup(
			config,
			publicPackages.map(({ manifest }) => manifest.name),
			diagnostics,
		);
		if (config.fixed?.length !== 1) {
			diagnostics.push(
				diagnostic(
					"PUBLIC_FIXED_GROUP_MISMATCH",
					"Public packages must form the only fixed group.",
				),
			);
		}
	}
	const changesets = await listChangesets(root);
	let emptyChangesets = 0;
	for (const changeset of changesets) {
		if (!validateChangeset(changeset, byName, diagnostics)) continue;
		if (changeset.releases.length === 0) {
			emptyChangesets += 1;
			diagnostics.push(
				diagnostic(
					"EMPTY_CHANGESET_NOT_ALLOWED",
					`Changeset ${changeset.id} does not request a package bump.`,
				),
			);
		}
	}
	if (changesets.length > 0) {
		if (!allowPending) {
			diagnostics.push(
				diagnostic(
					"NEXT_STABLE_VERSION_REQUIRED",
					"Pending Changesets must be consumed before stable release readiness.",
				),
			);
		}
	} else {
		const previousVersions = [];
		for (const { directory, manifest } of publicPackages) {
			if (
				!semver.valid(manifest.version) ||
				semver.prerelease(manifest.version)
			) {
				diagnostics.push(
					diagnostic(
						"INVALID_STABLE_VERSION",
						`${manifest.name} must use a stable SemVer version.`,
					),
				);
				continue;
			}
			try {
				const changelog = await readFile(
					join(root, directory, "CHANGELOG.md"),
					"utf8",
				);
				const headings = changelog
					.split(/\r?\n/)
					.filter((line) => line.startsWith("## "))
					.map((line) => line.slice(3).trim());
				if (!headings.includes(manifest.version)) {
					diagnostics.push(
						diagnostic(
							"MISSING_STABLE_CHANGELOG",
							`${manifest.name} has no changelog section for ${manifest.version}.`,
						),
					);
				}
				previousVersions.push(
					...headings.filter(
						(version) => version !== manifest.version && semver.valid(version),
					),
				);
			} catch {
				diagnostics.push(
					diagnostic(
						"MISSING_STABLE_CHANGELOG",
						`${manifest.name} has no readable changelog.`,
					),
				);
			}
		}
		if (previousVersions.length === 0) {
			diagnostics.push(
				diagnostic(
					"MISSING_RELEASE_HISTORY",
					"Stable candidate requires prior version history.",
				),
			);
		} else if (
			publicPackages.length > 0 &&
			semver.valid(publicPackages[0].manifest.version)
		) {
			const candidate = publicPackages[0].manifest.version;
			if (previousVersions.some((version) => !semver.gt(candidate, version))) {
				diagnostics.push(
					diagnostic(
						"STABLE_VERSION_NOT_AFTER_HISTORY",
						"Stable candidate must be newer than every prior changelog version.",
					),
				);
			}
		}
	}
	return {
		success: diagnostics.length === 0,
		mode: "normal",
		tag: null,
		candidateVersion:
			publicPackages.length > 0 && versions.size === 1
				? publicPackages[0].manifest.version
				: null,
		publicPackages: publicPackages.length,
		pendingChangesets: changesets.length,
		emptyChangesets,
		diagnostics,
	};
}

async function verifyPrereleaseMode(
	root,
	preState,
	{ allowPending = false } = {},
) {
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
		typeof preState.tag === "string" && /^[0-9A-Za-z-]+$/.test(preState.tag);
	if (!validTag) {
		diagnostics.push(
			diagnostic(
				"INVALID_PRE_TAG",
				"pre.json tag must be a non-empty prerelease identifier.",
			),
		);
	}
	const hasLegacyInitialVersions = Object.hasOwn(preState, "initialVersions");
	const hasLegacyChangesets = Object.hasOwn(preState, "changesets");
	const usesLegacyPreState = hasLegacyInitialVersions || hasLegacyChangesets;
	if (
		usesLegacyPreState &&
		(!preState.initialVersions ||
			typeof preState.initialVersions !== "object" ||
			Array.isArray(preState.initialVersions))
	) {
		diagnostics.push(
			diagnostic(
				"INVALID_INITIAL_VERSIONS",
				"Legacy pre.json initialVersions must be an object.",
			),
		);
	}
	if (
		usesLegacyPreState &&
		(!Array.isArray(preState.changesets) ||
			preState.changesets.some((id) => typeof id !== "string"))
	) {
		diagnostics.push(
			diagnostic(
				"INVALID_CONSUMED_CHANGESETS",
				"Legacy pre.json changesets must be an array of strings.",
			),
		);
	}

	const initialVersions =
		usesLegacyPreState &&
		preState.initialVersions &&
		typeof preState.initialVersions === "object" &&
		!Array.isArray(preState.initialVersions)
			? preState.initialVersions
			: {};
	if (usesLegacyPreState) {
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
	}

	const legacyConsumed = Array.isArray(preState.changesets)
		? preState.changesets.filter((id) => typeof id === "string")
		: [];
	const prereleaseChangesets = await listPrereleaseChangesets(root);
	const prereleaseIds = prereleaseChangesets.map(({ id }) => id);
	const consumed = [...legacyConsumed, ...prereleaseIds];
	if (new Set(consumed).size !== consumed.length) {
		diagnostics.push(
			diagnostic(
				"DUPLICATE_CONSUMED_CHANGESET",
				"Consumed prerelease changesets must not contain duplicate IDs.",
			),
		);
	}
	const consumedSet = new Set(consumed);
	for (const changeset of prereleaseChangesets) {
		if (!validateChangeset(changeset, byName, diagnostics)) continue;
		if (changeset.releases.length === 0) {
			diagnostics.push(
				diagnostic(
					"EMPTY_CHANGESET_NOT_ALLOWED",
					`Changeset ${changeset.id} does not request a package bump.`,
				),
			);
		}
	}
	const fixedGroup = validateFixedGroup(
		config && typeof config === "object" && !Array.isArray(config)
			? config
			: {},
		publicNames,
		diagnostics,
	);

	let candidateVersion = null;
	if (fixedGroup.length > 0) {
		const versions = fixedGroup.map(
			(name) => byName.get(name).manifest.version,
		);
		for (const [index, version] of versions.entries()) {
			const packageName = fixedGroup[index];
			const parsed = typeof version === "string" ? semver.parse(version) : null;
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
		if (!validateChangeset(changeset, byName, diagnostics)) continue;
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
	if (!(await exists(prePath))) return verifyNormalMode(root, { allowPending });

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
