import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { c as createTar, x as extractTar } from "tar";

import {
	createPublicationFacts,
	createPublicationPlan,
	inspectTarball,
	preparePublicationArtifacts,
	publishVerifiedArtifacts,
	readReleaseNotes,
	verifyPublicationArtifacts,
	verifyRegistry,
} from "./publication.mjs";
import { createWorkspaceOverridesYaml } from "./pack-smoke-helpers.mjs";

const execFileAsync = promisify(execFile);
const VERSION = "4.0.0-rc.2";
const SHA = "a".repeat(40);

async function writeFixtureFile(root, relativePath, contents) {
	const path = join(root, relativePath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, contents);
}

function publicManifest(name, extra = {}) {
	return {
		name,
		version: VERSION,
		repository: {
			type: "git",
			url: "https://github.com/Vc-great/openapi-to.git",
			directory: `packages/${name.split("/").at(-1)}`,
		},
		main: "index.js",
		files: ["index.js"],
		publishConfig: {
			access: "public",
			registry: "https://registry.npmjs.org/",
		},
		...extra,
	};
}

async function createPublicationFixture(t) {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-publication-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFixtureFile(
		root,
		"package.json",
		`${JSON.stringify({
			name: "fixture",
			private: true,
			workspaces: { packages: ["packages/*"] },
			packageManager: "pnpm@10.14.0",
		})}\n`,
	);
	await writeFixtureFile(
		root,
		"pnpm-workspace.yaml",
		"packages:\n  - 'packages/*'\n",
	);
	await writeFixtureFile(
		root,
		"packages/a/package.json",
		`${JSON.stringify(
			publicManifest("@fixture/a", {
				dependencies: { "@fixture/b": "workspace:*" },
			}),
		)}\n`,
	);
	await writeFixtureFile(
		root,
		"packages/b/package.json",
		`${JSON.stringify(publicManifest("@fixture/b"))}\n`,
	);
	await writeFixtureFile(
		root,
		"packages/private/package.json",
		'{"name":"@fixture/private","version":"1.0.0","private":true}\n',
	);
	await writeFixtureFile(
		root,
		"packages/a/index.js",
		'module.exports = require("@fixture/b") + "-a";\n',
	);
	await writeFixtureFile(
		root,
		"packages/b/index.js",
		'module.exports = "b";\n',
	);
	await writeFixtureFile(
		root,
		".changeset/config.json",
		'{"fixed":[["@fixture/a","@fixture/b"]]}\n',
	);
	await writeFixtureFile(
		root,
		".changeset/pre.json",
		'{"mode":"pre","tag":"rc","initialVersions":{},"changesets":[]}\n',
	);
	await writeFixtureFile(
		root,
		"packages/openapi/CHANGELOG.md",
		`# fixture

## ${VERSION}

- Current release notes.

## 3.2.2

- Older notes.
`,
	);
	await execFileAsync("pnpm", ["install", "--ignore-scripts"], {
		cwd: root,
		timeout: 30_000,
	});
	return root;
}

async function prepareFixture(t) {
	const root = await createPublicationFixture(t);
	const artifactDirectory = join(root, ".ci-artifacts/publication-test");
	await preparePublicationArtifacts({
		root,
		artifactDirectory,
		expectedSha: SHA,
		expectedVersion: VERSION,
		channel: "rc",
		resolveHeadSha: async () => SHA,
		resolveTrackedStatus: async () => "",
	});
	const manifestPath = join(artifactDirectory, "publication-manifest.json");
	const manifest = await verifyPublicationArtifacts({
		root,
		manifestPath,
		expectedSha: SHA,
		expectedVersion: VERSION,
		channel: "rc",
	});
	return { root, artifactDirectory, manifestPath, manifest };
}

function registryResponse(metadata, status = 200) {
	const body = new TextEncoder().encode(JSON.stringify(metadata));
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: () => String(body.byteLength) },
		arrayBuffer: async () =>
			body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
	};
}

function registryFixture(manifest, modeByName) {
	return async (url) => {
		const name = decodeURIComponent(new URL(url).pathname.slice(1));
		const packageRecord = manifest.packages.find(
			(candidate) => candidate.name === name,
		);
		const mode = typeof modeByName === "string" ? modeByName : modeByName[name];
		if (mode === "missing") return registryResponse({}, 404);
		if (mode === "503") return registryResponse({}, 503);
		if (mode === "429") return registryResponse({}, 429);
		if (mode === "throw") throw new Error("fixture timeout");
		const integrity =
			mode === "bytes-mismatch"
				? "sha512-ZGlmZmVyZW50"
				: packageRecord.integrity;
		const distTag = mode === "tag-mismatch" ? "4.0.0-rc.1" : VERSION;
		const dist = mode === "incomplete" ? {} : { integrity };
		return registryResponse({
			versions: { [VERSION]: { dist } },
			"dist-tags": { rc: distTag },
		});
	};
}

