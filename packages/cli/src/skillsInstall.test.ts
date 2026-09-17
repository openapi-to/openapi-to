import { createHash } from "node:crypto";
import {
	cp,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ExitCode } from "@openapi-to/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	buildConsumerSkillAssets,
	consumerSkillNames,
} from "../../../scripts/build-consumer-skill-assets.mjs";
import { type CLIIO, run } from "./index.ts";
import {
	installCodexSkills as installCodexSkillsImplementation,
	parseSkillsInstallRequest,
	SkillsInstallError,
	type SkillsInstallRequest,
	skillsInstallHumanOutput,
} from "./skillsInstall.ts";

const repositoryRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);
const packageVersion = "9.8.7-test";

function installCodexSkills(
	request: Omit<SkillsInstallRequest, "scope"> &
		Partial<Pick<SkillsInstallRequest, "scope">>,
	packageVersion_: string,
	dependencies: Parameters<typeof installCodexSkillsImplementation>[2],
) {
	return installCodexSkillsImplementation(
		{ scope: "project", ...request },
		packageVersion_,
		dependencies,
	);
}

async function filesBelow(root: string, relativeDirectory = "") {
	const directory = path.join(
		root,
		...relativeDirectory.split("/").filter(Boolean),
	);
	const entries = (await readdir(directory, { withFileTypes: true })).sort(
		(left, right) =>
			left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
	);
	const files: Array<{ path: string; bytes: Buffer; sha256: string }> = [];
	for (const entry of entries) {
		const relativePath = relativeDirectory
			? `${relativeDirectory}/${entry.name}`
			: entry.name;
		if (entry.isDirectory()) {
			files.push(...(await filesBelow(root, relativePath)));
		} else if (entry.isFile()) {
			const bytes = await readFile(path.join(root, ...relativePath.split("/")));
			files.push({
				path: relativePath,
				bytes,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			});
		}
	}
	return files;
}

