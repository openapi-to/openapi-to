import {
	type JSDocStructure,
	type OptionalKind,
	type StatementStructures,
	StructureKind,
	VariableDeclarationKind,
	type VariableStatementStructure,
} from "ts-morph";
import { jsDocTemplateFromSchema } from "@/templates/jsDocTemplateFromSchema.ts";
import {
	type SchemaRenderOptions,
	schemaTemplate,
} from "@/templates/schemaTemplate.ts";
import type { JsonResponseObject } from "../types.ts";

export function operationResponseTemplate(
	{ jsonSchema }: JsonResponseObject,
	declarationName: string,
	options: SchemaRenderOptions = {},
): StatementStructures {
	const schema = jsonSchema?.schema;

	const docs = jsDocTemplateFromSchema(jsonSchema?.description);

	if (schema === undefined) {
		return createVariable(declarationName, "z.undefined()", docs);
	}

	const aliasedType = schemaTemplate(schema, declarationName, "", options);
	return createVariable(declarationName, aliasedType, docs);
}

// ---------------- Helper: TypeAlias 构建 ----------------

export function createVariable(
	name: string,
	initializer: string,
	docs?: OptionalKind<JSDocStructure>[],
): VariableStatementStructure {
	return {
		kind: StructureKind.VariableStatement,
		declarationKind: VariableDeclarationKind.Const,
		isExported: true,
		docs,
		declarations: [
			{
				name,
				initializer,
			},
		],
	};
}

// ---------------- Helper: 错误类型联合 ----------------

export function buildResponseUnionSchema(
	name: string,
	memberNames: string[],
	failClosed = false,
): VariableStatementStructure {
	return {
		kind: StructureKind.VariableStatement,
		declarationKind: VariableDeclarationKind.Const,
		isExported: true,
		docs: [],
		declarations: [
			{
				name,
				initializer: failClosed
					? "z.never()"
					: memberNames.length === 0
						? "z.unknown()"
						: memberNames.length === 1
							? memberNames[0]
							: `z.union([${memberNames.join(", ")}])`,
			},
		],
	};
}

// ---------------- Helper: 无成功响应时 fallback ----------------