test("artifact preparation rejects tracked checkout drift before pnpm pack", async (t) => {
	const root = await createPublicationFixture(t);
	let packCalls = 0;
	await assert.rejects(
		preparePublicationArtifacts({
			root,
			artifactDirectory: join(root, ".ci-artifacts/publication-dirty"),
			expectedSha: SHA,
			expectedVersion: VERSION,
			channel: "rc",
			resolveHeadSha: async () => SHA,
			resolveTrackedStatus: async () => " M packages/a/index.js\n",
			runCommand: async () => {
				packCalls += 1;
				throw new Error("pnpm must not run for a dirty checkout");
			},
		}),
		(error) => error.code === "PUBLICATION_WORKTREE_DIRTY",
	);
	assert.equal(packCalls, 0);
});

test("publication facts dynamically discover the fixed group and reject metadata drift", async (t) => {
	const root = await createPublicationFixture(t);
	const facts = await createPublicationFacts({
		root,
		expectedVersion: VERSION,
		channel: "rc",
	});
	assert.equal(facts.packageCount, 2);
	assert.deepEqual(
		facts.packages.map(({ name }) => name),
		["@fixture/b", "@fixture/a"],
	);

	const manifestPath = join(root, "packages/b/package.json");
	const original = JSON.parse(await readFile(manifestPath, "utf8"));
	for (const repository of [
		undefined,
		"https://github.com/Vc-great/openapi-to.git",
		{ type: "git", url: "https://github.com/other/openapi-to.git" },
		{ type: "git", url: "https://github.com/Vc-great/openapi-to-fork.git" },
		{
			type: "git",
			url: "https://github.com/Vc-great/openapi-to.git",
			directory: "packages/a",
		},
	]) {
		await writeFile(
			manifestPath,
			`${JSON.stringify({ ...original, repository })}\n`,
		);
		await assert.rejects(
			createPublicationFacts({
				root,
				expectedVersion: VERSION,
				channel: "rc",
			}),
			/canonical/,
		);
	}
	await writeFile(manifestPath, `${JSON.stringify(original)}\n`);
	await assert.rejects(
		createPublicationFacts({
			root,
			expectedVersion: VERSION,
			channel: "latest",
		}),
		/requires the rc channel/,
	);
});

test("real pnpm pack resolves workspace:* and the same tarballs install in a consumer", async (t) => {
	const { manifest } = await prepareFixture(t);
	assert.equal(manifest.schemaVersion, 1);
	assert.equal(manifest.commitSha, SHA);
	assert.equal(manifest.packageCount, 2);
	const packageA = manifest.packages.find(({ name }) => name === "@fixture/a");
	assert.equal(packageA.packageManifest.dependencies["@fixture/b"], VERSION);
	assert.equal(
		JSON.stringify(packageA.packageManifest).includes("workspace:"),
		false,
	);
	assert.equal(
		packageA.internalDependencies.dependencies["@fixture/b"],
		VERSION,
	);
	for (const packageRecord of manifest.packages) {
		const inspection = await inspectTarball(packageRecord.archive);
		assert.equal(
			JSON.stringify(inspection.manifest).includes("workspace:"),
			false,
		);
		assert.equal(inspection.manifest.repository.type, "git");
		assert.equal(
			inspection.manifest.repository.url,
			"https://github.com/Vc-great/openapi-to.git",
		);
		assert.equal(inspection.manifest.publishConfig.access, "public");
	}

	const consumer = await mkdtemp(join(tmpdir(), "openapi-to-consumer-"));
	t.after(() => rm(consumer, { recursive: true, force: true }));
	const archives = Object.fromEntries(
		manifest.packages.map(({ name, archive }) => [name, `file:${archive}`]),
	);
	await writeFile(
		join(consumer, "package.json"),
		`${JSON.stringify({
			name: "consumer",
			private: true,
			packageManager: "pnpm@10.14.0",
			dependencies: archives,
		})}\n`,
	);
	await writeFile(
		join(consumer, "pnpm-workspace.yaml"),
		createWorkspaceOverridesYaml(archives),
	);
	await execFileAsync("pnpm", ["install", "--offline", "--ignore-scripts"], {
		cwd: consumer,
		timeout: 30_000,
	});
	const result = await execFileAsync(
		process.execPath,
		["-e", 'process.stdout.write(require("@fixture/a"))'],
		{ cwd: consumer, encoding: "utf8" },
	);
	assert.equal(result.stdout, "b-a");
	const installedA = JSON.parse(
		await readFile(
			join(consumer, "node_modules/@fixture/a/package.json"),
			"utf8",
		),
	);
	assert.equal(installedA.dependencies["@fixture/b"], VERSION);
	assert.equal(JSON.stringify(installedA).includes("workspace:"), false);
});

