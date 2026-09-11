import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import {
	readCatalogConfig,
	validatePackedCatalogRanges,
} from "./catalog-contract.mjs";
import { inspectTarball } from "./publication.mjs";

export const releasePackageDirectories = [
	"packages/core",
	"packages/cli",
	"packages/mcp",
	"packages/plugin-msw",
	"packages/plugin-swr",
	"packages/plugin-ts-request",
	"packages/plugin-ts-type",
	"packages/plugin-vue-query",
	"packages/plugin-zod",
	"packages/openapi",
];

const forbiddenTarballPaths = [
	/(^|\/)test-output(\/|$)/,
	/(^|\/)coverage(\/|$)/,
	/(^|\/)fixtures?(\/|$)/i,
	/(^|\/)\.agents(\/|$)/,
	/(^|\/)AGENTS\.md$/,
	/(^|\/)\.env(?:\.|$)/,
	/(^|\/)ownership-manifest/i,
	/\.log$/,
	/\.map$/,
	/(^|\/)\.openapi-to-transaction(?:\.json|\/|$)/,
	/(^|\/)\.openapi-to-write\.lock(\/|$)/,
	/(^|\/)tool-selection-cases\.json$/,
	/(^|\/)performance-baseline\.json$/,
	/(^|\/)(?:doctor|inspect|run-doctor|run-test-group)\.mjs$/,
	/(^|\/)(?:mcp-doctor|inspector)-(?:report|config)\.json$/i,
	/(^|\/)(?:staging|backup)(\/|$)/i,
];

export function parsePackResult(stdout) {
	const start = stdout.indexOf("{");
	if (start < 0) throw new Error(`pnpm pack did not return JSON: ${stdout}`);
	return JSON.parse(stdout.slice(start));
}

function exportTargets(value) {
	if (typeof value === "string") return [value];
	if (!value || typeof value !== "object") return [];
	return Object.values(value).flatMap(exportTargets);
}

export async function packReleasePackages({
	repositoryRoot,
	tarballDirectory,
	pnpm,
	catalogConfig: providedCatalogConfig,
	inspectPackageManifest = async (archive) =>
		(await inspectTarball(archive)).manifest,
}) {
	const packed = [];
	const catalogConfig =
		providedCatalogConfig ?? (await readCatalogConfig(repositoryRoot));
	for (const directory of releasePackageDirectories) {
		const packageDirectory = join(repositoryRoot, directory);
		const manifest = JSON.parse(
			await readFile(join(packageDirectory, "package.json"), "utf8"),
		);
		const result = parsePackResult(
			pnpm(
				["pack", "--json", "--pack-destination", tarballDirectory],
				packageDirectory,
			).stdout,
		);
		const archive = result.filename;
		const archiveStat = await stat(archive);
		const packedManifest = await inspectPackageManifest(archive);
		validatePackedCatalogRanges({
			config: catalogConfig,
			sourceManifest: manifest,
			packedManifest,
		});
		const filePaths = result.files.map(({ path }) => path).sort();
		const forbidden = filePaths.filter((path) =>
			forbiddenTarballPaths.some((pattern) => pattern.test(path)),
		);
		if (
			result.name === "@openapi-to/mcp" &&
			filePaths.some((path) => path.startsWith("scripts/"))
		) {
			forbidden.push(
				...filePaths.filter((path) => path.startsWith("scripts/")),
			);
		}
		if (forbidden.length > 0) {
			throw new Error(
				`${result.name} tarball contains forbidden files: ${forbidden.join(", ")}`,
			);
		}
		if (!filePaths.includes("package.json")) {
			throw new Error(`${result.name} tarball is missing package.json`);
		}
		if (result.name === "@openapi-to/cli") {
			for (const requiredSkillAsset of [
				"dist/skills/manifest.json",
				"dist/skills/openapi-to-generate/SKILL.md",
				"dist/skills/openapi-to-setup/SKILL.md",
			]) {
				if (!filePaths.includes(requiredSkillAsset)) {
					throw new Error(
						`${result.name} tarball is missing packaged Skill asset ${requiredSkillAsset}`,
					);
				}
			}
		}
		const packageTargets = [
			manifest.main,
			manifest.module,
			manifest.types,
			...exportTargets(manifest.exports),
			...Object.values(manifest.bin ?? {}),
		]
			.filter((target) => typeof target === "string" && !target.includes("*"))
			.map((target) => target.replace(/^\.\//, ""));
		for (const target of new Set(packageTargets)) {
			if (!filePaths.includes(target)) {
				throw new Error(
					`${result.name} tarball is missing declared target ${target}`,
				);
			}
		}
		packed.push({
			name: result.name,
			version: result.version,
			filename: basename(archive),
			archive,
			size: archiveStat.size,
			files: filePaths,
		});
	}
	return packed;
}

export function createPackedOverrides(packed) {
	return Object.fromEntries(
		packed
			.map(({ name, archive }) => [name, `file:${archive}`])
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
	);
}

export function createWorkspaceOverridesYaml(overrides) {
	const entries = Object.entries(overrides).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
	return [
		"overrides:",
		...entries.map(
			([name, value]) => `  ${JSON.stringify(name)}: ${JSON.stringify(value)}`,
		),
		"",
	].join("\n");
}
