import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
	access,
	lstat,
	mkdir,
	open,
	readdir,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import semver from "semver";
import { t as listTar } from "tar";

export const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../..",
);

const ALLOWED_CHANNELS = new Set(["rc", "latest"]);
const ARTIFACT_DIRECTORY_PREFIX = ".ci-artifacts/publication";
const MANIFEST_FILENAME = "publication-manifest.json";
const CHECKSUM_FILENAME = "SHA256SUMS";
const PUBLICATION_SCHEMA_VERSION = 1;
const EXPECTED_REPOSITORY = "Vc-great/openapi-to";
const EXPECTED_REPOSITORY_URL = "https://github.com/Vc-great/openapi-to.git";
const EXPECTED_REGISTRY = "https://registry.npmjs.org/";
const MAX_ARTIFACT_MANIFEST_BYTES = 1024 * 1024;
const MAX_ARTIFACT_FILES = 100;
const MAX_ARTIFACT_DEPTH = 4;
const MAX_TARBALL_BYTES = 50 * 1024 * 1024;
const MAX_TARBALL_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_TARBALL_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_TARBALL_ENTRIES = 20_000;
const MAX_PACK_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;
const MAX_REGISTRY_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_ATTEMPTS = 12;
const MAX_DELAY_MS = 30_000;
const MAX_REQUEST_TIMEOUT_MS = 30_000;
const MAX_TOTAL_VERIFY_MS = 180_000;
const DEPENDENCY_FIELDS = [
	"dependencies",
	"optionalDependencies",
	"peerDependencies",
	"devDependencies",
];
const execFileAsync = promisify(execFile);

export class PublicationError extends Error {
	constructor(code, message, details) {
		super(message);
		this.code = code;
		this.details = details;
	}
}

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique(values) {
	return [...new Set(values)].sort(compareText);
}

async function exists(path) {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function readBoundedFile(path, maximumBytes, code) {
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const pathStat = await handle.stat();
		if (!pathStat.isFile()) {
			throw new PublicationError(code, `${code} requires a regular file.`);
		}
		if (pathStat.size > maximumBytes) {
			throw new PublicationError(code, `${code} exceeds its size limit.`);
		}
		return await handle.readFile();
	} catch (error) {
		if (error instanceof PublicationError) throw error;
		throw new PublicationError(
			code,
			`Unable to read the file required by ${code}.`,
		);
	} finally {
		await handle?.close();
	}
}

async function readJson(
	path,
	code,
	maximumBytes = MAX_ARTIFACT_MANIFEST_BYTES,
) {
	try {
		return JSON.parse(
			(await readBoundedFile(path, maximumBytes, code)).toString("utf8"),
		);
	} catch (error) {
		if (error instanceof PublicationError) throw error;
		throw new PublicationError(
			code,
			`Unable to read valid JSON required by ${code}.`,
		);
	}
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

async function expandWorkspacePattern(root, pattern) {
	if (
		!/^[-A-Za-z0-9_.]+(?:\/[-A-Za-z0-9_.]+)*(?:\/\*)?$/.test(pattern) ||
		pattern.split("/").includes("..")
	) {
		throw new PublicationError(
			"UNSAFE_WORKSPACE_PATTERN",
			`Workspace pattern ${pattern} is not a safe repository-relative path.`,
		);
	}
	if (!pattern.endsWith("/*")) {
		return (await exists(join(root, pattern, "package.json"))) ? [pattern] : [];
	}
	const parent = pattern.slice(0, -2);
	const parentPath = join(root, parent);
	if (!(await exists(parentPath))) return [];
	const directories = [];
	for (const entry of (await readdir(parentPath, { withFileTypes: true })).sort(
		(left, right) => compareText(left.name, right.name),
	)) {
		if (
			entry.isDirectory() &&
			(await exists(join(parentPath, entry.name, "package.json")))
		) {
			directories.push(`${parent}/${entry.name}`);
		}
	}
	return directories;
}

function isInside(root, target) {
	const rootRelative = relative(root, target);
	return (
		rootRelative === "" ||
		(rootRelative !== ".." &&
			!rootRelative.startsWith(`..${sep}`) &&
			!isAbsolute(rootRelative))
	);
}

async function rejectSymlinkSegments(root, target, code) {
	const rootRelative = relative(root, target);
	if (!isInside(root, target)) {
		throw new PublicationError(
			code,
			`${code} path escapes its controlled root.`,
		);
	}
	let current = root;
	for (const segment of rootRelative.split(sep).filter(Boolean)) {
		current = join(current, segment);
		if (!(await exists(current))) break;
		if ((await lstat(current)).isSymbolicLink()) {
			throw new PublicationError(
				code,
				`${code} path must not traverse a symlink.`,
			);
		}
	}
}

export async function readWorkspacePackages(root = repositoryRoot) {
	const rootManifest = await readJson(
		join(root, "package.json"),
		"INVALID_ROOT_MANIFEST",
	);
	const pnpmPatterns = parseWorkspacePatterns(
		(
			await readBoundedFile(
				join(root, "pnpm-workspace.yaml"),
				MAX_ARTIFACT_MANIFEST_BYTES,
				"INVALID_WORKSPACE_CONFIG",
			)
		).toString("utf8"),
	);
	const rootPatterns = [...(rootManifest.workspaces?.packages ?? [])];
	if (
		JSON.stringify([...pnpmPatterns].sort(compareText)) !==
		JSON.stringify([...rootPatterns].sort(compareText))
	) {
		throw new PublicationError(
			"WORKSPACE_PATTERN_MISMATCH",
			"Root workspaces and pnpm-workspace.yaml must select the same packages.",
		);
	}

	const directories = [];
	for (const pattern of pnpmPatterns) {
		const matches = await expandWorkspacePattern(root, pattern);
		if (matches.length === 0) {
			throw new PublicationError(
				"EMPTY_WORKSPACE_PATTERN",
				`Workspace pattern ${pattern} does not contain a package manifest.`,
			);
		}
		directories.push(...matches);
	}
	const packages = [];
	const realRoot = await realpath(root);
	for (const directory of sortedUnique(directories)) {
		const packageDirectory = resolve(root, directory);
		if (!isInside(root, packageDirectory)) {
			throw new PublicationError(
				"WORKSPACE_PATH_ESCAPE",
				`Workspace package ${directory} escapes the repository root.`,
			);
		}
		if (
			(await lstat(packageDirectory)).isSymbolicLink() ||
			!isInside(realRoot, await realpath(packageDirectory))
		) {
			throw new PublicationError(
				"WORKSPACE_SYMLINK_ESCAPE",
				`Workspace package ${directory} must be a real directory inside the repository.`,
			);
		}
		const manifest = await readJson(
			join(packageDirectory, "package.json"),
			"INVALID_PACKAGE_MANIFEST",
		);
		packages.push({ directory, manifest });
	}
	return packages.sort((left, right) =>
		compareText(left.manifest.name, right.manifest.name),
	);
}

function validateFixedGroup(config, publicNames) {
	if (!Array.isArray(config.fixed)) {
		throw new PublicationError(
			"INVALID_FIXED_GROUP",
			"Changesets fixed groups must be an array.",
		);
	}
	const expected = [...publicNames].sort(compareText);
	const matchingGroups = config.fixed.filter(
		(group) =>
			Array.isArray(group) &&
			new Set(group).size === group.length &&
			JSON.stringify([...group].sort(compareText)) === JSON.stringify(expected),
	);
	if (matchingGroups.length !== 1 || config.fixed.length !== 1) {
		throw new PublicationError(
			"PUBLIC_FIXED_GROUP_MISMATCH",
			"All public workspace packages must form one exact Changesets fixed group.",
		);
	}
}

function validateVersionChannel(version, channel, preState) {
	const parsed = semver.parse(version);
	if (!parsed || semver.valid(version) !== version) {
		throw new PublicationError(
			"INVALID_EXPECTED_VERSION",
			`Expected version ${version} must be an exact SemVer value.`,
		);
	}
	const prerelease = parsed.prerelease.length > 0;
	if (prerelease) {
		if (channel !== "rc" || parsed.prerelease[0] !== "rc") {
			throw new PublicationError(
				"CHANNEL_VERSION_MISMATCH",
				`Prerelease version ${version} requires the rc channel and rc identifier.`,
			);
		}
		if (preState?.mode !== "pre" || preState?.tag !== "rc") {
			throw new PublicationError(
				"PRERELEASE_STATE_MISMATCH",
				`Version ${version} requires Changesets prerelease mode with tag rc.`,
			);
		}
	} else {
		if (channel !== "latest") {
			throw new PublicationError(
				"CHANNEL_VERSION_MISMATCH",
				`Stable version ${version} requires the latest channel.`,
			);
		}
		if (preState?.mode === "pre") {
			throw new PublicationError(
				"PRERELEASE_STATE_MISMATCH",
				`Stable version ${version} cannot publish while Changesets remains in prerelease mode.`,
			);
		}
	}
	return prerelease;
}

function validateRepositoryMetadata(manifest, expectedDirectory) {
	if (
		manifest.repository?.type !== "git" ||
		manifest.repository?.url !== EXPECTED_REPOSITORY_URL ||
		manifest.repository?.directory !== expectedDirectory
	) {
		throw new PublicationError(
			"INVALID_REPOSITORY_METADATA",
			`${manifest.name ?? "<unknown>"} repository must be the canonical ${EXPECTED_REPOSITORY_URL} directory ${expectedDirectory}.`,
		);
	}
}

async function loadCandidate({ root, expectedVersion, channel }) {
	if (typeof expectedVersion !== "string" || expectedVersion.length === 0) {
		throw new PublicationError(
			"MISSING_EXPECTED_VERSION",
			"An exact expected version is required.",
		);
	}
	if (!ALLOWED_CHANNELS.has(channel)) {
		throw new PublicationError(
			"INVALID_CHANNEL",
			`Channel ${channel ?? "<missing>"} must be rc or latest.`,
		);
	}

	const workspaces = await readWorkspacePackages(root);
	const publicPackages = workspaces.filter(
		({ manifest }) => manifest.private !== true,
	);
	if (publicPackages.length === 0) {
		throw new PublicationError(
			"NO_PUBLIC_PACKAGES",
			"No public workspace packages were discovered.",
		);
	}
	const publicNames = publicPackages.map(({ manifest }) => manifest.name);
	if (
		publicNames.some(
			(name) => typeof name !== "string" || name.trim().length === 0,
		)
	) {
		throw new PublicationError(
			"INVALID_PACKAGE_NAME",
			"Every public package must have a non-empty name.",
		);
	}
	const versions = new Set(
		publicPackages.map(({ manifest }) => manifest.version),
	);
	if (versions.size !== 1 || !versions.has(expectedVersion)) {
		throw new PublicationError(
			"PUBLIC_VERSION_MISMATCH",
			`Public packages must all use expected version ${expectedVersion}; found ${[
				...versions,
			]
				.sort(compareText)
				.join(", ")}.`,
		);
	}
	for (const { directory, manifest } of publicPackages) {
		if (
			manifest.publishConfig?.access !== "public" ||
			manifest.publishConfig?.registry !== EXPECTED_REGISTRY
		) {
			throw new PublicationError(
				"INVALID_PUBLISH_CONFIG",
				`${manifest.name}@${expectedVersion} must publish publicly to ${EXPECTED_REGISTRY}.`,
			);
		}
		validateRepositoryMetadata(manifest, directory);
	}

	const config = await readJson(
		join(root, ".changeset/config.json"),
		"INVALID_CHANGESET_CONFIG",
	);
	validateFixedGroup(config, publicNames);
	const prePath = join(root, ".changeset/pre.json");
	const preState = (await exists(prePath))
		? await readJson(prePath, "INVALID_PRE_STATE")
		: undefined;
	const prerelease = validateVersionChannel(expectedVersion, channel, preState);
	const packageMap = new Map(
		publicPackages.map((record) => [record.manifest.name, record]),
	);
	const orderedPackages = publicationOrder(publicPackages, packageMap);

	return {
		facts: {
			success: true,
			version: expectedVersion,
			channel,
			distTag: channel,
			prerelease,
			tag: `v${expectedVersion}`,
			packageCount: publicPackages.length,
			packages: orderedPackages.map(({ directory, manifest }) => ({
				name: manifest.name,
				version: manifest.version,
				directory,
			})),
		},
		packageMap,
		orderedPackages,
	};
}

function publicationOrder(publicPackages, packageMap) {
	const dependencies = new Map();
	for (const { manifest } of publicPackages) {
		dependencies.set(
			manifest.name,
			new Set(
				["dependencies", "optionalDependencies"]
					.flatMap((field) => Object.keys(manifest[field] ?? {}))
					.filter((name) => packageMap.has(name)),
			),
		);
	}
	const remaining = new Set(packageMap.keys());
	const ordered = [];
	while (remaining.size > 0) {
		const ready = [...remaining]
			.filter((name) =>
				[...(dependencies.get(name) ?? [])].every(
					(dependency) => !remaining.has(dependency),
				),
			)
			.sort(compareText);
		if (ready.length === 0) {
			throw new PublicationError(
				"PUBLICATION_DEPENDENCY_CYCLE",
				"Public runtime dependencies must form an acyclic publication order.",
			);
		}
		for (const name of ready) {
			ordered.push(packageMap.get(name));
			remaining.delete(name);
		}
	}
	return ordered;
}

export async function createPublicationFacts({
	root = repositoryRoot,
	expectedVersion,
	channel,
} = {}) {
	return (await loadCandidate({ root, expectedVersion, channel })).facts;
}

function normalizeJson(value) {
	if (Array.isArray(value)) return value.map(normalizeJson);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort(compareText)
			.map((key) => [key, normalizeJson(value[key])]),
	);
}

