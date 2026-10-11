import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const LINTABLE_EXTENSIONS = new Set([
	".cjs",
	".js",
	".json",
	".jsonc",
	".jsx",
	".mjs",
	".ts",
	".tsx",
]);

const PASSIVE_EXTENSIONS = new Set([
	".css",
	".gif",
	".html",
	".ico",
	".jpeg",
	".jpg",
	".md",
	".mdx",
	".pdf",
	".png",
	".svg",
	".txt",
	".webp",
]);

// Keep these exclusions aligned with scripts/lint-changed.mjs. They are checked
// by their generators or contain syntax Biome cannot parse as the named language.
const EXCLUDED_PATHS = new Set([
	"packages/config-ts/base.json",
	"packages/config-ts/bundler.json",
	"packages/openapi/src/utils.ts",
	"packages/plugin-swr/mock/newPetAPI.ts",
	"packages/plugin-ts-type/mock/User.ts",
]);

const EXCLUDED_PREFIXES = [
	"packages/plugin-ts-type/mock/typeModels/",
	"packages/plugin-zod/mock/zodModels/",
];

const FULL_VALIDATION_PATHS = new Set([
	".editorconfig",
	".npmrc",
	".husky/pre-commit",
	"biome.json",
	"biome.jsonc",
	"AGENTS.md",
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"scripts/verify-precommit.mjs",
	"scripts/verify-precommit.node-test.mjs",
	"scripts/repository-contract.mjs",
	"scripts/repository-contract.node-test.mjs",
	"turbo.json",
]);

const FULL_VALIDATION_PREFIXES = [".github/", ".husky/", "configs/"];

const MAX_STAGED_PATHS = 1000;
const MAX_LINTABLE_FILES = 500;
const MAX_STAGED_FILE_SIZE = 1024 * 1024;
const MAX_TOTAL_STAGED_BYTES = 16 * 1024 * 1024;
const BIOME_CLI = resolve("node_modules/@biomejs/biome/bin/biome");

function decodePath(bytes) {
	const path = bytes.toString("utf8");
	if (!Buffer.from(path, "utf8").equals(bytes)) {
		throw new Error(
			"A staged path is not valid UTF-8; refusing to guess its identity.",
		);
	}
	return path;
}

function displayPath(path) {
	const bounded = path.length > 160 ? `${path.slice(0, 157)}...` : path;
	return JSON.stringify(bounded);
}

function sanitizeDiagnostic(value) {
	let result = "";
	for (const character of value) {
		const code = character.codePointAt(0);
		if (code >= 0x20 && (code < 0x7f || code > 0x9f)) result += character;
	}
	return result.slice(0, 500);
}

function splitNullSeparated(buffer) {
	if (buffer.length === 0) return [];
	if (buffer.at(-1) !== 0) {
		throw new Error("Git returned an unterminated path list.");
	}
	const fields = [];
	let start = 0;
	for (let index = 0; index < buffer.length; index += 1) {
		if (buffer[index] === 0) {
			fields.push(buffer.subarray(start, index));
			start = index + 1;
		}
	}
	return fields;
}

