import process from "node:process";

import {
	DiagnosticError,
	ExitCode,
	compileOpenAPI,
	diffOpenAPIDocuments,
	exitCodeForDiagnostics,
	hasDiagnosticErrors,
	inspectOpenAPIDocument,
	loadOpenapiConfig,
	preflightConfiguredTargets,
	sortDiagnostics,
	summarizeDiagnostics,
	type Diagnostic,
	type ExitCodeValue,
	type OpenapiToConfig,
} from "@openapi-to/core";
import { cac } from "cac";
import path from "node:path";

import { version } from "../../openapi/package.json";
import { generate } from "./generate.ts";
import { init } from "./init.ts";
import {
	SkillsInstallError,
	installCodexSkills,
	parseSkillsInstallRequest,
	skillsInstallHumanOutput,
} from "./skillsInstall.ts";

const moduleName = "openapi";

export interface CLIIO {
	stdout(message: string): void;
	stderr(message: string): void;
}

export interface CLIRunResult {
	exitCode: ExitCodeValue;
	output?: unknown;
}

const defaultIO: CLIIO = {
	stdout: (message) => process.stdout.write(`${message}\n`),
	stderr: (message) => process.stderr.write(`${message}\n`),
};

function printJSON(io: CLIIO, value: unknown): void {
	io.stdout(JSON.stringify(value, null, 2));
}

function diagnosticText(diagnostic: Diagnostic): string {
	const location = diagnostic.location?.source
		? ` (${diagnostic.location.source}${diagnostic.location.path?.length ? `:${diagnostic.location.path.join(".")}` : ""})`
		: "";
	return `${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}${location}`;
}

function printDiagnostics(io: CLIIO, diagnostics: readonly Diagnostic[]): void {
	for (const diagnostic of diagnostics) io.stderr(diagnosticText(diagnostic));
}

function compilationOutput(
	command: string,
	source: string,
	diagnostics: Diagnostic[],
) {
	const sorted = sortDiagnostics(diagnostics);
	return {
		success: !hasDiagnosticErrors(sorted),
		command,
		source,
		diagnostics: sorted,
		summary: summarizeDiagnostics(sorted),
	};
}

function configFailure(error: unknown): Diagnostic[] {
	if (error instanceof DiagnosticError) return error.diagnostics;
	return [
		{
			code: "CONFIG_LOAD_FAILED",
			severity: "error",
			message: "Unable to load openapi configuration.",
			cause: error instanceof Error ? error.message : undefined,
		},
	];
}

function configuredSourceDisplay(
	configuredSource: string,
	compiledSource?: string,
): string {
	try {
		const url = new URL(configuredSource);
		if (url.protocol === "http:" || url.protocol === "https:") {
			return compiledSource ?? `${url.origin}${url.pathname}`;
		}
	} catch {
		// A local path is displayed exactly as configured for compatibility.
	}
	return configuredSource;
}