function publicationManifestFields(manifest) {
	const fields = {
		name: manifest.name,
		version: manifest.version,
		private: manifest.private === true,
		repository: manifest.repository,
		publishConfig: manifest.publishConfig,
	};
	for (const field of [
		...DEPENDENCY_FIELDS,
		"peerDependenciesMeta",
		"bundledDependencies",
		"bundleDependencies",
	]) {
		if (manifest[field] !== undefined) fields[field] = manifest[field];
	}
	return normalizeJson(fields);
}

function canonicalTarEntryPath(path) {
	if (
		typeof path !== "string" ||
		path.includes("\0") ||
		path.includes("\\") ||
		path.startsWith("/")
	) {
		throw new PublicationError(
			"UNSAFE_TARBALL_ENTRY",
			"Tarball entries must remain below the package directory.",
		);
	}
	const withoutTrailingSlash =
		path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
	const segments = withoutTrailingSlash.split("/");
	if (
		segments[0] !== "package" ||
		segments.some(
			(segment) => segment === "" || segment === "." || segment === "..",
		)
	) {
		throw new PublicationError(
			"UNSAFE_TARBALL_ENTRY",
			"Tarball entries must use canonical paths below the package directory.",
		);
	}
	return segments.join("/");
}

export async function inspectTarball(tarballPath) {
	const tarballStat = await lstat(tarballPath);
	if (
		!tarballStat.isFile() ||
		tarballStat.isSymbolicLink() ||
		tarballStat.size < 1 ||
		tarballStat.size > MAX_TARBALL_BYTES
	) {
		throw new PublicationError(
			"INVALID_TARBALL_FILE",
			"Publication tarball must be a bounded regular file.",
		);
	}
	let entries = 0;
	let expandedBytes = 0;
	let packageManifestBytes;
	let packageManifestEntries = 0;
	const files = [];
	const entryPaths = new Set();
	await listTar({
		file: tarballPath,
		strict: true,
		maxReadSize: MAX_PACKAGE_MANIFEST_BYTES,
		onentry(entry) {
			entries += 1;
			if (entries > MAX_TARBALL_ENTRIES) {
				throw new PublicationError(
					"TARBALL_ENTRY_LIMIT",
					"Publication tarball contains too many entries.",
				);
			}
			const canonicalPath = canonicalTarEntryPath(entry.path);
			if (entryPaths.has(canonicalPath)) {
				throw new PublicationError(
					"DUPLICATE_TARBALL_ENTRY",
					"Publication tarball must not contain duplicate entry paths.",
				);
			}
			entryPaths.add(canonicalPath);
			if (!["File", "Directory"].includes(entry.type)) {
				throw new PublicationError(
					"UNSAFE_TARBALL_ENTRY_TYPE",
					"Publication tarball must not contain links or special entries.",
				);
			}
			if (canonicalPath === "package" && entry.type !== "Directory") {
				throw new PublicationError(
					"INVALID_TARBALL_ROOT",
					"Publication tarball package root must be a directory.",
				);
			}
			const entrySize = Number(entry.size ?? 0);
			if (
				!Number.isSafeInteger(entrySize) ||
				entrySize < 0 ||
				entrySize > MAX_TARBALL_ENTRY_BYTES
			) {
				throw new PublicationError(
					"TARBALL_ENTRY_SIZE_LIMIT",
					"Publication tarball contains an invalid or oversized entry.",
				);
			}
			expandedBytes += entrySize;
			if (expandedBytes > MAX_TARBALL_EXPANDED_BYTES) {
				throw new PublicationError(
					"TARBALL_EXPANDED_SIZE_LIMIT",
					"Publication tarball exceeds the expanded size limit.",
				);
			}
			if (entry.type === "File")
				files.push(canonicalPath.slice("package/".length));
			if (canonicalPath !== "package/package.json" || entry.type !== "File") {
				entry.resume();
				return;
			}
			packageManifestEntries += 1;
			if (entrySize > MAX_PACKAGE_MANIFEST_BYTES) {
				throw new PublicationError(
					"TARBALL_MANIFEST_TOO_LARGE",
					"Tarball package.json exceeds the size limit.",
				);
			}
			const chunks = [];
			let totalBytes = 0;
			entry.on("data", (chunk) => {
				totalBytes += chunk.byteLength;
				if (totalBytes > MAX_PACKAGE_MANIFEST_BYTES) {
					entry.destroy(
						new PublicationError(
							"TARBALL_MANIFEST_TOO_LARGE",
							"Tarball package.json exceeds the size limit.",
						),
					);
					return;
				}
				chunks.push(chunk);
			});
			entry.on("end", () => {
				packageManifestBytes = Buffer.concat(chunks, totalBytes);
			});
		},
	});
	if (packageManifestEntries !== 1 || !packageManifestBytes) {
		throw new PublicationError(
			"INVALID_TARBALL_MANIFEST_COUNT",
			"Publication tarball must contain exactly one package/package.json.",
		);
	}
	let manifest;
	try {
		manifest = JSON.parse(packageManifestBytes.toString("utf8"));
	} catch {
		throw new PublicationError(
			"INVALID_TARBALL_MANIFEST",
			"Tarball package/package.json must contain valid JSON.",
		);
	}
	return {
		manifest,
		files: sortedUnique(files),
		size: tarballStat.size,
	};
}