function runGit(cwd, args, spawn) {
	const result = spawn("git", args, {
		cwd,
		encoding: null,
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		const detail = sanitizeDiagnostic(
			result.stderr?.toString("utf8") ?? "",
		).trim();
		throw new Error(
			detail || `git ${args[0]} exited with status ${result.status}`,
		);
	}
	return result.stdout ?? Buffer.alloc(0);
}

function stagedChanges(cwd, spawn) {
	const statusFields = splitNullSeparated(
		runGit(
			cwd,
			["diff", "--cached", "--name-status", "--no-renames", "-z"],
			spawn,
		),
	);
	const changes = [];
	for (let index = 0; index < statusFields.length; ) {
		const status = statusFields[index++].toString("ascii");
		const path = decodePath(statusFields[index++] ?? Buffer.alloc(0));
		if (!path) throw new Error("Git returned an empty staged path.");
		if (status === "U") {
			throw new Error(
				`Unmerged staged path requires resolution before commit: ${displayPath(path)}`,
			);
		}
		if (status !== "D") changes.push(path);
	}
	return changes;
}

function indexEntries(cwd, spawn) {
	const fields = splitNullSeparated(
		runGit(cwd, ["ls-files", "--stage", "-z"], spawn),
	);
	const entries = new Map();
	for (const record of fields) {
		const separator = record.indexOf(9);
		if (separator < 0) throw new Error("Git returned a malformed index entry.");
		const header = record.subarray(0, separator).toString("ascii").split(" ");
		if (header.length !== 3)
			throw new Error("Git returned a malformed index entry.");
		const [mode, oid, stageText] = header;
		const path = decodePath(record.subarray(separator + 1));
		const stage = Number(stageText);
		if (!Number.isInteger(stage) || stage < 0 || stage > 3) {
			throw new Error(
				`Git returned an invalid index stage for ${displayPath(path)}.`,
			);
		}
		const values = entries.get(path) ?? [];
		values.push({ mode, oid, stage });
		entries.set(path, values);
	}
	return entries;
}

function validatePortablePath(path) {
	if (
		path.length > 1024 ||
		path.startsWith("/") ||
		path.includes("\\") ||
		path.includes(":") ||
		path.split("/").some((part) => part === "" || part === "." || part === "..")
	) {
		throw new Error(
			`Staged path is unsafe or not portable: ${displayPath(path)}`,
		);
	}
	for (const part of path.split("/")) {
		if (
			/[. ]$/.test(part) ||
			/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part)
		) {
			throw new Error(
				`Staged path is not portable to Windows: ${displayPath(path)}`,
			);
		}
	}
}

function isLintable(path) {
	return (
		LINTABLE_EXTENSIONS.has(extname(path).toLowerCase()) &&
		!EXCLUDED_PATHS.has(path) &&
		!EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))
	);
}

function requiresFullValidation(path) {
	const basename = path.split("/").at(-1);
	const extension = extname(path).toLowerCase();
	return (
		FULL_VALIDATION_PATHS.has(path) ||
		FULL_VALIDATION_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
		basename === "biome.json" ||
		basename === "biome.jsonc" ||
		/\.(?:json5|yaml|yml|toml)$/i.test(path) ||
		path.endsWith("/package.json") ||
		/^tsconfig.*\.json$/i.test(basename) ||
		(!LINTABLE_EXTENSIONS.has(extension) && !PASSIVE_EXTENSIONS.has(extension))
	);
}

function runFullValidation(cwd, spawn) {
	return spawn("pnpm", ["run", "verify:precommit:tooling"], {
		cwd,
		stdio: "inherit",
		shell: process.platform === "win32",
	});
}

async function writeIndexedFile(cwd, root, path, entry, spawn) {
	validatePortablePath(path);
	if (entry.stage !== 0)
		throw new Error(
			`Unmerged staged path requires resolution: ${displayPath(path)}`,
		);
	if (entry.mode !== "100644" && entry.mode !== "100755") {
		throw new Error(
			`Staged path has an unsupported file mode: ${displayPath(path)}`,
		);
	}
	const sizeText = runGit(cwd, ["cat-file", "-s", entry.oid], spawn)
		.toString("ascii")
		.trim();
	const size = Number(sizeText);
	if (
		!Number.isSafeInteger(size) ||
		size < 0 ||
		size > MAX_STAGED_FILE_SIZE ||
		size > MAX_TOTAL_STAGED_BYTES
	) {
		throw new Error(
			`Staged lint file exceeds the ${MAX_STAGED_FILE_SIZE}-byte limit: ${displayPath(path)}`,
		);
	}
	const contents = runGit(cwd, ["cat-file", "blob", entry.oid], spawn);
	if (contents.length !== size)
		throw new Error(
			`Could not read the complete staged blob: ${displayPath(path)}`,
		);
	const target = resolve(root, ...path.split("/"));
	if (!target.startsWith(`${root}${sep}`))
		throw new Error(
			`Staged path escapes its temporary root: ${displayPath(path)}`,
		);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, contents, { flag: "wx" });
	return { target, size };
}

