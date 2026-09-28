import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	buildConsumerSkillAssets,
	consumerSkillNames,
	validateDistributionRelativePath,
} from "./build-consumer-skill-assets.mjs";

const repositoryRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const temporaryRoots = [];

after(async () => {
	await Promise.all(
		temporaryRoots.map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function temporaryRoot(prefix) {
	const root = await mkdtemp(path.join(tmpdir(), prefix));
	temporaryRoots.push(root);
	return root;
}

async function createRepositoryFixture(root, matrixContents = "# Matrix\n") {
	const sourceRoot = path.join(root, ".agents", "skills");
	const packageDirectory = path.join(root, "packages", "cli");
	for (const name of consumerSkillNames) {
		await mkdir(path.join(sourceRoot, name), { recursive: true });
		await writeFile(path.join(sourceRoot, name, "SKILL.md"), `# ${name}\n`);
	}
	await mkdir(path.join(root, "docs"), { recursive: true });
	await writeFile(path.join(root, "docs", "capability-matrix.md"), matrixContents);
	await mkdir(packageDirectory, { recursive: true });
	await writeFile(
		path.join(packageDirectory, "package.json"),
		'{"name":"@openapi-to/cli","version":"1.2.3"}\n',
	);
	return {
		repositoryRoot: root,
		sourceRoot,
		packageDirectory,
		outputDirectory: path.join(packageDirectory, "dist", "skills"),
	};
}

async function filesBelow(root, relativeDirectory = "") {
	const directory = path.join(
		root,
		...relativeDirectory.split("/").filter(Boolean),
	);
	const entries = (await readdir(directory, { withFileTypes: true })).sort(
		(left, right) =>
			left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
	);
	const files = [];
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
				size: bytes.byteLength,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				bytes,
			});
		}
	}
	return files;
}

test("builds exact, versioned, byte-stable assets from the two canonical Skills", async () => {
	const root = await temporaryRoot("openapi-to-skill-assets-");
	const outputDirectory = path.join(root, "dist", "skills");
	const options = {
		sourceRoot: path.join(repositoryRoot, ".agents", "skills"),
		packageDirectory: path.join(repositoryRoot, "packages", "cli"),
		outputDirectory,
	};
	const first = await buildConsumerSkillAssets(options);
	const manifestBytes = await readFile(
		path.join(outputDirectory, "manifest.json"),
	);
	const cliManifest = JSON.parse(
		await readFile(
			path.join(repositoryRoot, "packages/cli/package.json"),
			"utf8",
		),
	);
	assert.equal(first.schemaVersion, 1);
	assert.equal(first.packageVersion, cliManifest.version);
	assert.deepEqual(
		first.skills.map(({ name }) => name),
		consumerSkillNames,
	);

	for (const skill of first.skills) {
		const canonical = await filesBelow(
			path.join(repositoryRoot, ".agents", "skills", skill.name),
		);
		if (skill.name === "openapi-to-generate") {
			const matrixBytes = await readFile(
				path.join(repositoryRoot, "docs", "capability-matrix.md"),
			);
			canonical.push({
				path: "references/capability-matrix.md",
				size: matrixBytes.byteLength,
				sha256: createHash("sha256").update(matrixBytes).digest("hex"),
				bytes: matrixBytes,
			});
			canonical.sort((left, right) =>
				left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
			);
		}
		const distributed = await filesBelow(
			path.join(outputDirectory, skill.name),
		);
		assert.deepEqual(
			distributed.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
			canonical.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
		);
		for (const [index, file] of distributed.entries()) {
			assert.deepEqual(file.bytes, canonical[index].bytes);
		}
		assert.deepEqual(
			skill.files,
			canonical.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
		);
	}

	await writeFile(path.join(outputDirectory, "stale.txt"), "stale\n");
	const second = await buildConsumerSkillAssets(options);
	assert.deepEqual(second, first);
	assert.deepEqual(
		await readFile(path.join(outputDirectory, "manifest.json")),
		manifestBytes,
	);
	assert.equal(
		(await filesBelow(outputDirectory)).some(
			({ path }) => path === "stale.txt",
		),
		false,
	);
});