async function runGenerateInternal(
	options: Record<string, unknown>,
	io: CLIIO,
): Promise<CLIRunResult> {
	const json = options.json === true;
	let config: OpenapiToConfig;
	let configFilepath: string;
	try {
		const loaded = await loadOpenapiConfig({
			cwd: process.cwd(),
			moduleName,
			configPath:
				typeof options.config === "string" ? options.config : undefined,
		});
		config = loaded.config;
		configFilepath = loaded.filepath;
	} catch (error) {
		const diagnostics = configFailure(error);
		const output = {
			success: false,
			command: "generate",
			diagnostics,
			summary: summarizeDiagnostics(diagnostics),
			servers: [],
		};
		if (json) printJSON(io, output);
		else printDiagnostics(io, diagnostics);
		return { exitCode: ExitCode.ConfigError, output };
	}
	const workspaceRoot = path.dirname(configFilepath);
	const requestedTargets =
		typeof options.target === "string"
			? [options.target]
			: Array.isArray(options.target)
				? options.target.filter(
						(target): target is string => typeof target === "string",
					)
				: undefined;
	let prepared: Awaited<ReturnType<typeof preflightConfiguredTargets>>;
	try {
		prepared = await preflightConfiguredTargets(config, {
			workspaceRoot,
			localFileRoot: workspaceRoot,
			requestedTargets,
		});
	} catch (error) {
		const diagnostics =
			error instanceof DiagnosticError
				? error.diagnostics
				: configFailure(error);
		const output = {
			success: false,
			command: "generate",
			diagnostics,
			summary: summarizeDiagnostics(diagnostics),
			servers: [],
		};
		if (json) printJSON(io, output);
		else printDiagnostics(io, diagnostics);
		return { exitCode: exitCodeForDiagnostics(diagnostics), output };
	}

	const preflightDiagnostics = sortDiagnostics(
		prepared.flatMap(({ compilation }) => compilation?.diagnostics ?? []),
	);
	if (hasDiagnosticErrors(preflightDiagnostics)) {
		const output = {
			success: false,
			command: "generate",
			mode:
				options.check === true
					? "check"
					: options.dryRun === true
						? "dry-run"
						: "write",
			diagnostics: preflightDiagnostics,
			summary: summarizeDiagnostics(preflightDiagnostics),
			servers: prepared.map((target) => ({
				name: target.name,
				source: configuredSourceDisplay(
					target.server.input.path,
					target.compilation?.source,
				),
				output: target.output.workspaceRelativePath,
				success: false,
			})),
		};
		if (json) printJSON(io, output);
		else printDiagnostics(io, preflightDiagnostics);
		return { exitCode: exitCodeForDiagnostics(preflightDiagnostics), output };
	}

	const servers = [];
	for (const target of prepared) {
		if (!target.compilation)
			throw new Error(
				"Configured target preflight did not compile the selected input.",
			);
		servers.push(
			await generate(
				target.config,
				{
					json,
					dryRun: options.dryRun === true,
					check: options.check === true,
					debug: options.debug === true,
					logLevel:
						options.logLevel !== undefined &&
						Number.isFinite(Number(options.logLevel))
							? Number(options.logLevel)
							: undefined,
					localFileRoot: workspaceRoot,
				},
				target.compilation,
			),
		);
	}
	const diagnostics = sortDiagnostics(
		servers.flatMap((server) => server.result.diagnostics),
	);
	const output = {
		success: !hasDiagnosticErrors(diagnostics),
		command: "generate",
		mode:
			options.check === true
				? "check"
				: options.dryRun === true
					? "dry-run"
					: "write",
		diagnostics,
		summary: summarizeDiagnostics(diagnostics),
		servers: servers.map((server, index) => ({
			name: server.name,
			source: prepared[index]
				? configuredSourceDisplay(
						prepared[index].server.input.path,
						prepared[index].compilation?.source,
					)
				: server.source,
			output:
				prepared[index]?.output.workspaceRelativePath ??
				path.relative(workspaceRoot, server.output).split(path.sep).join("/"),
			success: server.success,
			manifest: server.result.generationResult?.manifest
				? {
						...server.result.generationResult.manifest,
						outputRoot:
							prepared[index]?.output.workspaceRelativePath ??
							path
								.relative(
									workspaceRoot,
									server.result.generationResult.manifest.outputRoot,
								)
								.split(path.sep)
								.join("/"),
					}
				: undefined,
		})),
	};
	if (json) printJSON(io, output);
	let exitCode = exitCodeForDiagnostics(diagnostics);
	if (
		options.check === true &&
		servers.some((server) => server.result.generationResult?.manifest.outdated)
	)
		exitCode = ExitCode.GeneratedOutputOutdated;
	return { exitCode, output };
}

async function runGenerate(
	options: Record<string, unknown>,
	io: CLIIO,
): Promise<CLIRunResult> {
	if (options.json !== true) return runGenerateInternal(options, io);
	const original = {
		log: console.log,
		info: console.info,
		debug: console.debug,
	};
	const redirect = (...values: unknown[]) =>
		io.stderr(
			values
				.map((value) =>
					typeof value === "string" ? value : JSON.stringify(value),
				)
				.join(" "),
		);
	console.log = redirect;
	console.info = redirect;
	console.debug = redirect;
	try {
		return await runGenerateInternal(options, io);
	} finally {
		console.log = original.log;
		console.info = original.info;
		console.debug = original.debug;
	}
}

async function runValidate(
	input: string,
	options: Record<string, unknown>,
	io: CLIIO,
): Promise<CLIRunResult> {
	const compilation = await compileOpenAPI(input, {
		cwd: process.cwd(),
		debug: options.debug === true,
	});
	const diagnostics = [...compilation.diagnostics];
	if (
		options.failOnWarning === true &&
		diagnostics.some((diagnostic) => diagnostic.severity === "warning")
	) {
		diagnostics.push({
			code: "OPENAPI_WARNINGS_AS_ERRORS",
			severity: "error",
			message:
				"Validation warnings were treated as errors because --fail-on-warning was set.",
			location: { source: compilation.source },
		});
	}
	const output = compilationOutput("validate", compilation.source, diagnostics);
	if (options.json === true) printJSON(io, output);
	else {
		printDiagnostics(io, output.diagnostics);
		io.stdout(
			output.success
				? `Valid OpenAPI document: ${compilation.source}`
				: `OpenAPI validation failed: ${compilation.source}`,
		);
		io.stdout(
			`${output.summary.errors} errors, ${output.summary.warnings} warnings, ${output.summary.infos} infos`,
		);
	}
	return { exitCode: exitCodeForDiagnostics(output.diagnostics), output };
}

