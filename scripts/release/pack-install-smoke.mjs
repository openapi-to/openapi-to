import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	access,
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runConsumerCodegenScenario } from "../consumer-codegen-smoke.mjs";
import {
	createPackedOverrides,
	packReleasePackages,
} from "./pack-smoke-helpers.mjs";
import { verifyPublicationArtifacts } from "./publication.mjs";
import { runSetupMcpHandoffScenario } from "./setup-mcp-handoff-smoke.mjs";

const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../..",
);

function parseArguments(argumentsList) {
	if (argumentsList[0] === "--") argumentsList = argumentsList.slice(1);
	if (argumentsList.length === 0) return {};
	if (
		argumentsList.length === 2 &&
		argumentsList[0] === "--publication-manifest"
	) {
		return { publicationManifest: resolve(argumentsList[1]) };
	}
	throw new Error(
		"Usage: pack-install-smoke.mjs [--publication-manifest <path>]",
	);
}

const options = parseArguments(process.argv.slice(2));

function run(command, args, cwd, options = {}) {
	const environment = {
		...process.env,
		CI: "1",
		NO_UPDATE_NOTIFIER: "1",
		...options.env,
	};
	for (const name of options.unsetEnvironment ?? []) {
		delete environment[name];
	}
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		env: environment,
	});
	if (result.error) throw result.error;
	if (result.status !== (options.expectedStatus ?? 0)) {
		throw new Error(
			`${command} ${args.join(" ")} exited with ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
		);
	}
	return result;
}

function pnpm(args, cwd) {
	const executable = process.env.npm_execpath;
	if (executable) return run(process.execPath, [executable, ...args], cwd);
	const suffix = process.platform === "win32" ? ".cmd" : "";
	return run(
		resolve(repositoryRoot, "node_modules", ".bin", `pnpm${suffix}`),
		args,
		cwd,
	);
}

function binPath(installationDirectory, name) {
	const suffix = process.platform === "win32" ? ".cmd" : "";
	return join(
		installationDirectory,
		"node_modules",
		".bin",
		`${name}${suffix}`,
	);
}

async function startRemoteFixtureServer(directory) {
	const serverPath = join(directory, "remote-openapi-server.mjs");
	await writeFile(
		serverPath,
		`import { createServer } from "node:http";
const json = JSON.stringify({
  openapi: "3.1.0",
  info: { title: "Remote JSON Service", version: "1" },
  paths: { "/remote-json": { get: { operationId: "remoteJson", responses: { "200": { description: "ok" } } } } },
});
const yaml = 'openapi: 3.1.0\\ninfo: { title: Remote YAML Service, version: "1" }\\npaths:\\n  /remote-yaml:\\n    get:\\n      operationId: remoteYaml\\n      responses: { "200": { description: ok } }\\n';
const observations = { sameOriginAuthorization: null, crossOriginAuthorization: null };
const crossServer = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (pathname === "/header-final") {
    observations.crossOriginAuthorization = request.headers.authorization ?? null;
    response.end(json);
  } else {
    response.writeHead(404).end();
  }
});
const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (pathname === "/json") {
    response.setHeader("content-type", "text/plain");
    response.end(json);
  } else if (pathname === "/yaml") {
    response.setHeader("content-type", "application/json");
    response.end(yaml);
  } else if (pathname === "/same-redirect") {
    response.writeHead(302, { location: "/same-final" }).end();
  } else if (pathname === "/same-final") {
    observations.sameOriginAuthorization = request.headers.authorization ?? null;
    response.end(json);
  } else if (pathname === "/cross-redirect") {
    response.writeHead(302, { location: "http://127.0.0.1:" + crossServer.address().port + "/header-final" }).end();
  } else if (pathname === "/observations") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(observations));
  } else {
    response.writeHead(404).end();
  }
});
crossServer.listen(0, "127.0.0.1", () => {
  server.listen(0, "127.0.0.1", () => process.stdout.write(JSON.stringify({ primary: server.address().port, cross: crossServer.address().port }) + "\\n"));
});
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => server.close(() => crossServer.close(() => process.exit(0))));
`,
	);
	const child = spawn(process.execPath, [serverPath], {
		cwd: directory,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const port = await new Promise((resolvePort, reject) => {
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`Remote fixture server did not start: ${stderr}`));
		}, 5_000);
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
			const line = stdout.split(/\r?\n/)[0];
			if (!line?.startsWith("{")) return;
			let ports;
			try {
				ports = JSON.parse(line);
			} catch {
				return;
			}
			if (!Number.isInteger(ports.primary) || !Number.isInteger(ports.cross))
				return;
			clearTimeout(timer);
			resolvePort(ports);
		});
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("exit", (code) => {
			if (code !== null && !stdout.includes("\n")) {
				clearTimeout(timer);
				reject(
					new Error(`Remote fixture server exited with ${code}: ${stderr}`),
				);
			}
		});
	});
	return {
		child,
		baseURL: `http://127.0.0.1:${port.primary}`,
		crossBaseURL: `http://127.0.0.1:${port.cross}`,
	};
}

async function directoryBytes(directory) {
	let total = 0;
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const entryPath = join(directory, entry.name);
		if (entry.isDirectory()) total += await directoryBytes(entryPath);
		else if (entry.isFile()) total += (await stat(entryPath)).size;
	}
	return total;
}

function dependencyNames(node, names = new Set()) {
	for (const [name, dependency] of Object.entries(node?.dependencies ?? {})) {
		names.add(name);
		dependencyNames(dependency, names);
	}
	return names;
}

async function skillTreeHashes(root, manifest) {
	const hashes = {};
	for (const skill of manifest.skills) {
		for (const file of skill.files) {
			const key = `${skill.name}/${file.path}`;
			const bytes = await readFile(
				join(root, skill.name, ...file.path.split("/")),
			);
			hashes[key] = createHash("sha256").update(bytes).digest("hex");
		}
	}
	return hashes;
}

