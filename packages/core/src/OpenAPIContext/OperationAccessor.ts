import { map as _map, camelCase, head, some } from "lodash-es";

import type { Operation } from "oas/operation";
import { resolveJSONPointer } from "../openapi/refResolver.ts";
import { isParameterRequired } from "./parameterSchema.ts";
import { isOperationRequestBodyRequired } from "./requestBody.ts";
import type { ParameterObjectWithRef } from "./types.ts";
import { selectSuccessResponseStatusCode } from "./responseStatus.ts";

type OperationTSType = {
	pathParams: string | undefined;
	queryParams: string | undefined;
	headerParams: string | undefined;
	cookieParams: string | undefined;
	body: string | undefined;
	requestInput?: string;
	responseSuccess: string | undefined;
	responseError: string | undefined;
	filePath: string | undefined;
};

type OperationZodSchema = {
	body: string;
	responseSuccess: string;
	headerParams: string;
	cookieParams: string;
	filePath: string;
};

type OperationFaker = {
	responseSuccess: string;
	filePath: string;
};

type OperationRequest = {
	requestName: string;
	filePath: string;
};

export type HeaderParameterSerializationMetadata = {
	name: string;
	required: boolean;
	strategy: "schema-simple" | "content";
	style: string;
	explode: boolean;
	schemaPresent: boolean;
	contentMediaType?: string;
};

export class OperationAccessor {
	private static _instances = new WeakMap<Operation, OperationAccessor>();
	private _operationType: OperationTSType | undefined;
	private _operationZodSchema: OperationZodSchema | undefined;
	private _operationFaker: OperationFaker | undefined;
	private _operationRequest: OperationRequest | undefined;
	private _dataReturnType: string[] | undefined;
	constructor(public operation: Operation) {}

	get operationName(): string {
		return camelCase(this.operationId); //|| fallbackOperationName(this.operation.path, this.operation.method)
	}

	get operationId() {
		return this.operation.getOperationId() || "";
	}

