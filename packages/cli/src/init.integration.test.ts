import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { init } from "./init.ts";
import { type CLIIO, run } from "./index.ts";
import { spinner } from "./utils/spinner.ts";

function isolatedGitEnvironment(): NodeJS.ProcessEnv {
	const environment = { ...process.env };
	for (const name of Object.keys(environment)) {
		if (name.startsWith("GIT_")) {
			delete environment[name];
		}
	}
	return environment;
}

describe.sequential("openapi init filesystem behavior", () => {
	let originalCwd: string;
	let originalExitCode: string | number | null | undefined;
	let root: string;

	beforeEach(async () => {
		originalCwd = process.cwd();
		originalExitCode = process.exitCode;
		root = await mkdtemp(path.join(os.tmpdir(), "openapi-init-"));
		process.chdir(root);
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		process.exitCode = originalExitCode;
		vi.restoreAllMocks();
		await rm(root, { recursive: true, force: true });
	});

	it.each([
		["commonjs", "openapi.config.js"],
		["module", "openapi.config.ts"],
	])(
		"creates a trackable root config for a %s workspace",
		async (type, configName) => {
			const start = vi.spyOn(spinner, "start");
			const succeed = vi.spyOn(spinner, "succeed");
			await writeFile(
				path.join(root, "package.json"),
				`${JSON.stringify({ private: true, type }, null, 2)}\n`,
			);
			await writeFile(
				path.join(root, ".gitignore"),
				"dist/\n.openapi-to-cache/",
			);

			await init();
			expect(start).toHaveBeenCalledWith("📦 Initializing openapi-to");
			expect(succeed).toHaveBeenCalledWith("📦 initialized openapi-to");

			const configPath = path.join(root, configName);
			const config = await readFile(configPath, "utf8");
			expect(config).toContain(
				type === "module" ? "export default" : "module.exports",
			);
			expect(config).toContain("pluginSWR()");
			expect(config).not.toContain("pluginVueQuery()");
			expect(config).toContain(
				"Import pluginVueQuery and replace pluginSWR() when using Vue Query.",
			);
			await expect(access(path.join(root, ".OpenAPI"))).rejects.toThrow();
			await expect(access(path.join(root, ".openapi-to"))).rejects.toThrow();
			const gitignore = await readFile(path.join(root, ".gitignore"), "utf8");
			expect(gitignore.match(/^\/\.openapi-to\/$/gm)).toHaveLength(1);
			expect(gitignore).toContain(
				".openapi-to-cache/\n# https://github.com/Vc-great/openapi-to\n/.openapi-to/\n",
			);

			const gitEnvironment = isolatedGitEnvironment();
			await execa("git", ["init", "--quiet"], {
				cwd: root,
				env: gitEnvironment,
				extendEnv: false,
			});
			await mkdir(path.join(root, ".openapi-to"));
			await writeFile(path.join(root, ".openapi-to", "state.json"), "{}\n");
			const ignoredState = await execa(
				"git",
				["check-ignore", "--quiet", ".openapi-to/state.json"],
				{
					cwd: root,
					env: gitEnvironment,
					extendEnv: false,
					reject: false,
				},
			);
			const trackedConfig = await execa(
				"git",
				["check-ignore", "--quiet", configName],
				{
					cwd: root,
					env: gitEnvironment,
					extendEnv: false,
					reject: false,
				},
			);
			expect(ignoredState.exitCode).toBe(0);
			expect(trackedConfig.exitCode).toBe(1);

			const configBefore = await readFile(configPath, "utf8");
			const gitignoreBefore = await readFile(
				path.join(root, ".gitignore"),
				"utf8",
			);
			await expect(init()).rejects.toThrow(/configuration already exists/i);
			expect(await readFile(configPath, "utf8")).toBe(configBefore);
			expect(await readFile(path.join(root, ".gitignore"), "utf8")).toBe(
				gitignoreBefore,
			);
		},
	);

	it.each([
		["commonjs", "openapi.config.js", "commonjs"],
		["module", "openapi.config.ts", "module"],
	])(
		"REG-INIT-JSON-STDOUT emits one JSON document for a fresh %s workspace and repeat failure",
		async (type, configName, moduleType) => {
			await writeFile(
				path.join(root, "package.json"),
				`${JSON.stringify({ private: true, type }, null, 2)}\n`,
			);
			const stdout: string[] = [];
			const stderr: string[] = [];
			const io: CLIIO = {
				stdout: (message) => stdout.push(message),
				stderr: (message) => stderr.push(message),
			};

			const fresh = await run(["node", "openapi", "init", "--json"], io);
			expect(fresh.exitCode).toBe(0);
			expect(stdout).toHaveLength(1);
			expect(JSON.parse(stdout[0] ?? "")).toMatchObject({
				success: true,
				command: "init",
				configPath: configName,
				moduleType,
				created: true,
				diagnostics: [],
			});
			expect(stderr).toEqual([]);

			stdout.length = 0;
			stderr.length = 0;
			const repeat = await run(["node", "openapi", "--json", "init"], io);
			expect(repeat.exitCode).toBe(1);
			expect(stdout).toHaveLength(1);
			expect(JSON.parse(stdout[0] ?? "")).toMatchObject({
				success: false,
				command: "init",
				created: false,
				diagnostics: [
					expect.objectContaining({ code: "CLI_EXECUTION_FAILED" }),
				],
			});
			expect(stderr).toEqual([]);
		},
	);

	it("REG-INIT-JSON-STDOUT uses the CommonJS default without package.json", async () => {
		const stdout: string[] = [];
		const stderr: string[] = [];
		const result = await run(["node", "openapi", "init", "--json"], {
			stdout: (message) => stdout.push(message),
			stderr: (message) => stderr.push(message),
		});
		expect(result.exitCode).toBe(0);
		expect(stdout).toHaveLength(1);
		expect(JSON.parse(stdout[0] ?? "")).toMatchObject({
			success: true,
			configPath: "openapi.config.js",
			moduleType: "commonjs",
		});
		expect(stderr).toEqual([]);
	});
});
