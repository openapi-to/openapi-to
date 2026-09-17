import {
	access,
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildConsumerSkillAssets } from "../../../scripts/build-consumer-skill-assets.mjs";
import { type CLIIO, run } from "./index.ts";
import { setup } from "./setup.ts";

const repositoryRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);

describe("openapi setup Codex bootstrap", { concurrent: false }, () => {
	let originalCwd: string;
	let root: string;
	let assetRoot: string;
	let stdout: string[];
	let stderr: string[];
	let io: CLIIO;

	beforeEach(async () => {
		originalCwd = process.cwd();
		root = await mkdtemp(path.join(os.tmpdir(), "openapi-setup-"));
		const packageDirectory = path.join(root, "asset-package");
		assetRoot = path.join(root, "assets");
		await mkdir(packageDirectory, { recursive: true });
		await writeFile(
			path.join(root, "package.json"),
			`${JSON.stringify({
				private: true,
				type: "module",
				packageManager: "pnpm@11.26.0",
				devDependencies: { "openapi-to": "4.0.0-rc.3" },
			})}\n`,
		);
		await writeFile(
			path.join(root, "pnpm-lock.yaml"),
			"lockfileVersion: '9.0'\n",
		);
		await writeFile(
			path.join(root, "asset-package", "package.json"),
			'{"version":"4.0.0-rc.3"}\n',
		);
		await buildConsumerSkillAssets({
			sourceRoot: path.join(repositoryRoot, ".agents/skills"),
			packageDirectory,
			outputDirectory: assetRoot,
		});
		process.chdir(root);
		stdout = [];
		stderr = [];
		io = {
			stdout: (message) => stdout.push(message),
			stderr: (message) => stderr.push(message),
		};
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		process.exitCode = 0;
		await rm(root, { recursive: true, force: true });
	});

	it("validates host and scope and supports global JSON placement", async () => {
		const missing = await run(["node", "openapi", "setup", "--json"], io);
		expect(missing.exitCode).not.toBe(0);
		expect(JSON.parse(stdout.join("\n"))).toMatchObject({
			success: false,
			command: "setup",
			diagnostics: [{ code: "CONFIG_SETUP_HOST_REQUIRED" }],
		});
		stdout = [];
		const invalid = await run(
			[
				"node",
				"openapi",
				"--json",
				"setup",
				"--host",
				"codex",
				"--scope",
				"user",
			],
			io,
		);
		expect(invalid.exitCode).not.toBe(0);
		expect(JSON.parse(stdout.join("\n"))).toMatchObject({
			success: false,
			diagnostics: [{ code: "CONFIG_SETUP_SCOPE_UNSUPPORTED" }],
		});
	});

	it("keeps dry-run read-only and applies a deterministic bootstrap", async () => {
		const preview = await setup(
			{ dryRun: true },
			{ assetRoot, workingDirectory: () => root },
		);
		expect(preview).toMatchObject({
			success: true,
			command: "setup",
			mode: "dry-run",
			host: "codex",
			scope: "project",
			setupMode: "read-only",
			state: "DRY_RUN",
			restartRequired: true,
		});
		expect(
			preview.actions.map(({ action }: { action: string }) => action),
		).toEqual([
			"create-config",
			"update-gitignore",
			"install-skills",
			"create-codex-config",
		]);
		await expect(
			access(path.join(root, "openapi.config.ts")),
		).rejects.toThrow();
		await expect(access(path.join(root, ".codex"))).rejects.toThrow();
		const applied = await setup(
			{},
			{ assetRoot, workingDirectory: () => root },
		);
		expect(applied).toMatchObject({
			success: true,
			mode: "apply",
			state: "RESTART_REQUIRED",
			restartRequired: true,
		});
		expect(await readFile(path.join(root, ".gitignore"), "utf8")).toContain(
			"/.openapi-to/",
		);
		expect(
			await readFile(path.join(root, ".codex/config.toml"), "utf8"),
		).toContain('command = "pnpm"');
		expect(
			await readFile(path.join(root, ".codex/config.toml"), "utf8"),
		).not.toContain("--allow-write");
		const rerun = await setup({}, { assetRoot, workingDirectory: () => root });
		expect(rerun).toMatchObject({
			actions: [],
			state: "READY",
			restartRequired: false,
		});
	});

	it("preserves unrelated Codex config bytes and rejects a modified Skill", async () => {
		const original = '# user config\n[mcp_servers.other]\ncommand = "other"\n';
		await mkdir(path.join(root, ".codex"), { recursive: true });
		await writeFile(path.join(root, ".gitignore"), "dist/\n");
		await writeFile(
			path.join(root, "openapi.config.ts"),
			"export default {};\n",
		);
		await writeFile(path.join(root, ".codex/config.toml"), original);
		await setup({}, { assetRoot, workingDirectory: () => root });
		const codex = await readFile(path.join(root, ".codex/config.toml"), "utf8");
		expect(codex.startsWith(original)).toBe(true);
		await writeFile(
			path.join(root, ".codex/config.toml"),
			`${codex}[mcp_servers.other_after]\ncommand = "other-after"\n`,
		);
		expect(
			(await setup({}, { assetRoot, workingDirectory: () => root })).actions,
		).toEqual([]);
		await writeFile(
			path.join(root, ".agents/skills/openapi-to-setup/SKILL.md"),
			"modified by consumer\n",
		);
		await expect(
			setup({}, { assetRoot, workingDirectory: () => root }),
		).rejects.toMatchObject({
			code: "CONFIG_SETUP_SKILLS_CONFLICT",
		});
	});

	it("rejects nested openapi_to sections instead of treating the canonical block as current", async () => {
		await mkdir(path.join(root, ".codex"), { recursive: true });
		await writeFile(
			path.join(root, ".codex/config.toml"),
			'[mcp_servers.openapi_to]\ncommand = "pnpm"\n[mcp_servers.openapi_to.extra]\nvalue = true\n',
		);
		await expect(
			setup({ dryRun: true }, { assetRoot, workingDirectory: () => root }),
		).rejects.toMatchObject({ code: "CONFIG_SETUP_CODEX_CONFLICT" });
	});

	it("rejects a symlinked Codex directory before reading outside the project", async () => {
		await mkdir(path.join(root, ".codex-target"), { recursive: true });
		await writeFile(
			path.join(root, ".codex-target/config.toml"),
			'command = "outside"\n',
		);
		try {
			await symlink(
				path.join(root, ".codex-target"),
				path.join(root, ".codex"),
				"dir",
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EPERM") return;
			throw error;
		}
		await expect(
			setup({ dryRun: true }, { assetRoot, workingDirectory: () => root }),
		).rejects.toMatchObject({ code: "CONFIG_SETUP_UNSAFE_PATH" });
	});

	it("rejects an mcp_servers array before appending a dotted server section", async () => {
		await mkdir(path.join(root, ".codex"), { recursive: true });
		await writeFile(
			path.join(root, ".codex/config.toml"),
			'[[mcp_servers]]\nname = "other"\n',
		);
		await expect(
			setup({ dryRun: true }, { assetRoot, workingDirectory: () => root }),
		).rejects.toMatchObject({ code: "CONFIG_SETUP_CODEX_CONFLICT" });
	});

	it("does not require write access when the existing ignore rule is already current", async () => {
		await writeFile(path.join(root, ".gitignore"), "/.openapi-to/\n");
		await chmod(path.join(root, ".gitignore"), 0o444);
		await expect(
			setup({}, { assetRoot, workingDirectory: () => root }),
		).resolves.toMatchObject({ success: true, state: "RESTART_REQUIRED" });
		await expect(
			access(path.join(root, "openapi.config.ts")),
		).resolves.toBeUndefined();
	});

	it("rejects a non-pnpm package manager even when a pnpm lockfile is present", async () => {
		await writeFile(
			path.join(root, "package.json"),
			`${JSON.stringify({
				private: true,
				type: "module",
				packageManager: "npm@11.0.0",
				devDependencies: { "openapi-to": "4.0.0-rc.3" },
			})}\n`,
		);
		await expect(
			setup({ dryRun: true }, { assetRoot, workingDirectory: () => root }),
		).rejects.toMatchObject({ code: "CONFIG_SETUP_PNPM_REQUIRED" });
	});

	it("uses the verified Windows launcher form", async () => {
		await setup(
			{},
			{ assetRoot, platform: "win32", workingDirectory: () => root },
		);
		const codex = await readFile(path.join(root, ".codex/config.toml"), "utf8");
		expect(codex).toContain('command = "cmd.exe"');
		expect(codex).toContain('/d", "/s", "/c');
		expect(codex).toContain("--workspace-root . --config openapi.config.ts");
	});
});
