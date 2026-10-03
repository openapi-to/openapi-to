import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function install(flag) {
	const result = spawnSync(pnpm, ["install", "--frozen-lockfile", flag], {
		cwd: repositoryRoot,
		stdio: "inherit",
		shell: process.platform === "win32",
	});

	if (result.error) {
		console.error(`Codex worktree setup: could not run pnpm: ${result.error.message}`);
	}
	return result.status === 0;
}

console.log("Codex worktree setup: installing workspace dependencies from the local pnpm store.");
if (install("--offline")) {
	console.log("Codex worktree setup: offline install succeeded.");
} else {
	console.error("Codex worktree setup: offline install failed; trying the local store first and fetching missing packages.");
	if (install("--prefer-offline")) {
		console.log("Codex worktree setup: dependency install succeeded.");
	} else {
		console.error("Codex worktree setup: install failed. Check the pnpm output above, the shared store, and registry access.");
		process.exitCode = 1;
	}
}
