import type { Schema } from "@openapi-to/core";
import type { JSONSchema } from "oas/types";
import type { OpenAPIV3, OpenAPIV3_1 } from "openapi-types";

type MixedSchemaObject = Extract<
	OpenAPIV3_1.SchemaObject,
	{
		type?: (
			| OpenAPIV3_1.ArraySchemaObjectType
			| OpenAPIV3_1.NonArraySchemaObjectType
		)[];
	}
>;

export type PluginConfig = {
	/**
	 * 是否在 import 路径中添加扩展名（如 .ts）
	 */
	importWithExtension?: boolean;
};

export type SchemaObjectAndJSONSchema =
	| OpenAPIV3.ArraySchemaObject
	| OpenAPIV3.NonArraySchemaObject
	| OpenAPIV3_1.ArraySchemaObject
	| OpenAPIV3_1.NonArraySchemaObject
	| MixedSchemaObject
	| JSONSchema
	| OpenAPIV3.ReferenceObject
	| OpenAPIV3_1.ReferenceObject; //| JSONSchema

export interface JsonResponseObject {
	code: string;
	jsonSchema?: {
		description?: string;
		label: string;
		schema: Schema;
		type: string | string[];
	};
}