function findWorkspaceProtocol(value, path = []) {
	if (typeof value === "string") {
		return value.startsWith("workspace:") ? path.join(".") : undefined;
	}
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			const found = findWorkspaceProtocol(item, [...path, String(index)]);
			if (found) return found;
		}
		return undefined;
	}
	if (!value || typeof value !== "object") return undefined;
	for (const [key, item] of Object.entries(value)) {
		const found = findWorkspaceProtocol(item, [...path, key]);
		if (found) return found;
	}
	return undefined;
}

function validateInternalRange({
	name,
	field,
	sourceRange,
	publishedRange,
	expectedVersion,
}) {
	if (typeof publishedRange !== "string") {
		throw new PublicationError(
			"INVALID_INTERNAL_DEPENDENCY",
			`${name} in ${field} must use a string range in the tarball manifest.`,
		);
	}
	if (
		/^(?:workspace:|file:|link:)/.test(publishedRange) ||
		!semver.validRange(publishedRange) ||
		!semver.satisfies(expectedVersion, publishedRange, {
			includePrerelease: true,
		})
	) {
		throw new PublicationError(
			"INVALID_INTERNAL_DEPENDENCY_RANGE",
			`${name} in ${field} must resolve to the current fixed-group version.`,
		);
	}
	if (sourceRange === "workspace:*" && publishedRange !== expectedVersion) {
		throw new PublicationError(
			"WORKSPACE_STAR_RESOLUTION_MISMATCH",
			`${name} workspace:* must resolve to exact version ${expectedVersion}.`,
		);
	}
}

function validatePackedManifest({
	sourceManifest,
	packedManifest,
	expectedVersion,
	publicNames,
}) {
	if (packedManifest.name !== sourceManifest.name) {
		throw new PublicationError(
			"TARBALL_PACKAGE_NAME_MISMATCH",
			"Tarball package name does not match its source package.",
		);
	}
	if (
		packedManifest.version !== expectedVersion ||
		packedManifest.version !== sourceManifest.version
	) {
		throw new PublicationError(
			"TARBALL_PACKAGE_VERSION_MISMATCH",
			`${sourceManifest.name} tarball version must equal ${expectedVersion}.`,
		);
	}
	if (packedManifest.private === true) {
		throw new PublicationError(
			"TARBALL_PACKAGE_PRIVATE",
			`${sourceManifest.name} tarball must not be private.`,
		);
	}
	if (
		packedManifest.publishConfig?.access !== "public" ||
		packedManifest.publishConfig?.registry !== EXPECTED_REGISTRY
	) {
		throw new PublicationError(
			"INVALID_TARBALL_PUBLISH_CONFIG",
			`${sourceManifest.name} tarball publishConfig is not the public npm registry.`,
		);
	}
	validateRepositoryMetadata(
		packedManifest,
		sourceManifest.repository.directory,
	);
	const publishedFields = publicationManifestFields(packedManifest);
	const workspacePath = findWorkspaceProtocol(publishedFields);
	if (workspacePath) {
		throw new PublicationError(
			"WORKSPACE_PROTOCOL_IN_TARBALL",
			`${sourceManifest.name} tarball retains workspace: in ${workspacePath}.`,
		);
	}
	const peerNames = new Set(Object.keys(packedManifest.peerDependencies ?? {}));
	for (const name of Object.keys(packedManifest.peerDependenciesMeta ?? {})) {
		if (!peerNames.has(name)) {
			throw new PublicationError(
				"ORPHAN_PEER_DEPENDENCY_META",
				`${sourceManifest.name} peerDependenciesMeta names ${name} without a peer dependency.`,
			);
		}
	}
	for (const field of ["bundledDependencies", "bundleDependencies"]) {
		const bundled = packedManifest[field];
		if (
			bundled !== undefined &&
			(!Array.isArray(bundled) ||
				bundled.some((name) => typeof name !== "string"))
		) {
			throw new PublicationError(
				"INVALID_BUNDLED_DEPENDENCIES",
				`${sourceManifest.name} ${field} must be an array of package names.`,
			);
		}
		for (const name of bundled ?? []) {
			if (publicNames.has(name)) {
				throw new PublicationError(
					"BUNDLED_FIXED_GROUP_DEPENDENCY",
					`${sourceManifest.name} must not bundle fixed-group package ${name}.`,
				);
			}
		}
	}

	const internalDependencies = {};
	for (const field of DEPENDENCY_FIELDS) {
		for (const [name, sourceRange] of Object.entries(
			sourceManifest[field] ?? {},
		)) {
			if (!publicNames.has(name)) continue;
			const publishedRange = packedManifest[field]?.[name];
			validateInternalRange({
				name,
				field,
				sourceRange,
				publishedRange,
				expectedVersion,
			});
			internalDependencies[field] ??= {};
			internalDependencies[field][name] = publishedRange;
		}
		for (const name of Object.keys(packedManifest[field] ?? {})) {
			if (
				publicNames.has(name) &&
				!Object.hasOwn(sourceManifest[field] ?? {}, name)
			) {
				throw new PublicationError(
					"UNEXPECTED_INTERNAL_DEPENDENCY",
					`${sourceManifest.name} tarball unexpectedly adds ${name} to ${field}.`,
				);
			}
		}
	}
	return normalizeJson({
		packageManifest: publishedFields,
		internalDependencies,
	});
}

function safeTarballFilename(name, version) {
	const safeName = name.replace(/^@/, "").replaceAll("/", "-");
	if (!/^[-a-z0-9._]+$/i.test(safeName) || !semver.valid(version)) {
		throw new PublicationError(
			"UNSAFE_TARBALL_FILENAME",
			"Package name or version cannot form a safe tarball filename.",
		);
	}
	return `${safeName}-${version}.tgz`;
}

