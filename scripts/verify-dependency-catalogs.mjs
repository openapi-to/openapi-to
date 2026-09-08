import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
	readCatalogConfig,
	validateWorkspaceCatalogs,
} from "./release/catalog-contract.mjs";
import {
	readWorkspacePackages,
	repositoryRoot,
} from "./release/publication.mjs";

const rootManifest = JSON.parse(
	await readFile(join(repositoryRoot, "package.json"), "utf8"),
);
const workspacePackages = await readWorkspacePackages(repositoryRoot);
const result = validateWorkspaceCatalogs({
	config: await readCatalogConfig(repositoryRoot),
	records: [{ directory: ".", manifest: rootManifest }, ...workspacePackages],
});

process.stdout.write(
	`${JSON.stringify({ success: true, ...result }, null, 2)}\n`,
);