async function runInspect(
	input: string,
	options: Record<string, unknown>,
	io: CLIIO,
): Promise<CLIRunResult> {
	const compilation = await compileOpenAPI(input, {
		cwd: process.cwd(),
		debug: options.debug === true,
	});
	const base = compilationOutput(
		"inspect",
		compilation.source,
		compilation.diagnostics,
	);
	const inspection = compilation.document
		? {
				...inspectOpenAPIDocument(
					compilation.document,
					compilation.references?.externalReferenceCount ?? 0,
					compilation.diagnostics,
				),
				openapiVersion:
					compilation.version ?? String(compilation.document.openapi),
			}
		: undefined;
	const output = { ...base, inspection };
	if (options.json === true) printJSON(io, output);
	else if (inspection) {
		io.stdout(
			`${inspection.title ?? "(untitled)"} ${inspection.apiVersion ?? ""} — OpenAPI ${inspection.openapiVersion}`,
		);
		io.stdout(
			`${inspection.pathCount} paths, ${inspection.operationCount} operations, ${inspection.schemaCount} schemas`,
		);
		io.stdout(
			`Methods: ${
				Object.entries(inspection.methodDistribution)
					.map(([method, count]) => `${method} ${count}`)
					.join(", ") || "none"
			}`,
		);
		io.stdout(
			`Missing operationId: ${inspection.missingOperationIds.length}; deprecated: ${inspection.deprecatedOperations.length}; external refs: ${inspection.externalReferenceCount}`,
		);
		printDiagnostics(io, base.diagnostics);
	} else printDiagnostics(io, base.diagnostics);
	return { exitCode: exitCodeForDiagnostics(base.diagnostics), output };
}

async function runDiff(
	before: string,
	after: string,
	options: Record<string, unknown>,
	io: CLIIO,
): Promise<CLIRunResult> {
	const [beforeCompilation, afterCompilation] = await Promise.all([
		compileOpenAPI(before, { cwd: process.cwd() }),
		compileOpenAPI(after, { cwd: process.cwd() }),
	]);
	const diagnostics = sortDiagnostics([
		...beforeCompilation.diagnostics,
		...afterCompilation.diagnostics,
	]);
	const diff =
		beforeCompilation.normalizedDocument && afterCompilation.normalizedDocument
			? diffOpenAPIDocuments(
					beforeCompilation.normalizedDocument,
					afterCompilation.normalizedDocument,
				)
			: undefined;
	const failedForBreaking =
		options.failOnBreaking === true && diff?.breaking === true;
	const output = {
		success: !hasDiagnosticErrors(diagnostics) && !failedForBreaking,
		command: "diff",
		before: beforeCompilation.source,
		after: afterCompilation.source,
		breaking: diff?.breaking ?? false,
		changes: diff?.changes ?? [],
		summary: diff?.summary ?? {
			breaking: 0,
			nonBreaking: 0,
			warnings: 0,
			informational: 0,
		},
		diagnostics,
	};
	if (options.json === true) printJSON(io, output);
	else {
		for (const change of output.changes)
			io.stdout(
				`${change.classification.toUpperCase()} ${change.code}: ${change.message}`,
			);
		printDiagnostics(io, diagnostics);
		io.stdout(
			`${output.summary.breaking} breaking, ${output.summary.nonBreaking} non-breaking, ${output.summary.warnings} warnings`,
		);
	}
	const diagnosticExitCode = exitCodeForDiagnostics(diagnostics);
	return {
		exitCode:
			diagnosticExitCode !== ExitCode.Success
				? diagnosticExitCode
				: failedForBreaking
					? ExitCode.BreakingChanges
					: ExitCode.Success,
		output,
	};
}

async function runSkillsInstall(
	action: unknown,
	options: Record<string, unknown>,
	io: CLIIO,
): Promise<CLIRunResult> {
	const json = options.json === true;
	try {
		const request = parseSkillsInstallRequest(action, options);
		const output = await installCodexSkills(request, version);
		if (json) printJSON(io, output);
		else {
			for (const line of skillsInstallHumanOutput(output)) io.stdout(line);
		}
		return { exitCode: ExitCode.Success, output };
	} catch (error) {
		const diagnostics: Diagnostic[] = [
			{
				code:
					error instanceof SkillsInstallError
						? error.code
						: "SKILLS_INSTALL_FAILED",
				severity: "error",
				message:
					error instanceof SkillsInstallError
						? error.message
						: "Codex Skill installation failed safely.",
			},
		];
		const output = {
			success: false,
			command: "skills install",
			diagnostics,
			summary: summarizeDiagnostics(diagnostics),
		};
		if (json) printJSON(io, output);
		else printDiagnostics(io, diagnostics);
		return { exitCode: ExitCode.GeneralError, output };
	}
}

