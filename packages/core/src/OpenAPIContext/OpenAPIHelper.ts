import { map as _map, camelCase, keys } from "lodash-es";
import type Oas from "oas";
import type { HttpMethods } from "oas/types";
import { pinyin } from "pinyin-pro";
import { HTTP_OPERATION_METHODS } from "../openapi/validator.ts";
import { removePunctuation } from "../utils/removePunctuation.ts";
import { OperationAccessor } from "./OperationAccessor.ts";
import type { OperationsByTag } from "./types.ts";

export class OpenAPIHelper {
	public oas: Oas;
	private readonly operationAccessors = new Map<string, OperationAccessor>();

	constructor(
		oasInstance: Oas,
		private readonly sourceOpenAPIVersion?: string,
	) {
		this.oas = oasInstance;

		// this.generateOperationName()
	}

	/*  generateOperationName() {
    // 构建 operation name 映射
    const allOps = this.getAllOperations()
    const names = inferOperationNamesByTags(allOps)
    allOps.forEach(({ path, method, accessor }) => {
      const key = `${path}-${method}`
      const opName = names[key] || fallbackOperationName(path, method)
      accessor.setOperationName(opName)
    })
  }*/

	//将所有的operation按照tag进行分组
	get operationsByTag(): OperationsByTag {
		const operations = this.getAllOperations();
		const grouped: OperationsByTag = {};

		for (const { path, method, accessor } of operations) {
			const operationTags = _map(accessor.operation.getTags(), "name").filter(
				(tag): tag is string => typeof tag === "string" && tag.length > 0,
			);
			const tags = operationTags.length > 0 ? operationTags : ["default"];
			for (const tag of tags) {
				const tagName = camelCase(tag) || "default";
				if (!grouped[tagName]) {
					grouped[tagName] = [];
				}
				grouped[tagName].push({
					path,
					method,
					tagName,
					accessor,
				});
			}
		}

		return grouped;
	}

	formatterName(name: string): string {
		return this.containsChinese(name)
			? pinyin(removePunctuation(name), {
					toneType: "none",
					type: "array",
				}).join("_")
			: camelCase(name);
	}

	containsChinese(str: string) {
		// 匹配中文字符 Unicode 范围：\u4e00 至 \u9fff
		return /[\u4e00-\u9fff]/.test(str);
	}
	/**
	 * 获取某路径某方法的 operation 信息封装
	 */
	getOperation(path: string, method: HttpMethods): OperationAccessor | null {
		const key = `${path}\0${method}`;
		const cached = this.operationAccessors.get(key);
		if (cached) return cached;
		const operation = this.oas.operation(path, method);
		if (!operation) return null;
		const accessor = OperationAccessor.getInstance(
			operation,
			this.sourceOpenAPIVersion,
		);
		this.operationAccessors.set(key, accessor);
		return accessor;
	}

	/**
	 * 获取所有 paths 的封装信息
	 */
	getAllOperations(): {
		path: string;
		method: HttpMethods;
		accessor: OperationAccessor;
	}[] {
		const result: {
			path: string;
			method: HttpMethods;
			accessor: OperationAccessor;
		}[] = [];
		const paths = keys(this.oas.getPaths());
		const pathObjects = this.oas.api.paths ?? {};
		for (const path of paths) {
			for (const method of HTTP_OPERATION_METHODS.filter(
				(candidate): candidate is HttpMethods =>
					Object.hasOwn(pathObjects[path] ?? {}, candidate),
			)) {
				const accessor = this.getOperation(path, method);
				if (accessor) {
					result.push({ path, method, accessor });
				}
			}
		}
		return result;
	}
}