describe("Codex Skill installer", { concurrent: false }, () => {
	let root: string;
	let assetRoot: string;
	let codexHome: string;
	let dependencies: {
		assetRoot: string;
		environment: NodeJS.ProcessEnv;
		homeDirectory: () => string;
		workingDirectory: () => string;
	};

	beforeEach(async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "openapi-to-skills-install-"));
		const packageDirectory = path.join(root, "package");
		assetRoot = path.join(root, "assets");
		codexHome = path.join(root, "Codex Home 空格", ".agents");
		await mkdir(path.dirname(codexHome), { recursive: true });
		await mkdir(packageDirectory, { recursive: true });
		await writeFile(
			path.join(packageDirectory, "package.json"),
			`${JSON.stringify({
				name: "@openapi-to/cli",
				version: packageVersion,
			})}\n`,
		);
		await buildConsumerSkillAssets({
			sourceRoot: path.join(repositoryRoot, ".agents", "skills"),
			packageDirectory,
			outputDirectory: assetRoot,
		});
		dependencies = {
			assetRoot,
			environment: { CODEX_HOME: codexHome },
			homeDirectory: () => path.join(root, "unused-home"),
			workingDirectory: () => path.dirname(codexHome),
		};
	});

	afterEach(async () => {
		process.exitCode = 0;
		vi.restoreAllMocks();
		await rm(root, { recursive: true, force: true });
	});

	async function createRetainedTransaction(nonce: string) {
		await expect(
			installCodexSkills({ dryRun: false, json: true }, packageVersion, {
				...dependencies,
				processId: 999_999,
				transactionNonce: () => nonce,
				beforeTargetCommit: async (skill) => {
					if (skill === "openapi-to-setup") {
						throw new Error("retain transaction after first target");
					}
				},
				beforeTargetRollback: async () => {
					throw new Error("retain transaction for recovery");
				},
			}),
		).rejects.toMatchObject({ code: "SKILLS_INSTALL_RECOVERY_REQUIRED" });
	}

	it("requires exactly --host codex and rejects unsupported actions", () => {
		expect(() => parseSkillsInstallRequest("install", {})).toThrowError(
			expect.objectContaining({ code: "SKILLS_HOST_REQUIRED" }),
		);
		expect(() =>
			parseSkillsInstallRequest("install", { host: true }),
		).toThrowError(expect.objectContaining({ code: "SKILLS_HOST_EMPTY" }));
		expect(() =>
			parseSkillsInstallRequest("install", { host: ["codex", "codex"] }),
		).toThrowError(expect.objectContaining({ code: "SKILLS_HOST_DUPLICATE" }));
		expect(() =>
			parseSkillsInstallRequest("install", { host: "cursor" }),
		).toThrowError(
			expect.objectContaining({ code: "SKILLS_HOST_UNSUPPORTED" }),
		);
		expect(() =>
			parseSkillsInstallRequest("update", { host: "codex" }),
		).toThrowError(
			expect.objectContaining({ code: "SKILLS_ACTION_UNSUPPORTED" }),
		);
		expect(() =>
			parseSkillsInstallRequest("install", { host: "codex" }),
		).toThrowError(expect.objectContaining({ code: "SKILLS_SCOPE_REQUIRED" }));
		expect(() =>
			parseSkillsInstallRequest("install", {
				host: "codex",
				scope: "workspace",
			}),
		).toThrowError(
			expect.objectContaining({ code: "SKILLS_SCOPE_UNSUPPORTED" }),
		);
		expect(
			parseSkillsInstallRequest("install", {
				host: "codex",
				scope: "project",
				dryRun: true,
				json: true,
			}),
		).toEqual({ dryRun: true, json: true, scope: "project" });
	});

	it("dry-runs with an exact JSON-ready plan and creates no CODEX_HOME", async () => {
		const output = await installCodexSkills(
			{ dryRun: true, json: true },
			packageVersion,
			dependencies,
		);
		expect(output).toMatchObject({
			success: true,
			command: "skills install",
			mode: "dry-run",
			host: "codex",
			packageVersion,
			source: "packaged-npm-assets",
			destinationRoot: path.join(codexHome, "skills"),
			skills: consumerSkillNames,
			installed: [],
			restartRequired: true,
		});
		expect(output.actions).toEqual(
			consumerSkillNames.map((skill) => ({
				action: "install",
				skill,
				destination: path.join(codexHome, "skills", skill),
			})),
		);
		expect(JSON.parse(JSON.stringify(output))).toEqual(output);
		await expect(lstat(codexHome)).rejects.toMatchObject({ code: "ENOENT" });
		expect(skillsInstallHumanOutput(output)).toContain(
			"No files were written.",
		);
		expect(skillsInstallHumanOutput(output).join("\n")).toContain(
			`Destination: ${output.destinationRoot}`,
		);
		expect(skillsInstallHumanOutput(output).join("\n")).toContain(
			"Scope: project",
		);
		const firstSkill = consumerSkillNames.at(0);
		if (!firstSkill) throw new Error("consumer Skill fixture is empty");
		expect(skillsInstallHumanOutput(output).join("\n")).toContain(
			`- install ${firstSkill} -> ${path.join(output.destinationRoot, firstSkill)}`,
		);
	});

	it("resolves project scope from the exact current working directory", async () => {
		const nestedProject = path.join(root, "nested", "project");
		await mkdir(nestedProject, { recursive: true });
		const output = await installCodexSkills(
			{ dryRun: true, json: true, scope: "project" },
			packageVersion,
			{ ...dependencies, workingDirectory: () => nestedProject },
		);
		expect(output.scope).toBe("project");
		expect(output.destinationRoot).toBe(
			path.join(nestedProject, ".agents", "skills"),
		);
	});

	it("rejects a filesystem root as the scope authority", async () => {
		const filesystemRoot = path.parse(process.cwd()).root;
		for (const scope of ["project", "user"] as const) {
			await expect(
				installCodexSkills(
					{ dryRun: true, json: true, scope },
					packageVersion,
					{
						...dependencies,
						workingDirectory: () => filesystemRoot,
						homeDirectory: () => filesystemRoot,
					},
				),
			).rejects.toMatchObject({ code: "SKILLS_DESTINATION_INVALID" });
		}
	});

	it("reports legacy installations without changing them", async () => {
		const legacyHome = path.join(root, "legacy-home");
		const legacySkill = path.join(
			legacyHome,
			".codex",
			"skills",
			"openapi-to-setup",
		);
		await mkdir(legacySkill, { recursive: true });
		const sentinel = path.join(legacySkill, "sentinel.txt");
		await writeFile(sentinel, "preserved\n");
		const output = await installCodexSkills(
			{ dryRun: true, json: true, scope: "user" },
			packageVersion,
			{ ...dependencies, homeDirectory: () => legacyHome },
		);
		expect(output.warnings).toEqual([
			`SKILLS_LEGACY_INSTALL_DETECTED: Existing legacy Skill installation at ${legacySkill}. No automatic migration was performed.`,
		]);
		expect(await readFile(sentinel, "utf8")).toBe("preserved\n");
	});

	it("fails closed when the .agents root is an unsafe symlink", async (t) => {
		if (process.platform === "win32") {
			t.skip();
			return;
		}
		const projectRoot = path.join(root, "symlink-project");
		const externalRoot = path.join(root, "symlink-external");
		await mkdir(projectRoot, { recursive: true });
		await mkdir(externalRoot, { recursive: true });
		await symlink(externalRoot, path.join(projectRoot, ".agents"), "dir");
		await expect(
			installCodexSkills(
				{ dryRun: false, json: true, scope: "project" },
				packageVersion,
				{ ...dependencies, workingDirectory: () => projectRoot },
			),
		).rejects.toMatchObject({ code: "SKILLS_DESTINATION_INVALID" });
		expect(await readdir(externalRoot)).toEqual([]);
	});

	it("installs both Skills, verifies every byte, and requires restart", async () => {
		const output = await installCodexSkills(
			{ dryRun: false, json: true },
			packageVersion,
			dependencies,
		);
		expect(output).toMatchObject({
			mode: "install",
			installed: consumerSkillNames,
			restartRequired: true,
		});
		for (const name of consumerSkillNames) {
			const packaged = await filesBelow(path.join(assetRoot, name));
			const installed = await filesBelow(path.join(codexHome, "skills", name));
			expect(installed.map(({ path, sha256 }) => ({ path, sha256 }))).toEqual(
				packaged.map(({ path, sha256 }) => ({ path, sha256 })),
			);
			for (const [index, file] of installed.entries()) {
				expect(file.bytes).toEqual(packaged.at(index)?.bytes);
			}
		}
		expect(await readdir(path.join(codexHome, "skills"))).toEqual(
			consumerSkillNames,
		);
		expect(skillsInstallHumanOutput(output)).toContain("restartRequired: true");
	});

	it("fails before writing when either destination already exists", async () => {
		for (const conflict of consumerSkillNames) {
			await rm(codexHome, { recursive: true, force: true });
			const skillsRoot = path.join(codexHome, "skills");
			await mkdir(path.join(skillsRoot, conflict), { recursive: true });
			await writeFile(
				path.join(skillsRoot, conflict, "sentinel.txt"),
				"preserved\n",
			);
			const before = await filesBelow(codexHome);
			await expect(
				installCodexSkills(
					{ dryRun: false, json: true },
					packageVersion,
					dependencies,
				),
			).rejects.toMatchObject({ code: "SKILLS_DESTINATION_CONFLICT" });
			const after = await filesBelow(codexHome);
			expect(after).toEqual(before);
			const other = consumerSkillNames.find((name) => name !== conflict);
			expect(other).toBeDefined();
			await expect(
				lstat(path.join(skillsRoot, String(other))),
			).rejects.toMatchObject({
				code: "ENOENT",
			});
		}
	});

	it("rejects a destination symlink without following or modifying it", async (t) => {
		const skillsRoot = path.join(codexHome, "skills");
		const external = path.join(root, "external");
		await Promise.all([
			mkdir(skillsRoot, { recursive: true }),
			mkdir(external, { recursive: true }),
		]);
		try {
			await symlink(
				external,
				path.join(skillsRoot, "openapi-to-generate"),
				process.platform === "win32" ? "junction" : "dir",
			);
		} catch (error) {
			if (
				process.platform === "win32" &&
				["EPERM", "EACCES"].includes(
					(error as NodeJS.ErrnoException).code ?? "",
				)
			) {
				t.skip();
				return;
			}
			throw error;
		}
		await expect(
			installCodexSkills(
				{ dryRun: false, json: true },
				packageVersion,
				dependencies,
			),
		).rejects.toMatchObject({ code: "SKILLS_DESTINATION_CONFLICT" });
		expect(await readdir(external)).toEqual([]);
	});

	it("rolls back the first committed Skill when the second commit fails", async () => {
		const skillsRoot = path.join(codexHome, "skills");
		await expect(
			installCodexSkills({ dryRun: false, json: true }, packageVersion, {
				...dependencies,
				beforeTargetCommit: async (skill) => {
					if (skill === "openapi-to-setup") {
						throw new Error("injected second commit failure");
					}
				},
			}),
		).rejects.toMatchObject({ code: "SKILLS_INSTALL_FAILED" });
		for (const name of consumerSkillNames) {
			await expect(lstat(path.join(skillsRoot, name))).rejects.toMatchObject({
				code: "ENOENT",
			});
		}
		await expect(lstat(skillsRoot)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("never overwrites a target that appears during commit", async () => {
		const skillsRoot = path.join(codexHome, "skills");
		await expect(
			installCodexSkills({ dryRun: false, json: true }, packageVersion, {
				...dependencies,
				beforeTargetCommit: async (skill) => {
					if (skill === "openapi-to-generate") {
						await mkdir(path.join(skillsRoot, skill));
					}
				},
			}),
		).rejects.toMatchObject({ code: "SKILLS_DESTINATION_CONFLICT" });
		expect(await readdir(path.join(skillsRoot, "openapi-to-generate"))).toEqual(
			[],
		);
		await expect(
			lstat(path.join(skillsRoot, "openapi-to-setup")),
		).rejects.toMatchObject({ code: "ENOENT" });
		expect(await readdir(skillsRoot)).toEqual(["openapi-to-generate"]);
	});

	it("recovers a retained transaction before retrying the complete install", async () => {
		const skillsRoot = path.join(codexHome, "skills");
		const processId = 999_999;
		await expect(
			installCodexSkills({ dryRun: false, json: true }, packageVersion, {
				...dependencies,
				processId,
				beforeTargetCommit: async (skill) => {
					if (skill === "openapi-to-setup") {
						throw new Error("injected second commit failure");
					}
				},
				beforeTargetRollback: async (skill) => {
					if (skill === "openapi-to-generate") {
						throw new Error("injected rollback failure");
					}
				},
				transactionNonce: () => "retained-transaction",
			}),
		).rejects.toMatchObject({ code: "SKILLS_INSTALL_RECOVERY_REQUIRED" });
		await expect(
			lstat(path.join(skillsRoot, "openapi-to-generate")),
		).resolves.toBeDefined();
		await expect(
			lstat(path.join(skillsRoot, "openapi-to-setup")),
		).rejects.toMatchObject({ code: "ENOENT" });

		const output = await installCodexSkills(
			{ dryRun: false, json: true },
			packageVersion,
			dependencies,
		);
		expect(output.installed).toEqual(consumerSkillNames);
		expect((await readdir(skillsRoot)).sort()).toEqual(consumerSkillNames);
	});

	it("recovers a partially materialized owned target before retrying", async () => {
		const skillsRoot = path.join(codexHome, "skills");
		const destination = path.join(skillsRoot, "openapi-to-generate");
		let injected = false;
		await expect(
			installCodexSkills({ dryRun: false, json: true }, packageVersion, {
				...dependencies,
				processId: 999_999,
				transactionNonce: () => "partial-owned-target",
				writeFile: async (...arguments_) => {
					const target = String(arguments_[0]);
					if (
						!injected &&
						target.startsWith(`${destination}${path.sep}`) &&
						path.basename(target) !== ".openapi-to-install-owner"
					) {
						injected = true;
						throw new Error("injected target copy failure");
					}
					return writeFile(...arguments_);
				},
				beforeTargetRollback: async () => {
					throw new Error("retain transaction for recovery");
				},
			}),
		).rejects.toMatchObject({ code: "SKILLS_INSTALL_RECOVERY_REQUIRED" });
		expect(injected).toBe(true);
		expect(await readdir(destination)).toContain(".openapi-to-install-owner");

		const output = await installCodexSkills(
			{ dryRun: false, json: true },
			packageVersion,
			dependencies,
		);
		expect(output.installed).toEqual(consumerSkillNames);
		expect((await readdir(skillsRoot)).sort()).toEqual(consumerSkillNames);
	});

	it("reports success when retrying a fully committed interrupted transaction", async () => {
		const skillsRoot = path.join(codexHome, "skills");
		await expect(
			installCodexSkills({ dryRun: false, json: true }, packageVersion, {
				...dependencies,
				processId: 999_999,
				transactionNonce: () => "complete-owned-targets",
				afterTargetCommit: async (_skill, index) => {
					if (index === consumerSkillNames.length - 1) {
						throw new Error("injected interruption after complete commit");
					}
				},
				beforeTargetRollback: async () => {
					throw new Error("retain completed transaction for recovery");
				},
			}),
		).rejects.toMatchObject({ code: "SKILLS_INSTALL_RECOVERY_REQUIRED" });
		expect((await readdir(skillsRoot)).sort()).toEqual([
			".openapi-to-skills-install-complete-owned-targets",
			".openapi-to-skills-install.lock",
			...consumerSkillNames,
		]);

		const output = await installCodexSkills(
			{ dryRun: false, json: true },
			packageVersion,
			dependencies,
		);
		expect(output).toMatchObject({
			success: true,
			mode: "install",
			installed: consumerSkillNames,
			restartRequired: true,
		});
		expect((await readdir(skillsRoot)).sort()).toEqual(consumerSkillNames);
	});

	it("preserves a replaced target during rollback for manual recovery", async () => {
		const skillsRoot = path.join(codexHome, "skills");
		const displaced = path.join(codexHome, "displaced-owned-skill");
		const replacement = path.join(skillsRoot, "openapi-to-generate");
		await expect(
			installCodexSkills({ dryRun: false, json: true }, packageVersion, {
				...dependencies,
				beforeTargetCommit: async (skill) => {
					if (skill === "openapi-to-setup") {
						throw new Error("injected second commit failure");
					}
				},
				beforeTargetRollback: async (skill) => {
					if (skill === "openapi-to-generate") {
						await rename(replacement, displaced);
						await mkdir(replacement);
						await writeFile(
							path.join(replacement, "foreign.txt"),
							"preserved\n",
						);
					}
				},
			}),
		).rejects.toMatchObject({ code: "SKILLS_INSTALL_RECOVERY_REQUIRED" });
		expect(await readFile(path.join(replacement, "foreign.txt"), "utf8")).toBe(
			"preserved\n",
		);
		await expect(
			readFile(path.join(displaced, "SKILL.md"), "utf8"),
		).resolves.toContain("openapi-to-generate");
	});

	it("preserves a replaced staging directory during normal failure cleanup", async () => {
		const nonce = "replaced-normal-staging";
		const skillsRoot = path.join(codexHome, "skills");
		const stagingRoot = path.join(
			skillsRoot,
			`.openapi-to-skills-install-${nonce}`,
		);
		const sentinel = path.join(stagingRoot, "foreign-sentinel.txt");
		await expect(
			installCodexSkills({ dryRun: false, json: true }, packageVersion, {
				...dependencies,
				transactionNonce: () => nonce,
				beforeTargetCommit: async (_skill, index) => {
					if (index !== 0) return;
					await rm(stagingRoot, { recursive: true, force: false });
					await mkdir(stagingRoot);
					await writeFile(sentinel, "preserved\n");
					throw new Error("fail after replacing staging");
				},
			}),
		).rejects.toMatchObject({ code: "SKILLS_INSTALL_RECOVERY_REQUIRED" });
		expect(await readFile(sentinel, "utf8")).toBe("preserved\n");
		await expect(lstat(stagingRoot)).resolves.toMatchObject({});
		await expect(
			lstat(path.join(skillsRoot, ".openapi-to-skills-install.lock")),
		).resolves.toMatchObject({});
	});

	it("preserves a replaced staging directory during interrupted recovery", async () => {
		const nonce = "replaced-recovery-staging";
		const skillsRoot = path.join(codexHome, "skills");
		const stagingRoot = path.join(
			skillsRoot,
			`.openapi-to-skills-install-${nonce}`,
		);
		const sentinel = path.join(stagingRoot, "foreign-sentinel.txt");
		await createRetainedTransaction(nonce);
		await rm(stagingRoot, { recursive: true, force: false });
		await mkdir(stagingRoot);
		await writeFile(sentinel, "preserved\n");

		await expect(
			installCodexSkills(
				{ dryRun: false, json: true },
				packageVersion,
				dependencies,
			),
		).rejects.toMatchObject({ code: "SKILLS_INSTALL_RECOVERY_REQUIRED" });
		expect(await readFile(sentinel, "utf8")).toBe("preserved\n");
		await expect(lstat(stagingRoot)).resolves.toMatchObject({});
	});

	it("preserves a staging replacement introduced after normal cleanup verification", async () => {
		const nonce = "replace-after-normal-verification";
		const skillsRoot = path.join(codexHome, "skills");
		const stagingRoot = path.join(
			skillsRoot,
			`.openapi-to-skills-install-${nonce}`,
		);
		const lockPath = path.join(skillsRoot, ".openapi-to-skills-install.lock");
		const quarantineRoot = path.join(lockPath, "staging-quarantine");
		const displaced = path.join(root, "verified-normal-staging");
		await expect(
			installCodexSkills({ dryRun: false, json: true }, packageVersion, {
				...dependencies,
				transactionNonce: () => nonce,
				beforeTargetCommit: async (_skill, index) => {
					if (index === 0) throw new Error("start normal cleanup");
				},
				beforeStagingDetach: async () => {
					await rename(stagingRoot, displaced);
					await mkdir(stagingRoot);
					await writeFile(
						path.join(stagingRoot, "foreign-sentinel.txt"),
						"preserved\n",
					);
				},
			}),
		).rejects.toMatchObject({ code: "SKILLS_INSTALL_RECOVERY_REQUIRED" });
		expect(
			await readFile(path.join(quarantineRoot, "foreign-sentinel.txt"), "utf8"),
		).toBe("preserved\n");
		await expect(
			readFile(path.join(displaced, "openapi-to-generate", "SKILL.md"), "utf8"),
		).resolves.toContain("openapi-to-generate");
		await expect(lstat(lockPath)).resolves.toMatchObject({});
	});

	it("preserves a staging replacement introduced after recovery verification", async () => {
		const nonce = "replace-after-recovery-verification";
		const skillsRoot = path.join(codexHome, "skills");
		const stagingRoot = path.join(
			skillsRoot,
			`.openapi-to-skills-install-${nonce}`,
		);
		const lockPath = path.join(skillsRoot, ".openapi-to-skills-install.lock");
		const quarantineRoot = path.join(lockPath, "staging-quarantine");
		const displaced = path.join(root, "verified-recovery-staging");
		await createRetainedTransaction(nonce);

		await expect(
			installCodexSkills({ dryRun: false, json: true }, packageVersion, {
				...dependencies,
				beforeStagingDetach: async () => {
					await rename(stagingRoot, displaced);
					await mkdir(stagingRoot);
					await writeFile(
						path.join(stagingRoot, "foreign-sentinel.txt"),
						"preserved\n",
					);
				},
			}),
		).rejects.toMatchObject({ code: "SKILLS_INSTALL_RECOVERY_REQUIRED" });
		expect(
			await readFile(path.join(quarantineRoot, "foreign-sentinel.txt"), "utf8"),
		).toBe("preserved\n");
		await expect(
			readFile(path.join(displaced, "openapi-to-generate", "SKILL.md"), "utf8"),
		).resolves.toContain("openapi-to-generate");
		await expect(lstat(lockPath)).resolves.toMatchObject({});
	});

	it("preserves an exact staging replacement introduced after quarantine verification", async () => {
		const nonce = "replace-after-quarantine-verification";
		const skillsRoot = path.join(codexHome, "skills");
		const lockPath = path.join(skillsRoot, ".openapi-to-skills-install.lock");
		const quarantineRoot = path.join(lockPath, "staging-quarantine");
		const displaced = path.join(root, "verified-quarantine-staging");
		await expect(
			installCodexSkills({ dryRun: false, json: true }, packageVersion, {
				...dependencies,
				transactionNonce: () => nonce,
				beforeTargetCommit: async (_skill, index) => {
					if (index === 0) throw new Error("start quarantine cleanup");
				},
				beforeQuarantineCleanup: async () => {
					await rename(quarantineRoot, displaced);
					await cp(displaced, quarantineRoot, { recursive: true });
					await writeFile(
						path.join(quarantineRoot, "foreign-sentinel.txt"),
						"preserved\n",
					);
				},
			}),
		).rejects.toMatchObject({ code: "SKILLS_INSTALL_RECOVERY_REQUIRED" });
		expect(
			await readFile(path.join(quarantineRoot, "foreign-sentinel.txt"), "utf8"),
		).toBe("preserved\n");
		await expect(
			readFile(
				path.join(quarantineRoot, "openapi-to-generate", "SKILL.md"),
				"utf8",
			),
		).resolves.toContain("openapi-to-generate");
		await expect(
			readFile(path.join(displaced, "openapi-to-generate", "SKILL.md"), "utf8"),
		).resolves.toContain("openapi-to-generate");
	});

	it("preserves a recovery replacement introduced after quarantine verification", async () => {
		const nonce = "recovery-replace-after-quarantine";
		const skillsRoot = path.join(codexHome, "skills");
		const lockPath = path.join(skillsRoot, ".openapi-to-skills-install.lock");
		const quarantineRoot = path.join(lockPath, "staging-quarantine");
		const displaced = path.join(root, "recovery-verified-quarantine-staging");
		await createRetainedTransaction(nonce);

		await expect(
			installCodexSkills({ dryRun: false, json: true }, packageVersion, {
				...dependencies,
				beforeQuarantineCleanup: async () => {
					await rename(quarantineRoot, displaced);
					await cp(displaced, quarantineRoot, { recursive: true });
					await writeFile(
						path.join(quarantineRoot, "foreign-sentinel.txt"),
						"preserved\n",
					);
				},
			}),
		).rejects.toMatchObject({ code: "SKILLS_INSTALL_RECOVERY_REQUIRED" });
		expect(
			await readFile(path.join(quarantineRoot, "foreign-sentinel.txt"), "utf8"),
		).toBe("preserved\n");
		await expect(
			readFile(
				path.join(quarantineRoot, "openapi-to-generate", "SKILL.md"),
				"utf8",
			),
		).resolves.toContain("openapi-to-generate");
		await expect(
			readFile(path.join(displaced, "openapi-to-generate", "SKILL.md"), "utf8"),
		).resolves.toContain("openapi-to-generate");
	});

	it("rejects an old or incomplete interrupted transaction journal", async () => {
		const nonce = "old-journal-schema";
		const skillsRoot = path.join(codexHome, "skills");
		const lockPath = path.join(skillsRoot, ".openapi-to-skills-install.lock");
		await createRetainedTransaction(nonce);
		const journalPath = path.join(lockPath, "transaction.json");
		const journal = JSON.parse(await readFile(journalPath, "utf8"));
		journal.schemaVersion = 1;
		delete journal.stagingOwnerMarker;
		await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);

		await expect(
			installCodexSkills(
				{ dryRun: false, json: true },
				packageVersion,
				dependencies,
			),
		).rejects.toMatchObject({ code: "SKILLS_INSTALL_RECOVERY_REQUIRED" });
		await expect(
			lstat(path.join(skillsRoot, `.openapi-to-skills-install-${nonce}`)),
		).resolves.toMatchObject({});
		await expect(lstat(lockPath)).resolves.toMatchObject({});
	});

	it.each([
		{
			name: "a missing staging owner marker",
			mutate: async ({
				stagingRoot,
			}: {
				stagingRoot: string;
				lockPath: string;
			}) => {
				await rm(path.join(stagingRoot, ".openapi-to-staging-owner"));
			},
		},
		{
			name: "a staging owner marker with the wrong nonce",
			mutate: async ({
				stagingRoot,
			}: {
				stagingRoot: string;
				lockPath: string;
			}) => {
				await writeFile(
					path.join(stagingRoot, ".openapi-to-staging-owner"),
					"openapi-to-staging:wrong-nonce\n",
				);
			},
		},
		{
			name: "an unexplained staging file",
			mutate: async ({
				stagingRoot,
			}: {
				stagingRoot: string;
				lockPath: string;
			}) => {
				await writeFile(path.join(stagingRoot, "foreign.txt"), "preserved\n");
			},
		},
		{
			name: "an unexplained staging directory",
			mutate: async ({
				stagingRoot,
			}: {
				stagingRoot: string;
				lockPath: string;
			}) => {
				await mkdir(path.join(stagingRoot, "foreign-directory"));
			},
		},
		{
			name: "a missing staging ownership record",
			mutate: async ({
				lockPath,
			}: {
				stagingRoot: string;
				lockPath: string;
			}) => {
				await rm(path.join(lockPath, "staging-owner.json"));
			},
		},
		{
			name: "a corrupted staging ownership record",
			mutate: async ({
				lockPath,
			}: {
				stagingRoot: string;
				lockPath: string;
			}) => {
				await writeFile(path.join(lockPath, "staging-owner.json"), "{\n");
			},
		},
		{
			name: "a persisted staging identity mismatch",
			mutate: async ({
				lockPath,
			}: {
				stagingRoot: string;
				lockPath: string;
			}) => {
				const recordPath = path.join(lockPath, "staging-owner.json");
				const record = JSON.parse(await readFile(recordPath, "utf8"));
				record.stagingIdentity.inode = (
					BigInt(record.stagingIdentity.inode) + 1n
				).toString();
				await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
			},
		},
	])("fails closed for $name", async ({ mutate }) => {
		const nonce = "tampered-staging";
		const skillsRoot = path.join(codexHome, "skills");
		const stagingRoot = path.join(
			skillsRoot,
			`.openapi-to-skills-install-${nonce}`,
		);
		const lockPath = path.join(skillsRoot, ".openapi-to-skills-install.lock");
		await expect(
			installCodexSkills({ dryRun: false, json: true }, packageVersion, {
				...dependencies,
				transactionNonce: () => nonce,
				beforeTargetCommit: async (_skill, index) => {
					if (index !== 0) return;
					await mutate({ stagingRoot, lockPath });
					throw new Error("fail after tampering with staging ownership");
				},
			}),
		).rejects.toMatchObject({ code: "SKILLS_INSTALL_RECOVERY_REQUIRED" });
		await expect(lstat(stagingRoot)).resolves.toMatchObject({});
		await expect(lstat(lockPath)).resolves.toMatchObject({});
	});

	it("fails closed for staging ownership symlinks without following them", async (t) => {
		if (process.platform === "win32") {
			t.skip();
			return;
		}
		for (const target of ["staging", "marker", "record"] as const) {
			const nonce = `symlink-${target}`;
			const skillsRoot = path.join(codexHome, "skills");
			const stagingRoot = path.join(
				skillsRoot,
				`.openapi-to-skills-install-${nonce}`,
			);
			const external = path.join(root, `external-${target}`);
			await mkdir(external);
			await writeFile(path.join(external, "sentinel.txt"), "preserved\n");
			await expect(
				installCodexSkills({ dryRun: false, json: true }, packageVersion, {
					...dependencies,
					transactionNonce: () => nonce,
					beforeTargetCommit: async (_skill, index) => {
						if (index !== 0) return;
						if (target === "staging") {
							await rm(stagingRoot, { recursive: true, force: false });
							await symlink(external, stagingRoot, "dir");
						} else if (target === "marker") {
							const marker = path.join(
								stagingRoot,
								".openapi-to-staging-owner",
							);
							await rm(marker);
							await symlink(path.join(external, "sentinel.txt"), marker);
						} else {
							const record = path.join(
								skillsRoot,
								".openapi-to-skills-install.lock",
								"staging-owner.json",
							);
							await rm(record);
							await symlink(path.join(external, "sentinel.txt"), record);
						}
						throw new Error("fail after adding staging symlink");
					},
				}),
			).rejects.toMatchObject({ code: "SKILLS_INSTALL_RECOVERY_REQUIRED" });
			expect(await readFile(path.join(external, "sentinel.txt"), "utf8")).toBe(
				"preserved\n",
			);
			await rm(codexHome, { recursive: true, force: true });
		}
	});

	it("cleans staging and destinations after a copy failure", async () => {
		let writes = 0;
		await expect(
			installCodexSkills({ dryRun: false, json: true }, packageVersion, {
				...dependencies,
				writeFile: async (...arguments_) => {
					writes += 1;
					if (writes === 2) throw new Error("injected copy failure");
					return writeFile(...arguments_);
				},
			}),
		).rejects.toMatchObject({ code: "SKILLS_INSTALL_FAILED" });
		expect(writes).toBe(2);
		await expect(lstat(codexHome)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("fails closed before staging without leaving a lock", async () => {
		await expect(
			installCodexSkills({ dryRun: false, json: true }, packageVersion, {
				...dependencies,
				beforeStaging: async () => {
					throw new Error("injected staging failure");
				},
			}),
		).rejects.toMatchObject({ code: "SKILLS_INSTALL_FAILED" });
		await expect(lstat(codexHome)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("detects a replaced skills root before staging and never follows it", async (t) => {
		const skillsRoot = path.join(codexHome, "skills");
		const displaced = path.join(codexHome, "displaced-skills");
		const external = path.join(root, "external-race-target");
		await mkdir(external);
		let swapped = false;
		await expect(
			installCodexSkills({ dryRun: false, json: true }, packageVersion, {
				...dependencies,
				beforeStaging: async () => {
					await rename(skillsRoot, displaced);
					try {
						await symlink(
							external,
							skillsRoot,
							process.platform === "win32" ? "junction" : "dir",
						);
					} catch (error) {
						if (
							process.platform === "win32" &&
							["EPERM", "EACCES"].includes(
								(error as NodeJS.ErrnoException).code ?? "",
							)
						) {
							await rename(displaced, skillsRoot);
							t.skip();
							return;
						}
						throw error;
					}
					swapped = true;
				},
			}),
		).rejects.toMatchObject({ code: "SKILLS_DESTINATION_CHANGED" });
		if (!swapped) return;
		expect(await readdir(external)).toEqual([]);
		expect(await readdir(displaced)).toEqual([
			".openapi-to-skills-install.lock",
		]);
	});

	it("fails closed for missing, malformed, mismatched, or corrupted manifests", async () => {
		const manifestPath = path.join(assetRoot, "manifest.json");
		const original = await readFile(manifestPath);
		for (const mutation of [
			async () => rm(manifestPath),
			async () => writeFile(manifestPath, "{"),
			async () =>
				writeFile(
					manifestPath,
					original.toString().replace(packageVersion, "wrong-version"),
				),
		]) {
			await writeFile(manifestPath, original);
			await mutation();
			await expect(
				installCodexSkills(
					{ dryRun: true, json: true },
					packageVersion,
					dependencies,
				),
			).rejects.toBeInstanceOf(SkillsInstallError);
			await expect(lstat(codexHome)).rejects.toMatchObject({ code: "ENOENT" });
		}
		await writeFile(manifestPath, original);
		const target = path.join(assetRoot, "openapi-to-generate", "SKILL.md");
		await writeFile(target, `${await readFile(target, "utf8")}\ncorrupted\n`);
		await expect(
			installCodexSkills(
				{ dryRun: true, json: true },
				packageVersion,
				dependencies,
			),
		).rejects.toMatchObject({ code: "SKILLS_ASSET_INTEGRITY_FAILED" });
	});

	it("ignores CODEX_HOME and rejects invalid scope roots", async () => {
		for (const value of ["", "relative/codex"]) {
			const output = await installCodexSkills(
				{ dryRun: true, json: true },
				packageVersion,
				{
					...dependencies,
					environment: { CODEX_HOME: value },
				},
			);
			expect(output.destinationRoot).toBe(path.join(codexHome, "skills"));
		}
		await writeFile(codexHome, "not a directory\n");
		await expect(
			installCodexSkills(
				{ dryRun: false, json: true },
				packageVersion,
				dependencies,
			),
		).rejects.toMatchObject({ code: "SKILLS_DESTINATION_INVALID" });
		await rm(codexHome);
		await mkdir(codexHome);
		await writeFile(path.join(codexHome, "skills"), "not a directory\n");
		await expect(
			installCodexSkills(
				{ dryRun: false, json: true },
				packageVersion,
				dependencies,
			),
		).rejects.toMatchObject({ code: "SKILLS_DESTINATION_INVALID" });
		await expect(
			installCodexSkills({ dryRun: true, json: true }, packageVersion, {
				...dependencies,
				environment: {},
				workingDirectory: () => "",
			}),
		).rejects.toMatchObject({ code: "SKILLS_DESTINATION_INVALID" });
	});

	it("uses ~/.agents/skills for user scope", async () => {
		const home = path.join(root, "User Home");
		const output = await installCodexSkills(
			{ dryRun: true, json: true, scope: "user" },
			packageVersion,
			{
				...dependencies,
				environment: {},
				homeDirectory: () => home,
			},
		);
		expect(output.destinationRoot).toBe(path.join(home, ".agents", "skills"));
		await expect(lstat(home)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("installs user scope independently of CODEX_HOME", async () => {
		const home = path.join(root, "User Home");
		const codexHomeOverride = path.join(root, "ignored-codex-home");
		await mkdir(home, { recursive: true });
		const output = await installCodexSkills(
			{ dryRun: false, json: true, scope: "user" },
			packageVersion,
			{
				...dependencies,
				environment: { CODEX_HOME: codexHomeOverride },
				homeDirectory: () => home,
			},
		);
		expect(output.destinationRoot).toBe(path.join(home, ".agents", "skills"));
		expect(output.installed).toEqual(consumerSkillNames);
		await expect(lstat(codexHomeOverride)).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("rejects a second install without modifying installed bytes", async () => {
		await installCodexSkills(
			{ dryRun: false, json: true },
			packageVersion,
			dependencies,
		);
		const before = await filesBelow(path.join(codexHome, "skills"));
		await expect(
			installCodexSkills(
				{ dryRun: false, json: true },
				packageVersion,
				dependencies,
			),
		).rejects.toMatchObject({ code: "SKILLS_DESTINATION_CONFLICT" });
		expect(await filesBelow(path.join(codexHome, "skills"))).toEqual(before);
	});
});

describe("skills command CLI contract", { concurrent: false }, () => {
	let stdout: string[];
	let stderr: string[];
	let io: CLIIO;

	beforeEach(() => {
		stdout = [];
		stderr = [];
		io = {
			stdout: (message) => stdout.push(message),
			stderr: (message) => stderr.push(message),
		};
	});

	afterEach(() => {
		process.exitCode = 0;
		vi.restoreAllMocks();
	});

	it("emits stable JSON for host validation before or after the command", async () => {
		for (const argv of [
			["node", "openapi", "--json", "skills", "install"],
			["node", "openapi", "skills", "install", "--host", "cursor", "--json"],
			[
				"node",
				"openapi",
				"skills",
				"install",
				"--host",
				"codex",
				"--host",
				"codex",
				"--json",
			],
		]) {
			stdout = [];
			stderr = [];
			const result = await run(argv, io);
			expect(result.exitCode).toBe(ExitCode.GeneralError);
			expect(stderr).toEqual([]);
			expect(JSON.parse(stdout.join("\n"))).toMatchObject({
				success: false,
				command: "skills install",
				diagnostics: [{ code: expect.stringMatching(/^SKILLS_HOST_/) }],
			});
		}
	});

	it("requires an explicit scope in the CLI JSON contract", async () => {
		const result = await run(
			["node", "openapi", "skills", "install", "--host", "codex", "--json"],
			io,
		);
		expect(result.exitCode).toBe(ExitCode.GeneralError);
		expect(stderr).toEqual([]);
		expect(JSON.parse(stdout.join("\n"))).toMatchObject({
			success: false,
			diagnostics: [
				{
					code: "SKILLS_SCOPE_REQUIRED",
					message: expect.stringContaining("--scope project"),
				},
			],
		});
	});

	it("rejects overwrite flags through the existing CLI error contract", async () => {
		const result = await run(
			[
				"node",
				"openapi",
				"skills",
				"install",
				"--host",
				"codex",
				"--force",
				"--json",
			],
			io,
		);
		expect(result.exitCode).toBe(ExitCode.GeneralError);
		expect(stderr).toEqual([]);
		expect(JSON.parse(stdout.join("\n"))).toMatchObject({
			success: false,
			diagnostics: [{ code: "CLI_EXECUTION_FAILED" }],
		});
	});

	it("shows focused help without running the installer", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const result = await run(
			["node", "openapi", "skills", "install", "--help"],
			io,
		);
		expect(result.exitCode).toBe(ExitCode.Success);
		expect(log.mock.calls.flat().join("\n")).toContain(
			"skills install --host codex",
		);
		expect(stdout).toEqual([]);
		expect(stderr).toEqual([]);
	});
});
