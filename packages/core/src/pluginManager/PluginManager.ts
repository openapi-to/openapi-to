import { execa } from "execa";
import Oas from "oas";
import type { OASDocument } from "oas/types";
import type { SourceFile, ts } from "ts-morph";
import {
	compareArtifacts,
	formatMaterializedArtifacts,
	materializeArtifacts,
	sortGeneratedArtifacts,
	sourceFileToArtifact,
	writeArtifacts,
} from "../artifacts/index.ts";
import type { GeneratedArtifact } from "../artifacts/types.ts";
import type { Diagnostic } from "../diagnostics.ts";
import { DiagnosticError, hasDiagnosticErrors } from "../diagnostics.ts";
import { type PluginEnumType, PluginStatus } from "../enums.ts";
import { throwIfAborted } from "../execution.ts";
import { OpenAPIHelper } from "../OpenAPIContext/OpenAPIHelper.ts";
import type { OpenAPIDocument, OpenapiToSingleConfig } from "../types";
import { sortPluginsByStages } from "./graph.ts";
import { runPluginsByTags } from "./runPluginsByTags.ts";
import type { PluginDefinition } from "./types.ts";
export type PluginStatusValue = `${PluginStatus}`;
type Executed = {
	name: string;
	status: PluginStatusValue;
};

export class PluginManager {
	executed: Array<Executed> = [];
	readonly plugins: Array<PluginDefinition> = [];
	filesCreated = 0;
	diagnostics: Diagnostic[] = [];
	constructor(
		private readonly openapiToSingleConfig: OpenapiToSingleConfig,
		private readonly openAPIDocument: OpenAPIDocument,
		private readonly signal?: AbortSignal,
	) {
		this.openapiToSingleConfig = openapiToSingleConfig;
		this.openAPIDocument = openAPIDocument;
		this.plugins = this.openapiToSingleConfig.plugins;
	}

	get pluginsByStages() {
		return sortPluginsByStages(this.plugins);
	}

	get pluginNames(): PluginEnumType {
		return this.plugins.map((plugin) => plugin.name) as PluginEnumType;
	}

	async execute(): Promise<{
		sourceFiles: SourceFile[];
		artifacts: GeneratedArtifact[];
		diagnostics: Diagnostic[];
		failedPluginNames: string[];
	}> {
		throwIfAborted(this.signal);
		const openAPIHelper = new OpenAPIHelper(
			new Oas(structuredClone(this.openAPIDocument) as OASDocument),
			String((this.openAPIDocument as { openapi?: string }).openapi ?? ""),
		);
		const sourceFileAll = [];
		const failedPluginNameSet = new Set<string>();

		const { sourceFiles, artifacts, diagnostics, failedPluginNames } =
			await runPluginsByTags(this.pluginsByStages, {
				openAPIHelper: openAPIHelper,
				openapiToSingleConfig: this.openapiToSingleConfig,
				openAPIDocument: this.openAPIDocument,
				pluginNames: this.pluginNames,
				signal: this.signal,
			});
		sourceFileAll.push(...sourceFiles);
		for (const name of failedPluginNames) failedPluginNameSet.add(name);
		this.diagnostics = diagnostics;
		this.executed = this.plugins.map((plugin) => ({
			name: plugin.name,
			status: failedPluginNames.includes(plugin.name)
				? PluginStatus.Failed
				: PluginStatus.Succeeded,
		}));

		return {
			sourceFiles: sourceFileAll,
			artifacts,
			diagnostics,
			failedPluginNames: [...failedPluginNameSet],
		};
	}

	get formatText() {
		return {
			// 缩进与换行
			indentSize: 2,
			indentStyle: 2 as ts.IndentStyle,
			convertTabsToSpaces: true,
			newLineCharacter: "\n",

			// 引号与尾随逗号（来自 manipulationSettings）
			quoteKind: "single",
			useTrailingCommas: true,

			// 空格规则
			insertSpaceAfterCommaDelimiter: true,
			insertSpaceBeforeFunctionParenthesis: false,
			insertSpaceAfterFunctionKeywordForAnonymousFunctions: true,
			insertSpaceAfterSemicolonInForStatements: true,
			insertSpaceBeforeTypeAnnotation: false,

			// 大括号放置
			placeOpenBraceOnNewLineForFunctions: false,
			placeOpenBraceOnNewLineForControlBlocks: false,

			// 分号策略
			semicolons: "insert" as ts.SemicolonPreference,
		};
	}

	async writeFiles(sourceFiles: SourceFile[]): Promise<void> {
		const batchSize = 100;
		for (let i = 0; i < sourceFiles.length; i += batchSize) {
			const batch = sourceFiles.slice(i, i + batchSize);
			await Promise.all(
				batch.map((sourceFile) => {
					sourceFile.formatText(this.formatText);
					return sourceFile.save();
				}),
			);
		}
	}

	async formatterCode() {
		const outputDir = this.openapiToSingleConfig.output.dir;
		//检查是否安装了biome
		if (
			!(await execa("which", ["biome"])
				.then(() => true)
				.catch(() => false))
		) {
			console.warn("Biome not found， please install it first.");
		}

		await execa("biome", ["format", "--write", outputDir]).catch((e) => {
			console.warn(e);
			// 忽略错误
		});
	}

	async run(): Promise<void> {
		const { sourceFiles, artifacts, diagnostics } = await this.execute();
		if (hasDiagnosticErrors(diagnostics))
			throw new DiagnosticError("Plugin execution failed.", diagnostics);
		const collected = sortGeneratedArtifacts([
			...sourceFiles.map((sourceFile) => sourceFileToArtifact(sourceFile)),
			...artifacts,
		]);
		const materialized = materializeArtifacts(
			collected,
			this.openapiToSingleConfig.output.dir,
		);
		if (hasDiagnosticErrors(materialized.diagnostics))
			throw new DiagnosticError(
				"Generated artifact collection failed.",
				materialized.diagnostics,
			);
		const formatted = await formatMaterializedArtifacts(
			materialized.artifacts,
			this.openapiToSingleConfig.output.format,
		);
		const manifest = await compareArtifacts(
			formatted.artifacts,
			this.openapiToSingleConfig.output.dir,
			this.openapiToSingleConfig.output.clean === true,
		);
		await writeArtifacts(formatted.artifacts, manifest);
		this.filesCreated = materialized.artifacts.length;
	}
}
