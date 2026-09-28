import { createHash } from "node:crypto";
import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

export const consumerSkillNames = ["openapi-to-generate", "openapi-to-setup"];

const derivedConsumerSkillAssets = [
	{
		skillName: "openapi-to-generate",
		source: "docs/capability-matrix.md",
		destination: "references/capability-matrix.md",
	},
];

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function validateDistributionRelativePath(relativePath) {
	if (
		typeof relativePath !== "string" ||
		relativePath.length === 0 ||
		relativePath.includes("\\") ||
		relativePath.includes("\0") ||
		path.posix.isAbsolute(relativePath) ||
		path.posix.normalize(relativePath) !== relativePath ||
		relativePath === "." ||
		relativePath.startsWith("../") ||
		relativePath.split("/").some((segment) => segment.length === 0)
	) {
		throw new Error(
			`Unsafe consumer Skill distribution path: ${JSON.stringify(relativePath)}`,
		);
	}
	return relativePath;
}

function assertCanonicalSkillNames(skillNames) {
	const sorted = [...skillNames].sort(compareText);
	if (
		JSON.stringify(sorted) !==
		JSON.stringify([...consumerSkillNames].sort(compareText))
	) {
		throw new Error(
			`Consumer Skill asset build must contain only: ${consumerSkillNames.join(", ")}`,
		);
	}
	return sorted;
}

async function readCanonicalFiles(skillRoot, relativeDirectory = "") {
	const directory = path.join(
		skillRoot,
		...relativeDirectory.split("/").filter(Boolean),
	);
	const entries = (await readdir(directory, { withFileTypes: true })).sort(
		(left, right) => compareText(left.name, right.name),
	);
	const files = [];
	for (const entry of entries) {
		const relativePath = validateDistributionRelativePath(
			relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name,
		);
		const absolutePath = path.join(skillRoot, ...relativePath.split("/"));
		const details = await lstat(absolutePath);
		if (details.isSymbolicLink()) {
			throw new Error(
				`Consumer Skill source must not contain symlinks: ${relativePath}`,
			);
		}
		if (details.isDirectory()) {
			files.push(...(await readCanonicalFiles(skillRoot, relativePath)));
			continue;
		}
		if (!details.isFile()) {
			throw new Error(
				`Consumer Skill source must contain only regular files: ${relativePath}`,
			);
		}
		const bytes = await readFile(absolutePath);
		if (bytes.byteLength === 0) {
			throw new Error(
				`Consumer Skill source files must not be empty: ${relativePath}`,
			);
		}
		files.push({ relativePath, bytes });
	}
	return files;
}

async function replaceDirectory(stagingDirectory, destinationDirectory) {
	const parentDirectory = path.dirname(destinationDirectory);
	let backupContainer;
	let backupDirectory;
	try {
		const existing = await lstat(destinationDirectory).catch((error) => {
			if (error?.code === "ENOENT") return undefined;
			throw error;
		});
		if (existing) {
			backupContainer = await mkdtemp(
				path.join(parentDirectory, ".consumer-skills-backup-"),
			);
			backupDirectory = path.join(backupContainer, "previous");
			await rename(destinationDirectory, backupDirectory);
		}
		try {
			await rename(stagingDirectory, destinationDirectory);
		} catch (error) {
			if (backupDirectory) {
				await rename(backupDirectory, destinationDirectory);
			}
			throw error;
		}
	} finally {
		if (backupContainer) {
			await rm(backupContainer, { recursive: true, force: true });
		}
	}
}

