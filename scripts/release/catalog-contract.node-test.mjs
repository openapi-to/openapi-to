import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	readCatalogConfig,
	resolveCatalogRange,
	validatePackedCatalogRanges,
	validateWorkspaceCatalogs,
} from "./catalog-contract.mjs";

const config = {
	catalog: { external: "^1.2.3", peer: "^4.5.6" },
	catalogs: { exact: { peer: "4.5.6" } },
};

test("readCatalogConfig preserves default and named catalog merges", async () => {
	const root = await mkdtemp(join(tmpdir(), "catalog-contract-"));
	try {
		await writeFile(
			join(root, "pnpm-workspace.yaml"),
			[
				"catalog: &common",
				"  zod: 4.4.3",
				"catalogs:",
				"  test:",
				"    <<: *common",
				"    lodash: 4.17.21",
				"",
			].join("\n"),
		);
		assert.deepEqual(await readCatalogConfig(root), {
			catalog: { zod: "4.4.3" },
			catalogs: { test: { zod: "4.4.3", lodash: "4.17.21" } },
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

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