async function hashTarball(path) {
	const bytes = await readBoundedFile(
		path,
		MAX_TARBALL_BYTES,
		"INVALID_TARBALL_FILE",
	);
	return {
		sha256: createHash("sha256").update(bytes).digest("hex"),
		integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
	};
}

function parsePackResult(stdout) {
	if (Buffer.byteLength(stdout) > MAX_PACK_OUTPUT_BYTES) {
		throw new PublicationError(
			"PACK_OUTPUT_TOO_LARGE",
			"pnpm pack output exceeds the allowed size.",
		);
	}
	const start = stdout.indexOf("{");
	if (start < 0) {
		throw new PublicationError(
			"INVALID_PACK_OUTPUT",
			"pnpm pack did not return a JSON result.",
		);
	}
	try {
		return JSON.parse(stdout.slice(start));
	} catch {
		throw new PublicationError(
			"INVALID_PACK_OUTPUT",
			"pnpm pack returned invalid JSON.",
		);
	}
}

async function defaultCaptureCommand(command, argumentsList, options) {
	return execFileAsync(command, argumentsList, {
		cwd: options.cwd,
		encoding: "utf8",
		maxBuffer: MAX_PACK_OUTPUT_BYTES,
		env: options.env,
	});
}

async function verifyPnpmToolchain({
	root,
	runCommand = defaultCaptureCommand,
}) {
	const rootManifest = await readJson(
		join(root, "package.json"),
		"INVALID_ROOT_MANIFEST",
	);
	const match = rootManifest.packageManager?.match(/^pnpm@(\d+\.\d+\.\d+)$/);
	if (!match) {
		throw new PublicationError(
			"UNPINNED_PNPM_TOOLCHAIN",
			"Root packageManager must pin an exact pnpm version.",
		);
	}
	const { stdout } = await runCommand("pnpm", ["--version"], { cwd: root });
	if (stdout.trim() !== match[1]) {
		throw new PublicationError(
			"PNPM_TOOLCHAIN_MISMATCH",
			`Artifact preparation requires pnpm ${match[1]}.`,
		);
	}
	return match[1];
}

function controlledArtifactPath(root, artifactDirectory) {
	const target = resolve(artifactDirectory);
	const relativePath = relative(root, target).split(sep).join("/");
	if (
		!relativePath.startsWith(ARTIFACT_DIRECTORY_PREFIX) ||
		relativePath.includes("..")
	) {
		throw new PublicationError(
			"UNSAFE_ARTIFACT_DIRECTORY",
			`Publication artifacts must use ${ARTIFACT_DIRECTORY_PREFIX}*.`,
		);
	}
	return target;
}

async function atomicWrite(path, contents) {
	const temporaryPath = `${path}.tmp`;
	await writeFile(temporaryPath, contents, { flag: "wx" });
	await rename(temporaryPath, path);
}

export async function preparePublicationArtifacts({
	root = repositoryRoot,
	artifactDirectory = join(root, ARTIFACT_DIRECTORY_PREFIX),
	expectedSha,
	expectedVersion,
	channel,
	runCommand = defaultCaptureCommand,
	resolveHeadSha = async () =>
		(
			await execFileAsync("git", ["rev-parse", "HEAD"], {
				cwd: root,
				encoding: "utf8",
			})
		).stdout.trim(),
	resolveTrackedStatus = async () =>
		(
			await execFileAsync(
				"git",
				["status", "--porcelain=v1", "--untracked-files=all"],
				{ cwd: root, encoding: "utf8" },
			)
		).stdout,
} = {}) {
	if (!/^[0-9a-f]{40}$/.test(expectedSha ?? "")) {
		throw new PublicationError(
			"INVALID_EXPECTED_SHA",
			"Artifact preparation requires a full lowercase commit SHA.",
		);
	}
	if ((await resolveHeadSha()) !== expectedSha) {
		throw new PublicationError(
			"ARTIFACT_HEAD_SHA_MISMATCH",
			"Artifact preparation checkout does not match expected_sha.",
		);
	}
	let trackedStatus;
	try {
		trackedStatus = await resolveTrackedStatus();
	} catch {
		throw new PublicationError(
			"WORKTREE_STATUS_UNAVAILABLE",
			"Artifact preparation could not prove that the checkout is clean.",
		);
	}
	if (trackedStatus.trim().length > 0) {
		throw new PublicationError(
			"PUBLICATION_WORKTREE_DIRTY",
			"Artifact preparation requires a clean tracked and non-ignored worktree after readiness checks.",
		);
	}
	const controlledDirectory = controlledArtifactPath(root, artifactDirectory);
	await rejectSymlinkSegments(
		root,
		controlledDirectory,
		"UNSAFE_ARTIFACT_DIRECTORY",
	);
	const { facts, orderedPackages } = await loadCandidate({
		root,
		expectedVersion,
		channel,
	});
	const pnpmVersion = await verifyPnpmToolchain({ root, runCommand });
	await rm(controlledDirectory, { recursive: true, force: true });
	const stagingDirectory = join(controlledDirectory, "staging");
	const tarballDirectory = join(controlledDirectory, "tarballs");
	await Promise.all([
		mkdir(stagingDirectory, { recursive: true }),
		mkdir(tarballDirectory, { recursive: true }),
	]);
	const publicNames = new Set(
		orderedPackages.map(({ manifest }) => manifest.name),
	);
	const packages = [];
	try {
		for (const { directory, manifest: sourceManifest } of orderedPackages) {
			const packageDirectory = join(root, directory);
			const { stdout } = await runCommand(
				"pnpm",
				["pack", "--json", "--pack-destination", stagingDirectory],
				{ cwd: packageDirectory },
			);
			const packResult = parsePackResult(stdout);
			if (
				packResult.name !== sourceManifest.name ||
				packResult.version !== expectedVersion ||
				typeof packResult.filename !== "string"
			) {
				throw new PublicationError(
					"PACK_RESULT_MISMATCH",
					`pnpm pack returned unexpected facts for ${sourceManifest.name}.`,
				);
			}
			const sourceTarball = resolve(packResult.filename);
			if (
				!isInside(stagingDirectory, sourceTarball) ||
				(await lstat(sourceTarball)).isSymbolicLink()
			) {
				throw new PublicationError(
					"UNSAFE_PACK_RESULT_PATH",
					"pnpm pack returned a tarball outside the controlled staging directory.",
				);
			}
			const filename = safeTarballFilename(
				sourceManifest.name,
				expectedVersion,
			);
			const relativeTarball = `tarballs/${filename}`;
			const finalTarball = join(controlledDirectory, relativeTarball);
			await rename(sourceTarball, finalTarball);
			const inspection = await inspectTarball(finalTarball);
			const validated = validatePackedManifest({
				sourceManifest,
				packedManifest: inspection.manifest,
				expectedVersion,
				publicNames,
			});
			const hashes = await hashTarball(finalTarball);
			packages.push({
				name: sourceManifest.name,
				version: expectedVersion,
				sourceDirectory: directory,
				tarball: relativeTarball,
				size: inspection.size,
				sha256: hashes.sha256,
				integrity: hashes.integrity,
				...validated,
			});
		}
		await rm(stagingDirectory, { recursive: true, force: true });
		const manifest = normalizeJson({
			schemaVersion: PUBLICATION_SCHEMA_VERSION,
			repository: EXPECTED_REPOSITORY,
			commitSha: expectedSha,
			version: expectedVersion,
			channel,
			distTag: facts.distTag,
			prerelease: facts.prerelease,
			packageCount: packages.length,
			pnpmVersion,
			packages,
		});
		const manifestPath = join(controlledDirectory, MANIFEST_FILENAME);
		const checksumContents = `${packages
			.map(({ sha256, tarball }) => `${sha256}  ${tarball}`)
			.join("\n")}\n`;
		await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
		await atomicWrite(
			join(controlledDirectory, CHECKSUM_FILENAME),
			checksumContents,
		);
		const verified = await verifyPublicationArtifacts({
			root,
			manifestPath,
			expectedSha,
			expectedVersion,
			channel,
		});
		return {
			success: true,
			manifestPath,
			checksumPath: join(controlledDirectory, CHECKSUM_FILENAME),
			packageCount: verified.packageCount,
			version: verified.version,
			channel: verified.channel,
			commitSha: verified.commitSha,
		};
	} catch (error) {
		await rm(controlledDirectory, { recursive: true, force: true });
		throw error;
	}
}

