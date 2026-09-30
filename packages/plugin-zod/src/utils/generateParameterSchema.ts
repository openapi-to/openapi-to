import {
	isParameterRequired,
	type ParameterObjectWithRef,
	resolveParameterSchema,
} from "@openapi-to/core";
import { CodeBlockWriter } from "ts-morph";
import {
	jsDocTemplateFromParameter,
	writeJSDoc,
} from "@/templates/jsDocTemplateFromSchema.ts";
import type { SchemaRenderOptions } from "@/templates/schemaTemplate.ts";
import { schemaTemplate } from "@/templates/schemaTemplate.ts";
import { getComponentRefExportName } from "./componentNaming.ts";

/**
 * 将一组属性描述生成成带 JSDoc 注释的 TypeScript 对象字面量
 */
export function generateParameterSchema(
	parameters: ParameterObjectWithRef[],
	operationName: string,
	options: SchemaRenderOptions = {},
): string {
	const writer = new CodeBlockWriter({ indentNumberOfSpaces: 4 });

	writer.block(() => {
		parameters.forEach((prop, idx) => {
			const name = prop.name;
			const comma = idx < parameters.length - 1 ? "," : "";
			const optional = isParameterRequired(prop) ? "" : ".optional()";

			writeJSDoc(writer, jsDocTemplateFromParameter(prop));
			let schemaString: string;
			if ("$ref" in prop && prop.$ref) {
				schemaString = getComponentRefExportName(prop.$ref);
			} else {
				const schema =
					Object.keys(prop.content ?? {}).length > 1
						? false
						: resolveParameterSchema(prop);
				schemaString =
					schema === undefined
						? "z.string()"
						: schemaTemplate(schema, name, operationName, options);
			}

			writer.writeLine(
				`${JSON.stringify(name)}: ${schemaString}${optional}${comma}`,
			);
		});
	});
	return `z.object(${writer.toString()})`;
}
