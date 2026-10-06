import { spawnSync } from "node:child_process";
import {
	mkdtemp,
	mkdir,
	readdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createPackedOverrides,
	createWorkspaceOverridesYaml,
	packReleasePackages,
} from "./release/pack-smoke-helpers.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function run(label, command, args, cwd) {
	console.error(`[faker consumer] ${label}`);
	const executable =
		process.env.npm_execpath && command === "pnpm" ? process.execPath : command;
	const actualArgs =
		executable === process.execPath && command === "pnpm"
			? [process.env.npm_execpath, ...args]
			: args;
	const result = spawnSync(executable, actualArgs, {
		cwd,
		encoding: "utf8",
		maxBuffer: 8 * 1024 * 1024,
		shell: false,
		env: { ...process.env, CI: "1", NO_UPDATE_NOTIFIER: "1" },
	});
	if (result.error || result.status !== 0) {
		throw new Error(
			`${label} failed (${result.status ?? result.error?.message}).\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
		);
	}
	return result.stdout;
}

function writeJson(path, value) {
	return writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readFileTree(root, current = root) {
	const entries = await readdir(current, { withFileTypes: true });
	const files = [];
	for (const entry of entries.sort((left, right) =>
		left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
	)) {
		const filePath = join(current, entry.name);
		if (entry.isDirectory()) files.push(...(await readFileTree(root, filePath)));
		else if (entry.isFile())
			files.push([relative(root, filePath), await readFile(filePath, "utf8")]);
	}
	return files;
}

async function main() {
	const temporaryRoot = await mkdtemp(
		join(tmpdir(), "openapi-to-faker-packed-consumer-"),
	);
	try {
		const archivesRoot = join(temporaryRoot, "archives");
		await mkdir(archivesRoot);
		const packed = await packReleasePackages({
			repositoryRoot,
			tarballDirectory: archivesRoot,
			pnpm: (args, cwd) => run(`pack ${cwd}`, "pnpm", args, cwd),
		});
		const aggregate = packed.find(({ name }) => name === "openapi-to");
		const fakerPlugin = packed.find(
			({ name }) => name === "@openapi-to/plugin-faker",
		);
		const mswPlugin = packed.find(
			({ name }) => name === "@openapi-to/plugin-msw",
		);
		if (!aggregate || !fakerPlugin || !mswPlugin)
			throw new Error("Packed aggregate or required generator plugins are missing.");
		const catalog = await readFile(
			join(repositoryRoot, "pnpm-workspace.yaml"),
			"utf8",
		);
		const fakerVersion = catalog.match(
			/^\s+'@faker-js\/faker':\s+'([^']+)'/m,
		)?.[1];
		const mswVersion = catalog.match(/^\s+msw:\s+'([^']+)'/m)?.[1];
		const typescriptVersion = JSON.parse(
			await readFile(
				join(repositoryRoot, "node_modules/typescript/package.json"),
				"utf8",
			),
		).version;
		if (!fakerVersion || !mswVersion)
			throw new Error("Faker or MSW is missing from the workspace catalog.");
		const consumerRoot = join(temporaryRoot, "consumer");
		await mkdir(consumerRoot);
		await writeJson(join(consumerRoot, "package.json"), {
			name: "openapi-to-faker-packed-consumer",
			private: true,
			type: "module",
			packageManager: "pnpm@11.26.0",
			devDependencies: {
				"openapi-to": `file:${aggregate.archive}`,
				"@openapi-to/plugin-faker": `file:${fakerPlugin.archive}`,
				"@openapi-to/plugin-msw": `file:${mswPlugin.archive}`,
				"@faker-js/faker": fakerVersion,
				msw: mswVersion,
				typescript: typescriptVersion,
			},
		});
		await writeFile(
			join(consumerRoot, "pnpm-workspace.yaml"),
			createWorkspaceOverridesYaml(createPackedOverrides(packed)),
		);
		await writeJson(join(consumerRoot, "openapi.json"), {
			openapi: "3.1.0",
			info: { title: "Faker packed consumer", version: "1.0.0" },
			paths: {
				"/pets/{id}": {
					get: {
						operationId: "getPet",
						tags: ["pets"],
						responses: {
							200: {
								description: "pet",
								content: {
									"application/json": {
										schema: { $ref: "#/components/schemas/Pet" },
									},
								},
							},
							204: { description: "empty" },
						},
					},
				},
			},
			components: {
				schemas: {
					Pet: {
						type: "object",
						properties: {
							id: { type: "integer", minimum: 1 },
							name: { type: "string", minLength: 2 },
							createdAt: { type: "string", format: "date-time" },
						},
						required: ["id", "name", "createdAt"],
					},
				},
			},
		});
		await writeFile(
			join(consumerRoot, "openapi.config.ts"),
			`import { defineConfig, pluginFaker, pluginMSW, pluginTSType } from "openapi-to";\nexport default defineConfig({ servers: [{ name: "faker", input: { path: "./openapi.json" }, output: { base: "workspace", dir: "generated", clean: true } }], plugins: [pluginTSType({ importWithExtension: true }), pluginFaker({ importWithExtension: true }), pluginMSW({ importWithExtension: true, responseDefaultType: "faker" })] });\n`,
		);
		await writeJson(join(consumerRoot, "tsconfig.json"), {
			compilerOptions: {
				target: "ES2022",
				module: "NodeNext",
				moduleResolution: "NodeNext",
				allowImportingTsExtensions: true,
				rewriteRelativeImportExtensions: true,
				strict: true,
				skipLibCheck: true,
				outDir: "runtime-dist",
			},
			include: ["generated/**/*.ts", "runtime-check.ts"],
		});
		run(
			"packed consumer install",
			"pnpm",
			["install", "--ignore-scripts", "--prefer-offline"],
			consumerRoot,
		);
		const installedManifest = JSON.parse(
			await readFile(
				join(consumerRoot, "node_modules/openapi-to/package.json"),
				"utf8",
			),
		);
		const pluginManifest = JSON.parse(
			await readFile(
				join(
					consumerRoot,
					"node_modules/@openapi-to/plugin-faker/package.json",
				),
				"utf8",
			),
		);
		const mswPluginManifest = JSON.parse(
			await readFile(
				join(consumerRoot, "node_modules/@openapi-to/plugin-msw/package.json"),
				"utf8",
			),
		);
		const installedFakerManifest = JSON.parse(
			await readFile(
				join(consumerRoot, "node_modules/@faker-js/faker/package.json"),
				"utf8",
			),
		);
		const installedAggregatePath = await realpath(
			join(consumerRoot, "node_modules/openapi-to"),
		);
		const aggregateRelativePath = relative(
			await realpath(consumerRoot),
			installedAggregatePath,
		);
		if (
			isAbsolute(aggregateRelativePath) ||
			aggregateRelativePath === ".." ||
			aggregateRelativePath.startsWith(
				`..${process.platform === "win32" ? "\\" : "/"}`,
			)
		)
			throw new Error(
				"Packed aggregate resolved outside the isolated consumer.",
			);
		if (
			!installedManifest.dependencies?.["@openapi-to/plugin-faker"] ||
			installedManifest.dependencies?.["@faker-js/faker"] ||
			pluginManifest.dependencies?.["@faker-js/faker"] ||
			pluginManifest.peerDependencies?.["@faker-js/faker"] ||
			mswPluginManifest.dependencies?.["@faker-js/faker"] ||
			mswPluginManifest.peerDependencies?.["@faker-js/faker"] ||
			installedFakerManifest.version !== fakerVersion
		)
			throw new Error(
				"Packed package manifests violate the consumer-owned Faker runtime contract.",
			);
		if (
			!JSON.parse(await readFile(join(consumerRoot, "package.json"), "utf8"))
				.devDependencies["@faker-js/faker"]
		)
			throw new Error("Consumer does not directly declare @faker-js/faker.");
		const installedPlugin = JSON.parse(
			await readFile(
				join(
					consumerRoot,
					"node_modules/@openapi-to/plugin-faker/package.json",
				),
				"utf8",
			),
		);
		if (installedPlugin.version !== fakerPlugin.version)
			throw new Error("Consumer resolved a non-packed Faker plugin version.");
		const cjs = run(
			"CommonJS aggregate require",
			process.execPath,
			[
				"-e",
				'const api = require("openapi-to"); if (typeof api.pluginFaker !== "function") process.exit(1);',
			],
			consumerRoot,
		);
		void cjs;
		run(
			"CommonJS direct plugin require",
			process.execPath,
			[
				"-e",
				'const plugin = require("@openapi-to/plugin-faker"); if (typeof plugin.definePlugin !== "function") process.exit(1);',
			],
			consumerRoot,
		);
		const cli = join(consumerRoot, "node_modules/.bin/openapi");
		const first = run(
			"packed Faker generation",
			cli,
			["generate", "--config", "./openapi.config.ts", "--json"],
			consumerRoot,
		);
		const firstResult = JSON.parse(first);
		if (firstResult.success !== true)
			throw new Error(`Packed Faker generation failed: ${first}`);
		const factoriesPath = join(consumerRoot, "generated/faker/factories.ts");
		const firstFactories = await readFile(factoriesPath, "utf8");
		const firstGeneratedFiles = await readFileTree(
			join(consumerRoot, "generated"),
		);
		const firstDiagnostics = firstResult.diagnostics;
		const second = run(
			"repeat packed Faker generation",
			cli,
			["generate", "--config", "./openapi.config.ts", "--json"],
			consumerRoot,
		);
		const secondResult = JSON.parse(second);
		if (
			secondResult.success !== true ||
			(await readFile(factoriesPath, "utf8")) !== firstFactories ||
			JSON.stringify(await readFileTree(join(consumerRoot, "generated"))) !==
				JSON.stringify(firstGeneratedFiles) ||
			JSON.stringify(secondResult.diagnostics) !==
				JSON.stringify(firstDiagnostics)
		)
			throw new Error(
				"Second packed generation changed files, bytes, diagnostics, or manifest.",
			);
		await writeFile(
			join(consumerRoot, "runtime-check.ts"),
			`import { faker } from "@faker-js/faker";
import { createGetPet200ApplicationJsonResponse, createPet } from "./generated/faker/factories.js";
import getPetHandler from "./generated/pets/get-pet.handler.js";
function setup() { faker.seed(1234); faker.setDefaultRefDate("2026-01-01T00:00:00.000Z"); }
function sample() { setup(); return { pet: createPet(faker), response: createGetPet200ApplicationJsonResponse(faker) }; }
const first = sample();
if (JSON.stringify(first) !== JSON.stringify(sample())) throw new Error("Fixed seed/refDate did not reproduce Faker output.");
const pet = first.pet;
if (typeof pet.name !== "string" || pet.id < 1 || Number.isNaN(Date.parse(pet.createdAt))) throw new Error("Generated component factory returned an invalid Pet value.");
async function handlerResponse(handler: ReturnType<typeof getPetHandler>) { const resolver = Reflect.get(handler, "resolver"); return resolver({ request: new Request("http://localhost/pets"), cookies: {}, params: {} }); }
setup();
const expectedBody = createGetPet200ApplicationJsonResponse(faker);
const expectedNext = faker.string.uuid();
setup();
const handler = getPetHandler(faker);
if (handler.info.method !== "GET" || typeof Reflect.get(handler, "resolver") !== "function") throw new Error("Generated MSW handler is invalid.");
const afterConstruction = faker.string.uuid();
if (afterConstruction !== expectedNext) throw new Error("Faker factory did not run exactly once at handler construction.");
const responseOne = await handlerResponse(handler);
const responseTwo = await handlerResponse(handler);
if (responseOne.status !== 200 || JSON.stringify(await responseOne.json()) !== JSON.stringify(expectedBody) || JSON.stringify(await responseTwo.json()) !== JSON.stringify(expectedBody)) throw new Error("Generated handler did not retain its construction-time response.");
setup();
const nextWithoutFactory = faker.string.uuid();
setup();
const override = { id: 7, name: "fixed", createdAt: "2026-01-01T00:00:00.000Z" };
const overrideHandler = getPetHandler(faker, override);
if (faker.string.uuid() !== nextWithoutFactory) throw new Error("Explicit response override executed the Faker factory.");
const overrideResponse = await handlerResponse(overrideHandler);
if (JSON.stringify(await overrideResponse.json()) !== JSON.stringify(override)) throw new Error("Explicit response override was not used.");
`,
		);
		run(
			"packed strict TypeScript compile",
			join(consumerRoot, "node_modules/.bin/tsc"),
			["-p", "tsconfig.json"],
			consumerRoot,
		);
		run(
			"packed ESM Faker runtime",
			process.execPath,
			["runtime-dist/runtime-check.js"],
			consumerRoot,
		);
		console.log(
			JSON.stringify(
				{
					result: "PASS",
					packedPackages: packed.length,
					directFakerVersion: fakerVersion,
					generatedSourceDeterministic: true,
					strictTypecheck: "PASS",
					esmRuntime: "PASS",
					commonJsRequire: "PASS",
					seedRefDateReproducibility: "PASS",
					mswRuntimeInjection: "PASS",
					constructionTimeFactoryAndOverride: "PASS",
				},
				null,
				2,
			),
		);
	} finally {
		if (process.env.KEEP_FAKER_CONSUMER_SMOKE !== "1")
			await rm(temporaryRoot, { recursive: true, force: true });
		else console.log(`Consumer files retained at ${temporaryRoot}`);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
