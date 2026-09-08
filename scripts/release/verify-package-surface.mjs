import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PUBLISHED_NODE_ENGINE } from "../node-runtime-contract.mjs";

const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const repositoryUrl = "https://github.com/Vc-great/openapi-to.git";
const bugsUrl = "https://github.com/Vc-great/openapi-to/issues";
const homepage = "https://github.com/Vc-great/openapi-to#readme";
const expectedAggregateDependencies = [
	"@openapi-to/cli",
	"@openapi-to/core",
	"@openapi-to/mcp",
	"@openapi-to/plugin-msw",
	"@openapi-to/plugin-swr",
	"@openapi-to/plugin-ts-request",
	"@openapi-to/plugin-ts-type",
	"@openapi-to/plugin-vue-query",
	"@openapi-to/plugin-zod",
];

async function exists(path) {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function exportTargets(value) {
	if (typeof value === "string") return [value];
	if (!value || typeof value !== "object") return [];
	return Object.values(value).flatMap(exportTargets);
}

async function declarationFiles(directory) {
	if (!(await exists(directory))) return [];
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await declarationFiles(path)));
		else if (entry.name.endsWith(".d.ts") || entry.name.endsWith(".d.cts"))
			files.push(path);
	}
	return files.sort();
}

async function packageRecords() {
	const records = [];
	for (const entry of await readdir(join(repositoryRoot, "packages"), {
		withFileTypes: true,
	})) {
		if (!entry.isDirectory()) continue;
		const directory = `packages/${entry.name}`;
		const manifestPath = join(repositoryRoot, directory, "package.json");
		if (!(await exists(manifestPath))) continue;
		records.push({
			directory,
			absoluteDirectory: join(repositoryRoot, directory),
			manifest: JSON.parse(await readFile(manifestPath, "utf8")),
		});
	}
	return records.sort((left, right) =>
		left.manifest.name.localeCompare(right.manifest.name),
	);
}

