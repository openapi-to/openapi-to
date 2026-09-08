import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { load as parseYaml } from "js-yaml";

export const dependencyFields = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
];

function catalogKey(catalogName, dependencyName) {
	return `${catalogName}\0${dependencyName}`;
}

export async function readCatalogConfig(root) {
	const value = parseYaml(
		await readFile(join(root, "pnpm-workspace.yaml"), "utf8"),
	);
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("pnpm-workspace.yaml must contain a mapping");
	}
	return value;
}

export function resolveCatalogRange(config, dependencyName, specifier) {
	if (typeof specifier !== "string" || !specifier.startsWith("catalog:")) {
		throw new Error(`${dependencyName} must use a catalog: specifier`);
	}
	const catalogName = specifier.slice("catalog:".length) || "default";
	const catalog =
		catalogName === "default" ? config.catalog : config.catalogs?.[catalogName];
	const range = catalog?.[dependencyName];
	if (typeof range !== "string" || range.length === 0) {
		throw new Error(
			`${dependencyName} references missing catalog ${catalogName}`,
		);
	}
	return { catalogName, range };
}

export function validateWorkspaceCatalogs({ config, records }) {
	const workspaceNames = new Set(records.map(({ manifest }) => manifest.name));
	const references = new Set();
	let externalEntries = 0;
	let workspaceEntries = 0;

	for (const { directory, manifest } of records) {
		for (const field of dependencyFields) {
			for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
				if (workspaceNames.has(name)) {
					if (specifier !== "workspace:*") {
						throw new Error(
							`${directory} ${field}.${name} must preserve workspace:*`,
						);
					}
					workspaceEntries += 1;
					continue;
				}
				const { catalogName } = resolveCatalogRange(config, name, specifier);
				references.add(catalogKey(catalogName, name));
				externalEntries += 1;
			}
		}
	}

	const definitions = [];
	for (const [name, range] of Object.entries(config.catalog ?? {})) {
		definitions.push({ catalogName: "default", name, range });
	}
	for (const [catalogName, catalog] of Object.entries(config.catalogs ?? {})) {
		for (const [name, range] of Object.entries(catalog ?? {})) {
			definitions.push({ catalogName, name, range });
		}
	}
	const duplicateRanges = new Set();
	for (const { catalogName, name, range } of definitions) {
		if (typeof range !== "string" || range.length === 0) {
			throw new Error(`${catalogName}.${name} must define a string range`);
		}
		if (!references.has(catalogKey(catalogName, name))) {
			throw new Error(`${catalogName}.${name} is an unused catalog entry`);
		}
		const duplicateKey = `${name}\0${range}`;
		if (duplicateRanges.has(duplicateKey)) {
			throw new Error(`${name}@${range} is duplicated across catalogs`);
		}
		duplicateRanges.add(duplicateKey);
	}

	return {
		manifestCount: records.length,
		externalEntries,
		workspaceEntries,
		catalogDefinitions: definitions.length,
		namedCatalogs: Object.keys(config.catalogs ?? {}).sort(),
	};
}

export function validatePackedCatalogRanges({
	config,
	sourceManifest,
	packedManifest,
}) {
	for (const field of dependencyFields) {
		for (const [name, sourceSpecifier] of Object.entries(
			sourceManifest[field] ?? {},
		)) {
			if (!sourceSpecifier.startsWith("catalog:")) continue;
			const { range } = resolveCatalogRange(config, name, sourceSpecifier);
			const packedSpecifier = packedManifest[field]?.[name];
			if (packedSpecifier !== range) {
				throw new Error(
					`${sourceManifest.name} ${field}.${name} packed as ${packedSpecifier ?? "<missing>"}; expected ${range}`,
				);
			}
		}
		for (const [name, packedSpecifier] of Object.entries(
			packedManifest[field] ?? {},
		)) {
			if (
				typeof packedSpecifier === "string" &&
				packedSpecifier.startsWith("catalog:")
			) {
				throw new Error(
					`${sourceManifest.name} ${field}.${name} retains catalog: in the tarball`,
				);
			}
		}
	}
}