function assertCriticalPathsMatchIndex(cwd, paths, spawn) {
	const critical = paths.filter(requiresFullValidation);
	if (critical.length === 0) return;
	const result = spawn(
		"git",
		[
			"--literal-pathspecs",
			"diff",
			"--quiet",
			"--no-ext-diff",
			"--no-textconv",
			"--",
			...critical,
		],
		{ cwd },
	);
	if (result.error) throw result.error;
	if (result.status === 1) {
		throw new Error(
			"A critical staged path also has unstaged edits; stage the complete validated content before commit.",
		);
	}
	if (result.status !== 0) {
		throw new Error(
			"Could not verify critical staged paths against the working tree.",
		);
	}
}

export async function main({
	cwd = process.cwd(),
	spawn = spawnSync,
	biomeCli = BIOME_CLI,
	runFull = runFullValidation,
} = {}) {
	const top = runGit(cwd, ["rev-parse", "--show-toplevel"], spawn)
		.toString("utf8")
		.trim();
	const changes = stagedChanges(top, spawn);
	if (changes.length === 0) {
		process.stdout.write("No staged changes.\n");
		return 0;
	}
	if (changes.length > MAX_STAGED_PATHS) {
		throw new Error(
			`The staged path count exceeds the ${MAX_STAGED_PATHS}-path limit.`,
		);
	}

	for (const path of changes) validatePortablePath(path);
	if (changes.some(requiresFullValidation)) {
		assertCriticalPathsMatchIndex(top, changes, spawn);
		process.stdout.write(
			"Pre-commit tooling changed; running full verification.\n",
		);
		const result = runFull(top, spawn);
		if (result.error) {
			process.stderr.write(`${result.error.message}\n`);
			return 1;
		}
		return result.status ?? 1;
	}

	const index = indexEntries(top, spawn);
	const lintable = changes.filter(isLintable);
	if (lintable.length === 0) {
		process.stdout.write("No staged lintable files.\n");
		return 0;
	}
	if (lintable.length > MAX_LINTABLE_FILES) {
		throw new Error(
			`The staged lint file count exceeds the ${MAX_LINTABLE_FILES}-file limit.`,
		);
	}

	const configEntry = index
		.get("biome.json")
		?.find((entry) => entry.stage === 0);
	if (!configEntry)
		throw new Error("The staged index has no root biome.json configuration.");

	const tempRoot = await mkdtemp(join(tmpdir(), "openapi-to-precommit-"));
	try {
		let totalSize = 0;
		const config = await writeIndexedFile(
			top,
			tempRoot,
			"biome.json",
			configEntry,
			spawn,
		);
		totalSize += config.size;
		const files = [];
		for (const path of lintable) {
			const entries = index.get(path) ?? [];
			if (entries.length !== 1)
				throw new Error(
					`Staged path is missing or ambiguous in the index: ${displayPath(path)}`,
				);
			const file = await writeIndexedFile(
				top,
				tempRoot,
				path,
				entries[0],
				spawn,
			);
			totalSize += file.size;
			if (totalSize > MAX_TOTAL_STAGED_BYTES) {
				throw new Error(
					`Staged lint contents exceed the ${MAX_TOTAL_STAGED_BYTES}-byte total limit.`,
				);
			}
			files.push(file.target);
		}

		const result = spawn(
			process.execPath,
			[
				biomeCli,
				"lint",
				"--error-on-warnings",
				"--files-ignore-unknown=false",
				"--max-diagnostics=50",
				`--config-path=${config.target}`,
				"--",
				...files,
			],
			{ cwd: top, stdio: "inherit" },
		);
		if (result.error) {
			process.stderr.write(`${result.error.message}\n`);
			return 1;
		}
		return result.status ?? 1;
	} finally {
		await rm(tempRoot, { recursive: true, force: true });
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	main().then(
		(status) => {
			if (status !== 0) process.exitCode = status;
		},
		(error) => {
			process.stderr.write(`${error.message}\n`);
			process.exitCode = 1;
		},
	);
}
