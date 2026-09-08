import assert from "node:assert/strict";
import test from "node:test";

import {
	resolveCatalogRange,
	validatePackedCatalogRanges,
	validateWorkspaceCatalogs,
} from "./catalog-contract.mjs";

const config = {
	catalog: { external: "^1.2.3", peer: "^4.5.6" },
	catalogs: { exact: { peer: "4.5.6" } },
};

test("workspace catalog contract centralizes external ranges and preserves workspace:*", () => {
	assert.deepEqual(
		validateWorkspaceCatalogs({
			config,
			records: [
				{
					directory: "packages/a",
					manifest: {
						name: "@fixture/a",
						dependencies: {
							"@fixture/b": "workspace:*",
							external: "catalog:",
							peer: "catalog:exact",
						},
					},
				},
				{
					directory: "packages/b",
					manifest: {
						name: "@fixture/b",
						peerDependencies: { peer: "catalog:" },
					},
				},
			],
		}),
		{
			manifestCount: 2,
			externalEntries: 3,
			workspaceEntries: 1,
			catalogDefinitions: 3,
			namedCatalogs: ["exact"],
		},
	);
});

test("workspace catalog contract rejects distributed, missing, unused, and duplicate authority", () => {
	const records = [
		{
			directory: "packages/a",
			manifest: { name: "@fixture/a", dependencies: { external: "^1.2.3" } },
		},
	];
	assert.throws(
		() => validateWorkspaceCatalogs({ config, records }),
		/must use a catalog:/,
	);
	assert.throws(
		() => resolveCatalogRange(config, "missing", "catalog:"),
		/missing catalog/,
	);
	assert.throws(
		() =>
			validateWorkspaceCatalogs({
				config: { catalog: { external: "^1.2.3", unused: "1.0.0" } },
				records: [
					{
						directory: "packages/a",
						manifest: {
							name: "@fixture/a",
							dependencies: { external: "catalog:" },
						},
					},
				],
			}),
		/unused catalog entry/,
	);
	assert.throws(
		() =>
			validateWorkspaceCatalogs({
				config: {
					catalog: { external: "^1.2.3" },
					catalogs: { duplicate: { external: "^1.2.3" } },
				},
				records: [
					{
						directory: "packages/a",
						manifest: {
							name: "@fixture/a",
							dependencies: { external: "catalog:" },
							devDependencies: { external: "catalog:duplicate" },
						},
					},
				],
			}),
		/duplicated across catalogs/,
	);
});

test("packed catalog contract preserves default, named, and peer ranges", () => {
	const sourceManifest = {
		name: "@fixture/a",
		dependencies: { external: "catalog:", peer: "catalog:exact" },
		peerDependencies: { peer: "catalog:" },
	};
	validatePackedCatalogRanges({
		config,
		sourceManifest,
		packedManifest: {
			dependencies: { external: "^1.2.3", peer: "4.5.6" },
			peerDependencies: { peer: "^4.5.6" },
		},
	});
	assert.throws(
		() =>
			validatePackedCatalogRanges({
				config,
				sourceManifest,
				packedManifest: {
					dependencies: { external: "catalog:", peer: "^4.5.6" },
					peerDependencies: { peer: "^4.5.6" },
				},
			}),
		/packed as|retains catalog:/,
	);
});
