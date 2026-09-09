import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

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

// These tracked legacy files are not parseable as their filename's language by
// Biome 2.2.
const EXCLUDED_PATHS = new Set([
	"packages/config-ts/base.json",
	"packages/config-ts/bundler.json",
	"packages/openapi/src/utils.ts",
	// Checked-in generator output: the source generator and snapshots own it.
	"packages/plugin-swr/mock/newPetAPI.ts",
	// Checked-in TypeScript request/type generator output with intentional namespace merging.
	"packages/plugin-ts-type/mock/User.ts",
]);

const EXCLUDED_PREFIXES = [
	// Checked-in TypeScript generator output fixtures.
	"packages/plugin-ts-type/mock/typeModels/",
	// Checked-in Zod generator output fixtures.
	"packages/plugin-zod/mock/zodModels/",
];

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: process.cwd(),
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
		...options,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		process.stderr.write(result.stderr ?? "");
		throw new Error(`${command} exited with status ${result.status}`);
	}
	return result.stdout ?? "";
}

function nulSeparatedGit(args) {
	return run("git", args)
		.split("\0")
		.filter(Boolean);
}

export function collectChangedFiles(base) {
	const paths = new Set();
	const add = (items) => {
		for (const item of items) paths.add(item);
	};

	if (base) {
		add(nulSeparatedGit(["diff", "--name-only", "-z", "--diff-filter=ACMR", `${base}...HEAD`]));
	}
	add(nulSeparatedGit(["diff", "--name-only", "-z", "--diff-filter=ACMR"]));
	add(nulSeparatedGit(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"]));
	add(nulSeparatedGit(["ls-files", "--others", "--exclude-standard", "-z"]));

	return [...paths]
		.filter((path) => LINTABLE_EXTENSIONS.has(extname(path).toLowerCase()))
		.filter((path) => !EXCLUDED_PATHS.has(path))
		.filter(
			(path) => !EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix)),
		)
		.filter((path) => existsSync(resolve(process.cwd(), path)))
		.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function parseArguments(arguments_) {
	let base;
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		if (argument === "--base") {
			base = arguments_[index + 1];
			if (!base) throw new Error("--base requires a Git reference.");
			index += 1;
		} else {
			throw new Error(`Unknown argument: ${argument}`);
		}
	}
	return { base };
}

function biomeCommand() {
	const configured = process.env.LINT_CHANGED_BIOME;
	if (configured) {
		return configured.endsWith(".mjs") || configured.endsWith(".js")
			? { command: process.execPath, prefix: [configured] }
			: { command: configured, prefix: [] };
	}
	const suffix = process.platform === "win32" ? ".cmd" : "";
	return {
		command: resolve(process.cwd(), "node_modules", ".bin", `biome${suffix}`),
		prefix: [],
	};
}

export function main(arguments_ = process.argv.slice(2)) {
	const { base } = parseArguments(arguments_);
	const files = collectChangedFiles(base);
	if (files.length === 0) {
		process.stdout.write("No changed lintable files.\n");
		return;
	}

	const { command, prefix } = biomeCommand();
	const result = spawnSync(
		command,
		[
			...prefix,
			"lint",
			"--error-on-warnings",
			"--files-ignore-unknown=true",
			"--no-errors-on-unmatched",
			"--max-diagnostics=none",
			"--",
			...files,
		],
		{ cwd: process.cwd(), stdio: "inherit" },
	);
	if (result.error) throw result.error;
	if (result.status !== 0) process.exitCode = result.status ?? 1;
}

main();
