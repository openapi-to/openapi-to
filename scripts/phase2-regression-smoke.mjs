import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dump, load } from "js-yaml";

const repositoryRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const requestedCompilers = process.argv.flatMap((argument, index, argv) =>
	argument === "--tsc" && argv[index + 1]
		? [path.resolve(argv[index + 1])]
		: [],
);
const dependencyRootArgument = process.argv.indexOf("--dependency-root");
const dependencyRoot =
	dependencyRootArgument >= 0 && process.argv[dependencyRootArgument + 1]
		? path.resolve(process.argv[dependencyRootArgument + 1])
		: path.join(repositoryRoot, "e2e/module/node_modules");
const openapiPackageRootArgument = process.argv.indexOf(
	"--openapi-package-root",
);
const openapiPackageRoot =
	openapiPackageRootArgument >= 0 &&
	process.argv[openapiPackageRootArgument + 1]
		? path.resolve(process.argv[openapiPackageRootArgument + 1])
		: path.join(repositoryRoot, "packages/openapi");
const cli = path.join(openapiPackageRoot, "bin/openapi.js");
const compilers =
	requestedCompilers.length > 0
		? requestedCompilers
		: [path.join(repositoryRoot, "node_modules/typescript-7/bin/tsc")];

function run(label, executable, args, cwd, expectedStatus = 0) {
	const result = spawnSync(executable, args, {
		cwd,
		encoding: "utf8",
		env: { ...process.env, NO_COLOR: "1" },
	});
	assert.equal(
		result.status,
		expectedStatus,
		`${label} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
	);
	return result;
}

function runCli(label, args, cwd, expectedStatus = 0) {
	return run(label, process.execPath, [cli, ...args], cwd, expectedStatus);
}

function jsonResult(label, result) {
	assert.doesNotThrow(
		() => JSON.parse(result.stdout),
		`${label} stdout is not one JSON document:\n${result.stdout}`,
	);
	return JSON.parse(result.stdout);
}

async function linkPackage(nodeModules, packageName, source) {
	const target = path.join(nodeModules, packageName);
	await mkdir(path.dirname(target), { recursive: true });
	await symlink(await realpath(source), target, "junction");
}

async function prepareConsumer(root) {
	const nodeModules = path.join(root, "node_modules");
	await mkdir(nodeModules, { recursive: true });
	await linkPackage(nodeModules, "openapi-to", openapiPackageRoot);
	for (const packageName of [
		"@tanstack/vue-query",
		"@types/react",
		"axios",
		"msw",
		"swr",
		"vue",
		"zod",
	]) {
		await linkPackage(
			nodeModules,
			packageName,
			path.join(dependencyRoot, packageName),
		);
	}
	await writeFile(
		path.join(root, "request.ts"),
		`export type RequestOptions = Record<string, unknown>;
export async function request<T>(_options: RequestOptions): Promise<{ data: T }> {
  return { data: undefined as T };
}
`,
	);
}

function pluginConfig(output, input, plugins, name) {
	return `import {
  defineConfig,
  pluginMSW,
  pluginSWR,
  pluginTSRequest,
  pluginTSType,
  pluginVueQuery,
  pluginZod,
} from "openapi-to";

export default defineConfig({
  servers: [{
    name: ${JSON.stringify(name)},
    input: { path: ${JSON.stringify(input)} },
    output: { base: "workspace", dir: ${JSON.stringify(output)}, clean: true },
  }],
  plugins: ${plugins},
});
`;
}

const tsType = "pluginTSType({ importWithExtension: false })";
const tsRequest = `pluginTSRequest({
      requestClient: "common",
      requestImportDeclaration: { moduleSpecifier: "request-client" },
      requestConfigTypeImportDeclaration: {
        namedImports: ["RequestOptions"],
        moduleSpecifier: "request-client",
      },
      importWithExtension: false,
    })`;

async function writeRegressionConfigs(root) {
	const inlineChains = {
		"inline-ts-type": `[${tsType}]`,
		"inline-ts-request": `[${tsType}, ${tsRequest}]`,
		"inline-zod": `[pluginZod({ importWithExtension: false }), ${tsType}]`,
		"inline-swr": `[${tsType}, ${tsRequest}, pluginSWR({ importWithExtension: false })]`,
		"inline-vue-query": `[${tsType}, ${tsRequest}, pluginVueQuery({ importWithExtension: false })]`,
		"inline-msw": `[${tsType}, pluginMSW({ importWithExtension: false })]`,
	};
	for (const [name, plugins] of Object.entries(inlineChains)) {
		await writeFile(
			path.join(root, `${name}.config.ts`),
			pluginConfig(`generated-${name}`, "./inline-enum.yaml", plugins, name),
		);
	}
	await writeFile(
		path.join(root, "inline-reordered.config.ts"),
		pluginConfig(
			"generated-inline-reordered",
			"./inline-enum-reordered.yaml",
			`[${tsType}]`,
			"inline-reordered",
		),
	);
	await writeFile(
		path.join(root, "swr.config.ts"),
		pluginConfig(
			"generated-swr",
			"./swr-minimal.yaml",
			`[${tsType}, ${tsRequest}, pluginSWR({
				importWithExtension: false,
				responseConfigTypeImportDeclaration: {
					namedImports: ["AxiosResponse"],
					moduleSpecifier: "axios",
				},
				responseErrorTypeImportDeclaration: {
					namedImports: ["AxiosError"],
					moduleSpecifier: "axios",
				},
			})]`,
			"swr",
		),
	);
	await writeFile(
		path.join(root, "msw.config.ts"),
		pluginConfig(
			"generated-msw",
			"./msw-schema-less.yaml",
			`[${tsType}, pluginMSW({ importWithExtension: false })]`,
			"msw",
		),
	);
}

function assertCurrentCheck(label, result) {
	const output = jsonResult(label, result);
	assert.equal(output.success, true);
	assert.equal(output.command, "generate");
	assert.equal(output.mode, "check");
	assert.equal(output.servers.length, 1);
	assert.equal(output.servers[0].manifest.outdated, false);
	assert.deepEqual(output.servers[0].manifest.summary, {
		added: 0,
		modified: 0,
		deleted: 0,
		unchanged: output.servers[0].manifest.summary.unchanged,
	});
}

async function verifyInit(root) {
	const esm = path.join(root, "init-esm");
	await mkdir(esm);
	await prepareConsumer(esm);
	await writeFile(
		path.join(esm, "package.json"),
		'{"name":"init-esm","private":true,"type":"module"}\n',
	);
	await cp(
		path.join(repositoryRoot, "fixtures/phase2/swr-minimal.yaml"),
		path.join(esm, "openapi.yaml"),
	);
	const initialized = jsonResult(
		"ESM init --json",
		runCli("ESM init --json", ["init", "--json"], esm),
	);
	assert.deepEqual(initialized, {
		success: true,
		command: "init",
		configPath: "openapi.config.ts",
		moduleType: "module",
		created: true,
		diagnostics: [],
		summary: { errors: 0, warnings: 0, infos: 0 },
	});
	const configPath = path.join(esm, "openapi.config.ts");
	const initializedConfig = await readFile(configPath, "utf8");
	assert.match(initializedConfig, /pluginSWR\(\)/);
	assert.doesNotMatch(initializedConfig, /pluginVueQuery\(\)/);
	assert.match(initializedConfig, /alternative query plugins/);
	await writeFile(
		configPath,
		initializedConfig.replace(
			"https://petstore.swagger.io/v2/swagger.json",
			"./openapi.yaml",
		),
	);
	const dryRun = jsonResult(
		"default init dry-run",
		runCli(
			"default init dry-run",
			["generate", "--config", "openapi.config.ts", "--dry-run", "--json"],
			esm,
		),
	);
	assert.equal(dryRun.success, true);
	assert.equal(
		dryRun.diagnostics.some(
			(diagnostic) => diagnostic.code === "ARTIFACT_PATH_CONFLICT",
		),
		false,
	);
	assert(
		dryRun.servers[0].manifest.entries.some((entry) =>
			entry.path.endsWith("use-get-health.query.ts"),
		),
	);
	const generated = jsonResult(
		"default init generate",
		runCli(
			"default init generate",
			["generate", "--config", "openapi.config.ts", "--json"],
			esm,
		),
	);
	assert.equal(generated.success, true);
	assertCurrentCheck(
		"default init repeated check",
		runCli(
			"default init repeated check",
			["generate", "--config", "openapi.config.ts", "--check", "--json"],
			esm,
		),
	);
	const repeated = jsonResult(
		"repeat init --json",
		runCli("repeat init --json", ["--json", "init"], esm, 1),
	);
	assert.equal(repeated.success, false);
	assert.equal(repeated.command, "init");
	assert.equal(repeated.created, false);

	for (const [directory, packageJson, configPath, moduleType] of [
		[
			"init-commonjs",
			'{"name":"init-commonjs","private":true,"type":"commonjs"}\n',
			"openapi.config.js",
			"commonjs",
		],
		["init-no-package", null, "openapi.config.js", "commonjs"],
	]) {
		const workspace = path.join(root, directory);
		await mkdir(workspace);
		await prepareConsumer(workspace);
		if (packageJson)
			await writeFile(path.join(workspace, "package.json"), packageJson);
		const output = jsonResult(
			`${directory} init`,
			runCli(`${directory} init`, ["init", "--json"], workspace),
		);
		assert.equal(output.configPath, configPath);
		assert.equal(output.moduleType, moduleType);
	}
}

async function verifyGenerators(root) {
	await prepareConsumer(root);
	await writeFile(
		path.join(root, "package.json"),
		'{"name":"phase2-regression-consumer","private":true,"type":"module"}\n',
	);
	for (const fixture of [
		"inline-enum.yaml",
		"swr-minimal.yaml",
		"msw-schema-less.yaml",
	]) {
		await cp(
			path.join(repositoryRoot, "fixtures/phase2", fixture),
			path.join(root, fixture),
		);
	}
	const inlineFixture = load(
		await readFile(path.join(root, "inline-enum.yaml"), "utf8"),
	);
	const collisionProperties =
		inlineFixture.components.schemas.CollisionModel.properties;
	inlineFixture.components.schemas.CollisionModel.properties =
		Object.fromEntries(Object.entries(collisionProperties).reverse());
	await writeFile(
		path.join(root, "inline-enum-reordered.yaml"),
		dump(inlineFixture, { noRefs: true, sortKeys: false }),
	);
	await writeRegressionConfigs(root);

	const manifests = new Map();
	for (const name of [
		"inline-ts-type",
		"inline-reordered",
		"inline-ts-request",
		"inline-zod",
		"inline-swr",
		"inline-vue-query",
		"inline-msw",
		"swr",
		"msw",
	]) {
		const config = `${name}.config.ts`;
		const generated = jsonResult(
			`${name} generate`,
			runCli(
				`${name} generate`,
				["generate", "--config", config, "--json"],
				root,
			),
		);
		assert.equal(generated.success, true);
		manifests.set(name, generated.servers[0].manifest.entries);
		assertCurrentCheck(
			`${name} byte stability`,
			runCli(
				`${name} byte stability`,
				["generate", "--config", config, "--check", "--json"],
				root,
			),
		);
	}

	const enumFile = await readFile(
		path.join(root, "generated-inline-ts-type/types/enum.model.ts"),
		"utf8",
	);
	const userModel = await readFile(
		path.join(root, "generated-inline-ts-type/types/models/user.model.ts"),
		"utf8",
	);
	const collisionModel = await readFile(
		path.join(
			root,
			"generated-inline-ts-type/types/models/collision-model.model.ts",
		),
		"utf8",
	);
	const anchoredCollisionModel = await readFile(
		path.join(
			root,
			"generated-inline-ts-type/types/models/anchored-collision-model.model.ts",
		),
		"utf8",
	);
	const crossHookSchemaModel = await readFile(
		path.join(
			root,
			"generated-inline-ts-type/types/models/request-bodies-foo.model.ts",
		),
		"utf8",
	);
	const crossHookRequestBody = await readFile(
		path.join(
			root,
			"generated-inline-ts-type/types/requestBodies/foo.model.ts",
		),
		"utf8",
	);
	assert.match(enumFile, /UserOptionalInlineModeEnumValue/);
	assert.match(userModel, /UserOptionalInlineModeEnumValue/);
	assert.doesNotMatch(userModel, /UseroptionalInlineModeEnumValue/);
	assert.match(enumFile, /UserSimilarNameEnumValue/);
	assert.match(enumFile, /UserSimilar_u2d_NameEnumValue/);
	assert.match(enumFile, /UserSimilar_u5f_u2d_NameEnumValue/);
	const declarations =
		enumFile.match(/export type ([A-Za-z_$][A-Za-z0-9_$]*)/g) ?? [];
	const expectedInlineEnumTypeDeclarations =
		countInlineEnums(inlineFixture) * 2;
	assert.equal(declarations.length, expectedInlineEnumTypeDeclarations);
	assert.equal(new Set(declarations).size, declarations.length);

	const collisionSymbols = new Map([
		["similarName", "CollisionModelSimilarName__15bafc6dca3dEnumValue"],
		["SimilarName", "CollisionModelSimilarName__c27232e9a0aeEnumValue"],
		["similar-name", "CollisionModelSimilar_u2d_Name__c715d2d35d32EnumValue"],
		["similar-Name", "CollisionModelSimilar_u2d_Name__963c4fadafc4EnumValue"],
		[
			"foo-bar.mode",
			"CollisionModelFoo_u5f_u2d_BarMode__2ae51d31ab05EnumValue",
		],
		[
			"foo-Bar.mode",
			"CollisionModelFoo_u5f_u2d_BarMode__2a928070e275EnumValue",
		],
		[
			"anchorName",
			"AnchoredCollisionModelAnchorName__977e67d75041EnumValue",
		],
		[
			"AnchorName",
			"AnchoredCollisionModelAnchorName__c404b3590ffaEnumValue",
		],
		[
			"schema-model",
			"RequestBodiesFooModel__fa2b5527fa9dEnumValue",
		],
		[
			"request-body-model",
			"RequestBodiesFooModel__5f9784238592EnumValue",
		],
	]);
	for (const symbol of collisionSymbols.values()) {
		assert.match(enumFile, new RegExp(`export type ${symbol}\\b`));
	}
	assert.match(
		collisionModel,
		new RegExp(`similarName: ${collisionSymbols.get("similarName")}\\b`),
	);
	assert.match(
		collisionModel,
		new RegExp(`SimilarName: ${collisionSymbols.get("SimilarName")}\\b`),
	);
	assert.match(
		collisionModel,
		new RegExp(
			`"similar-name": ${collisionSymbols.get("similar-name")}\\b`,
		),
	);
	assert.match(
		anchoredCollisionModel,
		new RegExp(`anchorName\\?: ${collisionSymbols.get("anchorName")}\\b`),
	);
	assert.match(
		anchoredCollisionModel,
		new RegExp(`AnchorName\\?: ${collisionSymbols.get("AnchorName")}\\b`),
	);
	assert.match(
		crossHookSchemaModel,
		new RegExp(`model\\?: ${collisionSymbols.get("schema-model")}\\b`),
	);
	assert.match(
		crossHookRequestBody,
		new RegExp(`\\b${collisionSymbols.get("request-body-model")}\\b`),
	);
	assert.match(
		collisionModel,
		new RegExp(
			`"similar-Name": ${collisionSymbols.get("similar-Name")}\\b`,
		),
	);
	assert.match(
		collisionModel,
		new RegExp(
			`"foo-bar": \\{[\\s\\S]*?mode\\?: ${collisionSymbols.get("foo-bar.mode")}\\b`,
		),
	);
	assert.match(
		collisionModel,
		new RegExp(
			`"foo-Bar": \\{[\\s\\S]*?mode\\?: ${collisionSymbols.get("foo-Bar.mode")}\\b`,
		),
	);
	const reorderedEnumFile = await readFile(
		path.join(root, "generated-inline-reordered/types/enum.model.ts"),
		"utf8",
	);
	const reorderedCollisionModel = await readFile(
		path.join(
			root,
			"generated-inline-reordered/types/models/collision-model.model.ts",
		),
		"utf8",
	);
	for (const symbol of collisionSymbols.values()) {
		assert.match(reorderedEnumFile, new RegExp(`export type ${symbol}\\b`));
	}
	for (const key of [
		"similarName",
		"SimilarName",
		"similar-name",
		"similar-Name",
		"foo-bar.mode",
		"foo-Bar.mode",
	]) {
		assert.match(
			reorderedCollisionModel,
			new RegExp(`\\b${collisionSymbols.get(key)}\\b`),
		);
	}
	assert.deepEqual(
		manifests
			.get("inline-reordered")
			.map(({ path: entryPath }) => entryPath)
			.sort(),
		manifests
			.get("inline-ts-type")
			.map(({ path: entryPath }) => entryPath)
			.sort(),
	);

	const swr = await readFile(
		path.join(root, "generated-swr/health/use-get-health.query.ts"),
		"utf8",
	);
	assert.match(swr, /fetcher: async \(\) =>/);
	assert.doesNotMatch(swr, /fetcher: async \(\s*_url/);
	assert.doesNotMatch(swr, /\bany\b|@ts-ignore|@ts-expect-error/);
	assert.match(swr, /return getHealthService\(region, params\)/);

	const schemaLess = await readFile(
		path.join(root, "generated-msw/responses/get-schema-less.handler.ts"),
		"utf8",
	);
	const known = await readFile(
		path.join(root, "generated-msw/responses/get-known-object.handler.ts"),
		"utf8",
	);
	assert.match(schemaLess, /data as import\("msw"\)\.JsonBodyType/);
	assert.doesNotMatch(known, /JsonBodyType/);

	await writeFile(
		path.join(root, "tsconfig.json"),
		`${JSON.stringify(
			{
				compilerOptions: {
					allowImportingTsExtensions: true,
					exactOptionalPropertyTypes: true,
					forceConsistentCasingInFileNames: true,
					module: "ESNext",
					moduleResolution: "Bundler",
					noEmit: true,
					noImplicitAny: true,
					noUncheckedIndexedAccess: true,
					paths: { "request-client": ["./request.ts"] },
					skipLibCheck: false,
					strict: true,
					target: "ES2022",
				},
				include: ["generated-*/**/*.ts", "request.ts"],
			},
			null,
			2,
		)}\n`,
	);
	const compilerVersions = [];
	for (const compiler of compilers) {
		const version = run(
			`TypeScript version (${compiler})`,
			process.execPath,
			[compiler, "--version"],
			root,
		).stdout.trim();
		run(
			`strict generated consumer compile (${version})`,
			process.execPath,
			[compiler, "-p", "tsconfig.json"],
			root,
		);
		compilerVersions.push(version);
	}
	return compilerVersions;
}

function countInlineEnums(value) {
	if (Array.isArray(value)) {
		return value.reduce((count, item) => count + countInlineEnums(item), 0);
	}
	if (!value || typeof value !== "object") return 0;
	return (
		(Array.isArray(value.enum) ? 1 : 0) +
		Object.entries(value).reduce(
			(count, [key, item]) =>
				key === "enum" ? count : count + countInlineEnums(item),
			0,
		)
	);
}

const temporaryRoot = await mkdtemp(
	path.join(os.tmpdir(), "openapi-to-phase2-regressions-"),
);
try {
	await readFile(path.join(openapiPackageRoot, "dist/index.js"));
	await verifyInit(temporaryRoot);
	const compilerVersions = await verifyGenerators(
		path.join(temporaryRoot, "consumer"),
	);
	process.stdout.write(
		`${JSON.stringify({
			success: true,
			tests: [
				"REG-INIT-DEFAULT-CONFIG-GENERATES",
				"REG-INLINE-ENUM-SYMBOL-CASING",
				"REG-INLINE-ENUM-SYMBOL-COLLISIONS",
				"REG-SWR-FETCHER-STRICT",
				"REG-MSW-SCHEMALESS-JSON",
				"REG-INIT-JSON-STDOUT",
			],
			compilerVersions,
		})}\n`,
	);
} finally {
	await rm(temporaryRoot, { recursive: true, force: true });
}
