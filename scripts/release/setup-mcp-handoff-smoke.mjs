import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const prepareToolName = "openapi_prepare_generation";
const applyToolName = "openapi_apply_generation";
const MAX_DIAGNOSTIC_CHARS = 2048;

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function appendBounded(previous, value, limit = MAX_DIAGNOSTIC_CHARS) {
	const next = `${previous}${String(value)}`;
	return next.length > limit ? next.slice(-limit) : next;
}

function redactDiagnosticText(value) {
	return String(value)
		.replace(/(bearer\s+)[^\s,;]+/gi, "$1<redacted>")
		.replace(/(authorization\s*[:=]\s*)([^\s,;]+)/gi, "$1<redacted>")
		.replace(/(\b(?:auth|key|password|secret|token)\s*[:=]\s*)[^\s,;]+/gi, "$1<redacted>")
		.replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|npm_[A-Za-z0-9_]+)/g, "<redacted>");
}

function redactAndBound(value, limit = 768) {
	const text = redactDiagnosticText(value);
	return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function formatPackedMcpConnectionFailure({
	launch,
	error,
	transportError,
	stderr,
	closed,
	pid,
}) {
	const details = [
		`command=${[launch.command, ...(launch.args ?? [])].join(" ")}`,
		"cwd=<consumer-root>",
		`pid=${pid ?? "unknown"}`,
		`closed=${closed === true ? "true" : "false"}`,
	];
	for (const [label, candidate] of [
		["connectError", error],
		["transportError", transportError],
	]) {
		if (!candidate) continue;
		const name = candidate.name ? `${candidate.name}: ` : "";
		const code = candidate.code ? ` [code=${candidate.code}]` : "";
		details.push(`${label}=${redactAndBound(`${name}${candidate.message ?? candidate}`)}${code}`);
	}
	if (stderr) details.push(`stderr=${redactAndBound(stderr, MAX_DIAGNOSTIC_CHARS)}`);
	const message = `Packed MCP Setup handoff connection failed (${details.join("; ")})`;
	return message.length > 4096 ? `${message.slice(0, 4096)}…` : message;
}

function tomlString(value) {
	return JSON.stringify(value);
}

export function createCodexHostLaunch({
	mode,
	platform = process.platform,
} = {}) {
	assert(
		mode === "read-only" || mode === "write-enabled",
		"Setup MCP handoff mode must be read-only or write-enabled.",
	);
	const mcpArguments = [
		"exec",
		"--",
		"openapi-to-mcp",
		"--workspace-root",
		".",
		"--config",
		"openapi.config.cjs",
	];
	if (mode === "write-enabled") mcpArguments.push("--allow-write");

	const command = platform === "win32" ? "cmd.exe" : "pnpm";
	const args =
		platform === "win32"
			? ["/d", "/s", "/c", `pnpm ${mcpArguments.join(" ")}`]
			: mcpArguments;
	const configLines = [
		"[mcp_servers.openapi_to]",
		`command = ${tomlString(command)}`,
		"args = [",
		...args.map((argument) => `  ${tomlString(argument)},`),
		"]",
		'cwd = "."',
	];
	if (mode === "write-enabled") {
		configLines.push(
			"",
			"[mcp_servers.openapi_to.tools.openapi_apply_generation]",
			'approval_mode = "prompt"',
		);
	}
	return {
		command,
		args,
		configToml: `${configLines.join("\n")}\n`,
	};
}

function assertObjectSchema(schema, toolName, direction) {
	assert(
		schema &&
			typeof schema === "object" &&
			!Array.isArray(schema) &&
			schema.type === "object",
		`${toolName} ${direction}Schema must be an object Schema.`,
	);
}

function assertSchemaProperties(tool, requiredProperties) {
	const properties = tool.inputSchema?.properties;
	assert(
		properties && typeof properties === "object" && !Array.isArray(properties),
		`${tool.name} inputSchema must expose properties.`,
	);
	for (const property of requiredProperties) {
		assert(
			Object.hasOwn(properties, property),
			`${tool.name} inputSchema is missing ${property}.`,
		);
	}
}

export function assertModeCapabilityAgreement({ inferredMode, tools }) {
	assert(Array.isArray(tools), "Packed MCP Tool list must be an array.");
	const byName = new Map();
	for (const tool of tools) {
		assert(
			tool && typeof tool.name === "string" && !byName.has(tool.name),
			"Packed MCP Tool names must be unique strings.",
		);
		assertObjectSchema(tool.inputSchema, tool.name, "input");
		assertObjectSchema(tool.outputSchema, tool.name, "output");
		byName.set(tool.name, tool);
	}
	for (const required of [
		"openapi_validate",
		"openapi_list_targets",
		"openapi_generate_dry_run",
	]) {
		assert(
			byName.has(required),
			`Packed MCP is missing required Tool ${required}.`,
		);
	}
	assertSchemaProperties(byName.get("openapi_generate_dry_run"), [
		"targets",
		"scope",
	]);

	const capabilities = {
		prepare: byName.has(prepareToolName),
		apply: byName.has(applyToolName),
	};
	if (inferredMode === "read-only") {
		assert(
			!capabilities.prepare && !capabilities.apply,
			"Read-only Setup mode must not expose Prepare or Apply.",
		);
		return capabilities;
	}
	assert(
		inferredMode === "write-enabled",
		`Unsupported Setup Inspector mode ${String(inferredMode)}.`,
	);
	assert(
		capabilities.prepare && capabilities.apply,
		"Write-enabled Setup mode must expose both Prepare and Apply.",
	);
	assertSchemaProperties(byName.get(prepareToolName), ["targets", "selection"]);
	const applyTool = byName.get(applyToolName);
	assertSchemaProperties(applyTool, ["planId", "token", "approvedPlanHash"]);
	const applyRequired = new Set(applyTool.inputSchema.required);
	for (const property of ["planId", "token", "approvedPlanHash"]) {
		assert(
			applyRequired.has(property),
			`${applyToolName} inputSchema must require ${property}.`,
		);
	}
	return capabilities;
}

export function assertObservedStateHashChanged(previous, current) {
	for (const value of [previous, current]) {
		assert(
			typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
			"Setup Inspector must return a SHA-256 observedStateHash.",
		);
	}
	assert(
		previous !== current,
		"Setup handoff evidence must become stale when a bound file drifts.",
	);
	return true;
}

export function createSetupMcpHandoffReport({
	withoutHostState,
	readOnlyState,
	writeEnabledState,
	readOnlyMode,
	writeEnabledMode,
	readOnlyCapabilities,
	writeEnabledCapabilities,
	observedStateHashChanged,
}) {
	return {
		success: true,
		inspectorSource: "repository-skill",
		runtimeSource: "packed-tarballs",
		states: {
			withoutHost: withoutHostState,
			readOnly: readOnlyState,
			writeEnabled: writeEnabledState,
		},
		modes: {
			readOnly: readOnlyMode,
			writeEnabled: writeEnabledMode,
		},
		capabilities: {
			readOnlyPrepare: readOnlyCapabilities.prepare,
			readOnlyApply: readOnlyCapabilities.apply,
			writePrepare: writeEnabledCapabilities.prepare,
			writeApply: writeEnabledCapabilities.apply,
		},
		observedStateHashChanged,
	};
}

async function inspectProject(repositoryRoot, consumerRoot) {
	const inspector = join(
		repositoryRoot,
		".agents/skills/openapi-to-setup/scripts/inspect-project.mjs",
	);
	let result;
	try {
		result = await execFileAsync(
			process.execPath,
			[inspector, "--root", consumerRoot],
			{ maxBuffer: 128 * 1024 },
		);
	} catch {
		throw new Error(
			"Repository Setup Inspector failed during packed MCP handoff.",
		);
	}
	assert(
		result.stderr === "",
		"Repository Setup Inspector wrote unexpected stderr during packed MCP handoff.",
	);
	try {
		return JSON.parse(result.stdout);
	} catch {
		throw new Error("Repository Setup Inspector returned invalid JSON.");
	}
}

async function listPackedMcpTools(consumerRoot, launch) {
	const requireFromConsumer = createRequire(join(consumerRoot, "package.json"));
	const [{ Client }, { StdioClientTransport }] = await Promise.all([
		import(
			pathToFileURL(
				requireFromConsumer.resolve(
					"@modelcontextprotocol/sdk/client/index.js",
				),
			).href
		),
		import(
			pathToFileURL(
				requireFromConsumer.resolve(
					"@modelcontextprotocol/sdk/client/stdio.js",
				),
			).href
		),
	]);
	let stderr = "";
	const transport = new StdioClientTransport({
		command: launch.command,
		args: launch.args,
		cwd: consumerRoot,
		stderr: "pipe",
	});
	transport.stderr?.on("data", (chunk) => {
		stderr = appendBounded(stderr, chunk);
	});
	const client = new Client({
		name: "setup-packed-mcp-handoff-smoke",
		version: "1.0.0",
	});
	let transportError;
	let closed = false;
	transport.onerror = (error) => {
		transportError ??= error;
	};
	transport.onclose = () => {
		closed = true;
	};
	try {
		await client.connect(transport);
		const listed = await client.listTools();
		assert(
			!stderr.includes("Unable to start server"),
			"Packed MCP reported a startup failure during Setup handoff.",
		);
		return listed.tools;
	} catch (error) {
		throw new Error(
			formatPackedMcpConnectionFailure({
				launch,
				error,
				transportError,
				stderr,
				closed,
				pid: transport.pid,
			}),
		);
	} finally {
		await client.close().catch(() => undefined);
	}
}

async function assertPackedInstallation(consumerRoot, packed) {
	for (const packageName of ["openapi-to", "@openapi-to/mcp"]) {
		const expected = packed.find(({ name }) => name === packageName);
		assert(expected, `Packed release inputs are missing ${packageName}.`);
		const installed = JSON.parse(
			await readFile(
				join(
					consumerRoot,
					"node_modules",
					...packageName.split("/"),
					"package.json",
				),
				"utf8",
			),
		);
		assert(
			installed.version === expected.version,
			`Installed ${packageName} does not match the packed release input.`,
		);
	}
}

export async function runSetupMcpHandoffScenario({
	consumerRoot,
	packed,
	repositoryRoot,
}) {
	await assertPackedInstallation(consumerRoot, packed);
	const withoutHost = await inspectProject(repositoryRoot, consumerRoot);
	assert(
		withoutHost.state === "HOST_CONFIG_MISSING" &&
			withoutHost.codex?.inferredMode === "missing",
		"Setup Inspector must report HOST_CONFIG_MISSING before Host configuration.",
	);

	const codexDirectory = join(consumerRoot, ".codex");
	const codexConfig = join(codexDirectory, "config.toml");
	await mkdir(codexDirectory);

	const readOnlyLaunch = createCodexHostLaunch({ mode: "read-only" });
	await writeFile(codexConfig, readOnlyLaunch.configToml);
	const readOnly = await inspectProject(repositoryRoot, consumerRoot);
	assert(
		readOnly.state === "HOST_CONFIG_READY" &&
			readOnly.codex?.inferredMode === "read-only",
		"Setup Inspector must infer the read-only Host configuration.",
	);
	assertObservedStateHashChanged(
		withoutHost.observedStateHash,
		readOnly.observedStateHash,
	);
	const readOnlyCapabilities = assertModeCapabilityAgreement({
		inferredMode: readOnly.codex.inferredMode,
		tools: await listPackedMcpTools(consumerRoot, readOnlyLaunch),
	});

	const writeEnabledLaunch = createCodexHostLaunch({ mode: "write-enabled" });
	await writeFile(codexConfig, writeEnabledLaunch.configToml);
	const writeEnabled = await inspectProject(repositoryRoot, consumerRoot);
	assert(
		writeEnabled.state === "HOST_CONFIG_READY" &&
			writeEnabled.codex?.inferredMode === "write-enabled",
		"Setup Inspector must infer the write-enabled Host configuration.",
	);
	assertObservedStateHashChanged(
		readOnly.observedStateHash,
		writeEnabled.observedStateHash,
	);
	const writeEnabledCapabilities = assertModeCapabilityAgreement({
		inferredMode: writeEnabled.codex.inferredMode,
		tools: await listPackedMcpTools(consumerRoot, writeEnabledLaunch),
	});

	await appendFile(codexConfig, "# setup handoff drift probe\n");
	const drifted = await inspectProject(repositoryRoot, consumerRoot);
	const observedStateHashChanged = assertObservedStateHashChanged(
		writeEnabled.observedStateHash,
		drifted.observedStateHash,
	);

	return createSetupMcpHandoffReport({
		withoutHostState: withoutHost.state,
		readOnlyState: readOnly.state,
		writeEnabledState: writeEnabled.state,
		readOnlyMode: readOnly.codex.inferredMode,
		writeEnabledMode: writeEnabled.codex.inferredMode,
		readOnlyCapabilities,
		writeEnabledCapabilities,
		observedStateHashChanged,
	});
}
