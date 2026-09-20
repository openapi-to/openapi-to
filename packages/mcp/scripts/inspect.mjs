import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import {
	access,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const INSPECTOR_VERSION = "0.22.0";
// @modelcontextprotocol/inspector 0.22.0 declares this exact minimum in package.json.
const INSPECTOR_MINIMUM_NODE = [22, 7, 5];
const INSPECTOR_NODE_ENGINE = ">=22.7.5";
const packageRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const repositoryRoot = path.resolve(packageRoot, "../..");
const mcpBin = path.join(packageRoot, "bin/openapi-to-mcp.js");
const mcpDist = path.join(packageRoot, "dist/cli.js");
const inspectorPackage = `@modelcontextprotocol/inspector@${INSPECTOR_VERSION}`;
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const inspectorPrefix = [
	"--yes",
	`--package=${inspectorPackage}`,
	"mcp-inspector",
];

function pnpmInvocation(args) {
	const entrypoint = process.env.npm_execpath;
	if (entrypoint && /\.(?:c|m)?js$/i.test(entrypoint)) {
		return { command: process.execPath, args: [entrypoint, ...args] };
	}
	return {
		command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
		args,
	};
}

const HELP = `openapi-to MCP Inspector launcher

Usage:
  node packages/mcp/scripts/inspect.mjs [--generation-mode <developer|read-only|hardened>]

Options:
  --generation-mode  Select the Generation v2 capability mode (default: developer).
  -h, --help     Show this help.

The launcher accepts no command, config, Workspace, host, port, or authentication overrides.
It builds @openapi-to/mcp, uses ${inspectorPackage}, binds both Inspector services to
127.0.0.1 on free high ports, and keeps Inspector Proxy authentication enabled.
`;

function parseOptions() {
	try {
		const parsed = parseArgs({
			// Root -> package pnpm script forwarding may preserve one or more literal separators.
			args: process.argv.slice(2).filter((argument) => argument !== "--"),
			allowPositionals: false,
			strict: true,
			options: {
				"generation-mode": { type: "string", default: "developer" },
				help: { type: "boolean", short: "h", default: false },
			},
		});
		const generationMode = parsed.values["generation-mode"];
		if (!["developer", "read-only", "hardened"].includes(generationMode)) throw new Error("--generation-mode must be developer, read-only, or hardened.");
		return {
			generationMode,
			help: parsed.values.help,
		};
	} catch {
		throw new Error(`Only --generation-mode and --help are accepted.\n\n${HELP}`);
	}
}

function versionAtLeast(actual, minimum) {
	const parts = actual.split(".").map((part) => Number(part));
	if (
		parts.length < 3 ||
		parts.some((part) => !Number.isInteger(part) || part < 0)
	)
		return false;
	for (let index = 0; index < minimum.length; index += 1) {
		if (parts[index] > minimum[index]) return true;
		if (parts[index] < minimum[index]) return false;
	}
	return true;
}

function assertNodeVersion() {
	if (versionAtLeast(process.versions.node, INSPECTOR_MINIMUM_NODE)) return;
	throw new Error(
		`${inspectorPackage} requires Node.js >=${INSPECTOR_MINIMUM_NODE.join(".")}; ` +
			`this process is running Node.js ${process.versions.node}. Switch Node versions and rerun the launcher.`,
	);
}

function waitForExit(child, label) {
	return new Promise((resolve, reject) => {
		child.once("error", (error) =>
			reject(new Error(`${label} could not start: ${error.message}`)),
		);
		child.once("exit", (code, signal) => resolve({ code, signal }));
	});
}

async function runChecked(command, args, label, options = {}) {
	const child = spawn(command, args, {
		cwd: repositoryRoot,
		env: options.env ?? process.env,
		stdio: options.stdio ?? "inherit",
		windowsHide: true,
	});
	const result = await waitForExit(child, label);
	if (result.code !== 0) {
		const detail = result.signal
			? `signal ${result.signal}`
			: `exit code ${result.code ?? "unknown"}`;
		throw new Error(`${label} failed with ${detail}.`);
	}
}

async function runCaptured(command, args, label) {
	const child = spawn(command, args, {
		cwd: repositoryRoot,
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	const stdout = [];
	const stderr = [];
	let bytes = 0;
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill("SIGTERM");
	}, 30_000);
	const collect = (target) => (chunk) => {
		bytes += chunk.byteLength;
		if (bytes > 128 * 1024) {
			child.kill("SIGTERM");
			return;
		}
		target.push(Buffer.from(chunk));
	};
	child.stdout.on("data", collect(stdout));
	child.stderr.on("data", collect(stderr));
	const result = await waitForExit(child, label).finally(() =>
		clearTimeout(timer),
	);
	const output = Buffer.concat(stdout).toString("utf8");
	const errors = Buffer.concat(stderr).toString("utf8");
	if (timedOut) throw new Error(`${label} did not finish within 30 seconds.`);
	if (bytes > 128 * 1024)
		throw new Error(`${label} returned unexpectedly large output.`);
	if (result.code !== 0) {
		const summary = errors.trim().split(/\r?\n/).at(-1);
		throw new Error(`${label} failed${summary ? `: ${summary}` : "."}`);
	}
	return `${output}\n${errors}`;
}

async function ensureMcpBuild() {
	process.stdout.write(
		"Building @openapi-to/mcp and its workspace dependencies from this checkout...\n",
	);
	const invocation = pnpmInvocation([
		"exec",
		"turbo",
		"run",
		"build",
		"--filter=@openapi-to/mcp",
	]);
	await runChecked(
		invocation.command,
		invocation.args,
		"@openapi-to/mcp dependency-aware build",
	);
	try {
		await Promise.all([access(mcpBin), access(mcpDist)]);
	} catch {
		throw new Error(
			"The MCP build completed without the expected repository bin and dist entrypoints.",
		);
	}
}

async function inspectorPackageAt(packageJsonPath) {
	try {
		const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
		if (
			packageJson.name !== "@modelcontextprotocol/inspector" ||
			packageJson.version !== INSPECTOR_VERSION ||
			packageJson.engines?.node !== INSPECTOR_NODE_ENGINE ||
			packageJson.bin?.["mcp-inspector"] !== "cli/build/cli.js"
		)
			return undefined;
		const packageDirectory = await realpath(path.dirname(packageJsonPath));
		const cliPath = path.join(packageDirectory, "cli/build/cli.js");
		await access(cliPath);
		return {
			command: process.execPath,
			prefix: [cliPath],
			source: "validated local package/cache",
		};
	} catch {
		return undefined;
	}
}

async function resolveInspectorCli() {
	const installed = await inspectorPackageAt(
		path.join(
			repositoryRoot,
			"node_modules/@modelcontextprotocol/inspector/package.json",
		),
	);
	if (installed) return installed;

	const npxCacheRoot = path.join(os.homedir(), ".npm/_npx");
	try {
		const cacheEntries = (await readdir(npxCacheRoot, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
		for (const cacheEntry of cacheEntries) {
			const cached = await inspectorPackageAt(
				path.join(
					npxCacheRoot,
					cacheEntry,
					"node_modules/@modelcontextprotocol/inspector/package.json",
				),
			);
			if (cached) return cached;
		}
	} catch {
		// A missing/unreadable npm cache is expected on a first run.
	}

	return {
		command: npxCommand,
		prefix: inspectorPrefix,
		source: "pinned npx fallback",
	};
}

async function verifyInspectorCli(inspector) {
	process.stdout.write(
		`Checking ${inspectorPackage} CLI help (${inspector.source})...\n`,
	);
	let help;
	try {
		help = await runCaptured(
			inspector.command,
			[...inspector.prefix, "--help"],
			`${inspectorPackage} help`,
		);
	} catch (error) {
		throw new Error(
			`${error.message}\nUnable to run the pinned Inspector. Check the npm cache or npm registry access, then rerun.`,
		);
	}
	const expectedHelp = [
		"--config <path>",
		"--server <n>",
		"--cli",
		"--transport <type>",
	];
	const missing = expectedHelp.filter((option) => !help.includes(option));
	if (missing.length > 0) {
		throw new Error(
			`${inspectorPackage} help did not expose the expected 0.22.0 options: ${missing.join(", ")}.`,
		);
	}
}

async function reserveHighPort(excluded = new Set()) {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		const port = randomInt(49_152, 65_536);
		if (excluded.has(port)) continue;
		const server = net.createServer();
		const available = await new Promise((resolve, reject) => {
			server.once("error", (error) => {
				if (error.code === "EADDRINUSE" || error.code === "EACCES")
					resolve(false);
				else reject(error);
			});
			server.listen({ host: "127.0.0.1", port, exclusive: true }, () =>
				resolve(true),
			);
		});
		if (!available) continue;
		return { port, server };
	}
	throw new Error(
		"Unable to reserve a free localhost high port for Inspector.",
	);
}

async function closeServer(server) {
	await new Promise((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
}

async function selectInspectorPorts() {
	const client = await reserveHighPort();
	try {
		const proxy = await reserveHighPort(new Set([client.port]));
		return { client, proxy };
	} catch (error) {
		await closeServer(client.server);
		throw error;
	}
}

async function createFixture() {
	const root = await mkdtemp(
		path.join(os.tmpdir(), "openapi-to-mcp-inspector-"),
	);
	const outputRoot = path.join(root, ".openapi-to/generated");
	await mkdir(outputRoot, { recursive: true });
	await writeFile(
		path.join(root, "openapi.yaml"),
		`openapi: 3.1.0
info: { title: Inspector Fixture, version: "1.0.0" }
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: array
                items: { $ref: "./schemas.yaml#/$defs/Pet" }
`,
	);
	await writeFile(
		path.join(root, "schemas.yaml"),
		`$defs:
  Pet:
    type: object
    required: [id]
    properties:
      id: { type: integer }
      name: { type: string }
`,
	);
	await writeFile(
		path.join(root, "before.yaml"),
		`openapi: 3.1.0
info: { title: Before, version: "1" }
paths:
  /legacy:
    get:
      operationId: legacy
      responses: { "200": { description: ok } }
`,
	);
	await writeFile(
		path.join(root, "after.yaml"),
		`openapi: 3.1.0
info: { title: After, version: "2" }
paths:
  /pets:
    get:
      operationId: listPets
      responses: { "200": { description: ok } }
`,
	);
	await writeFile(
		path.join(root, "openapi.config.cjs"),
		`module.exports = {
  servers: [{ name: 'fixture', input: { path: './openapi.yaml' }, output: { dir: 'generated', clean: true } }],
  plugins: [{ name: 'inspector-fixture', hooks: { buildStart(ctx) {
    const root = ctx.openapiToSingleConfig.output.dir;
    ctx.addArtifact({ kind: 'text', path: root + '/client.txt', content: 'generated client\\n' });
  } } }]
};
`,
	);
	await writeFile(
		path.join(outputRoot, "old-managed.txt"),
		"old managed output\n",
	);
	await writeFile(
		path.join(outputRoot, "user-owned.txt"),
		"unmanaged user file\n",
	);
	await writeFile(
		path.join(outputRoot, ".openapi-to-manifest.json"),
		`${JSON.stringify({ version: 1, files: ["old-managed.txt"] }, null, 2)}\n`,
	);
	return { root, outputRoot };
}

function printChecklist({ generationMode, clientPort, proxyPort, fixture }) {
	const expectedTools = generationMode === "hardened" ? 10 : 8;
	const mode = generationMode;
	process.stdout.write(`\nSynthetic ${mode} Inspector session\n`);
	process.stdout.write(`  Workspace: ${fixture.root}\n`);
	process.stdout.write(`  Output:    ${fixture.outputRoot}\n`);
	process.stdout.write(`  UI:        http://127.0.0.1:${clientPort}\n`);
	process.stdout.write(`  Proxy:     http://127.0.0.1:${proxyPort}\n`);
	process.stdout.write(
		"  Authentication: enabled; the Inspector prints its ephemeral token only to this terminal.\n",
	);
	process.stdout.write(
		"  Browser auto-open: disabled; open the authenticated URL printed by Inspector.\n\n",
	);

	const common = [
		"Open the authenticated Inspector URL printed below; do not copy its Proxy token into a file.",
		"Connect the preconfigured stdio server and list tools; keep this same Inspector/Server session for every step.",
		`Confirm exactly ${expectedTools} tools are listed and that every input/output schema is visible.`,
		"Call openapi_validate with source 'openapi.yaml'; expect a successful OpenAPI 3.1 result.",
		"Call openapi_inspect with source 'openapi.yaml' and includeOperations true; expect listPets.",
		"Call openapi_diff with before 'before.yaml' and after 'after.yaml'; review the bounded breaking/non-breaking summary.",
		"Call openapi_list_targets; expect only fixture metadata, with no source path, URL, headers, or config body.",
		"Call openapi_search_operations with target 'fixture' and query 'list pets'; expect one lightweight listPets candidate.",
		"Call openapi_get_operation with target 'fixture', operationKey 'listPets', and detail 'contract'; review the bounded 200 response contract.",
		"Call openapi_generate with target 'fixture', selection { type: 'full' }, and mode 'dry-run'; expect client.txt added and old-managed.txt deleted.",
		"Call openapi_generate with target 'fixture', selection { type: 'operations', operationKeys: ['listPets'], strategy: 'ephemeral' }, and mode 'dry-run'; expect one projected operation, a stable projection hash, and no OpenAPI document body.",
		"Call openapi_check_generation with target 'fixture'; expect the persisted/configured basis result and confirm preview/check changed no files.",
	];
	const modeSpecific = generationMode === "hardened"
		? [
				"Call openapi_prepare_generation with targets ['fixture'] and selection { type: 'add', operationKeys: ['listPets'] }; confirm kind=selective, applySupported=true, a one-time token, bounded selection/projection summaries, and no Workspace changes.",
				"Before approval, confirm old-managed.txt and user-owned.txt still exist, client.txt and the derived selection manifest do not, and Prepare wrote no lock, stage, backup, journal, output, ownership, or selection bytes.",
				"After explicit human approval, call openapi_apply_generation with only the selective planId, token, and approvedPlanHash; confirm generated output, ownership, and the one-operation selection appear together while user-owned.txt stays byte-identical.",
				"Prepare a non-empty replace selection and confirm mutationType plus previous/requested/added/already-selected/retained/removed/desired summaries, exact counts, truncation, and any managed deletions are visible before approval; never pass operation keys to Apply.",
				"Replay the selective plan and confirm MCP_PLAN_ALREADY_USED. Then prepare/apply a full plan and confirm its established semantics still work against the now-current output.",
				"Confirm check is current, a new Prepare is unchanged, no transaction internals remain, then press Ctrl-C and verify the temporary Workspace and both listeners are removed.",
			]
		: generationMode === "developer"
			? [
					"Call openapi_generate without mode for the explicit developer write path; confirm output, ownership, and persisted Generation Intent are committed atomically.",
					"Call openapi_generate with mode 'dry-run' and the ephemeral strategy; confirm it does not change the persisted selection or output bytes.",
					"Confirm openapi_prepare_generation and openapi_apply_generation are absent in developer mode.",
					"Press Ctrl-C; confirm the launcher removes the temporary Workspace and releases both localhost listeners.",
				]
			: [
				"Confirm openapi_prepare_generation and openapi_apply_generation are absent; no Tool in this session can write.",
				"In another terminal, confirm old-managed.txt and user-owned.txt still exist and client.txt does not after all calls.",
				"If hardened plan testing is intended, stop here and rerun this fixed launcher with --generation-mode hardened.",
				"Press Ctrl-C; confirm the launcher removes the temporary Workspace and releases both localhost listeners.",
			];
	process.stdout.write(`Manual ${common.length + modeSpecific.length}-step checklist:\n`);
	for (const [index, step] of [...common, ...modeSpecific].entries()) {
		process.stdout.write(`  ${index + 1}. ${step}\n`);
	}
	process.stdout.write("\n");
}

function inspectorEnvironment(clientPort, proxyPort) {
	const env = {
		...process.env,
		HOST: "127.0.0.1",
		CLIENT_PORT: String(clientPort),
		SERVER_PORT: String(proxyPort),
		ALLOWED_ORIGINS: `http://127.0.0.1:${clientPort}`,
		MCP_AUTO_OPEN_ENABLED: "false",
	};
	// Never inherit either an auth bypass or a reusable Proxy secret into this fixture.
	delete env.DANGEROUSLY_OMIT_AUTH;
	delete env.MCP_PROXY_AUTH_TOKEN;
	return env;
}

async function portIsAvailable(port) {
	const server = net.createServer();
	const available = await new Promise((resolve, reject) => {
		server.once("error", (error) => {
			if (error.code === "EADDRINUSE" || error.code === "EACCES")
				resolve(false);
			else reject(error);
		});
		server.listen({ host: "127.0.0.1", port, exclusive: true }, () =>
			resolve(true),
		);
	});
	if (available) await closeServer(server);
	return available;
}

async function waitForPortsReleased(ports) {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (
			(await Promise.all(ports.map((port) => portIsAvailable(port)))).every(
				Boolean,
			)
		)
			return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(
		"Inspector exited but one of its localhost listeners was not released.",
	);
}

async function launchInspector({
	generationMode,
	fixture,
	clientPort,
	proxyPort,
	inspector,
}) {
	const serverArgs = [
		process.execPath,
		mcpBin,
		"--workspace-root",
		fixture.root,
		"--config",
		"openapi.config.cjs",
		"--generation-mode",
		generationMode,
		"--log-level",
		"error",
	];
	const child = spawn(
		inspector.command,
		[...inspector.prefix, "--", ...serverArgs],
		{
			cwd: repositoryRoot,
			env: inspectorEnvironment(clientPort, proxyPort),
			stdio: "inherit",
			windowsHide: true,
		},
	);
	let receivedSignal;
	const forwardSignal = (signal) => {
		if (receivedSignal) return;
		receivedSignal = signal;
		process.stdout.write(
			`\nForwarding ${signal} to the foreground Inspector process...\n`,
		);
		// Inspector 0.22.0 performs its coordinated Proxy/UI/stdio shutdown on SIGINT.
		child.kill("SIGINT");
	};
	const forwardSigint = () => forwardSignal("SIGINT");
	const forwardSigterm = () => forwardSignal("SIGTERM");
	process.once("SIGINT", forwardSigint);
	process.once("SIGTERM", forwardSigterm);
	try {
		const result = await waitForExit(
			child,
			`${inspectorPackage} foreground process`,
		);
		await waitForPortsReleased([clientPort, proxyPort]);
		if (receivedSignal) return receivedSignal === "SIGINT" ? 130 : 143;
		if (result.code === 0) return 0;
		const detail = result.signal
			? `signal ${result.signal}`
			: `exit code ${result.code ?? "unknown"}`;
		throw new Error(`${inspectorPackage} exited with ${detail}.`);
	} finally {
		process.removeListener("SIGINT", forwardSigint);
		process.removeListener("SIGTERM", forwardSigterm);
	}
}

async function main() {
	const options = parseOptions();
	if (options.help) {
		process.stdout.write(HELP);
		return;
	}
	assertNodeVersion();
	await ensureMcpBuild();
	const inspector = await resolveInspectorCli();
	await verifyInspectorCli(inspector);

	let fixture;
	let ports;
	try {
		fixture = await createFixture();
		ports = await selectInspectorPorts();
		await Promise.all([
			closeServer(ports.client.server),
			closeServer(ports.proxy.server),
		]);
		printChecklist({
			generationMode: options.generationMode,
			clientPort: ports.client.port,
			proxyPort: ports.proxy.port,
			fixture,
		});
		const exitCode = await launchInspector({
			generationMode: options.generationMode,
			fixture,
			clientPort: ports.client.port,
			proxyPort: ports.proxy.port,
			inspector,
		});
		process.exitCode = exitCode;
	} finally {
		if (ports) {
			await Promise.all([
				portIsAvailable(ports.client.port),
				portIsAvailable(ports.proxy.port),
			]).catch(() => undefined);
		}
		if (fixture) await rm(fixture.root, { recursive: true, force: true });
		process.stdout.write("Inspector fixture cleanup complete.\n");
	}
}

main().catch((error) => {
	process.stderr.write(
		`[openapi-to-inspector] ${error instanceof Error ? error.message : "Unexpected launcher failure."}\n`,
	);
	process.exitCode = 1;
});
