import assert from "node:assert/strict";
import {
	access,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import {
	assertGeneratedOutput,
	assertSafeReviewExportDirectory,
	assertSafeTemporaryRoot,
	cleanupReviewExportDirectory,
	cleanupTemporaryRoot,
	exportReviewSnapshot,
	installedBinaryPath,
	main,
	parseArguments,
	runCommand,
} from "./consumer-codegen-smoke.mjs";
import {
	createPackedOverrides,
	createWorkspaceOverridesYaml,
	packReleasePackages,
	parsePackResult,
	releasePackageDirectories,
} from "./release/pack-smoke-helpers.mjs";

test("parses supported arguments and rejects unknown arguments", () => {
	assert.deepEqual(parseArguments([]), {
		keep: false,
		json: false,
		exportReviewDir: null,
	});
	assert.deepEqual(
		parseArguments([
			"--",
			"--json",
			"--keep",
			"--export-review-dir",
			".ci-artifacts/consumer-codegen-review/current",
		]),
		{
			keep: true,
			json: true,
			exportReviewDir: ".ci-artifacts/consumer-codegen-review/current",
		},
	);
	assert.deepEqual(parseArguments(["--help"]), {
		keep: false,
		json: false,
		exportReviewDir: null,
		help: true,
	});
	for (const argv of [
		["--wat"],
		["--keep", "--keep"],
		["--json", "--json"],
		["--export-review-dir"],
		["--export-review-dir", ""],
		["--export-review-dir", "--keep"],
		[
			"--export-review-dir",
			".ci-artifacts/consumer-codegen-review/current",
			"--export-review-dir",
			".ci-artifacts/consumer-codegen-review/previous",
		],
		["--help", "--keep"],
	]) {
		assert.throws(() => parseArguments(argv));
	}
});

test("review export paths stay strictly within the owned repository directory", async () => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-review-paths-"));
	try {
		const target = await assertSafeReviewExportDirectory(
			".ci-artifacts/consumer-codegen-review/current",
			root,
		);
		assert.equal(
			target,
			join(root, ".ci-artifacts/consumer-codegen-review/current"),
		);
		for (const candidate of [
			".",
			"..",
			"/",
			root,
			".ci-artifacts",
			".ci-artifacts/consumer-codegen-review",
			".ci-artifacts/consumer-codegen-review/../escape",
			".ci-artifacts/consumer-codegen-review/current/node_modules",
			join(tmpdir(), "outside-review"),
		]) {
			await assert.rejects(
				() => assertSafeReviewExportDirectory(candidate, root),
				/Review export directory/,
			);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("review export paths reject symbolic-link escapes", async (context) => {
	if (process.platform === "win32") {
		context.skip(
			"Creating directory symlinks requires additional Windows privileges.",
		);
		return;
	}
	const root = await mkdtemp(join(tmpdir(), "openapi-to-review-symlink-"));
	const outside = await mkdtemp(join(tmpdir(), "openapi-to-review-outside-"));
	try {
		await mkdir(join(root, ".ci-artifacts/consumer-codegen-review"), {
			recursive: true,
		});
		await symlink(
			outside,
			join(root, ".ci-artifacts/consumer-codegen-review/escape"),
			"dir",
		);
		await assert.rejects(
			() =>
				assertSafeReviewExportDirectory(
					".ci-artifacts/consumer-codegen-review/escape",
					root,
				),
			/symbolic link/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(outside, { recursive: true, force: true });
	}
});

async function createReviewFixture(root) {
	const consumerRoot = join(root, "consumer");
	for (const directory of [
		".openapi-to",
		"generated/types/models",
		"generated/zod/models",
		"generated/widgets",
		"node_modules/example",
		"tarballs",
	]) {
		await mkdir(join(consumerRoot, directory), { recursive: true });
	}
	const files = {
		"package.json": '{"name":"review-consumer"}\n',
		"pnpm-workspace.yaml": "overrides: {}\n",
		"pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
		"openapi.json": '{"openapi":"3.0.3"}\n',
		"request.ts": "export const request = true;\n",
		"consumer-usage.ts": "export const usage = true;\n",
		"tsconfig.generated.json": '{"compilerOptions":{"strict":true}}\n',
		"openapi.config.ts": "export default {};\n",
		"generated/.openapi-to-manifest.json":
			'{"version":2,"files":["types/models/widget.model.ts"]}\n',
		"generated/types/models/widget.model.ts":
			"export interface WidgetModel { id: string }\n",
		"generated/zod/models/widget.schema.ts":
			"export const widgetSchema = {};\n",
		"generated/widgets/get-widget.service.ts":
			"export const getWidgetService = true;\n",
		"node_modules/example/index.js": "excluded\n",
		"tarballs/openapi-to.tgz": "excluded\n",
	};
	for (const [path, contents] of Object.entries(files))
		await writeFile(join(consumerRoot, path), contents);
	return consumerRoot;
}

function reviewScenarioReport() {
	return {
		version: "0.9.0",
		validate: { success: true, errors: 0 },
		inspect: { paths: 2, operations: 2, schemas: 5 },
		generatedFiles: 4,
		typecheck: "passed",
		currentCheck: { total: 4, added: 0, modified: 0, deleted: 0 },
		outdated: { exitCode: 6, modified: "widgets/get-widget.service.ts" },
		restore: "current-and-compiled",
		idempotent: true,
		ownershipManifestStable: true,
	};
}

const reviewMetadata = {
	exportedAt: "2026-07-27T00:00:00.000Z",
	sourceCommitSha: "0123456789abcdef",
	nodeVersion: "v22.0.0",
	pnpmVersion: "10.14.0",
};

test("exports a compact validated review snapshot and safely replaces an old snapshot", async () => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-review-export-"));
	try {
		const consumerRoot = await createReviewFixture(root);
		const targetDirectory = ".ci-artifacts/consumer-codegen-review/current";
		const first = await exportReviewSnapshot({
			consumerRoot,
			targetDirectory,
			report: reviewScenarioReport(),
			root,
			metadata: reviewMetadata,
		});
		assert.equal(
			first.path,
			join(root, ".ci-artifacts/consumer-codegen-review/current"),
		);
		assert.ok(first.fileCount >= 10);
		await access(join(first.path, "consumer/generated/types"));
		await access(
			join(first.path, "consumer/generated/.openapi-to-manifest.json"),
		);
		await assert.rejects(() =>
			access(join(first.path, "consumer/node_modules")),
		);
		await assert.rejects(() => access(join(first.path, "consumer/tarballs")));
		const report = JSON.parse(
			await readFile(join(first.path, "report.json"), "utf8"),
		);
		assert.equal(report.schemaVersion, 1);
		assert.equal(report.success, true);
		assert.equal(report.runtime.pnpm, "10.14.0");

		await writeFile(
			join(consumerRoot, "consumer-usage.ts"),
			"export const usage = 'second';\n",
		);
		const second = await exportReviewSnapshot({
			consumerRoot,
			targetDirectory,
			report: reviewScenarioReport(),
			root,
			metadata: reviewMetadata,
		});
		assert.match(
			await readFile(join(second.path, "consumer/consumer-usage.ts"), "utf8"),
			/second/,
		);
		const reviewRoot = join(root, ".ci-artifacts/consumer-codegen-review");
		assert.deepEqual(await readdir(reviewRoot), ["current"]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("failed review export preserves the previous snapshot and cleans transaction directories", async () => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-review-failure-"));
	try {
		const consumerRoot = await createReviewFixture(root);
		const targetDirectory = ".ci-artifacts/consumer-codegen-review/current";
		const first = await exportReviewSnapshot({
			consumerRoot,
			targetDirectory,
			report: reviewScenarioReport(),
			root,
			metadata: reviewMetadata,
		});
		const originalReport = await readFile(
			join(first.path, "report.json"),
			"utf8",
		);
		await rm(join(consumerRoot, "openapi.json"));
		await assert.rejects(() =>
			exportReviewSnapshot({
				consumerRoot,
				targetDirectory,
				report: reviewScenarioReport(),
				root,
				metadata: reviewMetadata,
			}),
		);
		assert.equal(
			await readFile(join(first.path, "report.json"), "utf8"),
			originalReport,
		);
		assert.deepEqual(
			await readdir(join(root, ".ci-artifacts/consumer-codegen-review")),
			["current"],
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("review export rejects drift and does not replace the prior snapshot", async () => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-review-drift-"));
	try {
		const consumerRoot = await createReviewFixture(root);
		const targetDirectory = ".ci-artifacts/consumer-codegen-review/current";
		const first = await exportReviewSnapshot({
			consumerRoot,
			targetDirectory,
			report: reviewScenarioReport(),
			root,
			metadata: reviewMetadata,
		});
		await writeFile(
			join(consumerRoot, "generated/widgets/get-widget.service.ts"),
			"// consumer smoke drift\n",
		);
		await assert.rejects(
			() =>
				exportReviewSnapshot({
					consumerRoot,
					targetDirectory,
					report: reviewScenarioReport(),
					root,
					metadata: reviewMetadata,
				}),
			/test drift/,
		);
		assert.doesNotMatch(
			await readFile(
				join(first.path, "consumer/generated/widgets/get-widget.service.ts"),
				"utf8",
			),
			/consumer smoke drift/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("review cleanup removes only snapshots owned by this feature", async () => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-review-cleanup-"));
	try {
		const consumerRoot = await createReviewFixture(root);
		const targetDirectory = ".ci-artifacts/consumer-codegen-review/current";
		const exported = await exportReviewSnapshot({
			consumerRoot,
			targetDirectory,
			report: reviewScenarioReport(),
			root,
			metadata: reviewMetadata,
		});
		await cleanupReviewExportDirectory(targetDirectory, root);
		await assert.rejects(() => access(exported.path));

		await mkdir(exported.path);
		await writeFile(join(exported.path, "user.txt"), "not owned\n");
		await assert.rejects(
			() => cleanupReviewExportDirectory(targetDirectory, root),
			/not owned|valid report/,
		);
		assert.equal(
			await readFile(join(exported.path, "user.txt"), "utf8"),
			"not owned\n",
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("uses the Windows command suffix only on Windows", () => {
	assert.match(
		installedBinaryPath("C:\\consumer", "openapi", "win32"),
		/openapi\.cmd$/,
	);
	assert.match(
		installedBinaryPath("/tmp/consumer", "openapi", "linux"),
		/openapi$/,
	);
});

test("command failures include a bounded stage, command, exit code, and output", () => {
	assert.throws(
		() =>
			runCommand(
				"synthetic compile",
				process.execPath,
				[
					"-e",
					'process.stdout.write("x".repeat(5000)); process.stderr.write("bad"); process.exit(7)',
				],
				process.cwd(),
			),
		(error) => {
			assert.match(error.message, /synthetic compile/);
			assert.match(error.message, /Command:/);
			assert.match(error.message, /Exit code: 7/);
			assert.match(error.message, /characters omitted/);
			assert.match(error.message, /stderr:\nbad/);
			assert.ok(error.message.length < 5_000);
			return true;
		},
	);
});

test("cleanup accepts only owned prefixed roots beneath the OS temp directory", async () => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-consumer-codegen-"));
	await writeFile(join(root, "owned.txt"), "owned");
	assert.equal(assertSafeTemporaryRoot(root), root);
	await cleanupTemporaryRoot(root);
	await assert.rejects(() => writeFile(join(root, "missing", "file"), "x"));
	assert.throws(() => assertSafeTemporaryRoot(tmpdir()), /Refusing to clean/);
	assert.throws(
		() => assertSafeTemporaryRoot(process.cwd()),
		/Refusing to clean/,
	);
});

test("JSON mode emits one JSON document and routes progress to stderr", async () => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-consumer-codegen-"));
	const stdout = [];
	const stderr = [];
	const exitCode = await main({
		argv: ["--json"],
		stdout: (value) => stdout.push(value),
		stderr: (value) => stderr.push(value),
		createTemporaryRoot: async () => root,
		execute: async ({ log }) => {
			log("fake", "progress");
			return { idempotent: true };
		},
	});
	assert.equal(exitCode, 0);
	assert.equal(stdout.length, 1);
	assert.deepEqual(JSON.parse(stdout[0]), {
		success: true,
		report: { idempotent: true },
		temporaryRoot: null,
	});
	assert.match(stderr.join(""), /\[consumer-codegen:fake] progress/);
	await assert.rejects(() => access(root));
});

test("JSON review export reports one document and cleans the temporary root", async () => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-consumer-codegen-"));
	const stdout = [];
	const stderr = [];
	const reviewPath = join(
		process.cwd(),
		".ci-artifacts/consumer-codegen-review/unit-json",
	);
	const exitCode = await main({
		argv: [
			"--json",
			"--export-review-dir",
			".ci-artifacts/consumer-codegen-review/unit-json",
		],
		stdout: (value) => stdout.push(value),
		stderr: (value) => stderr.push(value),
		createTemporaryRoot: async () => root,
		execute: async () => ({ idempotent: true }),
		exportReview: async ({ consumerRoot, targetDirectory }) => {
			assert.equal(consumerRoot, join(root, "consumer"));
			assert.equal(
				targetDirectory,
				".ci-artifacts/consumer-codegen-review/unit-json",
			);
			return { path: reviewPath, fileCount: 23 };
		},
	});
	assert.equal(exitCode, 0);
	assert.equal(stdout.length, 1);
	assert.deepEqual(JSON.parse(stdout[0]), {
		success: true,
		report: { idempotent: true },
		temporaryRoot: null,
		export: { path: reviewPath, fileCount: 23 },
	});
	assert.match(stderr.join(""), /review exported to/);
	await assert.rejects(() => access(root));
});

test("--keep and review export retain the temporary root and report both paths", async () => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-consumer-codegen-"));
	const stdout = [];
	try {
		const exitCode = await main({
			argv: [
				"--keep",
				"--export-review-dir",
				".ci-artifacts/consumer-codegen-review/unit-keep",
			],
			stdout: (value) => stdout.push(value),
			stderr: () => {},
			createTemporaryRoot: async () => root,
			execute: async () => ({ idempotent: true }),
			exportReview: async () => ({
				path: join(
					process.cwd(),
					".ci-artifacts/consumer-codegen-review/unit-keep",
				),
				fileCount: 23,
			}),
		});
		assert.equal(exitCode, 0);
		assert.match(stdout.join(""), /review exported to/);
		assert.match(
			stdout.join(""),
			new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
		);
		await access(root);
	} finally {
		await cleanupTemporaryRoot(root);
	}
});

test("--keep retains and reports the absolute consumer workspace", async () => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-consumer-codegen-"));
	const stdout = [];
	const exitCode = await main({
		argv: ["--keep"],
		stdout: (value) => stdout.push(value),
		stderr: () => {},
		createTemporaryRoot: async () => root,
		execute: async () => ({ idempotent: true }),
	});
	assert.equal(exitCode, 0);
	assert.match(
		stdout.join(""),
		new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
	);
	await writeFile(join(root, "still-present"), "yes");
	await cleanupTemporaryRoot(root);
});

test("empty output and TypeScript command failures make main return nonzero", async () => {
	for (const execute of [
		async () => assertGeneratedOutput([]),
		async () =>
			runCommand(
				"TypeScript compile",
				process.execPath,
				["-e", "process.exit(2)"],
				process.cwd(),
			),
	]) {
		const root = await mkdtemp(join(tmpdir(), "openapi-to-consumer-codegen-"));
		const stderr = [];
		const exitCode = await main({
			argv: [],
			stdout: () => {},
			stderr: (value) => stderr.push(value),
			createTemporaryRoot: async () => root,
			execute,
		});
		assert.equal(exitCode, 1);
		assert.notEqual(stderr.join(""), "");
	}
});

test("shared tarball helpers preserve pack JSON parsing and stable overrides", () => {
	assert.deepEqual(
		parsePackResult('notice\n{"name":"openapi-to","files":[]}'),
		{ name: "openapi-to", files: [] },
	);
	assert.deepEqual(
		createPackedOverrides([
			{ name: "openapi-to", archive: "/tmp/openapi.tgz" },
			{ name: "@openapi-to/core", archive: "/tmp/core.tgz" },
		]),
		{
			"@openapi-to/core": "file:/tmp/core.tgz",
			"openapi-to": "file:/tmp/openapi.tgz",
		},
	);
	assert.equal(
		createWorkspaceOverridesYaml({
			"openapi-to": "file:/tmp/openapi.tgz",
			"@openapi-to/core": "file:/tmp/core.tgz",
		}),
		'overrides:\n  "@openapi-to/core": "file:/tmp/core.tgz"\n  "openapi-to": "file:/tmp/openapi.tgz"\n',
	);
});

test("shared pack helper discovers every release package and preserves tarball safety checks", async () => {
	const root = await mkdtemp(join(tmpdir(), "openapi-to-pack-helper-"));
	const tarballDirectory = join(root, "tarballs");
	const packageNames = new Map();
	await mkdir(tarballDirectory);
	try {
		for (const directory of releasePackageDirectories) {
			const packageDirectory = join(root, directory);
			const packageName = `fixture-${basename(directory)}`;
			packageNames.set(packageDirectory, packageName);
			await mkdir(packageDirectory, { recursive: true });
			await writeFile(
				join(packageDirectory, "package.json"),
				`${JSON.stringify({
					name: packageName,
					version: "1.0.0",
				})}\n`,
			);
			await writeFile(
				join(tarballDirectory, `${basename(directory)}.tgz`),
				"tgz",
			);
		}
		const fakePnpm = (args, cwd, extraFiles = []) => {
			assert.deepEqual(args.slice(0, 2), ["pack", "--json"]);
			return {
				stdout: JSON.stringify({
					name: packageNames.get(cwd),
					version: "1.0.0",
					filename: join(tarballDirectory, `${basename(cwd)}.tgz`),
					files: [{ path: "package.json" }, ...extraFiles],
				}),
			};
		};
		const packed = await packReleasePackages({
			repositoryRoot: root,
			tarballDirectory,
			pnpm: (args, cwd) => fakePnpm(args, cwd),
			catalogConfig: { catalog: {} },
			inspectPackageManifest: async () => ({}),
		});
		assert.equal(packed.length, releasePackageDirectories.length);
		await assert.rejects(
			() =>
				packReleasePackages({
					repositoryRoot: root,
					tarballDirectory,
					pnpm: (args, cwd) =>
						fakePnpm(args, cwd, [{ path: "coverage/report.json" }]),
					catalogConfig: { catalog: {} },
					inspectPackageManifest: async () => ({}),
				}),
			/tarball contains forbidden files/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