function validatePublicationManifestEnvelope(
	manifest,
	{ expectedSha, expectedVersion, channel },
) {
	const expectedKeys = [
		"channel",
		"commitSha",
		"distTag",
		"packageCount",
		"packages",
		"pnpmVersion",
		"prerelease",
		"repository",
		"schemaVersion",
		"version",
	];
	if (
		!manifest ||
		typeof manifest !== "object" ||
		Array.isArray(manifest) ||
		manifest.schemaVersion !== PUBLICATION_SCHEMA_VERSION ||
		JSON.stringify(Object.keys(manifest).sort(compareText)) !==
			JSON.stringify(expectedKeys)
	) {
		throw new PublicationError(
			"UNSUPPORTED_PUBLICATION_MANIFEST",
			`Publication manifest must exactly match schemaVersion ${PUBLICATION_SCHEMA_VERSION}.`,
		);
	}
	if (manifest.repository !== EXPECTED_REPOSITORY) {
		throw new PublicationError(
			"PUBLICATION_REPOSITORY_MISMATCH",
			"Publication manifest repository is not the canonical repository.",
		);
	}
	if (
		!ALLOWED_CHANNELS.has(manifest.channel) ||
		manifest.distTag !== manifest.channel ||
		!semver.valid(manifest.version) ||
		typeof manifest.prerelease !== "boolean" ||
		!semver.valid(manifest.pnpmVersion) ||
		!/^[0-9a-f]{40}$/.test(manifest.commitSha ?? "")
	) {
		throw new PublicationError(
			"PUBLICATION_CHANNEL_MISMATCH",
			"Publication manifest facts are malformed or inconsistent.",
		);
	}
	if (expectedSha && manifest.commitSha !== expectedSha) {
		throw new PublicationError(
			"PUBLICATION_COMMIT_MISMATCH",
			"Publication manifest commitSha does not match expected_sha.",
		);
	}
	if (expectedVersion && manifest.version !== expectedVersion) {
		throw new PublicationError(
			"PUBLICATION_VERSION_MISMATCH",
			"Publication manifest version does not match expected_version.",
		);
	}
	if (channel && manifest.channel !== channel) {
		throw new PublicationError(
			"PUBLICATION_CHANNEL_MISMATCH",
			"Publication manifest channel does not match the Workflow input.",
		);
	}
	if (
		!Array.isArray(manifest.packages) ||
		!Number.isInteger(manifest.packageCount) ||
		manifest.packageCount < 1 ||
		manifest.packageCount !== manifest.packages.length
	) {
		throw new PublicationError(
			"INVALID_PUBLICATION_PACKAGE_LIST",
			"Publication manifest packageCount must match its package list.",
		);
	}
}

async function collectArtifactFiles(
	directory,
	root = directory,
	files = [],
	depth = 0,
) {
	if (depth > MAX_ARTIFACT_DEPTH) {
		throw new PublicationError(
			"ARTIFACT_DEPTH_LIMIT",
			"Publication artifact directory nesting exceeds its limit.",
		);
	}
	for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
		(left, right) => compareText(left.name, right.name),
	)) {
		const path = join(directory, entry.name);
		if (entry.isSymbolicLink()) {
			throw new PublicationError(
				"ARTIFACT_SYMLINK",
				"Publication artifact must not contain symlinks.",
			);
		}
		if (entry.isDirectory()) {
			await collectArtifactFiles(path, root, files, depth + 1);
		} else if (entry.isFile()) {
			files.push(relative(root, path).split(sep).join("/"));
			if (files.length > MAX_ARTIFACT_FILES) {
				throw new PublicationError(
					"ARTIFACT_FILE_LIMIT",
					"Publication artifact contains too many files.",
				);
			}
		} else {
			throw new PublicationError(
				"ARTIFACT_SPECIAL_FILE",
				"Publication artifact must contain only regular files and directories.",
			);
		}
	}
	return files;
}

export async function verifyPublicationArtifacts({
	root = repositoryRoot,
	manifestPath,
	expectedSha,
	expectedVersion,
	channel,
} = {}) {
	if (!manifestPath) {
		throw new PublicationError(
			"MISSING_PUBLICATION_MANIFEST",
			"A publication manifest path is required.",
		);
	}
	const artifactDirectory = controlledArtifactPath(root, dirname(manifestPath));
	const resolvedManifestPath = resolve(manifestPath);
	if (resolvedManifestPath !== join(artifactDirectory, MANIFEST_FILENAME)) {
		throw new PublicationError(
			"UNSAFE_PUBLICATION_MANIFEST_PATH",
			`Publication manifest must be named ${MANIFEST_FILENAME}.`,
		);
	}
	await rejectSymlinkSegments(
		root,
		resolvedManifestPath,
		"UNSAFE_PUBLICATION_MANIFEST_PATH",
	);
	const manifest = await readJson(
		resolvedManifestPath,
		"INVALID_PUBLICATION_MANIFEST",
	);
	validatePublicationManifestEnvelope(manifest, {
		expectedSha,
		expectedVersion,
		channel,
	});
	const candidate = await loadCandidate({
		root,
		expectedVersion: manifest.version,
		channel: manifest.channel,
	});
	const rootManifest = await readJson(
		join(root, "package.json"),
		"INVALID_ROOT_MANIFEST",
	);
	if (
		manifest.prerelease !== candidate.facts.prerelease ||
		manifest.distTag !== candidate.facts.distTag ||
		rootManifest.packageManager !== `pnpm@${manifest.pnpmVersion}`
	) {
		throw new PublicationError(
			"PUBLICATION_FACT_MISMATCH",
			"Publication manifest prerelease, dist-tag, or pnpm facts do not match the checkout.",
		);
	}
	const expectedOrder = candidate.orderedPackages.map(
		({ manifest: sourceManifest }) => sourceManifest.name,
	);
	const actualNames = manifest.packages.map(({ name }) => name);
	if (
		new Set(actualNames).size !== actualNames.length ||
		JSON.stringify(actualNames) !== JSON.stringify(expectedOrder)
	) {
		throw new PublicationError(
			"PUBLICATION_PACKAGE_SET_MISMATCH",
			"Publication manifest packages must exactly match deterministic fixed-group order.",
		);
	}
	const tarballPaths = manifest.packages.map(({ tarball }) => tarball);
	if (new Set(tarballPaths).size !== tarballPaths.length) {
		throw new PublicationError(
			"DUPLICATE_PUBLICATION_TARBALL",
			"Publication manifest tarball paths must be unique.",
		);
	}
	const publicNames = new Set(expectedOrder);
	const verifiedPackages = [];
	const expectedPackageKeys = [
		"integrity",
		"internalDependencies",
		"name",
		"packageManifest",
		"sha256",
		"size",
		"sourceDirectory",
		"tarball",
		"version",
	];
	for (const packageRecord of manifest.packages) {
		if (
			!packageRecord ||
			typeof packageRecord !== "object" ||
			Array.isArray(packageRecord) ||
			JSON.stringify(Object.keys(packageRecord).sort(compareText)) !==
				JSON.stringify(expectedPackageKeys)
		) {
			throw new PublicationError(
				"INVALID_PUBLICATION_PACKAGE_RECORD",
				"Publication package records must exactly match the supported schema.",
			);
		}
		const sourceRecord = candidate.packageMap.get(packageRecord.name);
		const expectedTarball = `tarballs/${safeTarballFilename(
			packageRecord.name,
			manifest.version,
		)}`;
		if (
			packageRecord.version !== manifest.version ||
			packageRecord.sourceDirectory !== sourceRecord.directory ||
			packageRecord.tarball !== expectedTarball ||
			!Number.isSafeInteger(packageRecord.size) ||
			packageRecord.size < 1 ||
			packageRecord.size > MAX_TARBALL_BYTES ||
			!/^[0-9a-f]{64}$/.test(packageRecord.sha256 ?? "") ||
			!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(packageRecord.integrity ?? "")
		) {
			throw new PublicationError(
				"INVALID_PUBLICATION_PACKAGE_RECORD",
				`${packageRecord.name} publication manifest record is inconsistent.`,
			);
		}
		const tarballPath = resolve(artifactDirectory, packageRecord.tarball);
		if (!isInside(artifactDirectory, tarballPath)) {
			throw new PublicationError(
				"PUBLICATION_TARBALL_PATH_ESCAPE",
				"Publication tarball path escapes its artifact directory.",
			);
		}
		await rejectSymlinkSegments(
			artifactDirectory,
			tarballPath,
			"UNSAFE_PUBLICATION_TARBALL_PATH",
		);
		const hashes = await hashTarball(tarballPath);
		if (
			hashes.sha256 !== packageRecord.sha256 ||
			hashes.integrity !== packageRecord.integrity
		) {
			throw new PublicationError(
				"PUBLICATION_TARBALL_INTEGRITY_MISMATCH",
				`${packageRecord.name} tarball bytes do not match the publication manifest.`,
			);
		}
		const inspection = await inspectTarball(tarballPath);
		const validated = validatePackedManifest({
			sourceManifest: sourceRecord.manifest,
			packedManifest: inspection.manifest,
			expectedVersion: manifest.version,
			publicNames,
		});
		if (
			inspection.size !== packageRecord.size ||
			JSON.stringify(validated.packageManifest) !==
				JSON.stringify(packageRecord.packageManifest) ||
			JSON.stringify(validated.internalDependencies) !==
				JSON.stringify(packageRecord.internalDependencies)
		) {
			throw new PublicationError(
				"PUBLICATION_TARBALL_MANIFEST_MISMATCH",
				`${packageRecord.name} tarball manifest does not match recorded facts.`,
			);
		}
		verifiedPackages.push({
			...packageRecord,
			archive: tarballPath,
			filename: packageRecord.tarball.split("/").at(-1),
			files: inspection.files,
		});
	}
	const expectedChecksum = `${manifest.packages
		.map(({ sha256, tarball }) => `${sha256}  ${tarball}`)
		.join("\n")}\n`;
	const checksum = (
		await readBoundedFile(
			join(artifactDirectory, CHECKSUM_FILENAME),
			MAX_ARTIFACT_MANIFEST_BYTES,
			"INVALID_PUBLICATION_CHECKSUM_FILE",
		)
	).toString("utf8");
	if (checksum !== expectedChecksum) {
		throw new PublicationError(
			"PUBLICATION_CHECKSUM_FILE_MISMATCH",
			"SHA256SUMS does not exactly match the publication manifest.",
		);
	}
	const artifactFiles = await collectArtifactFiles(artifactDirectory);
	const expectedFiles = [
		MANIFEST_FILENAME,
		CHECKSUM_FILENAME,
		...manifest.packages.map(({ tarball }) => tarball),
	].sort(compareText);
	if (
		JSON.stringify(artifactFiles.sort(compareText)) !==
		JSON.stringify(expectedFiles)
	) {
		throw new PublicationError(
			"PUBLICATION_ARTIFACT_FILE_SET_MISMATCH",
			"Publication artifact contains missing or unexpected files.",
		);
	}
	return {
		...manifest,
		success: true,
		manifestPath: resolvedManifestPath,
		artifactDirectory,
		packages: verifiedPackages,
	};
}

