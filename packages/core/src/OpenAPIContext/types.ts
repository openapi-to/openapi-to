import type {
	JSONSchema4,
	JSONSchema6Definition,
	JSONSchema7Definition,
} from "json-schema";
import type { TagObject } from "oas/types";

export type { HttpMethods } from "oas/types";

import type { OpenAPIV3, OpenAPIV3_1 } from "openapi-types";
import type { OperationAccessor } from "./OperationAccessor.ts";
import type {
	OpenAPIOperationSource,
	OperationKind,
	OperationSourceKind,
} from "../openapi/operations.ts";

type TagName = string;

export type OperationWrapper = {
	path: string;
	method: string;
	wireMethod: string;
	sourceKind: OperationSourceKind;
	sourceMethod: string;
	sourcePath: Array<string | number>;
	sourcePointer: string;
	operationKind: OperationKind;
	tagName: string;
	accessor: OperationAccessor;
};

export type OperationDescriptor = OpenAPIOperationSource;

export type OperationsByTag = Record<TagName, OperationWrapper[]>;

export type OperationsByTagValue = OperationsByTag[keyof OperationsByTag];

export type Schema =
	| OpenAPIV3.SchemaObject
	| OpenAPIV3.ReferenceObject
	| OpenAPIV3_1.SchemaObject
	| OpenAPIV3_1.ReferenceObject
	| JSONSchema4
	| JSONSchema6Definition
	| JSONSchema7Definition;

export type ComponentsSchema = Schema;

export type ReferenceObject =
	| OpenAPIV3.ReferenceObject
	| OpenAPIV3_1.ReferenceObject;

export type PathParameters =
	| OpenAPIV3.OperationObject["parameters"]
	| OpenAPIV3_1.OperationObject["parameters"];

export type PathRequestBodies =
	| OpenAPIV3.OperationObject["requestBody"]
	| OpenAPIV3_1.OperationObject["requestBody"];

export type ComponentsParameters = NonNullable<
	| OpenAPIV3.ComponentsObject["parameters"]
	| OpenAPIV3_1.ComponentsObject["parameters"]
>;

type OpenAPIV3_1ParameterMediaTypeObject = Omit<
	OpenAPIV3_1.MediaTypeObject,
	"schema"
> & {
	schema?: Schema;
};

type OpenAPIV3_1ParameterObject = Omit<
	OpenAPIV3_1.ParameterObject,
	"schema" | "content"
> & {
	schema?: Schema;
	content?: Record<string, OpenAPIV3_1ParameterMediaTypeObject>;
};

export type ComponentsParameterValue =
	| OpenAPIV3.ReferenceObject
	| OpenAPIV3_1.ReferenceObject
	| OpenAPIV3.ParameterObject
	| OpenAPIV3_1.ParameterObject
	| OpenAPIV3_1ParameterObject;

export type RequestBodyObject =
	| OpenAPIV3.RequestBodyObject
	| OpenAPIV3_1.RequestBodyObject;

//export type ComponentsRequestBodies = NonNullable<OpenAPIV3.ComponentsObject['requestBodies'] | OpenAPIV3_1.ComponentsObject['requestBodies']>
export type ComponentsRequestBodies = Record<
	string,
	ReferenceObject | RequestBodyObject
>;

export type ComponentsResponses = NonNullable<
	| OpenAPIV3.ComponentsObject["responses"]
	| OpenAPIV3_1.ComponentsObject["responses"]
>;

export type ComponentsResponsesValue =
	| OpenAPIV3.ReferenceObject
	| OpenAPIV3_1.ReferenceObject
	| OpenAPIV3.ResponseObject
	| OpenAPIV3_1.ResponseObject;

export type HookTagObject = TagObject;

export type ParameterObject =
	| OpenAPIV3.ParameterObject
	| OpenAPIV3_1.ParameterObject
	| OpenAPIV3_1ParameterObject;

export type ParameterObjectWithRef =
	| (OpenAPIV3.ParameterObject & { $ref?: string })
	| (OpenAPIV3_1.ParameterObject & { $ref?: string })
	| (OpenAPIV3_1ParameterObject & { $ref?: string });

export type MediaTypeObject =
	| OpenAPIV3.MediaTypeObject
	| OpenAPIV3_1.MediaTypeObject;