async function runInit(
	options: Record<string, unknown>,
	io: CLIIO,
): Promise<CLIRunResult> {
	const json = options.json === true;
	try {
		const result = await init({ quiet: json });
		const diagnostics: Diagnostic[] = [];
		const output = {
			success: true,
			command: "init",
			...result,
			diagnostics,
			summary: summarizeDiagnostics(diagnostics),
		};
		if (json) printJSON(io, output);
		return { exitCode: ExitCode.Success, output };
	} catch (error) {
		const diagnostics: Diagnostic[] = [
			{
				code: "CLI_EXECUTION_FAILED",
				severity: "error",
				message: error instanceof Error ? error.message : String(error),
			},
		];
		const output = {
			success: false,
			command: "init",
			created: false,
			diagnostics,
			summary: summarizeDiagnostics(diagnostics),
		};
		if (json) printJSON(io, output);
		else printDiagnostics(io, diagnostics);
		return { exitCode: ExitCode.GeneralError, output };
	}
}

export async function run(
	argv: string[] = process.argv,
	io: CLIIO = defaultIO,
): Promise<CLIRunResult> {
	const program = cac(moduleName);
	let actionResult: CLIRunResult = { exitCode: ExitCode.Success };
	program.option(
		"--json",
		"Write one machine-readable JSON document to stdout",
	);
	program.option("--debug", "Include debug details where available");
	program
		.command("init", "Generate a root openapi.config file")
		.action(async (options) => {
			actionResult = await runInit(options, io);
		});
	program
		.command("skills <action>", "Manage packaged Agent Skills")
		.usage("skills install --host codex [--dry-run] [--json]")
		.option(
			"--host [host]",
			"Install for the selected Host (currently codex only)",
		)
		.option("--dry-run", "Preview the exact install plan without writing")
		.option("--json", "Write JSON to stdout")
		.action(async (action, options) => {
			actionResult = await runSkillsInstall(action, options, io);
		});
	program
		.command("generate", "Generate code from an openapi.config file")
		.alias("g")
		.option(
			"--config <path>",
			"Load the explicitly selected configuration file",
		)
		.option("-l, --log-level <level>", "Numeric log level")
		.option("--dry-run", "Generate and compare without writing files")
		.option("--check", "Fail when generated output differs from disk")
		.option(
			"--target <name>",
			"Generate only the named configured target; repeat for multiple targets",
		)
		.option("--json", "Write JSON to stdout")
		.action(async (options) => {
			actionResult = await runGenerate(options, io);
		});
	program
		.command(
			"validate <input>",
			"Parse, resolve references, and validate an OpenAPI document",
		)
		.option("--json", "Write JSON to stdout")
		.option("--fail-on-warning", "Treat warnings as validation failures")
		.action(async (input, options) => {
			actionResult = await runValidate(input, options, io);
		});
	program
		.command("inspect <input>", "Inspect an OpenAPI document")
		.option("--json", "Write JSON to stdout")
		.action(async (input, options) => {
			actionResult = await runInspect(input, options, io);
		});
	program
		.command("diff <before> <after>", "Compare two OpenAPI contracts")
		.option("--json", "Write JSON to stdout")
		.option(
			"--fail-on-breaking",
			"Exit with code 7 when breaking changes are found",
		)
		.action(async (before, after, options) => {
			actionResult = await runDiff(before, after, options, io);
		});
	program.help();
	program.version(version);
	const originalConsoleInfo = console.info;
	// CAC 6 wrote help and version output through console.log. Keep that
	// observable stdout path while CAC 7 uses console.info instead.
	console.info = (...values) => console.log(...values);
	try {
		program.parse(argv, { run: false });
		await program.runMatchedCommand();
	} catch (error) {
		const diagnostics: Diagnostic[] = [
			{
				code: "CLI_EXECUTION_FAILED",
				severity: "error",
				message: error instanceof Error ? error.message : String(error),
			},
		];
		const json = argv.includes("--json");
		const output = {
			success: false,
			command: program.matchedCommand?.name ?? "unknown",
			diagnostics,
			summary: summarizeDiagnostics(diagnostics),
		};
		if (json) printJSON(io, output);
		else printDiagnostics(io, diagnostics);
		actionResult = { exitCode: ExitCode.GeneralError, output };
	} finally {
		console.info = originalConsoleInfo;
	}
	process.exitCode = actionResult.exitCode;
	return actionResult;
}

export default run;