	get getFirstTagName(): string | undefined {
		return camelCase(head(_map(this.operation?.getTags(), "name")));
	}
	get parameters(): ParameterObjectWithRef[] {
		const operationParameters = Array.isArray(this.operation.schema?.parameters)
			? this.operation.schema.parameters
			: undefined;
		const pathParameters = Array.isArray(
			this.operation.api?.paths?.[this.operation.path]?.parameters,
		)
			? this.operation.api?.paths?.[this.operation.path]?.parameters
			: undefined;
		const parameters =
			operationParameters || pathParameters
				? [...(operationParameters ?? []), ...(pathParameters ?? [])]
				: this.operation.getParameters();
		const seen = new Set<string>();
		return parameters
			.map<ParameterObjectWithRef>((parameterObject) => {
				if (
					parameterObject &&
					"$ref" in parameterObject &&
					parameterObject.$ref
				) {
					const originalRef = parameterObject.$ref;
					const seenRefs = new Set<string>();
					let value: unknown = parameterObject;
					while (
						value &&
						typeof value === "object" &&
						!Array.isArray(value) &&
						"$ref" in value &&
						typeof value.$ref === "string"
					) {
						if (seenRefs.has(value.$ref)) {
							value = undefined;
							break;
						}
						seenRefs.add(value.$ref);
						const resolved = resolveJSONPointer(this.operation.api, value.$ref);
						value = resolved.found ? resolved.value : undefined;
					}
					return {
						...(typeof value === "object" &&
						value !== null &&
						!Array.isArray(value)
							? value
							: {}),
						$ref: originalRef,
					} as ParameterObjectWithRef;
				}
				return parameterObject as ParameterObjectWithRef;
			})
			.filter((parameterObject) => {
				if (
					typeof parameterObject.in !== "string" ||
					typeof parameterObject.name !== "string"
				)
					return true;
				if (
					parameterObject.in === "header" &&
					["accept", "content-type", "authorization"].includes(
						parameterObject.name.toLowerCase(),
					)
				)
					return false;
				const name =
					parameterObject.in === "header"
						? parameterObject.name.toLowerCase()
						: parameterObject.name;
				const key = `${parameterObject.in}\0${name}`;
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
	}

	get queryParameters(): ParameterObjectWithRef[] {
		return this.parametersByLocation("query");
	}

	get pathParameters(): ParameterObjectWithRef[] {
		return this.parametersByLocation("path").map((x) => {
			return {
				...x,
				name: camelCase(x.name),
				required: true,
			};
		});
	}

	get headerParameters(): ParameterObjectWithRef[] {
		return this.parametersByLocation("header");
	}

	get headerParameterSerialization(): HeaderParameterSerializationMetadata[] {
		return this.headerParameters.map((parameter) => {
			const hasContent = parameter.content !== undefined;
			const contentMediaType = parameter.content
				? Object.keys(parameter.content)[0]
				: undefined;
			return {
				name: parameter.name,
				required: isParameterRequired(parameter),
				strategy: hasContent ? "content" : "schema-simple",
				style: parameter.style ?? "simple",
				explode: parameter.explode ?? false,
				schemaPresent: parameter.schema !== undefined,
				...(contentMediaType ? { contentMediaType } : {}),
			};
		});
	}

	get cookieParameters(): ParameterObjectWithRef[] {
		return this.parametersByLocation("cookie");
	}

	parametersByLocation(
		location: "path" | "query" | "header" | "cookie",
	): ParameterObjectWithRef[] {
		return this.parameters.filter((parameter) => parameter.in === location);
	}

	get hasQueryParameters(): boolean {
		return some(this.parameters || [], ["in", "query"]);
	}

	get hasQueryParametersArray(): boolean {
		return some(
			this.queryParameters,
			(parameter) =>
				"schema" in parameter &&
				parameter.schema &&
				typeof parameter.schema === "object" &&
				"type" in parameter.schema &&
				parameter.schema.type === "array",
		);
	}

	get hasPathParameters(): boolean {
		return some(this.parameters, ["in", "path"]);
	}

	get hasHeaderParameters(): boolean {
		return some(this.parameters, ["in", "header"]);
	}

	get hasCookieParameters(): boolean {
		return some(this.parameters, ["in", "cookie"]);
	}

	get isQueryParametersOptional(): boolean {
		const queryParameters = this.queryParameters || [];
		return queryParameters.every((x) => !isParameterRequired(x));
	}

	get isHeaderParametersOptional(): boolean {
		return this.headerParameters.every(
			(parameter) => !isParameterRequired(parameter),
		);
	}

	get isRequestBodyRequired(): boolean {
		return isOperationRequestBodyRequired(this.operation);
	}

	get isRequestInputOptional(): boolean {
		return (
			!this.hasPathParameters &&
			this.isQueryParametersOptional &&
			!this.isRequestBodyRequired &&
			this.isHeaderParametersOptional
		);
	}

	get hasRequestBody() {
		return this.operation.hasRequestBody();
	}

	get operationTSType(): OperationTSType | undefined {
		return this._operationType;
	}

	get operationZodSchema() {
		return this._operationZodSchema;
	}

	get operationRequest() {
		return this._operationRequest;
	}

	get operationFaker() {
		return this._operationFaker;
	}

	setOperationFaker(operationFaker: OperationFaker) {
		this._operationFaker = operationFaker;
	}

	get dataReturnType() {
		return this._dataReturnType || [];
	}

	setOperationTSType(operationTSType: OperationTSType) {
		this._operationType = operationTSType;
	}

	setDataReturnType(dataReturnType: string[]) {
		this._dataReturnType = dataReturnType;
	}

	setOperationZodSchemaName(operationZodSchema: OperationZodSchema) {
		this._operationZodSchema = operationZodSchema;
	}

	setOperationRequest(operationRequest: OperationRequest) {
		this._operationRequest = operationRequest;
	}

	/**
	 * Content-type :application/json or Content-typec: *
	 */
	get isJsonContainsDefaultCases(): boolean {
		const isJson = this.operation.isJson();
		//no set type.the default is json
		const isNoContentType = this.operation.getContentType() === "*/*";
		return isJson || isNoContentType;
	}

	//todo isMultipart()

	//根据response的类型判断是否为下载的接口
	get isDownLoad(): boolean {
		// 检查响应内容类型是否为下载类型
		const responseContentType = this.getResponseContentType();
		const downloadTypes = [
			"application/octet-stream",
			"application/pdf",
			"application/zip",
			"application/vnd.ms-excel",
			"application/msword",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			"image/jpeg",
			"image/png",
			"image/gif",
			"audio/mpeg",
			"video/mp4",
		];
		return responseContentType.some((contentType) =>
			downloadTypes.includes(contentType),
		);
	}

	getResponseContentType(): string[] {
		const documentedStatusCodes = Object.keys(
			this.operation.schema?.responses ?? {},
		);
		const statusCodes =
			documentedStatusCodes.length > 0
				? documentedStatusCodes
				: this.operation.getResponseStatusCodes();
		const successCode = selectSuccessResponseStatusCode(statusCodes);
		if (!successCode) return [];
		const sourceCode =
			statusCodes.find(
				(status) => String(status).toLowerCase() === successCode.toLowerCase(),
			) ?? successCode;
		const successResponse = this.operation.getResponseByStatusCode(sourceCode);
		if (
			typeof successResponse !== "boolean" &&
			successResponse &&
			"content" in successResponse &&
			successResponse.content
		) {
			// 获取第一个内容类型
			return Object.keys(successResponse.content);
		}
		return [];
	}

	/**
	 * 获取 OperationAccessor 实例
	 * 如果相同 operation 的实例已存在则返回现有实例，否则创建新实例
	 * @param operation Operation 对象
	 * @returns OperationAccessor 实例
	 */
	public static getInstance(operation: Operation): OperationAccessor {
		const cached = OperationAccessor._instances.get(operation);
		if (cached) return cached;
		const accessor = new OperationAccessor(operation);
		OperationAccessor._instances.set(operation, accessor);
		return accessor;
	}
}