export async function buildConsumerSkillAssets(options = {}) {
	const effectiveRepositoryRoot = options.repositoryRoot ?? repositoryRoot;
	const sourceRoot =
		options.sourceRoot ?? path.join(effectiveRepositoryRoot, ".agents", "skills");
	const packageDirectory =
		options.packageDirectory ?? path.join(effectiveRepositoryRoot, "packages", "cli");
	const outputDirectory =
		options.outputDirectory ?? path.join(packageDirectory, "dist", "skills");
	const skillNames = assertCanonicalSkillNames(
		options.skillNames ?? consumerSkillNames,
	);
	const packageManifest = JSON.parse(
		await readFile(path.join(packageDirectory, "package.json"), "utf8"),
	);
	if (
		typeof packageManifest.version !== "string" ||
		packageManifest.version.length === 0
	) {
		throw new Error("@openapi-to/cli package version is missing.");
	}

	const outputParent = path.dirname(outputDirectory);
	await mkdir(outputParent, { recursive: true });
	const stagingDirectory = await mkdtemp(
		path.join(outputParent, ".consumer-skills-build-"),
	);
	try {
		const skills = [];
		for (const name of skillNames) {
			const skillRoot = path.join(sourceRoot, name);
			const rootDetails = await lstat(skillRoot);
			if (rootDetails.isSymbolicLink() || !rootDetails.isDirectory()) {
				throw new Error(
					`Consumer Skill source root must be a real directory: ${name}`,
				);
			}
			const canonicalFiles = await readCanonicalFiles(skillRoot);
			if (
				!canonicalFiles.some(({ relativePath }) => relativePath === "SKILL.md")
			) {
				throw new Error(`Consumer Skill ${name} is missing SKILL.md.`);
			}
			const filesToDistribute = canonicalFiles.map((file) => ({ ...file }));
			for (const asset of derivedConsumerSkillAssets.filter(
				({ skillName }) => skillName === name,
			)) {
				const destination = validateDistributionRelativePath(asset.destination);
				if (
					filesToDistribute.some(({ relativePath }) => relativePath === destination)
				) {
					throw new Error(
						`Derived consumer Skill asset collides with canonical file: ${name}/${destination}`,
					);
				}
				const source = validateDistributionRelativePath(asset.source);
				const sourcePath = path.join(
					effectiveRepositoryRoot,
					...source.split("/"),
				);
				const sourceDetails = await lstat(sourcePath);
				if (sourceDetails.isSymbolicLink() || !sourceDetails.isFile()) {
					throw new Error(
						`Derived consumer Skill source must be a regular file: ${source}`,
					);
				}
				const repositoryRealPath = await realpath(effectiveRepositoryRoot);
				const sourceRealPath = await realpath(sourcePath);
				const relativeSourcePath = path.relative(
					repositoryRealPath,
					sourceRealPath,
				);
				if (
					relativeSourcePath === ".." ||
					relativeSourcePath.startsWith(`..${path.sep}`) ||
					path.isAbsolute(relativeSourcePath)
				) {
					throw new Error(
						`Derived consumer Skill source must remain inside the repository root: ${source}`,
					);
				}
				const bytes = await readFile(sourceRealPath);
				if (bytes.byteLength === 0) {
					throw new Error(
						`Derived consumer Skill source must not be empty: ${source}`,
					);
				}
				filesToDistribute.push({ relativePath: destination, bytes });
			}
			filesToDistribute.sort((left, right) =>
				compareText(left.relativePath, right.relativePath),
			);
			const files = [];
			for (const { relativePath, bytes } of filesToDistribute) {
				const destination = path.join(
					stagingDirectory,
					name,
					...relativePath.split("/"),
				);
				await mkdir(path.dirname(destination), { recursive: true });
				await writeFile(destination, bytes, { flag: "wx", mode: 0o644 });
				files.push({
					path: relativePath,
					size: bytes.byteLength,
					sha256: createHash("sha256").update(bytes).digest("hex"),
				});
			}
			skills.push({ name, files });
		}
		const manifest = {
			schemaVersion: 1,
			packageVersion: packageManifest.version,
			skills,
		};
		await writeFile(
			path.join(stagingDirectory, "manifest.json"),
			`${JSON.stringify(manifest, null, 2)}\n`,
			{ flag: "wx", mode: 0o644 },
		);
		await replaceDirectory(stagingDirectory, outputDirectory);
		return manifest;
	} finally {
		await rm(stagingDirectory, { recursive: true, force: true });
	}
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const manifest = await buildConsumerSkillAssets();
	process.stdout.write(
		`Built ${manifest.skills.length} consumer Skills for @openapi-to/cli@${manifest.packageVersion}.\n`,
	);
}