test("artifact verification rejects tampering, replacement, missing, extra, traversal, symlink, and schema drift", async (t) => {
	const prepared = await prepareFixture(t);
	const baseline = join(prepared.root, ".ci-artifacts/publication-baseline");
	await cp(prepared.artifactDirectory, baseline, { recursive: true });

	async function fixtureCopy(label) {
		const directory = join(prepared.root, `.ci-artifacts/publication-${label}`);
		await cp(baseline, directory, { recursive: true });
		return {
			directory,
			manifestPath: join(directory, "publication-manifest.json"),
		};
	}

	{
		const fixture = await fixtureCopy("tarball-tamper");
		const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8"));
		await writeFile(
			join(fixture.directory, manifest.packages[0].tarball),
			"replaced bytes",
		);
		await assert.rejects(
			verifyPublicationArtifacts({
				root: prepared.root,
				manifestPath: fixture.manifestPath,
			}),
			/integrity|tarball/i,
		);
	}
	{
		const fixture = await fixtureCopy("tarball-manifest-metadata");
		const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8"));
		const packageRecord = manifest.packages[0];
		const archive = join(fixture.directory, packageRecord.tarball);
		const extracted = join(prepared.root, ".ci-artifacts/tarball-edit");
		await mkdir(extracted, { recursive: true });
		await extractTar({ cwd: extracted, file: archive, strict: true });
		const packedManifestPath = join(extracted, "package/package.json");
		const packedManifest = JSON.parse(
			await readFile(packedManifestPath, "utf8"),
		);
		packedManifest.repository.url = "https://github.com/other/openapi-to.git";
		await writeFile(
			packedManifestPath,
			`${JSON.stringify(packedManifest, null, 2)}\n`,
		);
		await createTar(
			{ cwd: extracted, file: archive, gzip: true, portable: true },
			["package"],
		);
		const archiveBytes = await readFile(archive);
		packageRecord.size = (await stat(archive)).size;
		packageRecord.sha256 = createHash("sha256")
			.update(archiveBytes)
			.digest("hex");
		packageRecord.integrity = `sha512-${createHash("sha512")
			.update(archiveBytes)
			.digest("base64")}`;
		await writeFile(
			fixture.manifestPath,
			`${JSON.stringify(manifest, null, 2)}\n`,
		);
		await writeFile(
			join(fixture.directory, "SHA256SUMS"),
			`${manifest.packages
				.map(({ sha256, tarball }) => `${sha256}  ${tarball}`)
				.join("\n")}\n`,
		);
		await assert.rejects(
			verifyPublicationArtifacts({
				root: prepared.root,
				manifestPath: fixture.manifestPath,
			}),
			/canonical/,
		);
	}
	{
		const fixture = await fixtureCopy("checksum-tamper");
		await writeFile(join(fixture.directory, "SHA256SUMS"), "bad\n");
		await assert.rejects(
			verifyPublicationArtifacts({
				root: prepared.root,
				manifestPath: fixture.manifestPath,
			}),
			/SHA256SUMS/,
		);
	}
	{
		const fixture = await fixtureCopy("missing");
		const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8"));
		await unlink(join(fixture.directory, manifest.packages[0].tarball));
		await assert.rejects(
			verifyPublicationArtifacts({
				root: prepared.root,
				manifestPath: fixture.manifestPath,
			}),
		);
	}
	{
		const fixture = await fixtureCopy("extra");
		await writeFile(join(fixture.directory, "extra.tgz"), "extra");
		await assert.rejects(
			verifyPublicationArtifacts({
				root: prepared.root,
				manifestPath: fixture.manifestPath,
			}),
			/unexpected files/,
		);
	}
	{
		const fixture = await fixtureCopy("traversal");
		const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8"));
		manifest.packages[0].tarball = "../escape.tgz";
		await writeFile(
			fixture.manifestPath,
			`${JSON.stringify(manifest, null, 2)}\n`,
		);
		await assert.rejects(
			verifyPublicationArtifacts({
				root: prepared.root,
				manifestPath: fixture.manifestPath,
			}),
			/inconsistent|escape/,
		);
	}
	{
		const fixture = await fixtureCopy("schema");
		const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8"));
		manifest.schemaVersion = 2;
		await writeFile(
			fixture.manifestPath,
			`${JSON.stringify(manifest, null, 2)}\n`,
		);
		await assert.rejects(
			verifyPublicationArtifacts({
				root: prepared.root,
				manifestPath: fixture.manifestPath,
			}),
			/schemaVersion/,
		);
	}
	{
		const fixture = await fixtureCopy("schema-extra-key");
		const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8"));
		manifest.unverified = true;
		await writeFile(
			fixture.manifestPath,
			`${JSON.stringify(manifest, null, 2)}\n`,
		);
		await assert.rejects(
			verifyPublicationArtifacts({
				root: prepared.root,
				manifestPath: fixture.manifestPath,
			}),
			/schemaVersion/,
		);
	}
	{
		const fixture = await fixtureCopy("package-extra-key");
		const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8"));
		manifest.packages[0].unverified = true;
		await writeFile(
			fixture.manifestPath,
			`${JSON.stringify(manifest, null, 2)}\n`,
		);
		await assert.rejects(
			verifyPublicationArtifacts({
				root: prepared.root,
				manifestPath: fixture.manifestPath,
			}),
			/package records/,
		);
	}
	{
		const fixture = await fixtureCopy("symlink");
		const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8"));
		const archive = join(fixture.directory, manifest.packages[0].tarball);
		const target = `${archive}.real`;
		await cp(archive, target);
		await unlink(archive);
		try {
			await symlink(target, archive);
		} catch (error) {
			if (error.code === "EPERM") return;
			throw error;
		}
		await assert.rejects(
			verifyPublicationArtifacts({
				root: prepared.root,
				manifestPath: fixture.manifestPath,
			}),
			/symlink/,
		);
	}
});