test("derives updated matrix bytes from an isolated repository fixture", async () => {
	const root = await temporaryRoot("openapi-to-skill-matrix-mutation-");
	const options = await createRepositoryFixture(root, "# Matrix A\n");
	const first = await buildConsumerSkillAssets(options);
	const derivedPath = path.join(
		options.outputDirectory,
		"openapi-to-generate",
		"references",
		"capability-matrix.md",
	);
	const firstBytes = await readFile(derivedPath);
	assert.equal(firstBytes.toString(), "# Matrix A\n");
	assert.deepEqual(
		first.skills[0].files.find(
			({ path: filePath }) => filePath === "references/capability-matrix.md",
		),
		{
			path: "references/capability-matrix.md",
			size: firstBytes.byteLength,
			sha256: createHash("sha256").update(firstBytes).digest("hex"),
		},
	);

	await writeFile(path.join(root, "docs", "capability-matrix.md"), "# Matrix B\n");
	const second = await buildConsumerSkillAssets(options);
	const secondBytes = await readFile(derivedPath);
	assert.equal(secondBytes.toString(), "# Matrix B\n");
	assert.notDeepEqual(secondBytes, firstBytes);
	assert.equal(
		second.skills[0].files.find(
			({ path: filePath }) => filePath === "references/capability-matrix.md",
		).sha256,
		createHash("sha256").update(secondBytes).digest("hex"),
	);
});

test("rejects a canonical file colliding with the derived matrix path", async () => {
	const root = await temporaryRoot("openapi-to-skill-matrix-collision-");
	const options = await createRepositoryFixture(root);
	const collisionPath = path.join(
		options.sourceRoot,
		"openapi-to-generate",
		"references",
		"capability-matrix.md",
	);
	await mkdir(path.dirname(collisionPath), { recursive: true });
	await writeFile(collisionPath, "canonical collision\n");
	await mkdir(options.outputDirectory, { recursive: true });
	await writeFile(path.join(options.outputDirectory, "sentinel.txt"), "preserved\n");
	await assert.rejects(
		buildConsumerSkillAssets(options),
		/collides with canonical file/,
	);
	assert.equal(
		await readFile(path.join(options.outputDirectory, "sentinel.txt"), "utf8"),
		"preserved\n",
	);
});

test("rejects missing, symlinked, non-regular, and empty derived sources", async (t) => {
	const cases = [
		"missing",
		"symlink",
		"symlink-ancestor",
		"non-regular",
		"empty",
	];
	for (const sourceCase of cases) {
		await t.test(sourceCase, async (context) => {
			const root = await temporaryRoot(
				`openapi-to-skill-matrix-${sourceCase}-`,
			);
			const options = await createRepositoryFixture(root);
			const sourcePath = path.join(root, "docs", "capability-matrix.md");
			let expected = /regular file/;
			if (sourceCase === "missing") {
				await rm(sourcePath);
				expected = /ENOENT/;
			} else if (sourceCase === "symlink") {
				await rm(sourcePath);
				try {
					await symlink(path.join(root, "docs", "matrix-target.md"), sourcePath);
				} catch (error) {
					if (
						process.platform === "win32" &&
						["EPERM", "EACCES"].includes(error?.code)
					) {
						context.skip("Windows runner does not permit test symlink creation.");
						return;
					}
					throw error;
				}
			} else if (sourceCase === "symlink-ancestor") {
				const outsideRoot = await temporaryRoot(
					"openapi-to-skill-matrix-outside-",
				);
				await writeFile(
					path.join(outsideRoot, "capability-matrix.md"),
					"# Outside repository\n",
				);
				await rm(path.join(root, "docs"), { recursive: true });
				try {
					await symlink(
						outsideRoot,
						path.join(root, "docs"),
						process.platform === "win32" ? "junction" : "dir",
					);
				} catch (error) {
					if (
						process.platform === "win32" &&
						["EPERM", "EACCES"].includes(error?.code)
					) {
						context.skip("Windows runner does not permit test symlink creation.");
						return;
					}
					throw error;
				}
				expected = /remain inside the repository root/;
			} else if (sourceCase === "non-regular") {
				await rm(sourcePath);
				await mkdir(sourcePath);
			} else {
				await writeFile(sourcePath, "");
				expected = /must not be empty/;
			}
			await assert.rejects(buildConsumerSkillAssets(options), expected);
		});
	}
});

