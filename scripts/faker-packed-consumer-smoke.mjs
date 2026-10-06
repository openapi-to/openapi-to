import { spawnSync } from "node:child_process";
import {
	mkdtemp,
	mkdir,
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
		if (!aggregate || !fakerPlugin)
			throw new Error("Packed aggregate or Faker plugin is missing.");
		const catalog = await readFile(
			join(repositoryRoot, "pnpm-workspace.yaml"),
			"utf8",
		);
		const fakerVersion = catalog.match(
			/^\s+'@faker-js\/faker':\s+'([^']+)'/m,
		)?.[1];
		const typescriptVersion = JSON.parse(
			await readFile(
				join(repositoryRoot, "node_modules/typescript/package.json"),
				"utf8",
			),
		).version;
		if (!fakerVersion)
			throw new Error("@faker-js/faker is missing from the workspace catalog.");
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
				"@faker-js/faker": fakerVersion,
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
			`import { defineConfig, pluginFaker, pluginTSType } from "openapi-to";\nexport default defineConfig({ servers: [{ name: "faker", input: { path: "./openapi.json" }, output: { base: "workspace", dir: "generated", clean: true } }], plugins: [pluginTSType({ importWithExtension: true }), pluginFaker({ importWithExtension: true })] });\n`,
		);
		await writeJson(join(consumerRoot, "tsconfig.json"), {
			compilerOptions: {
				target: "ES2022",
				module: "NodeNext",
				moduleResolution: "NodeNext",
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
		const second = run(
			"repeat packed Faker generation",
			cli,
			["generate", "--config", "./openapi.config.ts", "--json"],
			consumerRoot,
		);
		if (
			JSON.parse(second).success !== true ||
			(await readFile(factoriesPath, "utf8")) !== firstFactories
		)
			throw new Error(
				"Second packed generation changed generated Faker bytes.",
			);
		await writeFile(
			join(consumerRoot, "runtime-check.ts"),
			`import { faker } from "@faker-js/faker";\nimport { createGetPet200ApplicationJsonResponse, createPet } from "./generated/faker/factories.js";\nfunction sample() { faker.seed(1234); faker.setDefaultRefDate("2026-01-01T00:00:00.000Z"); return { pet: createPet(faker), response: createGetPet200ApplicationJsonResponse(faker) }; }\nconst first = sample();\nif (JSON.stringify(first) !== JSON.stringify(sample())) throw new Error("Fixed seed/refDate did not reproduce Faker output.");\nconst pet = first.pet;\nif (typeof pet.name !== "string" || pet.id < 1 || Number.isNaN(Date.parse(pet.createdAt))) throw new Error("Generated component factory returned an invalid Pet value.");\n`,
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
