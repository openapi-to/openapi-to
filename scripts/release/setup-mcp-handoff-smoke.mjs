import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { appendFile, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path, { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const prepareToolName = "openapi_prepare_generation";
const applyToolName = "openapi_apply_generation";
const generateToolName = "openapi_generate";
const MAX_DIAGNOSTIC_CHARS = 2048;
const MAX_PROVENANCE_FILE_BYTES = 32 * 1024 * 1024;

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
	consumerRoot,
	platform = process.platform,
	launcher = "pnpm",
	includeGenerationMode = true,
} = {}) {
	assert(
		mode === "developer" || mode === "read-only" || mode === "hardened",
		"Setup MCP handoff mode must be developer, read-only, or hardened.",
	);
	assert(
		launcher === "pnpm" || launcher === "node",
		"Setup MCP handoff launcher must be pnpm or node.",
	);
	assert(
		typeof consumerRoot === "string" &&
			((platform === "win32" && path.win32.isAbsolute(consumerRoot)) ||
				(platform !== "win32" && path.posix.isAbsolute(consumerRoot))),
		"Setup MCP handoff requires an absolute consumerRoot.",
	);
	const serverArguments = [
		"--workspace-root",
		".",
		"--config",
		"openapi.config.cjs",
		...(includeGenerationMode ? ["--generation-mode", mode] : []),
	];

	const nodeArguments = [
		"node_modules/openapi-to/bin/openapi-to-mcp.js",
		...serverArguments,
	];
	const pnpmArguments = [
		"exec",
		"--",
		platform === "win32"
			? "./node_modules/.bin/openapi-to-mcp.cmd"
			: "./node_modules/.bin/openapi-to-mcp",
		...serverArguments,
	];
	const command =
		launcher === "node" ? "node" : platform === "win32" ? "cmd.exe" : "pnpm";
	const args =
		launcher === "node"
			? nodeArguments
			: platform === "win32"
				? ["/d", "/s", "/c", `pnpm ${pnpmArguments.join(" ")}`]
				: pnpmArguments;
	const configLines = [
		"[mcp_servers.openapi_to]",
		`command = ${tomlString(command)}`,
		"args = [",
		...args.map((argument) => `  ${tomlString(argument)},`),
		"]",
		`cwd = ${tomlString(consumerRoot)}`,
		"startup_timeout_sec = 10",
		"tool_timeout_sec = 60",
	];
	if (mode === "hardened") {
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

function assertSchemaEnum(tool, property, expectedValues) {
	const schema = tool.inputSchema?.properties?.[property];
	const actualValues = schema?.const !== undefined ? [schema.const] : schema?.enum;
	assert(
		Array.isArray(actualValues) &&
		JSON.stringify(actualValues) === JSON.stringify(expectedValues),
		`${tool.name} inputSchema.${property} must advertise ${expectedValues.join(" or ")}.`,
	);
}

function assertAnnotations(tool, expected) {
	for (const [key, value] of Object.entries(expected)) {
		assert(
			tool.annotations?.[key] === value,
			`${tool.name} annotations.${key} must be ${String(value)}.`,
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
		"openapi_inspect",
		"openapi_diff",
		"openapi_list_targets",
		"openapi_search_operations",
		"openapi_get_operation",
		generateToolName,
		"openapi_check_generation",
	]) {
		assert(
			byName.has(required),
			`Packed MCP is missing required Tool ${required}.`,
		);
	}
	const capabilities = {
		prepare: byName.has(prepareToolName),
		apply: byName.has(applyToolName),
	};
	const generateTool = byName.get(generateToolName);
	assertSchemaProperties(generateTool, ["target", "selection", "output", "includePreview", "mode"]);
	if (inferredMode === "developer") {
		assert(!capabilities.prepare && !capabilities.apply, "Developer Setup mode must not expose Prepare or Apply.");
		assert(tools.length === 8, "Developer Setup mode must expose exactly 8 Tools.");
		assertSchemaEnum(generateTool, "mode", ["write", "dry-run"]);
		assertAnnotations(generateTool, {
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: false,
			openWorldHint: false,
		});
		return { ...capabilities, toolCount: tools.length, writeCapability: true };
	}
	if (inferredMode === "read-only") {
		assert(
			!capabilities.prepare && !capabilities.apply,
			"Read-only Setup mode must not expose Prepare or Apply.",
		);
		assert(tools.length === 8, "Read-only Setup mode must expose exactly 8 Tools.");
		assertSchemaEnum(generateTool, "mode", ["dry-run"]);
		assertAnnotations(generateTool, {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		});
		return { ...capabilities, toolCount: tools.length, writeCapability: false };
	}
	assert(
		inferredMode === "hardened",
		`Unsupported Setup Inspector mode ${String(inferredMode)}.`,
	);
	assert(
		capabilities.prepare && capabilities.apply,
		"Hardened Setup mode must expose both Prepare and Apply.",
	);
	assert(tools.length === 10, "Hardened Setup mode must expose exactly 10 Tools.");
	assertSchemaEnum(generateTool, "mode", ["dry-run"]);
	assertAnnotations(generateTool, {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	});
	const prepareTool = byName.get(prepareToolName);
	assertSchemaProperties(prepareTool, ["targets", "selection"]);
	assertAnnotations(prepareTool, {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: false,
	});
	const applyTool = byName.get(applyToolName);
	assertSchemaProperties(applyTool, ["planId", "token", "approvedPlanHash"]);
	const applyRequired = new Set(applyTool.inputSchema.required);
	for (const property of ["planId", "token", "approvedPlanHash"]) {
		assert(
			applyRequired.has(property),
			`${applyToolName} inputSchema must require ${property}.`,
		);
	}
	assertAnnotations(applyTool, {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: false,
	});
	return { ...capabilities, toolCount: tools.length, writeCapability: false };
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
	developerState,
	readOnlyState,
	hardenedState,
	developerMode,
	readOnlyMode,
	hardenedMode,
	developerCapabilities,
	readOnlyCapabilities,
	hardenedCapabilities,
	observedStateHashChanged,
	dependencyProvenancePreserved,
}) {
	return {
		success: true,
		inspectorSource: "repository-skill",
		runtimeSource: "packed-tarballs",
		acceptanceClass: "packed-runtime-handoff-only",
		realAgentFirstAttemptConformance: "not-evaluated",
		states: {
			withoutHost: withoutHostState,
			developer: developerState,
			readOnly: readOnlyState,
			hardened: hardenedState,
		},
		modes: {
			developer: developerMode,
			readOnly: readOnlyMode,
			hardened: hardenedMode,
		},
		capabilities: {
			developerPrepare: developerCapabilities.prepare,
			developerApply: developerCapabilities.apply,
			developerWrite: developerCapabilities.writeCapability,
			readOnlyPrepare: readOnlyCapabilities.prepare,
			readOnlyApply: readOnlyCapabilities.apply,
			readOnlyWrite: readOnlyCapabilities.writeCapability,
			hardenedPrepare: hardenedCapabilities.prepare,
			hardenedApply: hardenedCapabilities.apply,
			hardenedWrite: hardenedCapabilities.writeCapability,
		},
		observedStateHashChanged,
		dependencyProvenancePreserved,
		restartBoundary: {
			hostConfigWrite: "RESTART_REQUIRED",
			runtimeReload: "fresh-session-preferred-host-restart-if-stale",
			packedToolSchemaVerification: "fresh-packed-process-only",
		},
	};
}

export async function readDependencyProvenance(consumerRoot) {
	return Promise.all(
		["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"].map(
			async (relativePath) => {
				let handle;
				try {
					handle = await open(
						join(consumerRoot, relativePath),
						constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
					);
					const opened = await handle.stat({ bigint: true });
					if (opened.size > BigInt(MAX_PROVENANCE_FILE_BYTES)) {
						throw new Error(`provenance file exceeds ${MAX_PROVENANCE_FILE_BYTES} bytes: ${relativePath}`);
					}
					const hash = createHash("sha256");
					let size = 0;
					for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
						size += chunk.byteLength;
						if (size > MAX_PROVENANCE_FILE_BYTES) {
							throw new Error(`provenance file exceeds ${MAX_PROVENANCE_FILE_BYTES} bytes: ${relativePath}`);
						}
						hash.update(chunk);
					}
					const after = await handle.stat({ bigint: true });
					if (BigInt(size) !== opened.size || BigInt(size) !== after.size) {
						throw new Error(`provenance file changed during read: ${relativePath}`);
					}
					return [relativePath, { size, sha256: hash.digest("hex") }];
				} finally {
					await handle?.close();
				}
			},
		),
	);
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
	const dependencyProvenanceBefore = await readDependencyProvenance(consumerRoot);
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

	const developerLaunch = createCodexHostLaunch({
		mode: "developer",
		consumerRoot,
		launcher: "node",
		includeGenerationMode: false,
	});
	await writeFile(codexConfig, developerLaunch.configToml);
	const developer = await inspectProject(repositoryRoot, consumerRoot);
	assert(
		developer.state === "HOST_CONFIG_READY" &&
			developer.codex?.inferredMode === "developer",
		"Setup Inspector must infer the developer Host configuration.",
	);
	assert(
		developer.codex?.generationMode === null,
		"Canonical Developer Setup must omit --generation-mode and use the MCP default.",
	);
	assertObservedStateHashChanged(
		withoutHost.observedStateHash,
		developer.observedStateHash,
	);
	const developerCapabilities = assertModeCapabilityAgreement({
		inferredMode: developer.codex.inferredMode,
		tools: await listPackedMcpTools(consumerRoot, developerLaunch),
	});

	const readOnlyLaunch = createCodexHostLaunch({
		mode: "read-only",
		consumerRoot,
		launcher: "node",
	});
	await writeFile(codexConfig, readOnlyLaunch.configToml);
	const readOnly = await inspectProject(repositoryRoot, consumerRoot);
	assert(
		readOnly.state === "HOST_CONFIG_READY" &&
			readOnly.codex?.inferredMode === "read-only",
		"Setup Inspector must infer the read-only Host configuration.",
	);
	assertObservedStateHashChanged(
		developer.observedStateHash,
		readOnly.observedStateHash,
	);
	const readOnlyCapabilities = assertModeCapabilityAgreement({
		inferredMode: readOnly.codex.inferredMode,
		tools: await listPackedMcpTools(consumerRoot, readOnlyLaunch),
	});

	const hardenedLaunch = createCodexHostLaunch({
		mode: "hardened",
		consumerRoot,
		launcher: "node",
	});
	await writeFile(codexConfig, hardenedLaunch.configToml);
	const hardened = await inspectProject(repositoryRoot, consumerRoot);
	assert(
		hardened.state === "HOST_CONFIG_READY" &&
			hardened.codex?.inferredMode === "hardened",
		"Setup Inspector must infer the hardened Host configuration.",
	);
	assertObservedStateHashChanged(
		readOnly.observedStateHash,
		hardened.observedStateHash,
	);
	const hardenedCapabilities = assertModeCapabilityAgreement({
		inferredMode: hardened.codex.inferredMode,
		tools: await listPackedMcpTools(consumerRoot, hardenedLaunch),
	});

	await appendFile(codexConfig, "# setup handoff drift probe\n");
	const drifted = await inspectProject(repositoryRoot, consumerRoot);
	const observedStateHashChanged = assertObservedStateHashChanged(
		hardened.observedStateHash,
		drifted.observedStateHash,
	);
	const dependencyProvenancePreserved =
		JSON.stringify(dependencyProvenanceBefore) ===
		JSON.stringify(await readDependencyProvenance(consumerRoot));
	assert(
		dependencyProvenancePreserved,
		"Setup handoff must preserve pre-existing package and pnpm override provenance.",
	);

	return createSetupMcpHandoffReport({
		withoutHostState: withoutHost.state,
		developerState: developer.state,
		readOnlyState: readOnly.state,
		hardenedState: hardened.state,
		developerMode: developer.codex.inferredMode,
		readOnlyMode: readOnly.codex.inferredMode,
		hardenedMode: hardened.codex.inferredMode,
		developerCapabilities,
		readOnlyCapabilities,
		hardenedCapabilities,
		observedStateHashChanged,
		dependencyProvenancePreserved,
	});
}