async function readRegistryMetadata(response, packageName, version) {
	const declaredLength = Number(response.headers?.get?.("content-length"));
	if (
		Number.isFinite(declaredLength) &&
		declaredLength > MAX_REGISTRY_RESPONSE_BYTES
	) {
		throw new PublicationError(
			"REGISTRY_RESPONSE_TOO_LARGE",
			`${packageName}@${version} registry metadata exceeds the response limit.`,
		);
	}
	const chunks = [];
	let totalBytes = 0;
	if (typeof response.body?.getReader === "function") {
		const reader = response.body.getReader();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				totalBytes += value.byteLength;
				if (totalBytes > MAX_REGISTRY_RESPONSE_BYTES) {
					await reader.cancel();
					throw new PublicationError(
						"REGISTRY_RESPONSE_TOO_LARGE",
						`${packageName}@${version} registry metadata exceeds the response limit.`,
					);
				}
				chunks.push(value);
			}
		} finally {
			reader.releaseLock();
		}
	} else {
		const bytes = new Uint8Array(await response.arrayBuffer());
		totalBytes = bytes.byteLength;
		if (totalBytes > MAX_REGISTRY_RESPONSE_BYTES) {
			throw new PublicationError(
				"REGISTRY_RESPONSE_TOO_LARGE",
				`${packageName}@${version} registry metadata exceeds the response limit.`,
			);
		}
		chunks.push(bytes);
	}
	const bytes = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw new PublicationError(
			"INVALID_REGISTRY_RESPONSE",
			`${packageName}@${version} registry metadata is not valid JSON.`,
		);
	}
}

async function queryOnePackage({
	packageRecord,
	version,
	channel,
	registryUrl,
	fetchImpl,
	requestTimeoutMs,
}) {
	try {
		const url = new URL(encodeURIComponent(packageRecord.name), registryUrl);
		const response = await fetchImpl(url, {
			headers: { accept: "application/json" },
			redirect: "error",
			signal: AbortSignal.timeout(requestTimeoutMs),
		});
		if (response.status === 404) {
			return {
				name: packageRecord.name,
				version,
				channel,
				status: "MISSING",
				registryIntegrity: null,
				distTagVersion: null,
			};
		}
		if (!response.ok) {
			return {
				name: packageRecord.name,
				version,
				channel,
				status: "REGISTRY_UNAVAILABLE",
				registryIntegrity: null,
				distTagVersion: null,
				error: `Registry returned HTTP ${response.status}.`,
			};
		}
		const metadata = await readRegistryMetadata(
			response,
			packageRecord.name,
			version,
		);
		const versionMetadata = metadata.versions?.[version];
		if (!versionMetadata) {
			return {
				name: packageRecord.name,
				version,
				channel,
				status: "MISSING",
				registryIntegrity: null,
				distTagVersion: metadata["dist-tags"]?.[channel] ?? null,
			};
		}
		const registryIntegrity = versionMetadata.dist?.integrity;
		const distTagVersion = metadata["dist-tags"]?.[channel] ?? null;
		if (typeof registryIntegrity !== "string") {
			return {
				name: packageRecord.name,
				version,
				channel,
				status: "REGISTRY_UNAVAILABLE",
				registryIntegrity: null,
				distTagVersion,
				error: "Registry version metadata is missing dist.integrity.",
			};
		}
		if (registryIntegrity !== packageRecord.integrity) {
			return {
				name: packageRecord.name,
				version,
				channel,
				status: "PUBLISHED_BYTES_MISMATCH",
				registryIntegrity,
				distTagVersion,
			};
		}
		if (distTagVersion !== version) {
			return {
				name: packageRecord.name,
				version,
				channel,
				status: "DIST_TAG_MISMATCH",
				registryIntegrity,
				distTagVersion,
			};
		}
		return {
			name: packageRecord.name,
			version,
			channel,
			status: "ALREADY_PUBLISHED_VERIFIED",
			registryIntegrity,
			distTagVersion,
		};
	} catch (error) {
		return {
			name: packageRecord.name,
			version,
			channel,
			status: "REGISTRY_UNAVAILABLE",
			registryIntegrity: null,
			distTagVersion: null,
			error:
				error instanceof PublicationError
					? error.message
					: `${packageRecord.name}@${version} registry query failed.`,
		};
	}
}

function validateRegistryBudgets({ attempts, delayMs, requestTimeoutMs }) {
	if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_ATTEMPTS) {
		throw new PublicationError(
			"INVALID_ATTEMPTS",
			`Registry attempts must be an integer from 1 to ${MAX_ATTEMPTS}.`,
		);
	}
	if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > MAX_DELAY_MS) {
		throw new PublicationError(
			"INVALID_RETRY_DELAY",
			`Registry retry delay must be an integer from 0 to ${MAX_DELAY_MS} milliseconds.`,
		);
	}
	if (
		!Number.isInteger(requestTimeoutMs) ||
		requestTimeoutMs < 1 ||
		requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS
	) {
		throw new PublicationError(
			"INVALID_REQUEST_TIMEOUT",
			`Registry request timeout must be an integer from 1 to ${MAX_REQUEST_TIMEOUT_MS} milliseconds.`,
		);
	}
	const totalBudgetMs = attempts * requestTimeoutMs + (attempts - 1) * delayMs;
	if (totalBudgetMs > MAX_TOTAL_VERIFY_MS) {
		throw new PublicationError(
			"INVALID_VERIFICATION_BUDGET",
			`Registry verification budget must not exceed ${MAX_TOTAL_VERIFY_MS} milliseconds.`,
		);
	}
	return totalBudgetMs;
}