function targetTopLevel(target) {
	const normalized = target.replace(/^\.\//, "");
	return normalized.split("/", 1)[0];
}

const records = await packageRecords();
const publicRecords = records.filter(
	({ manifest }) => manifest.private !== true,
);
const privateRecords = records.filter(
	({ manifest }) => manifest.private === true,
);
const results = [];
const failures = [];

if (publicRecords.length !== 10)
	failures.push(`expected 10 public packages, found ${publicRecords.length}`);
for (const { manifest } of privateRecords) {
	if (manifest.publishConfig !== undefined)
		failures.push(
			`${manifest.name}: private package must not declare publishConfig`,
		);
}

const fixedVersions = new Set(
	publicRecords.map(({ manifest }) => manifest.version),
);
if (fixedVersions.size !== 1)
	failures.push(
		`public fixed-version packages disagree: ${[...fixedVersions].sort().join(", ")}`,
	);

for (const { directory, absoluteDirectory, manifest } of publicRecords) {
	const requiredTargets = [
		manifest.main,
		manifest.module,
		manifest.types,
		...exportTargets(manifest.exports),
	].filter((target) => typeof target === "string" && !target.includes("*"));
	for (const target of new Set(requiredTargets)) {
		if (!(await exists(resolve(absoluteDirectory, target)))) {
			failures.push(`${manifest.name}: missing package target ${target}`);
		}
	}
	for (const [name, target] of Object.entries(manifest.bin ?? {})) {
		const binPath = resolve(absoluteDirectory, target);
		if (!(await exists(binPath)))
			failures.push(`${manifest.name}: missing bin ${target}`);
		else {
			const bin = await readFile(binPath, "utf8");
			if (!bin.startsWith("#!/usr/bin/env node"))
				failures.push(
					`${manifest.name}: bin ${name} (${target}) has no Node shebang`,
				);
			if (
				process.platform !== "win32" &&
				((await stat(binPath)).mode & 0o111) === 0
			) {
				failures.push(
					`${manifest.name}: bin ${name} (${target}) is not executable`,
				);
			}
		}
	}

	for (const [field, value] of [
		["description", manifest.description],
		["license", manifest.license],
		["author", manifest.author],
		["main", manifest.main],
		["module", manifest.module],
		["types", manifest.types],
	]) {
		if (typeof value !== "string" || value.trim() === "")
			failures.push(`${manifest.name}: ${field} is missing`);
	}
	if (
		manifest.repository?.type !== "git" ||
		manifest.repository?.url !== repositoryUrl
	) {
		failures.push(`${manifest.name}: repository must use ${repositoryUrl}`);
	}
	if (manifest.repository?.directory !== directory)
		failures.push(
			`${manifest.name}: repository.directory must be ${directory}`,
		);
	if (manifest.bugs?.url !== bugsUrl)
		failures.push(`${manifest.name}: bugs.url must be ${bugsUrl}`);
	if (manifest.homepage !== homepage)
		failures.push(`${manifest.name}: homepage must be ${homepage}`);
	if (manifest.engines?.node !== PUBLISHED_NODE_ENGINE)
		failures.push(
			`${manifest.name}: published package runtime Node engine must be ${PUBLISHED_NODE_ENGINE}`,
		);
	if (!Array.isArray(manifest.files) || manifest.files.length === 0)
		failures.push(`${manifest.name}: package files allowlist is missing`);
	if (!manifest.exports || typeof manifest.exports !== "object")
		failures.push(`${manifest.name}: exports map is missing`);
	if (manifest.exports?.["."]?.types !== manifest.types)
		failures.push(`${manifest.name}: exports["."].types must match types`);
	if (manifest.publishConfig?.access !== "public")
		failures.push(`${manifest.name}: publishConfig.access must be public`);
	if (manifest.publishConfig?.registry !== "https://registry.npmjs.org/")
		failures.push(`${manifest.name}: publishConfig.registry must be npmjs`);

	const searchableMetadata = `${manifest.description ?? ""} ${(manifest.keywords ?? []).join(" ")}`;
	if (/\bfaker\b|\bnestjs\b|\breact[- ]?query\b/i.test(searchableMetadata)) {
		failures.push(
			`${manifest.name}: metadata advertises an unsupported generator`,
		);
	}

	const allowedTopLevels = new Set(
		(manifest.files ?? [])
			.filter((entry) => !entry.startsWith("!"))
			.map((entry) => entry.split("/", 1)[0]),
	);
	for (const target of [
		...requiredTargets,
		...Object.values(manifest.bin ?? {}),
	]) {
		const topLevel = targetTopLevel(target);
		if (topLevel !== "package.json" && !allowedTopLevels.has(topLevel)) {
			failures.push(
				`${manifest.name}: files does not include declared target ${target}`,
			);
		}
	}
	if (
		manifest.name === "@openapi-to/mcp" &&
		manifest.files.some(
			(path) => path === "scripts" || path.startsWith("scripts/"),
		)
	) {
		failures.push(
			"@openapi-to/mcp: repository-only Doctor/Inspector/test scripts must not be published",
		);
	}
	if (manifest.scripts?.postinstall !== undefined) {
		failures.push(`${manifest.name}: public packages must not use postinstall`);
	}
	if (manifest.name === "@openapi-to/cli") {
		const skillManifestPath = join(
			absoluteDirectory,
			"dist",
			"skills",
			"manifest.json",
		);
		if (!(await exists(skillManifestPath))) {
			failures.push(
				"@openapi-to/cli: missing generated dist/skills/manifest.json",
			);
		} else {
			let skillManifest;
			try {
				skillManifest = JSON.parse(await readFile(skillManifestPath, "utf8"));
			} catch {
				failures.push(
					"@openapi-to/cli: packaged Skill manifest is invalid JSON",
				);
			}
			if (skillManifest) {
				if (
					skillManifest.schemaVersion !== 1 ||
					skillManifest.packageVersion !== manifest.version ||
					JSON.stringify(skillManifest.skills?.map(({ name }) => name)) !==
						JSON.stringify(["openapi-to-generate", "openapi-to-setup"])
				) {
					failures.push(
						"@openapi-to/cli: packaged Skill manifest version or Skill set is invalid",
					);
				} else {
					for (const skill of skillManifest.skills) {
						for (const file of skill.files ?? []) {
							const assetPath = join(
								absoluteDirectory,
								"dist",
								"skills",
								skill.name,
								...file.path.split("/"),
							);
							if (!(await exists(assetPath))) {
								failures.push(
									`@openapi-to/cli: missing packaged Skill file ${skill.name}/${file.path}`,
								);
								continue;
							}
							const bytes = await readFile(assetPath);
							if (
								bytes.byteLength !== file.size ||
								createHash("sha256").update(bytes).digest("hex") !== file.sha256
							) {
								failures.push(
									`@openapi-to/cli: packaged Skill bytes do not match manifest for ${skill.name}/${file.path}`,
								);
							}
						}
					}
				}
			}
		}
		if (
			!manifest.scripts?.build?.includes(
				"scripts/build-consumer-skill-assets.mjs",
			) ||
			manifest.scripts?.prepack !== "pnpm run build"
		) {
			failures.push(
				"@openapi-to/cli: build and prepack must generate packaged consumer Skill assets",
			);
		}
	}

	for (const declarationPath of await declarationFiles(
		join(absoluteDirectory, "dist"),
	)) {
		const path = relative(absoluteDirectory, declarationPath);
		const contents = await readFile(declarationPath, "utf8");
		if (/\/(?:Users|private)\/|[A-Za-z]:\\Users\\/.test(contents)) {
			failures.push(
				`${manifest.name}: declaration ${path} contains an absolute machine path`,
			);
		}
		if (/\.\.\/\.\.\/packages\//.test(contents)) {
			failures.push(
				`${manifest.name}: declaration ${path} references a workspace source path`,
			);
		}
	}

	results.push({
		package: manifest.name,
		version: manifest.version,
		engine: manifest.engines.node,
		exports: requiredTargets.length,
		bin: Object.keys(manifest.bin ?? {}).sort(),
		directory,
	});
}

const aggregate = publicRecords.find(
	({ manifest }) => manifest.name === "openapi-to",
)?.manifest;
if (!aggregate) {
	failures.push("openapi-to: aggregate package is missing");
} else {
	for (const dependency of expectedAggregateDependencies) {
		if (!aggregate.dependencies?.[dependency])
			failures.push(`openapi-to: missing aggregate dependency ${dependency}`);
	}
	if (
		aggregate.bin?.openapi !== "bin/openapi.js" ||
		aggregate.bin?.["openapi-to"] !== "bin/openapi.js" ||
		aggregate.bin?.["openapi-to-mcp"] !== "bin/openapi-to-mcp.js"
	) {
		failures.push(
			"openapi-to: expected openapi/openapi-to CLI aliases and the openapi-to-mcp wrapper",
		);
	}
	const aggregateIndex = await readFile(
		join(repositoryRoot, "packages/openapi/src/index.ts"),
		"utf8",
	);
	if (
		/\b(?:createOpenapiToMcpServer|runMcpCli|openapi_prepare_generation|openapi_apply_generation)\b/.test(
			aggregateIndex,
		)
	) {
		failures.push(
			"openapi-to: top-level JavaScript API must not re-export MCP implementation APIs",
		);
	}
}

for (const directory of ["e2e/common", "e2e/module"]) {
	const manifest = JSON.parse(
		await readFile(join(repositoryRoot, directory, "package.json"), "utf8"),
	);
	if (manifest.dependencies?.["openapi-to"] !== "workspace:*") {
		failures.push(
			`${directory}: real CLI consumer must depend on openapi-to through workspace:*`,
		);
	}
}

const mcp = publicRecords.find(
	({ manifest }) => manifest.name === "@openapi-to/mcp",
)?.manifest;
if (!mcp) {
	failures.push("@openapi-to/mcp: package is missing");
} else {
	if (mcp.bin?.["openapi-to-mcp"] !== "./bin/openapi-to-mcp.js")
		failures.push("@openapi-to/mcp: independent bin is missing");
	if (
		JSON.stringify(Object.keys(mcp.exports ?? {}).sort()) !==
		JSON.stringify([".", "./cli", "./package.json"])
	) {
		failures.push(
			"@openapi-to/mcp: exports must contain only the server API, CLI entry, and package metadata",
		);
	}
	if (
		mcp.exports?.["./cli"]?.types !== "./dist/cli.d.ts" ||
		mcp.exports?.["./cli"]?.import !== "./dist/cli.js" ||
		mcp.exports?.["./cli"]?.require !== "./dist/cli.cjs"
	) {
		failures.push("@openapi-to/mcp: ./cli export targets are incomplete");
	}
}

const aggregateMcpWrapper = await readFile(
	join(repositoryRoot, "packages/openapi/bin/openapi-to-mcp.js"),
	"utf8",
);
const independentMcpWrapper = await readFile(
	join(repositoryRoot, "packages/mcp/bin/openapi-to-mcp.js"),
	"utf8",
);
if (aggregateMcpWrapper !== independentMcpWrapper) {
	failures.push(
		"openapi-to-mcp: aggregate and independent wrappers must be byte-identical",
	);
}
if (
	!aggregateMcpWrapper.includes(
		"import { runMcpCli } from '@openapi-to/mcp/cli'",
	) ||
	!aggregateMcpWrapper.includes("await runMcpCli(process.argv.slice(2))") ||
	/\b(?:parseArgs|StdioServerTransport|createOpenapiToMcpServer)\b/.test(
		aggregateMcpWrapper,
	)
) {
	failures.push(
		"openapi-to-mcp: wrappers must delegate only to the shared @openapi-to/mcp/cli runner",
	);
}

const changesetsConfig = JSON.parse(
	await readFile(join(repositoryRoot, ".changeset/config.json"), "utf8"),
);
const fixedGroup = new Set(changesetsConfig.fixed?.flat() ?? []);
for (const { manifest } of publicRecords) {
	if (!fixedGroup.has(manifest.name))
		failures.push(`${manifest.name}: missing from Changesets fixed group`);
}
for (const name of fixedGroup) {
	if (!publicRecords.some(({ manifest }) => manifest.name === name))
		failures.push(`${name}: fixed group names a non-public package`);
}

const readme = await readFile(join(repositoryRoot, "README.md"), "utf8");
if (
	!readme.includes(
		"`openapi` and `openapi-to` are CLI aliases; `openapi-to-mcp` starts the stdio MCP server",
	)
) {
	failures.push("README does not declare all three aggregate binaries");
}
if (!readme.includes("docs/capability-matrix.md"))
	failures.push("README does not link the capability matrix");

if (failures.length > 0) {
	for (const failure of [...new Set(failures)].sort())
		process.stderr.write(`${failure}\n`);
	process.exitCode = 1;
} else {
	process.stdout.write(
		`${JSON.stringify({ success: true, packages: results }, null, 2)}\n`,
	);
}
