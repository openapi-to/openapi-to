import type { OperationWrapper } from "@openapi-to/core";
import { describeOperationResponses } from "@openapi-to/core";
import { URLPath } from "@openapi-to/core/utils";
import type { RequiredPluginConfig } from "../types.ts";
import { getMswHandlerMethod } from "./mswHandlerMethod.ts";

/**
 * 构建请求方法体
 * @param operation - 操作包装器
 * @param pluginConfig - 插件配置
 * @returns 生成的请求方法体字符串
 */
export function buildMethodBody(
	operation: OperationWrapper,
	_pluginConfig: RequiredPluginConfig,
): string {
	const url = new URLPath(operation.path);
	const dataExpression = hasSchemaLessJsonSuccessResponse(operation)
		? 'data as import("msw").JsonBodyType'
		: "data";
	const method = getMswHandlerMethod(operation);
	if (!method) {
		throw new Error(
			"Unsupported MSW handler method reached method body builder",
		);
	}
	return `return http.${method}(
    '${url.toURLPath}',
    (info) => {
      return HttpResponse.json(${dataExpression}, {
        status: 200,
      });
    },
  )`;
}

function hasSchemaLessJsonSuccessResponse(
	operation: OperationWrapper,
): boolean {
	return describeOperationResponses(operation.accessor.operation).some(
		(descriptor) => {
			if (descriptor.classification !== "success") return false;
			const response =
				operation.accessor.operation.schema?.responses?.[
					descriptor.sourceStatusCode
				];
			if (!response || "$ref" in response) return false;
			return Object.entries(response.content ?? {}).some(
				([mediaType, media]) =>
					(mediaType.toLowerCase() === "application/json" ||
						mediaType.toLowerCase().endsWith("+json")) &&
					media?.schema === undefined,
			);
		},
	);
}