function registryState(packages) {
	if (packages.some(({ status }) => status === "PUBLISHED_BYTES_MISMATCH"))
		return "PUBLISHED_BYTES_MISMATCH";
	if (packages.some(({ status }) => status === "DIST_TAG_MISMATCH"))
		return "DIST_TAG_MISMATCH";
	if (packages.some(({ status }) => status === "REGISTRY_UNAVAILABLE"))
		return "REGISTRY_UNAVAILABLE";
	const verified = packages.filter(
		({ status }) =>
			status === "ALREADY_PUBLISHED_VERIFIED" || status === "VERIFIED",
	).length;
	const missing = packages.filter(({ status }) => status === "MISSING").length;
	if (verified === packages.length) return "VERIFIED";
	if (missing === packages.length) return "NOTHING_PUBLISHED";
	if (verified > 0 && missing > 0) return "PARTIAL_PUBLICATION";
	return "REGISTRY_UNAVAILABLE";
}

async function queryRegistry({
	manifest,
	registryUrl,
	attempts,
	delayMs,
	requestTimeoutMs,
	fetchImpl,
	sleepImpl,
	onAttempt,
}) {
	const totalBudgetMs = validateRegistryBudgets({
		attempts,
		delayMs,
		requestTimeoutMs,
	});
	if (typeof fetchImpl !== "function") {
		throw new PublicationError(
			"MISSING_REGISTRY_CLIENT",
			"A registry client is required.",
		);
	}
	let packages = [];
	let attemptsUsed = 0;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		attemptsUsed = attempt;
		packages = await Promise.all(
			manifest.packages.map((packageRecord) =>
				queryOnePackage({
					packageRecord,
					version: manifest.version,
					channel: manifest.channel,
					registryUrl,
					fetchImpl,
					requestTimeoutMs,
				}),
			),
		);
		const terminal = packages.filter(({ status }) =>
			[
				"ALREADY_PUBLISHED_VERIFIED",
				"PUBLISHED_BYTES_MISMATCH",
				"DIST_TAG_MISMATCH",
			].includes(status),
		).length;
		onAttempt({
			attempt,
			attempts,
			terminal,
			total: packages.length,
		});
		if (
			packages.every(
				({ status }) =>
					status !== "REGISTRY_UNAVAILABLE" && status !== "MISSING",
			)
		) {
			break;
		}
		if (attempt < attempts) await sleepImpl(delayMs);
	}
	return { packages, attemptsUsed, totalBudgetMs };
}

export async function createPublicationPlan({
	manifest,
	registryUrl = EXPECTED_REGISTRY,
	attempts = 1,
	delayMs = 0,
	requestTimeoutMs = 10_000,
	fetchImpl = globalThis.fetch,
	sleepImpl = (milliseconds) =>
		new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
	onAttempt = () => {},
} = {}) {
	if (!manifest?.success || !Array.isArray(manifest.packages)) {
		throw new PublicationError(
			"INVALID_PUBLICATION_MANIFEST",
			"Verified publication artifacts are required for a publication plan.",
		);
	}
	const query = await queryRegistry({
		manifest,
		registryUrl,
		attempts,
		delayMs,
		requestTimeoutMs,
		fetchImpl,
		sleepImpl,
		onAttempt,
	});
	const safe = query.packages.every(({ status }) =>
		["MISSING", "ALREADY_PUBLISHED_VERIFIED"].includes(status),
	);
	return {
		success: safe,
		version: manifest.version,
		channel: manifest.channel,
		distTag: manifest.distTag,
		state: registryState(query.packages),
		attempts: query.attemptsUsed,
		requestTimeoutMs,
		totalBudgetMs: query.totalBudgetMs,
		publish: query.packages
			.filter(({ status }) => status === "MISSING")
			.map(({ name }) => name),
		skip: query.packages
			.filter(({ status }) => status === "ALREADY_PUBLISHED_VERIFIED")
			.map(({ name }) => name),
		packages: query.packages,
	};
}

export async function verifyRegistry({
	manifest,
	registryUrl = EXPECTED_REGISTRY,
	attempts = 6,
	delayMs = 10_000,
	requestTimeoutMs = 10_000,
	fetchImpl = globalThis.fetch,
	sleepImpl = (milliseconds) =>
		new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
	onAttempt = () => {},
} = {}) {
	const plan = await createPublicationPlan({
		manifest,
		registryUrl,
		attempts,
		delayMs,
		requestTimeoutMs,
		fetchImpl,
		sleepImpl,
		onAttempt,
	});
	const packages = plan.packages.map((record) => ({
		...record,
		status:
			record.status === "ALREADY_PUBLISHED_VERIFIED"
				? "VERIFIED"
				: record.status,
	}));
	const success = packages.every(({ status }) => status === "VERIFIED");
	return {
		...plan,
		success,
		state: registryState(packages),
		verifiedPackages: packages.filter(({ status }) => status === "VERIFIED")
			.length,
		expectedPackages: packages.length,
		packages,
		recovery: success
			? null
			: {
					state: registryState(packages),
					action:
						"Do not change versions or dist-tags; rerun only the same authorized SHA/version/channel and verified tarball manifest.",
				},
	};
}