test("publication plan distinguishes missing, verified, mismatched, and unavailable registry states", async (t) => {
	const { manifest } = await prepareFixture(t);
	const cases = [
		{
			modes: "missing",
			success: true,
			state: "NOTHING_PUBLISHED",
			statuses: ["MISSING", "MISSING"],
		},
		{
			modes: { "@fixture/b": "verified", "@fixture/a": "missing" },
			success: true,
			state: "PARTIAL_PUBLICATION",
			statuses: ["ALREADY_PUBLISHED_VERIFIED", "MISSING"],
		},
		{
			modes: "verified",
			success: true,
			state: "VERIFIED",
			statuses: ["ALREADY_PUBLISHED_VERIFIED", "ALREADY_PUBLISHED_VERIFIED"],
		},
		{
			modes: {
				"@fixture/b": "bytes-mismatch",
				"@fixture/a": "missing",
			},
			success: false,
			state: "PUBLISHED_BYTES_MISMATCH",
		},
		{
			modes: { "@fixture/b": "tag-mismatch", "@fixture/a": "missing" },
			success: false,
			state: "DIST_TAG_MISMATCH",
		},
		{ modes: "503", success: false, state: "REGISTRY_UNAVAILABLE" },
		{ modes: "429", success: false, state: "REGISTRY_UNAVAILABLE" },
		{ modes: "throw", success: false, state: "REGISTRY_UNAVAILABLE" },
		{ modes: "incomplete", success: false, state: "REGISTRY_UNAVAILABLE" },
	];
	for (const fixture of cases) {
		const plan = await createPublicationPlan({
			manifest,
			attempts: 1,
			delayMs: 0,
			fetchImpl: registryFixture(manifest, fixture.modes),
		});
		assert.equal(plan.success, fixture.success);
		assert.equal(plan.state, fixture.state);
		if (fixture.statuses) {
			assert.deepEqual(
				plan.packages.map(({ status }) => status),
				fixture.statuses,
			);
		}
	}
});

test("registry verification requires exact version, tag, and tarball integrity", async (t) => {
	const { manifest } = await prepareFixture(t);
	const verified = await verifyRegistry({
		manifest,
		attempts: 1,
		delayMs: 0,
		fetchImpl: registryFixture(manifest, "verified"),
	});
	assert.equal(verified.success, true);
	assert.equal(verified.state, "VERIFIED");
	assert.equal(verified.verifiedPackages, 2);
	assert.ok(verified.packages.every(({ status }) => status === "VERIFIED"));

	const unavailable = await verifyRegistry({
		manifest,
		attempts: 1,
		delayMs: 0,
		fetchImpl: registryFixture(manifest, "503"),
	});
	assert.equal(unavailable.success, false);
	assert.equal(unavailable.recovery.state, "REGISTRY_UNAVAILABLE");
});

