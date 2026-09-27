import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_SCHEMA = "v1";

function normalizeVersion(value, label) {
	if (
		typeof value !== "string" ||
		!/^(?:v)?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)
	) {
		throw new Error(`${label} must be a concrete semantic version`);
	}
	return value.replace(/^v/, "");
}

function validateComponent(value, label) {
	if (typeof value !== "string" || !/^[A-Za-z0-9._-]+$/.test(value)) {
		throw new Error(`${label} contains unsupported characters`);
	}
	return value;
}

export function createTurboCacheKeys({
	os,
	arch,
	nodeVersion,
	pnpmVersion,
	turboVersion,
	lockfileContents,
	sha,
}) {
	const normalizedOs = validateComponent(os, "runner OS");
	const normalizedArch = validateComponent(arch, "runner architecture");
	const normalizedNode = normalizeVersion(nodeVersion, "Node.js version");
	const normalizedPnpm = normalizeVersion(pnpmVersion, "pnpm version");
	const normalizedTurbo = normalizeVersion(turboVersion, "Turborepo version");
	if (typeof lockfileContents !== "string" || lockfileContents.length === 0) {
		throw new Error("pnpm lockfile contents must not be empty");
	}
	if (typeof sha !== "string" || !/^[0-9a-f]{40}$/i.test(sha)) {
		throw new Error("GitHub commit SHA must contain 40 hexadecimal characters");
	}

	const lockHash = createHash("sha256").update(lockfileContents).digest("hex");
	const restorePrefix = [
		"openapi-to-turbo",
		CACHE_SCHEMA,
		normalizedOs,
		normalizedArch,
		`node-${normalizedNode}`,
		`pnpm-${normalizedPnpm}`,
		`turbo-${normalizedTurbo}`,
		`lock-${lockHash}`,
	].join("-");
	return {
		cacheKey: `${restorePrefix}-${sha.toLowerCase()}`,
		restorePrefix: `${restorePrefix}-`,
	};
}

function readVersionContext() {
	const packageJson = JSON.parse(
		readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
	);
	const pnpmMatch = /^pnpm@([^+]+)(?:\+.*)?$/.exec(
		packageJson.packageManager ?? "",
	);
	if (!pnpmMatch)
		throw new Error("package.json must pin pnpm through packageManager");
	const turboVersion = execFileSync("pnpm", ["exec", "turbo", "--version"], {
		cwd: repositoryRoot,
		encoding: "utf8",
	}).trim();
	return { pnpmVersion: pnpmMatch[1], turboVersion };
}

function writeGitHubOutputs({ cacheKey, restorePrefix }) {
	const outputPath = process.env.GITHUB_OUTPUT;
	if (!outputPath)
		throw new Error("GITHUB_OUTPUT is required in GitHub Actions");
	appendFileSync(
		outputPath,
		`cache-key=${cacheKey}\nrestore-prefix=${restorePrefix}\n`,
		{ encoding: "utf8" },
	);
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const { pnpmVersion, turboVersion } = readVersionContext();
	const keys = createTurboCacheKeys({
		os: process.env.RUNNER_OS,
		arch: process.env.RUNNER_ARCH,
		nodeVersion: process.version,
		pnpmVersion,
		turboVersion,
		lockfileContents: readFileSync(
			resolve(repositoryRoot, "pnpm-lock.yaml"),
			"utf8",
		),
		sha: process.env.GITHUB_SHA,
	});
	writeGitHubOutputs(keys);
}