async function defaultNpmPublishRunner({
	command,
	arguments: argumentsList,
	cwd,
	env,
}) {
	await new Promise((resolveRun, rejectRun) => {
		const child = spawn(command, argumentsList, {
			cwd,
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let outputBytes = 0;
		for (const stream of [child.stdout, child.stderr]) {
			stream.on("data", (chunk) => {
				outputBytes += chunk.byteLength;
				if (outputBytes <= MAX_PACK_OUTPUT_BYTES) process.stderr.write(chunk);
			});
		}
		child.once("error", rejectRun);
		child.once("exit", (code, signal) => {
			if (code === 0) {
				resolveRun();
				return;
			}
			rejectRun(
				new PublicationError(
					"NPM_PUBLISH_FAILED",
					`npm publish failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`,
				),
			);
		});
	});
}

export async function publishVerifiedArtifacts({
	root = repositoryRoot,
	manifest,
	npmVersion,
	readNpmVersion = async () =>
		(
			await execFileAsync("npm", ["--version"], {
				cwd: root,
				encoding: "utf8",
			})
		).stdout.trim(),
	runNpmPublish = defaultNpmPublishRunner,
	fetchImpl = globalThis.fetch,
	requestTimeoutMs = 10_000,
} = {}) {
	if (!manifest?.success || !Array.isArray(manifest.packages)) {
		throw new PublicationError(
			"INVALID_PUBLICATION_MANIFEST",
			"Verified publication artifacts are required for npm publication.",
		);
	}
	if (!semver.valid(npmVersion) || npmVersion !== (await readNpmVersion())) {
		throw new PublicationError(
			"NPM_TOOLCHAIN_MISMATCH",
			`Publication requires the exact configured npm CLI ${npmVersion ?? "<missing>"}.`,
		);
	}
	const plan = await createPublicationPlan({
		manifest,
		attempts: 1,
		delayMs: 0,
		requestTimeoutMs,
		fetchImpl,
	});
	if (!plan.success) {
		throw new PublicationError(
			"UNSAFE_PUBLICATION_PLAN",
			`Publication plan stopped in ${plan.state} state.`,
			{ plan },
		);
	}
	const byName = new Map(
		manifest.packages.map((packageRecord) => [
			packageRecord.name,
			packageRecord,
		]),
	);
	const published = [];
	const skipped = [...plan.skip];
	const childEnvironment = { ...process.env };
	delete childEnvironment.NPM_TOKEN;
	delete childEnvironment.NODE_AUTH_TOKEN;
	for (const name of plan.publish) {
		const packageRecord = byName.get(name);
		const currentHashes = await hashTarball(packageRecord.archive);
		if (
			currentHashes.sha256 !== packageRecord.sha256 ||
			currentHashes.integrity !== packageRecord.integrity
		) {
			throw new PublicationError(
				"PUBLICATION_TARBALL_CHANGED",
				`${name} tarball bytes changed after artifact verification.`,
				{
					published,
					skipped,
					pending: plan.publish.filter(
						(candidateName) => !published.includes(candidateName),
					),
				},
			);
		}
		try {
			await runNpmPublish({
				command: "npm",
				arguments: [
					"publish",
					packageRecord.archive,
					"--tag",
					manifest.distTag,
					"--access",
					"public",
				],
				cwd: root,
				env: childEnvironment,
			});
			published.push(name);
		} catch (error) {
			const recovery = await createPublicationPlan({
				manifest,
				attempts: 1,
				delayMs: 0,
				requestTimeoutMs,
				fetchImpl,
			});
			throw new PublicationError(
				"PUBLICATION_FAILED",
				`npm publication stopped after ${published.length} successful package(s).`,
				{
					recovery: {
						state: "PUBLICATION_FAILED",
						registryState: recovery.state,
						published,
						skipped,
						packages: recovery.packages,
					},
					causeCode: error?.code ?? "NPM_PUBLISH_FAILED",
				},
			);
		}
	}
	return {
		success: true,
		version: manifest.version,
		channel: manifest.channel,
		distTag: manifest.distTag,
		published,
		skipped,
	};
}

export async function readReleaseNotes({
	root = repositoryRoot,
	version,
	outputPath,
} = {}) {
	if (!semver.valid(version)) {
		throw new PublicationError(
			"INVALID_EXPECTED_VERSION",
			`Expected version ${version ?? "<missing>"} must be valid SemVer.`,
		);
	}
	const changelog = (
		await readBoundedFile(
			join(root, "packages/openapi/CHANGELOG.md"),
			4 * 1024 * 1024,
			"INVALID_CHANGELOG",
		)
	).toString("utf8");
	const normalized = changelog.replaceAll("\r\n", "\n");
	const heading = `## ${version}`;
	const lines = normalized.split("\n");
	const start = lines.findIndex((line) => line.trim() === heading);
	if (start < 0) {
		throw new PublicationError(
			"MISSING_RELEASE_NOTES",
			`openapi-to changelog has no section for ${version}.`,
		);
	}
	const end = lines.findIndex(
		(line, index) => index > start && /^##\s+/.test(line),
	);
	const notes = lines
		.slice(start, end < 0 ? undefined : end)
		.join("\n")
		.trim();
	if (outputPath) {
		const resolvedOutput = resolve(outputPath);
		if (!isInside(root, resolvedOutput)) {
			throw new PublicationError(
				"UNSAFE_RELEASE_NOTES_PATH",
				"Release notes output must remain inside the repository checkout.",
			);
		}
		await writeFile(resolvedOutput, `${notes}\n`, { flag: "wx" });
	}
	return notes;
}

function parseInteger(value, name) {
	if (!/^\d+$/.test(value ?? "")) {
		throw new PublicationError(
			"INVALID_ARGUMENT",
			`${name} must be a non-negative integer.`,
		);
	}
	return Number(value);
}

function parseArguments(argv) {
	const [command, ...argumentsList] = argv;
	const commands = [
		"preflight",
		"prepare-artifacts",
		"verify-artifacts",
		"publication-plan",
		"publish-artifacts",
		"verify-registry",
		"release-notes",
	];
	if (!commands.includes(command)) {
		throw new PublicationError(
			"INVALID_COMMAND",
			`Command must be one of: ${commands.join(", ")}.`,
		);
	}
	const options = {
		command,
		root: repositoryRoot,
		attempts: 6,
		delayMs: 10_000,
		requestTimeoutMs: 10_000,
	};
	for (let index = 0; index < argumentsList.length; index += 1) {
		const argument = argumentsList[index];
		const value = argumentsList[index + 1];
		if (argument === "--root" && value) options.root = resolve(value);
		else if (argument === "--expected-version" && value)
			options.expectedVersion = value;
		else if (argument === "--channel" && value) options.channel = value;
		else if (argument === "--expected-sha" && value)
			options.expectedSha = value;
		else if (argument === "--npm-version" && value) options.npmVersion = value;
		else if (argument === "--artifact-dir" && value)
			options.artifactDirectory = resolve(value);
		else if (argument === "--manifest" && value)
			options.manifestPath = resolve(value);
		else if (argument === "--output" && value)
			options.outputPath = resolve(value);
		else if (argument === "--attempts" && value)
			options.attempts = parseInteger(value, "--attempts");
		else if (argument === "--delay-ms" && value)
			options.delayMs = parseInteger(value, "--delay-ms");
		else if (argument === "--timeout-ms" && value)
			options.requestTimeoutMs = parseInteger(value, "--timeout-ms");
		else {
			throw new PublicationError(
				"INVALID_ARGUMENT",
				`Unknown or incomplete argument: ${argument}`,
			);
		}
		index += 1;
	}
	return options;
}

function writeResult(result) {
	process.stdout.write(`${JSON.stringify(result)}\n`);
}

export async function main(argv = process.argv.slice(2)) {
	try {
		const options = parseArguments(argv);
		if (options.command === "preflight") {
			writeResult(
				await createPublicationFacts({
					root: options.root,
					expectedVersion: options.expectedVersion,
					channel: options.channel,
				}),
			);
			return;
		}
		if (options.command === "prepare-artifacts") {
			writeResult(
				await preparePublicationArtifacts({
					root: options.root,
					artifactDirectory: options.artifactDirectory,
					expectedSha: options.expectedSha,
					expectedVersion: options.expectedVersion,
					channel: options.channel,
				}),
			);
			return;
		}
		if (options.command === "release-notes") {
			const notes = await readReleaseNotes({
				root: options.root,
				version: options.expectedVersion,
				outputPath: options.outputPath,
			});
			writeResult({
				success: true,
				version: options.expectedVersion,
				output: options.outputPath,
				notes,
			});
			return;
		}
		const manifest = await verifyPublicationArtifacts({
			root: options.root,
			manifestPath: options.manifestPath,
			expectedSha: options.expectedSha,
			expectedVersion: options.expectedVersion,
			channel: options.channel,
		});
		if (options.command === "verify-artifacts") {
			writeResult({
				success: true,
				schemaVersion: manifest.schemaVersion,
				commitSha: manifest.commitSha,
				version: manifest.version,
				channel: manifest.channel,
				packageCount: manifest.packageCount,
			});
			return;
		}
		if (options.command === "publication-plan") {
			const result = await createPublicationPlan({
				manifest,
				attempts: options.attempts,
				delayMs: options.delayMs,
				requestTimeoutMs: options.requestTimeoutMs,
				onAttempt: ({ attempt, attempts, terminal, total }) => {
					process.stderr.write(
						`Registry plan attempt ${attempt}/${attempts}: ${terminal}/${total} terminal facts.\n`,
					);
				},
			});
			writeResult(result);
			if (!result.success) process.exitCode = 1;
			return;
		}
		if (options.command === "publish-artifacts") {
			writeResult(
				await publishVerifiedArtifacts({
					root: options.root,
					manifest,
					npmVersion: options.npmVersion,
					requestTimeoutMs: options.requestTimeoutMs,
				}),
			);
			return;
		}
		const result = await verifyRegistry({
			manifest,
			attempts: options.attempts,
			delayMs: options.delayMs,
			requestTimeoutMs: options.requestTimeoutMs,
			onAttempt: ({ attempt, attempts, terminal, total }) => {
				process.stderr.write(
					`Registry verification attempt ${attempt}/${attempts}: ${terminal}/${total} terminal facts.\n`,
				);
			},
		});
		writeResult(result);
		if (!result.success) process.exitCode = 1;
	} catch (error) {
		const code = error?.code ?? "PUBLICATION_CHECK_FAILED";
		const message =
			error instanceof PublicationError
				? error.message
				: "Publication validation failed.";
		writeResult({
			success: false,
			error: {
				code,
				message,
				...(error?.details ? { details: error.details } : {}),
			},
		});
		process.exitCode =
			code === "INVALID_COMMAND" || code === "INVALID_ARGUMENT" ? 2 : 1;
	}
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	await main();
}
