import { constants } from "node:fs";
import { access, lstat, open, writeFile } from "node:fs/promises";
import pathParser from "node:path";
import path from "node:path";
import process from "node:process";
import { PackageManager, stateDirectoryName } from "@openapi-to/core";
import c from "picocolors";
import { commonPresetMeta, modulePresetMeta } from "./presetMeta.ts";
import { spinner } from "./utils/spinner.ts";

export const configFileNames = [
	"openapi.config.ts",
	"openapi.config.js",
	"openapi.config.cjs",
	"openapi.config.mjs",
];
const stateIgnoreRule = `/${stateDirectoryName}/`;

export interface InitResult {
	configPath: string;
	moduleType: "module" | "commonjs";
	created: true;
}

export interface InitInspection {
	moduleType: "module" | "commonjs";
	configPath?: string;
	existingConfigPaths: string[];
	configContent: string;
}

export async function inspectInit(
	workingDirectory = process.cwd(),
): Promise<InitInspection> {
	const packageJson = await new PackageManager(
		path.resolve(workingDirectory, "./package.json"),
	).getPackageJSON();
	const moduleType = packageJson?.type === "module" ? "module" : "commonjs";
	const existingConfigPaths: string[] = [];
	for (const candidate of configFileNames) {
		try {
			await access(pathParser.resolve(workingDirectory, candidate));
			existingConfigPaths.push(candidate);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	const presetMeta =
		moduleType === "module" ? modulePresetMeta : commonPresetMeta;
	return {
		moduleType,
		configPath:
			existingConfigPaths.length === 1 ? existingConfigPaths[0] : undefined,
		existingConfigPaths: existingConfigPaths.sort(),
		configContent: presetMeta,
	};
}

export async function init(
	options: { quiet?: boolean } = {},
): Promise<InitResult> {
	if (!options.quiet) spinner.start("📦 Initializing openapi-to");
	const result = await createConfig(options.quiet === true);
	await ensureGitignore(options.quiet === true);
	if (!options.quiet) spinner.succeed("📦 initialized openapi-to");
	return result;
}

async function createConfig(quiet: boolean): Promise<InitResult> {
	const inspection = await inspectInit();
	const moduleType = inspection.moduleType;
	const configName = `openapi.config.${moduleType === "module" ? "ts" : "js"}`;
	const filePath = pathParser.resolve(process.cwd(), configName);
	const existing = inspection.existingConfigPaths;
	if (existing.length > 0) {
		throw new Error(
			`OpenAPI configuration already exists: ${existing.sort().join(", ")}.`,
		);
	}
	if (!quiet) spinner.start(`📀 Writing \`${configName}\` ${c.dim(filePath)}`);
	await writeFile(filePath, inspection.configContent, {
		encoding: "utf8",
		flag: "wx",
	});
	if (!quiet) spinner.succeed(`📀 Wrote \`${configName}\` ${c.dim(filePath)}`);
	return { configPath: configName, moduleType, created: true };
}

/**
 * 创建gitignore文件
 */
export async function ensureGitignore(quiet = false): Promise<boolean> {
	const gitignorePath = pathParser.resolve(process.cwd(), ".gitignore");
	const content = `# https://github.com/Vc-great/openapi-to\n${stateIgnoreRule}\n`;
	if (!quiet)
		spinner.start(
			`📀 Writing \`${stateIgnoreRule}\` to the .gitignore ${c.dim(gitignorePath)}`,
		);

	let fileContent = "";
	let existing = false;
	let expectedIdentity:
		| { dev: bigint | number; ino: bigint | number }
		| undefined;
	if (constants.O_NOFOLLOW === undefined) {
		try {
			const details = await lstat(gitignorePath);
			if (details.isSymbolicLink() || !details.isFile())
				throw new Error(".gitignore must be a regular file.");
			expectedIdentity = details;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	let readHandle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		readHandle = await open(
			gitignorePath,
			constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
		);
		const details = await readHandle.stat();
		if (!details.isFile())
			throw new Error(".gitignore must be a regular file.");
		if (
			expectedIdentity &&
			(details.dev !== expectedIdentity.dev ||
				details.ino !== expectedIdentity.ino)
		)
			throw new Error(".gitignore changed while it was being inspected.");
		fileContent = await readHandle.readFile("utf8");
		existing = true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	} finally {
		await readHandle?.close();
	}
	const hasStateRule = fileContent
		.split(/\r?\n/)
		.some((line) => line.trim() === stateIgnoreRule);
	if (!hasStateRule) {
		const separator =
			fileContent.length === 0 || fileContent.endsWith("\n") ? "" : "\n";
		const updated = `${fileContent}${separator}${content}`;
		if (!existing) {
			await writeFile(gitignorePath, updated, { encoding: "utf8", flag: "wx" });
		} else {
			const writeHandle = await open(
				gitignorePath,
				constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
			);
			try {
				const details = await writeHandle.stat();
				if (
					expectedIdentity &&
					(details.dev !== expectedIdentity.dev ||
						details.ino !== expectedIdentity.ino)
				)
					throw new Error(".gitignore changed before it was updated.");
				if ((await writeHandle.readFile("utf8")) !== fileContent)
					throw new Error(".gitignore changed before it was updated.");
				const bytes = Buffer.from(updated, "utf8");
				await writeHandle.write(bytes, 0, bytes.byteLength, 0);
				await writeHandle.truncate(Buffer.byteLength(updated));
				await writeHandle.sync();
			} finally {
				await writeHandle.close();
			}
		}
	}
	if (!quiet)
		spinner.succeed(
			`📀 Wrote \`${stateIgnoreRule}\` to the .gitignore ${c.dim(gitignorePath)}`,
		);
	return !hasStateRule;
}