test("rejects symlinks in a canonical Skill before replacing existing assets", async (t) => {
	const root = await temporaryRoot("openapi-to-skill-symlink-");
	const sourceRoot = path.join(root, "source");
	const packageDirectory = path.join(root, "package");
	const outputDirectory = path.join(packageDirectory, "dist", "skills");
	for (const name of consumerSkillNames) {
		await mkdir(path.join(sourceRoot, name), { recursive: true });
		await writeFile(path.join(sourceRoot, name, "SKILL.md"), `# ${name}\n`);
	}
	await mkdir(outputDirectory, { recursive: true });
	await writeFile(path.join(outputDirectory, "sentinel.txt"), "preserved\n");
	await writeFile(
		path.join(packageDirectory, "package.json"),
		'{"name":"@openapi-to/cli","version":"1.2.3"}\n',
	);
	try {
		await symlink(
			path.join(sourceRoot, "openapi-to-generate"),
			path.join(sourceRoot, "openapi-to-setup", "linked"),
			process.platform === "win32" ? "junction" : "dir",
		);
	} catch (error) {
		if (
			process.platform === "win32" &&
			["EPERM", "EACCES"].includes(error?.code)
		) {
			t.skip("Windows runner does not permit test symlink creation.");
			return;
		}
		throw error;
	}
	await assert.rejects(
		buildConsumerSkillAssets({
			sourceRoot,
			packageDirectory,
			outputDirectory,
		}),
		/must not contain symlinks/,
	);
	assert.equal(
		await readFile(path.join(outputDirectory, "sentinel.txt"), "utf8"),
		"preserved\n",
	);
});

test("rejects empty canonical files before replacing existing assets", async () => {
	const root = await temporaryRoot("openapi-to-skill-empty-");
	const sourceRoot = path.join(root, "source");
	const packageDirectory = path.join(root, "package");
	const outputDirectory = path.join(packageDirectory, "dist", "skills");
	for (const name of consumerSkillNames) {
		await mkdir(path.join(sourceRoot, name), { recursive: true });
		await writeFile(path.join(sourceRoot, name, "SKILL.md"), `# ${name}\n`);
	}
	await writeFile(path.join(sourceRoot, "openapi-to-generate", "empty.md"), "");
	await mkdir(outputDirectory, { recursive: true });
	await writeFile(path.join(outputDirectory, "sentinel.txt"), "preserved\n");
	await writeFile(
		path.join(packageDirectory, "package.json"),
		'{"name":"@openapi-to/cli","version":"1.2.3"}\n',
	);
	await assert.rejects(
		buildConsumerSkillAssets({
			sourceRoot,
			packageDirectory,
			outputDirectory,
		}),
		/must not be empty/,
	);
	assert.equal(
		await readFile(path.join(outputDirectory, "sentinel.txt"), "utf8"),
		"preserved\n",
	);
});

test("rejects traversal, platform separators, and non-canonical Skill sets", async () => {
	for (const candidate of [
		"../escape",
		"references\\escape.md",
		"/absolute",
		"references//double.md",
		"./SKILL.md",
	]) {
		assert.throws(
			() => validateDistributionRelativePath(candidate),
			/Unsafe consumer Skill distribution path/,
		);
	}
	const root = await temporaryRoot("openapi-to-skill-names-");
	await assert.rejects(
		buildConsumerSkillAssets({
			sourceRoot: root,
			packageDirectory: root,
			outputDirectory: path.join(root, "dist", "skills"),
			skillNames: ["../escape"],
		}),
		/must contain only/,
	);
});