test("npm receives only verified tarballs and safely skips identical published packages", async (t) => {
	const { root, manifest } = await prepareFixture(t);
	const invocations = [];
	const result = await publishVerifiedArtifacts({
		root,
		manifest,
		npmVersion: "12.0.2",
		readNpmVersion: async () => "12.0.2",
		fetchImpl: registryFixture(manifest, {
			"@fixture/b": "verified",
			"@fixture/a": "missing",
		}),
		runNpmPublish: async (invocation) => invocations.push(invocation),
	});
	assert.deepEqual(result.skipped, ["@fixture/b"]);
	assert.deepEqual(result.published, ["@fixture/a"]);
	assert.equal(invocations.length, 1);
	const invocation = invocations[0];
	assert.equal(invocation.command, "npm");
	assert.deepEqual(invocation.arguments, [
		"publish",
		manifest.packages.find(({ name }) => name === "@fixture/a").archive,
		"--tag",
		"rc",
		"--access",
		"public",
	]);
	assert.ok(invocation.arguments[1].endsWith(".tgz"));
	assert.ok(!invocation.arguments.includes("packages/a"));
	assert.ok(!invocation.arguments.includes("--otp"));
	assert.equal(invocation.env.NPM_TOKEN, undefined);
	assert.equal(invocation.env.NODE_AUTH_TOKEN, undefined);
});

test("npm is not invoked if a tarball changes after artifact verification", async (t) => {
	const { root, manifest } = await prepareFixture(t);
	await writeFile(manifest.packages[0].archive, "changed after verification");
	let invocations = 0;
	await assert.rejects(
		publishVerifiedArtifacts({
			root,
			manifest,
			npmVersion: "12.0.2",
			readNpmVersion: async () => "12.0.2",
			fetchImpl: registryFixture(manifest, "missing"),
			runNpmPublish: async () => {
				invocations += 1;
			},
		}),
		(error) => error.code === "PUBLICATION_TARBALL_CHANGED",
	);
	assert.equal(invocations, 0);
});

test("npm failure stops publication and returns classified recovery facts", async (t) => {
	const { root, manifest } = await prepareFixture(t);
	let calls = 0;
	await assert.rejects(
		publishVerifiedArtifacts({
			root,
			manifest,
			npmVersion: "12.0.2",
			readNpmVersion: async () => "12.0.2",
			fetchImpl: registryFixture(manifest, "missing"),
			runNpmPublish: async () => {
				calls += 1;
				throw new Error("fixture publication failure");
			},
		}),
		(error) => {
			assert.equal(error.code, "PUBLICATION_FAILED");
			assert.equal(error.details.recovery.state, "PUBLICATION_FAILED");
			assert.equal(error.details.recovery.registryState, "NOTHING_PUBLISHED");
			return true;
		},
	);
	assert.equal(calls, 1);
});

test("registry metadata and retry budgets are bounded", async (t) => {
	const { manifest } = await prepareFixture(t);
	await assert.rejects(
		verifyRegistry({ manifest, requestTimeoutMs: 0 }),
		/request timeout must be an integer/,
	);
	await assert.rejects(
		verifyRegistry({
			manifest,
			attempts: 12,
			delayMs: 30_000,
			requestTimeoutMs: 30_000,
		}),
		/verification budget must not exceed/,
	);
	let bodyRead = false;
	const result = await verifyRegistry({
		manifest,
		attempts: 1,
		delayMs: 0,
		fetchImpl: async () => ({
			ok: true,
			status: 200,
			headers: { get: () => String(5 * 1024 * 1024) },
			arrayBuffer: async () => {
				bodyRead = true;
				return new ArrayBuffer(0);
			},
		}),
	});
	assert.equal(result.success, false);
	assert.equal(result.state, "REGISTRY_UNAVAILABLE");
	assert.equal(bodyRead, false);
});

test("release notes use the tested exact changelog section implementation", async (t) => {
	const root = await createPublicationFixture(t);
	const output = join(root, "release-notes.md");
	assert.equal(
		await readReleaseNotes({ root, version: VERSION, outputPath: output }),
		`## ${VERSION}\n\n- Current release notes.`,
	);
	assert.equal(
		await readFile(output, "utf8"),
		`## ${VERSION}\n\n- Current release notes.\n`,
	);
	await assert.rejects(
		readReleaseNotes({ root, version: "4.0.0-rc.9" }),
		/has no section/,
	);
});