async function runPackedCodexSkillInstallerScenario({
	consumerRoot,
	openapiExecutable,
	openapiToExecutable,
	packed,
}) {
	const codexHome = join(consumerRoot, "Codex Home with spaces 空格");
	const notifierHome = join(consumerRoot, "notifier-user-home");
	const notifierConfig = join(consumerRoot, "notifier-config");
	const notifierAppData = join(consumerRoot, "notifier-app-data");
	const notifierLocalAppData = join(consumerRoot, "notifier-local-app-data");
	const networkTrace = join(consumerRoot, "codex-skills-network-attempted");
	const networkGuard = join(consumerRoot, "codex-skills-deny-network.cjs");
	await writeFile(
		networkGuard,
		`const fs = require("node:fs");
const net = require("node:net");
net.Socket.prototype.connect = function () {
  fs.appendFileSync(process.env.OPENAPI_TO_NETWORK_TRACE, "attempted\\n");
  throw new Error("Unexpected network access in packed Codex Skill installer smoke");
};
`,
	);
	const environment = {
		CODEX_HOME: codexHome,
		HOME: notifierHome,
		USERPROFILE: notifierHome,
		XDG_CONFIG_HOME: notifierConfig,
		APPDATA: notifierAppData,
		LOCALAPPDATA: notifierLocalAppData,
		NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${networkGuard}`]
			.filter(Boolean)
			.join(" "),
		OPENAPI_TO_NETWORK_TRACE: networkTrace,
	};
	const humanDryRun = run(
		openapiExecutable,
		["skills", "install", "--host", "codex", "--dry-run"],
		consumerRoot,
		{
			env: environment,
			unsetEnvironment: ["NO_UPDATE_NOTIFIER"],
		},
	);
	if (
		!humanDryRun.stdout.includes("No files were written") ||
		!humanDryRun.stdout.includes("Restart Codex")
	) {
		throw new Error(
			"Packed Codex Skill installer human dry-run contract failed",
		);
	}
	for (const [label, directory] of [
		["CODEX_HOME", codexHome],
		["HOME", notifierHome],
		["XDG_CONFIG_HOME", notifierConfig],
		["APPDATA", notifierAppData],
		["LOCALAPPDATA", notifierLocalAppData],
	]) {
		try {
			await access(directory);
			throw new Error(
				`Packed Codex Skill installer human dry-run created ${label}`,
			);
		} catch (error) {
			if (!(error && error.code === "ENOENT")) throw error;
		}
	}
	for (const [executable, alias] of [
		[openapiExecutable, "openapi"],
		[openapiToExecutable, "openapi-to"],
	]) {
		const globalDebugDryRun = run(
			executable,
			["--debug", "skills", "install", "--host", "codex", "--dry-run"],
			consumerRoot,
			{
				env: environment,
				unsetEnvironment: ["NO_UPDATE_NOTIFIER"],
			},
		);
		if (!globalDebugDryRun.stdout.includes("No files were written")) {
			throw new Error(
				`Packed ${alias} global-debug Skill dry-run contract failed`,
			);
		}
		for (const [label, directory] of [
			["CODEX_HOME", codexHome],
			["HOME", notifierHome],
			["XDG_CONFIG_HOME", notifierConfig],
			["APPDATA", notifierAppData],
			["LOCALAPPDATA", notifierLocalAppData],
			["network trace", networkTrace],
		]) {
			try {
				await access(directory);
				throw new Error(
					`Packed ${alias} global-debug Skill dry-run created ${label}`,
				);
			} catch (error) {
				if (!(error && error.code === "ENOENT")) throw error;
			}
		}
	}
	const dryRun = JSON.parse(
		run(
			openapiExecutable,
			["skills", "install", "--host", "codex", "--dry-run", "--json"],
			consumerRoot,
			{ env: environment },
		).stdout,
	);
	if (
		dryRun.success !== true ||
		dryRun.command !== "skills install" ||
		dryRun.mode !== "dry-run" ||
		dryRun.host !== "codex" ||
		dryRun.restartRequired !== true ||
		dryRun.installed?.length !== 0
	) {
		throw new Error("Packed Codex Skill installer dry-run contract failed");
	}
	try {
		await access(codexHome);
		throw new Error("Packed Codex Skill installer dry-run created CODEX_HOME");
	} catch (error) {
		if (!(error && error.code === "ENOENT")) throw error;
	}

	const resolverPath = join(consumerRoot, "resolve-cli-skill-assets.mjs");
	await writeFile(
		resolverPath,
		`import { createRequire } from "node:module";
import path from "node:path";
const consumerRequire = createRequire(import.meta.url);
const aggregateEntry = consumerRequire.resolve("openapi-to");
const aggregateRequire = createRequire(aggregateEntry);
const cliEntry = aggregateRequire.resolve("@openapi-to/cli");
process.stdout.write(JSON.stringify({ assetRoot: path.join(path.dirname(cliEntry), "skills") }));
`,
	);
	const { assetRoot } = JSON.parse(
		run(process.execPath, [resolverPath], consumerRoot).stdout,
	);
	const manifestBytes = await readFile(join(assetRoot, "manifest.json"));
	const manifest = JSON.parse(manifestBytes);
	const cliPackage = packed.find(({ name }) => name === "@openapi-to/cli");
	if (
		!cliPackage ||
		manifest.schemaVersion !== 1 ||
		manifest.packageVersion !== cliPackage.version ||
		manifest.skills?.map(({ name }) => name).join(",") !==
			"openapi-to-generate,openapi-to-setup"
	) {
		throw new Error("Packed Codex Skill manifest version or Skill set failed");
	}
	const packagedHashes = await skillTreeHashes(assetRoot, manifest);
	const installStarted = process.hrtime.bigint();
	const installedResult = run(
		openapiToExecutable,
		["skills", "install", "--host", "codex", "--json"],
		consumerRoot,
		{ env: environment },
	);
	const installMilliseconds =
		Number(process.hrtime.bigint() - installStarted) / 1_000_000;
	const installed = JSON.parse(installedResult.stdout);
	if (
		installed.success !== true ||
		installed.mode !== "install" ||
		installed.restartRequired !== true ||
		installed.installed?.join(",") !== "openapi-to-generate,openapi-to-setup"
	) {
		throw new Error("Packed Codex Skill installer install contract failed");
	}
	const installedRoot = join(codexHome, "skills");
	const installedEntries = (await readdir(installedRoot)).sort();
	if (installedEntries.join(",") !== "openapi-to-generate,openapi-to-setup") {
		throw new Error(
			"Packed Codex Skill installer left an unexpected installed file set",
		);
	}
	const installedHashes = await skillTreeHashes(installedRoot, manifest);
	if (JSON.stringify(installedHashes) !== JSON.stringify(packagedHashes)) {
		throw new Error(
			"Packed Codex Skill installer bytes differ from packaged assets",
		);
	}
	try {
		await access(networkTrace);
		throw new Error("Packed Codex Skill installer attempted network access");
	} catch (error) {
		if (!(error && error.code === "ENOENT")) throw error;
	}
	const beforeSecondInstall = JSON.stringify(installedHashes);
	const secondInstall = run(
		openapiExecutable,
		["skills", "install", "--host", "codex", "--json"],
		consumerRoot,
		{ env: environment, expectedStatus: 1 },
	);
	const secondInstallOutput = JSON.parse(secondInstall.stdout);
	if (
		secondInstallOutput.success !== false ||
		!secondInstallOutput.diagnostics?.some(
			({ code }) => code === "SKILLS_DESTINATION_CONFLICT",
		)
	) {
		throw new Error(
			"Packed Codex Skill installer did not reject existing destinations",
		);
	}
	if (
		JSON.stringify(await skillTreeHashes(installedRoot, manifest)) !==
		beforeSecondInstall
	) {
		throw new Error(
			"Packed Codex Skill installer modified bytes on its second invocation",
		);
	}
	const skillBytes = manifest.skills
		.flatMap(({ files }) => files)
		.reduce((total, { size }) => total + size, 0);
	return {
		package: cliPackage.name,
		version: cliPackage.version,
		skillCount: manifest.skills.length,
		fileCount: manifest.skills.flatMap(({ files }) => files).length,
		skillBytes,
		manifestBytes: manifestBytes.byteLength,
		installMilliseconds,
		humanDryRunNoNotifier: true,
		globalDebugDryRunNoNotifier: true,
		networkAttempted: false,
		dryRun: true,
		install: true,
		secondInstallRejected: true,
		installedBytesVerified: true,
	};
}

const temporaryRoot = await mkdtemp(
	join(tmpdir(), "openapi-to-release-smoke-"),
);
const tarballDirectory = join(temporaryRoot, "tarballs");
const installationDirectory = join(temporaryRoot, "consumer");
const aggregateInstallationDirectory = join(
	temporaryRoot,
	"aggregate-only-consumer",
);
const formalCodegenConsumerDirectory = join(
	temporaryRoot,
	"formal-codegen-consumer",
);
await writeFile(join(temporaryRoot, ".keep"), "release smoke workspace\n");
await Promise.all([
	mkdir(tarballDirectory, { recursive: true }),
	mkdir(installationDirectory, { recursive: true }),
	mkdir(aggregateInstallationDirectory, { recursive: true }),
	mkdir(formalCodegenConsumerDirectory, { recursive: true }),
]);

let succeeded = false;
let remoteFixtureServer;
let packageBaseline;
let setupMcpHandoff;
let codexSkillsInstaller;
try {
	const packed = options.publicationManifest
		? (
				await verifyPublicationArtifacts({
					root: repositoryRoot,
					manifestPath: options.publicationManifest,
				})
			).packages
		: await packReleasePackages({
				repositoryRoot,
				tarballDirectory,
				pnpm,
			});
	const packedOverrides = createPackedOverrides(packed);
	const aggregateArchive = packed.find(
		({ name }) => name === "openapi-to",
	)?.archive;
	if (!aggregateArchive)
		throw new Error("Packed aggregate openapi-to archive is missing");

	await runConsumerCodegenScenario({
		consumerRoot: formalCodegenConsumerDirectory,
		packed,
	});

	await writeFile(
		join(aggregateInstallationDirectory, "package.json"),
		JSON.stringify(
			{
				name: "openapi-to-aggregate-only-release-smoke",
				private: true,
				type: "module",
				devDependencies: {
					"openapi-to": `file:${aggregateArchive}`,
				},
				pnpm: {
					overrides: packedOverrides,
				},
			},
			null,
			2,
		),
	);
	pnpm(
		["install", "--ignore-scripts", "--prefer-offline"],
		aggregateInstallationDirectory,
	);
	await writeFile(
		join(aggregateInstallationDirectory, "openapi.yaml"),
		'openapi: 3.1.0\ninfo: { title: Aggregate only, version: "1" }\npaths: {}\n',
	);
	await writeFile(
		join(aggregateInstallationDirectory, "openapi.config.cjs"),
		`module.exports = {
  servers: [{ name: "main", input: { path: "./openapi.yaml" }, output: { dir: "generated" } }],
  plugins: []
};
`,
	);
	await writeFile(
		join(aggregateInstallationDirectory, "mcp-aggregate-stdio-smoke.mjs"),
		`import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const aggregateRequire = createRequire(import.meta.url);
const aggregateEntry = aggregateRequire.resolve("openapi-to");
const mcpRequire = createRequire(aggregateEntry);
const mcpManifest = mcpRequire.resolve("@openapi-to/mcp/package.json");
const sdkRequire = createRequire(mcpManifest);
const { Client } = await import(pathToFileURL(sdkRequire.resolve("@modelcontextprotocol/sdk/client/index.js")));
const { StdioClientTransport } = await import(pathToFileURL(sdkRequire.resolve("@modelcontextprotocol/sdk/client/stdio.js")));
const stderr = [];
const serverArgs = process.argv.slice(3);
const transport = new StdioClientTransport({ command: process.argv[2], args: [...serverArgs, "--workspace-root", process.cwd()], stderr: "pipe" });
transport.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
const client = new Client({ name: "aggregate-only-release-smoke", version: "1.0.0" });
await client.connect(transport);
const tools = await client.listTools();
const analysis = ["openapi_validate", "openapi_inspect", "openapi_diff"];
const configured = [...analysis, "openapi_list_targets", "openapi_search_operations", "openapi_get_operation", "openapi_generate_dry_run", "openapi_check_generation"];
const write = [...configured, "openapi_prepare_generation", "openapi_apply_generation"];
const expected = serverArgs.includes("--allow-write") ? write : serverArgs.includes("--config") ? configured : analysis;
if (tools.tools.map(({ name }) => name).join(",") !== expected.join(",")) throw new Error("Packed MCP tool matrix mismatch: expected " + expected.length);
for (const tool of tools.tools) {
  if (!tool.title || !tool.description || tool.inputSchema?.type !== "object" || tool.outputSchema?.type !== "object") throw new Error("Packed MCP schema metadata is incomplete");
}
await client.close();
if (stderr.join("").includes("Unable to start server")) throw new Error("Aggregate-only MCP server reported a startup failure");
`,
	);
	const aggregateOnlyOpenapi = binPath(
		aggregateInstallationDirectory,
		"openapi",
	);
	const aggregateOnlyOpenapiTo = binPath(
		aggregateInstallationDirectory,
		"openapi-to",
	);
	const aggregateOnlyMcp = binPath(
		aggregateInstallationDirectory,
		"openapi-to-mcp",
	);
	if (process.platform !== "win32") {
		await Promise.all(
			[aggregateOnlyOpenapi, aggregateOnlyOpenapiTo, aggregateOnlyMcp].map(
				(path) => chmod(path, 0o755),
			),
		);
	}
	codexSkillsInstaller = await runPackedCodexSkillInstallerScenario({
		consumerRoot: aggregateInstallationDirectory,
		openapiExecutable: aggregateOnlyOpenapi,
		openapiToExecutable: aggregateOnlyOpenapiTo,
		packed,
	});
	pnpm(["exec", "openapi", "--help"], aggregateInstallationDirectory);
	pnpm(["exec", "openapi-to", "--version"], aggregateInstallationDirectory);
	pnpm(["exec", "openapi-to-mcp", "--help"], aggregateInstallationDirectory);
	const coldInitializeStarted = process.hrtime.bigint();
	for (const [matrixIndex, serverArgs] of [
		[],
		["--config", "openapi.config.cjs"],
		["--config", "openapi.config.cjs", "--allow-write"],
	].entries()) {
		run(
			process.execPath,
			["mcp-aggregate-stdio-smoke.mjs", aggregateOnlyMcp, ...serverArgs],
			aggregateInstallationDirectory,
		);
		if (matrixIndex === 0) {
			const mcpInitializeMilliseconds =
				Number(process.hrtime.bigint() - coldInitializeStarted) / 1_000_000;
			const listed = JSON.parse(
				pnpm(
					["list", "--depth", "Infinity", "--json"],
					aggregateInstallationDirectory,
				).stdout,
			)[0];
			packageBaseline = {
				aggregateNodeModulesBytes: await directoryBytes(
					join(aggregateInstallationDirectory, "node_modules"),
				),
				productionDependencyCount: dependencyNames(
					listed.devDependencies?.["openapi-to"],
				).size,
				mcpInitializeMilliseconds,
			};
		}
	}

	await writeFile(
		join(installationDirectory, "package.json"),
		JSON.stringify(
			{
				name: "openapi-to-release-smoke",
				private: true,
				type: "module",
				dependencies: Object.fromEntries(
					packed
						.map(({ name, archive }) => [name, `file:${archive}`])
						.sort(([left], [right]) =>
							left < right ? -1 : left > right ? 1 : 0,
						),
				),
				devDependencies: {
					"@modelcontextprotocol/sdk": "1.29.0",
					"@types/node": "^22.7.4",
					zod: "4.4.3",
				},
				pnpm: {
					overrides: packedOverrides,
				},
			},
			null,
			2,
		),
	);
	pnpm(
		["install", "--ignore-scripts", "--prefer-offline"],
		installationDirectory,
	);
	const independentMcpBin = join(
		installationDirectory,
		"node_modules",
		"@openapi-to",
		"mcp",
		"bin",
		"openapi-to-mcp.js",
	);
	run(process.execPath, [independentMcpBin, "--help"], installationDirectory);
	for (const serverArgs of [
		[],
		["--config", "openapi.config.cjs"],
		["--config", "openapi.config.cjs", "--allow-write"],
	]) {
		run(
			process.execPath,
			[
				join(aggregateInstallationDirectory, "mcp-aggregate-stdio-smoke.mjs"),
				process.execPath,
				independentMcpBin,
				...serverArgs,
			],
			aggregateInstallationDirectory,
		);
	}

	const minimumDocument = `openapi: 3.0.3
info:
  title: Order Service
  version: 1.0.0
paths:
  /orders/{id}:
    get:
      operationId: getById
      responses:
        "200":
          description: OK
`;
	const userDocument = {
		openapi: "3.1.0",
		info: { title: "User Service", version: "1.0.0" },
		paths: {
			"/users/{id}": {
				get: {
					operationId: "getById",
					responses: { 200: { description: "OK" } },
				},
			},
		},
	};
	await writeFile(
		join(installationDirectory, "user.json"),
		`${JSON.stringify(userDocument, null, 2)}\n`,
	);
	await writeFile(join(installationDirectory, "order.yaml"), minimumDocument);
	await writeFile(
		join(installationDirectory, "legacy.yml"),
		minimumDocument
			.replace("Order Service", "Legacy Service")
			.replace("getById", "legacyGetById"),
	);
	await writeFile(join(installationDirectory, "openapi.yaml"), minimumDocument);
	await writeFile(join(installationDirectory, "invalid.yaml"), "openapi: [\n");
	remoteFixtureServer = await startRemoteFixtureServer(installationDirectory);
	await writeFile(
		join(installationDirectory, "openapi.config.cjs"),
		`module.exports = {
  servers: [
    { name: "user-service", input: { path: "./user.json" }, output: { base: "workspace", dir: "src/api/generated/user", clean: true } },
    { name: "order-service", input: { path: "./order.yaml" }, output: { base: "workspace", dir: "src/api/generated/order", clean: true } },
    { name: "legacy-service", input: { path: "./legacy.yml" }, output: { dir: "legacy", clean: true } },
    { name: "remote-json", input: { path: "${remoteFixtureServer.baseURL}/json?service=remote&token=release-smoke", remote: { allowPrivateNetwork: true, allowedHosts: ["127.0.0.1"] } }, output: { base: "workspace", dir: "src/api/generated/remote-json", clean: true } },
    { name: "remote-yaml", input: { path: "${remoteFixtureServer.baseURL}/yaml", remote: { allowPrivateNetwork: true, allowedHosts: ["127.0.0.1"] } }, output: { base: "workspace", dir: "src/api/generated/remote-yaml", clean: true } }
  ],
  plugins: [{ name: "release-write-smoke", hooks: { buildStart(ctx) {
    ctx.addArtifact({ kind: "text", path: "client.txt", content: ctx.openapiToSingleConfig.name + "\\n" });
  } } }]
};
`,
	);
	await writeFile(
		join(installationDirectory, "remote-policy.config.cjs"),
		`module.exports = {
  servers: [
    {
      name: "same-origin",
      input: {
        path: "${remoteFixtureServer.baseURL}/same-redirect",
        remote: {
          allowPrivateNetwork: true,
          allowedHosts: ["127.0.0.1"],
          headers: { Authorization: "Bearer packed-redirect-secret" }
        }
      },
      output: { dir: "same-origin" }
    },
    {
      name: "cross-origin",
      input: {
        path: "${remoteFixtureServer.baseURL}/cross-redirect",
        remote: {
          allowPrivateNetwork: true,
          allowedHosts: ["127.0.0.1"],
          headers: { Authorization: "Bearer packed-redirect-secret" }
        }
      },
      output: { dir: "cross-origin" }
    }
  ],
  plugins: []
};
`,
	);
	setupMcpHandoff = await runSetupMcpHandoffScenario({
		consumerRoot: installationDirectory,
		packed,
		repositoryRoot,
	});
	await writeFile(
		join(installationDirectory, "esm-smoke.mjs"),
		`import * as openapiTo from "openapi-to";
import {
  compileOpenAPI,
  inspectOpenAPIDocument,
  diffOpenAPIDocuments,
  pluginSWR,
  pluginMSW,
} from "openapi-to";
import { runMcpCli } from "@openapi-to/mcp/cli";
import { definePlugin as swrPackage } from "@openapi-to/plugin-swr";
import { definePlugin as mswPackage } from "@openapi-to/plugin-msw";
const document = {
  openapi: "3.0.3",
  info: { title: "Release Smoke", version: "1.0.0" },
  paths: { "/ping": { get: { operationId: "ping", responses: { "200": { description: "OK" } } } } },
};
const compilation = await compileOpenAPI(document);
if (!compilation.success || !compilation.document) throw new Error("compileOpenAPI failed");
const inspection = inspectOpenAPIDocument(compilation.document);
if (inspection.pathCount !== 1 || inspection.operationCount !== 1) throw new Error("inspect failed");
const difference = diffOpenAPIDocuments(compilation.document, compilation.document);
if (difference.breaking || difference.changes.length !== 0) throw new Error("diff failed");
if (pluginSWR !== swrPackage || pluginMSW !== mswPackage || pluginSWR === pluginMSW) throw new Error("plugin identity failed");
if (pluginSWR().name !== "SWR" || pluginMSW().name !== "MSW") throw new Error("plugin name failed");
if (typeof runMcpCli !== "function") throw new Error("MCP CLI ESM export missing");
for (const forbidden of ["createOpenapiToMcpServer", "runMcpCli", "openapi_prepare_generation", "openapi_apply_generation"]) {
  if (forbidden in openapiTo) throw new Error("Aggregate top-level MCP boundary regressed: " + forbidden);
}
`,
	);
	await writeFile(
		join(installationDirectory, "cjs-smoke.cjs"),
		`const openapiTo = require("openapi-to");
const swr = require("@openapi-to/plugin-swr");
const msw = require("@openapi-to/plugin-msw");
const mcp = require("@openapi-to/mcp");
const mcpCli = require("@openapi-to/mcp/cli");
if (typeof openapiTo.compileOpenAPI !== "function") throw new Error("CJS core export missing");
if (openapiTo.pluginSWR !== swr.definePlugin || openapiTo.pluginMSW !== msw.definePlugin) throw new Error("CJS plugin identity failed");
if (openapiTo.pluginSWR === openapiTo.pluginMSW) throw new Error("CJS plugins collapsed");
if (typeof mcp.createOpenapiToMcpServer !== "function") throw new Error("MCP CJS export missing");
if (typeof mcpCli.runMcpCli !== "function") throw new Error("MCP CLI CJS export missing");
for (const forbidden of ["createOpenapiToMcpServer", "runMcpCli", "openapi_prepare_generation", "openapi_apply_generation"]) {
  if (forbidden in openapiTo) throw new Error("Aggregate top-level MCP boundary regressed: " + forbidden);
}
`,
	);
	await writeFile(
		join(installationDirectory, "types-smoke.ts"),
		`import {
  compileOpenAPI,
  inspectOpenAPIDocument,
  diffOpenAPIDocuments,
  pluginSWR,
  pluginMSW,
  type Diagnostic,
  type GeneratedArtifact,
  type GenerationManifest,
  type GenerationResult,
  type OutputBase,
} from "openapi-to";
import {
  applyOperationSelectionMutation,
  createEmptyOperationSelection,
  mergeOperationSelection,
  type OperationSelectionMergeResult,
  type OperationSelectionMutation,
  type OperationSelectionMutationResult,
  type PersistentOperationSelectionMutation,
} from "@openapi-to/core";
import { createOpenapiToMcpServer, type OpenapiToMcpServerOptions } from "@openapi-to/mcp";
import { runMcpCli } from "@openapi-to/mcp/cli";
const diagnostic: Diagnostic = { code: "SMOKE", severity: "info", message: "smoke" };
const outputBase: OutputBase = "workspace";
declare const artifact: GeneratedArtifact;
declare const manifest: GenerationManifest;
declare const generation: GenerationResult;
const mcpOptions: OpenapiToMcpServerOptions = { workspaceRoot: ".", configPath: "openapi.config.cjs", allowWrite: true };
const legacyMutation: OperationSelectionMutation = { type: "add", operationKeys: ["getUser"] };
const legacyResultMock: OperationSelectionMergeResult = {
  manifest: createEmptyOperationSelection("sdk", "owner"),
  previousOperationKeys: [],
  requestedOperationKeys: ["getUser"],
  newlyAddedOperationKeys: ["getUser"],
  alreadySelectedOperationKeys: [],
  desiredOperationKeys: ["getUser"],
};
const legacyMerged: OperationSelectionMergeResult = mergeOperationSelection(legacyResultMock.manifest, legacyMutation);
const replaceMutation: PersistentOperationSelectionMutation = { type: "replace", operationKeys: ["getUser"] };
const replacement: OperationSelectionMutationResult = applyOperationSelectionMutation(legacyResultMock.manifest, replaceMutation);
void [compileOpenAPI, inspectOpenAPIDocument, diffOpenAPIDocuments, pluginSWR, pluginMSW, diagnostic, outputBase, artifact, manifest, generation, createOpenapiToMcpServer, runMcpCli, mcpOptions, legacyResultMock, legacyMerged, replacement];
`,
	);
	await writeFile(
		join(installationDirectory, "mcp-esm-smoke.mjs"),
		`import { createOpenapiToMcpServer } from "@openapi-to/mcp";
const server = createOpenapiToMcpServer({ workspaceRoot: process.cwd() });
if (typeof server.connect !== "function") throw new Error("MCP ESM export missing");
await server.close();
`,
	);
	await writeFile(
		join(installationDirectory, "mcp-stdio-smoke.mjs"),
		`import { access, readFile, readdir } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const analysisTools = ["openapi_validate", "openapi_inspect", "openapi_diff"];
const configuredTools = [...analysisTools, "openapi_list_targets", "openapi_search_operations", "openapi_get_operation", "openapi_generate_dry_run", "openapi_check_generation"];
const writeToolNames = [...configuredTools, "openapi_prepare_generation", "openapi_apply_generation"];
function assertToolMatrix(listed, expected) {
  if (listed.map(({ name }) => name).join(",") !== expected.join(",")) throw new Error("Unexpected packed MCP tool matrix");
  for (const tool of listed) {
    if (!tool.title || !tool.description || tool.inputSchema?.type !== "object" || tool.outputSchema?.type !== "object") throw new Error("Packed MCP schema metadata is incomplete");
    const write = tool.name === "openapi_apply_generation";
    if (tool.annotations?.readOnlyHint !== !write || tool.annotations?.destructiveHint !== write || tool.annotations?.idempotentHint !== (write ? false : tool.name !== "openapi_prepare_generation")) throw new Error("Packed MCP annotations are incorrect");
  }
}
const transport = new StdioClientTransport({ command: process.argv[2], args: ["--workspace-root", process.cwd()], stderr: "pipe" });
const client = new Client({ name: "release-smoke", version: "1.0.0" });
await client.connect(transport);
const tools = await client.listTools();
assertToolMatrix(tools.tools, analysisTools);
const result = await client.callTool({ name: "openapi_validate", arguments: { source: "openapi.yaml" } });
if (result.isError || result.structuredContent?.success !== true) throw new Error("MCP validate smoke failed");
await client.close();

const configuredTransport = new StdioClientTransport({ command: process.argv[2], args: ["--workspace-root", process.cwd(), "--config", "openapi.config.cjs", "--allow-private-network", "--allow-host", "127.0.0.1"], stderr: "pipe" });
const configuredClient = new Client({ name: "release-configured-smoke", version: "1.0.0" });
await configuredClient.connect(configuredTransport);
const configured = await configuredClient.listTools();
assertToolMatrix(configured.tools, configuredTools);
if (configured.tools.some(({ name }) => name === "openapi_prepare_generation" || name === "openapi_apply_generation")) throw new Error("Packed MCP exposed write tools without --allow-write");
const listedTargets = await configuredClient.callTool({ name: "openapi_list_targets", arguments: {} });
if (listedTargets.isError || listedTargets.structuredContent?.targets?.map(({ name }) => name).join(",") !== "user-service,order-service,legacy-service,remote-json,remote-yaml") throw new Error("Packed MCP target order failed");
const userSearch = await configuredClient.callTool({ name: "openapi_search_operations", arguments: { target: "user-service", query: "getById" } });
const orderSearch = await configuredClient.callTool({ name: "openapi_search_operations", arguments: { target: "order-service", query: "getById" } });
if (userSearch.isError || userSearch.structuredContent?.items?.[0]?.path !== "/users/{id}") throw new Error("Packed MCP user target search leaked or failed");
if (orderSearch.isError || orderSearch.structuredContent?.items?.[0]?.path !== "/orders/{id}") throw new Error("Packed MCP order target search leaked or failed");
const userContract = await configuredClient.callTool({ name: "openapi_get_operation", arguments: { target: "user-service", operationKey: "getById" } });
const orderContract = await configuredClient.callTool({ name: "openapi_get_operation", arguments: { target: "order-service", operationKey: "getById" } });
if (userContract.isError || userContract.structuredContent?.operation?.path !== "/users/{id}") throw new Error("Packed MCP user contract lookup leaked or failed");
if (orderContract.isError || orderContract.structuredContent?.operation?.path !== "/orders/{id}") throw new Error("Packed MCP order contract lookup leaked or failed");
await configuredClient.close();

const remotePolicyStderr = [];
const remotePolicyTransport = new StdioClientTransport({ command: process.argv[2], args: ["--workspace-root", process.cwd(), "--config", "remote-policy.config.cjs", "--allow-private-network", "--allow-host", "127.0.0.1"], stderr: "pipe" });
remotePolicyTransport.stderr?.on("data", (chunk) => remotePolicyStderr.push(String(chunk)));
const remotePolicyClient = new Client({ name: "release-remote-policy-smoke", version: "1.0.0" });
await remotePolicyClient.connect(remotePolicyTransport);
const remotePolicyTargets = await remotePolicyClient.callTool({ name: "openapi_list_targets", arguments: {} });
if (remotePolicyTargets.isError || remotePolicyTargets.structuredContent?.success !== true || remotePolicyTargets.structuredContent?.targets?.some(({ catalogAvailable }) => catalogAvailable !== true)) {
  const summary = {
    diagnostics: remotePolicyTargets.structuredContent?.diagnostics?.map(({ code, message }) => ({ code, message })),
    targets: remotePolicyTargets.structuredContent?.targets?.map(({ name, catalogAvailable, diagnosticSummary }) => ({
    name,
    catalogAvailable,
    diagnosticSummary,
    })),
  };
  throw new Error("Packed MCP remote policy targets failed: " + JSON.stringify(summary));
}
await remotePolicyClient.close();
const redirectObservations = await fetch("${remoteFixtureServer.baseURL}/observations").then((response) => response.json());
if (redirectObservations.sameOriginAuthorization !== "Bearer packed-redirect-secret") throw new Error("Packed MCP same-origin redirect dropped trusted headers");
if (redirectObservations.crossOriginAuthorization !== null) throw new Error("Packed MCP cross-origin redirect leaked trusted headers");
if (remotePolicyStderr.join("").includes("packed-redirect-secret")) throw new Error("Packed MCP stderr leaked a trusted header");

const restrictedPolicyTransport = new StdioClientTransport({ command: process.argv[2], args: ["--workspace-root", process.cwd(), "--config", "remote-policy.config.cjs", "--allow-private-network", "--allow-host", "schemas.example.com"], stderr: "pipe" });
const restrictedPolicyClient = new Client({ name: "release-restricted-policy-smoke", version: "1.0.0" });
await restrictedPolicyClient.connect(restrictedPolicyTransport);
const restrictedPolicy = await restrictedPolicyClient.callTool({ name: "openapi_search_operations", arguments: { target: "same-origin", query: "remote" } });
if (!restrictedPolicy.isError || !restrictedPolicy.structuredContent?.diagnostics?.some(({ code }) => code === "CONFIG_REMOTE_POLICY_CONFLICT")) throw new Error("Packed MCP operator host policy did not tighten the Target policy");
if (JSON.stringify(restrictedPolicy).includes("packed-redirect-secret")) throw new Error("Packed MCP policy error leaked a trusted header");
await restrictedPolicyClient.close();

const writeStderr = [];
const writeTransport = new StdioClientTransport({ command: process.argv[2], args: ["--workspace-root", process.cwd(), "--config", "openapi.config.cjs", "--allow-write", "--allow-private-network", "--allow-host", "127.0.0.1"], stderr: "pipe" });
writeTransport.stderr?.on("data", (chunk) => writeStderr.push(String(chunk)));
const writeClient = new Client({ name: "release-write-smoke", version: "1.0.0" });
await writeClient.connect(writeTransport);
const writeTools = await writeClient.listTools();
assertToolMatrix(writeTools.tools, writeToolNames);
const prepared = await writeClient.callTool({ name: "openapi_prepare_generation", arguments: { targets: ["user-service"], selection: { type: "add", operationKeys: ["getById"] } } });
const plan = prepared.structuredContent?.plan;
if (prepared.isError || !plan || plan.kind !== "selective" || plan.applySupported !== true || typeof plan.token !== "string" || plan.summary.added !== 1) throw new Error("MCP selective Prepare smoke failed");
try { await access("src/api/generated/user"); throw new Error("Prepare wrote the output directory"); } catch (error) { if (!(error && error.code === "ENOENT")) throw error; }
try { await access(".openapi-to/selections"); throw new Error("Prepare wrote the selection directory"); } catch (error) { if (!(error && error.code === "ENOENT")) throw error; }
const applied = await writeClient.callTool({ name: "openapi_apply_generation", arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash } });
if (applied.isError || applied.structuredContent?.applied !== true || applied.structuredContent?.planKind !== "selective" || applied.structuredContent?.selectionApplied !== true || applied.structuredContent?.selectedOperationCount !== 1) throw new Error("MCP selective Apply smoke failed");
if (await readFile("src/api/generated/user/client.txt", "utf8") !== "user-service\\n") throw new Error("MCP Apply wrote unexpected bytes");
const ownership = JSON.parse(await readFile("src/api/generated/user/.openapi-to-manifest.json", "utf8"));
if (ownership.version !== 2 || ownership.files.length !== 1) throw new Error("MCP Apply ownership manifest failed");
const selectionFiles = await readdir(".openapi-to/selections");
if (selectionFiles.length !== 1) throw new Error("MCP selective Apply wrote an unexpected selection file set");
const selection = JSON.parse(await readFile(".openapi-to/selections/" + selectionFiles[0], "utf8"));
if (selection.target !== "user-service" || selection.operations?.join(",") !== "getById") throw new Error("MCP selective Apply wrote unexpected selection state");
const replay = await writeClient.callTool({ name: "openapi_apply_generation", arguments: { planId: plan.planId, token: plan.token, approvedPlanHash: plan.planHash } });
if (!replay.isError || !replay.structuredContent?.diagnostics?.some(({ code }) => code === "MCP_PLAN_ALREADY_USED")) throw new Error("MCP Apply replay was not rejected");
const current = await writeClient.callTool({ name: "openapi_check_generation", arguments: { targets: ["user-service"] } });
if (current.structuredContent?.outdated !== false) throw new Error("MCP Apply output is not current");
const unchanged = await writeClient.callTool({ name: "openapi_prepare_generation", arguments: { targets: ["user-service"] } });
const unchangedSummary = unchanged.structuredContent?.plan?.summary;
if (unchanged.isError || !unchangedSummary || unchangedSummary.added !== 0 || unchangedSummary.modified !== 0 || unchangedSummary.deleted !== 0) throw new Error("MCP second Prepare was not unchanged");
if (writeStderr.join("").includes(plan.token)) throw new Error("MCP token leaked to stderr");
if (writeStderr.join("").includes(unchanged.structuredContent.plan.token)) throw new Error("MCP second plan token leaked to stderr");
await writeClient.close();
`,
	);
	await writeFile(
		join(installationDirectory, "tsconfig.json"),
		JSON.stringify(
			{
				compilerOptions: {
					module: "NodeNext",
					moduleResolution: "NodeNext",
					lib: ["ESNext", "DOM"],
					target: "ES2022",
					strict: true,
					noEmit: true,
					skipLibCheck: false,
					types: ["node"],
				},
				include: ["types-smoke.ts"],
			},
			null,
			2,
		),
	);

	run(process.execPath, ["esm-smoke.mjs"], installationDirectory);
	run(process.execPath, ["mcp-esm-smoke.mjs"], installationDirectory);
	run(process.execPath, ["cjs-smoke.cjs"], installationDirectory);
	run(
		resolve(
			repositoryRoot,
			"node_modules",
			".bin",
			process.platform === "win32" ? "tsc.cmd" : "tsc",
		),
		["-p", "tsconfig.json"],
		installationDirectory,
	);

	const aggregateVersion = packed.find(
		({ name }) => name === "openapi-to",
	).version;
	const reportedVersions = {};
	for (const binary of ["openapi", "openapi-to"]) {
		const executable = binPath(installationDirectory, binary);
		if (process.platform !== "win32") await chmod(executable, 0o755);
		run(executable, ["--help"], installationDirectory);
		const version = run(
			executable,
			["--version"],
			installationDirectory,
		).stdout.trim();
		reportedVersions[binary] = version;
		if (!version.startsWith(`openapi/${aggregateVersion} `)) {
			throw new Error(
				`${binary} reported ${version}; expected openapi/${aggregateVersion}`,
			);
		}
		for (const arguments_ of [
			["validate", "./openapi.yaml", "--json"],
			["inspect", "./openapi.yaml", "--json"],
		]) {
			const result = run(executable, arguments_, installationDirectory);
			JSON.parse(result.stdout);
		}
	}
	if (reportedVersions.openapi !== reportedVersions["openapi-to"]) {
		throw new Error(
			`Bin aliases report different versions: ${JSON.stringify(reportedVersions)}`,
		);
	}
	const cliExecutable = binPath(installationDirectory, "openapi");
	const invalidValidation = run(
		cliExecutable,
		["validate", "./invalid.yaml", "--json"],
		installationDirectory,
		{ expectedStatus: 3 },
	);
	const invalidValidationJson = JSON.parse(invalidValidation.stdout);
	if (
		invalidValidationJson.success !== false ||
		invalidValidationJson.command !== "validate"
	) {
		throw new Error(
			"Packed CLI invalid validation did not return the stable JSON envelope",
		);
	}
	const diffJson = JSON.parse(
		run(
			cliExecutable,
			["diff", "./openapi.yaml", "./openapi.yaml", "--json"],
			installationDirectory,
		).stdout,
	);
	if (
		diffJson.command !== "diff" ||
		diffJson.breaking !== false ||
		diffJson.changes.length !== 0
	) {
		throw new Error("Packed CLI diff JSON smoke failed");
	}
	const dryRunJson = JSON.parse(
		run(
			cliExecutable,
			[
				"generate",
				"--target",
				"order-service",
				"--target",
				"user-service",
				"--dry-run",
				"--json",
			],
			installationDirectory,
		).stdout,
	);
	if (
		dryRunJson.command !== "generate" ||
		dryRunJson.mode !== "dry-run" ||
		dryRunJson.success !== true ||
		dryRunJson.servers.map(({ name }) => name).join(",") !==
			"user-service,order-service" ||
		dryRunJson.servers.map(({ output }) => output).join(",") !==
			"src/api/generated/user,src/api/generated/order"
	) {
		throw new Error("Packed CLI generate --dry-run JSON smoke failed");
	}
	for (const output of [
		"src/api/generated/user",
		"src/api/generated/order",
		".openapi-to/legacy",
	]) {
		try {
			await access(join(installationDirectory, output));
			throw new Error(`Packed CLI generate --dry-run wrote ${output}`);
		} catch (error) {
			if (!(error && error.code === "ENOENT")) throw error;
		}
	}
	const checkJson = JSON.parse(
		run(
			cliExecutable,
			["generate", "--check", "--json"],
			installationDirectory,
			{ expectedStatus: 6 },
		).stdout,
	);
	if (checkJson.command !== "generate" || checkJson.mode !== "check") {
		throw new Error("Packed CLI generate --check JSON smoke failed");
	}
	const mcpExecutable = binPath(installationDirectory, "openapi-to-mcp");
	if (process.platform !== "win32") await chmod(mcpExecutable, 0o755);
	run(mcpExecutable, ["--help"], installationDirectory);
	const mcpVersion = run(
		mcpExecutable,
		["--version"],
		installationDirectory,
	).stdout.trim();
	const expectedMcpVersion = packed.find(
		({ name }) => name === "@openapi-to/mcp",
	).version;
	if (mcpVersion !== expectedMcpVersion)
		throw new Error(
			`openapi-to-mcp reported ${mcpVersion}; expected ${expectedMcpVersion}`,
		);
	run(
		process.execPath,
		["mcp-stdio-smoke.mjs", mcpExecutable],
		installationDirectory,
	);

	const selectedCheck = JSON.parse(
		run(
			cliExecutable,
			["generate", "--target", "user-service", "--check", "--json"],
			installationDirectory,
		).stdout,
	);
	if (
		selectedCheck.success !== true ||
		selectedCheck.servers.length !== 1 ||
		selectedCheck.servers[0]?.name !== "user-service"
	) {
		throw new Error("Packed CLI selected check included an unselected target");
	}

	const generatedAll = JSON.parse(
		run(cliExecutable, ["generate", "--json"], installationDirectory).stdout,
	);
	if (
		generatedAll.success !== true ||
		generatedAll.servers.map(({ name }) => name).join(",") !==
			"user-service,order-service,legacy-service,remote-json,remote-yaml"
	) {
		throw new Error("Packed CLI default multi-target generation failed");
	}
	if (JSON.stringify(generatedAll).includes("token=release-smoke")) {
		throw new Error("Packed CLI leaked a remote URL query token");
	}
	for (const [output, target] of [
		["src/api/generated/user", "user-service"],
		["src/api/generated/order", "order-service"],
		[".openapi-to/legacy", "legacy-service"],
		["src/api/generated/remote-json", "remote-json"],
		["src/api/generated/remote-yaml", "remote-yaml"],
	]) {
		if (
			(await readFile(
				join(installationDirectory, output, "client.txt"),
				"utf8",
			)) !== `${target}\n`
		) {
			throw new Error(`Packed CLI wrote unexpected ${target} bytes`);
		}
		await access(
			join(installationDirectory, output, ".openapi-to-manifest.json"),
		);
	}

	await writeFile(
		join(installationDirectory, "src/api/generated/remote-json/client.txt"),
		"remote-sentinel\n",
	);
	const selectedMultiple = JSON.parse(
		run(
			cliExecutable,
			[
				"generate",
				"--target",
				"order-service",
				"--target",
				"user-service",
				"--target",
				"user-service",
				"--json",
			],
			installationDirectory,
		).stdout,
	);
	if (
		selectedMultiple.servers.map(({ name }) => name).join(",") !==
		"user-service,order-service"
	) {
		throw new Error(
			"Packed CLI repeated target selection was not deduplicated in config order",
		);
	}
	if (
		(await readFile(
			join(installationDirectory, "src/api/generated/remote-json/client.txt"),
			"utf8",
		)) !== "remote-sentinel\n"
	) {
		throw new Error("Packed CLI changed an unselected target");
	}

	const aliasDryRuns = [];
	for (const binary of ["openapi", "openapi-to"]) {
		aliasDryRuns.push(
			run(
				binPath(installationDirectory, binary),
				["generate", "--target", "legacy-service", "--dry-run", "--json"],
				installationDirectory,
			).stdout,
		);
	}
	if (aliasDryRuns[0] !== aliasDryRuns[1]) {
		throw new Error("Packed CLI aliases returned different target dry-runs");
	}

	succeeded = true;
	process.stdout.write(
		`${JSON.stringify(
			{
				success: true,
				node: process.version,
				artifactSource: options.publicationManifest
					? "publication-manifest"
					: "fresh-pnpm-pack",
				workspace:
					process.env.KEEP_RELEASE_SMOKE === "1" ? temporaryRoot : undefined,
				packages: packed.map(({ name, version, filename, size, files }) => ({
					name,
					version,
					filename,
					size,
					fileCount: files.length,
				})),
				versions: reportedVersions,
				baseline: {
					openapiToTarballBytes: packed.find(
						({ name }) => name === "openapi-to",
					)?.size,
					cliTarballBytes: packed.find(({ name }) => name === "@openapi-to/cli")
						?.size,
					mcpTarballBytes: packed.find(({ name }) => name === "@openapi-to/mcp")
						?.size,
					packagedSkillBytes: codexSkillsInstaller?.skillBytes,
					codexSkillsInstallMilliseconds:
						codexSkillsInstaller?.installMilliseconds,
					...packageBaseline,
				},
				setupMcpHandoff,
				codexSkillsInstaller,
				checks: [
					"esm",
					"cjs",
					"types",
					"packed-catalog-ranges",
					"core-selection-api-compat",
					"formal-plugin-consumer-codegen",
					"openapi-bin",
					"openapi-to-bin",
					"openapi-to-mcp-bin",
					"aggregate-only-install",
					"aggregate-only-mcp-stdio",
					"aggregate-only-mcp-tool-matrix-3-8-10",
					"packed-consumer-skills-assets",
					"packed-codex-skills-human-dry-run-no-notifier",
					"packed-codex-skills-global-debug-no-notifier",
					"packed-codex-skills-no-network-attempt",
					"packed-codex-skills-dry-run",
					"packed-codex-skills-install",
					"packed-codex-skills-existing-destination",
					"independent-mcp-bin-stdio",
					"independent-mcp-tool-matrix-3-8-10",
					"mcp-stdio",
					"mcp-tool-matrix-3-8-10",
					"mcp-schemas-annotations",
					"mcp-selective-prepare-apply",
					"mcp-target-scoped-catalog",
					"mcp-target-operator-remote-policy",
					"mcp-same-origin-header-retention",
					"mcp-cross-origin-header-clearing",
					"mcp-workspace-output-ownership",
					"mcp-three-state-commit",
					"mcp-token-replay",
					"mcp-current",
					"mcp-full-prepare-unchanged",
					"setup-packed-mcp-read-only-handoff",
					"setup-packed-mcp-write-handoff",
					"setup-handoff-state-drift",
					"validate-json",
					"validate-error-exit",
					"inspect-json",
					"diff-json",
					"generate-dry-run-json",
					"generate-check-exit",
					"generate-target-check",
					"generate-multi-target",
					"generate-repeated-target",
					"generate-http-json-yaml",
					"generate-alias-parity",
				],
			},
			null,
			2,
		)}\n`,
	);
} finally {
	if (remoteFixtureServer?.child) {
		const child = remoteFixtureServer.child;
		if (child.exitCode === null) {
			const stopped = new Promise((resolveStopped) =>
				child.once("exit", resolveStopped),
			);
			child.kill("SIGTERM");
			await stopped;
		}
	}
	if (process.env.KEEP_RELEASE_SMOKE !== "1") {
		await rm(temporaryRoot, { recursive: true, force: true });
	} else if (!succeeded) {
		process.stderr.write(
			`Release smoke workspace retained at ${temporaryRoot}\n`,
		);
	}
}
