import { map as _map, camelCase } from "lodash-es";
import type Oas from "oas";
import { Operation } from "oas/operation";
import type { HttpMethods, OperationObject } from "oas/types";
import { pinyin } from "pinyin-pro";
import {
	enumerateOpenAPIOperations,
	type OpenAPIOperationSource,
} from "../openapi/operations.ts";
import type { CompatibleOpenAPIDocument } from "../types/index.ts";
import { removePunctuation } from "../utils/removePunctuation.ts";
import { OperationAccessor } from "./OperationAccessor.ts";
import type { OperationsByTag, OperationWrapper } from "./types.ts";

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

		for (const operation of operations) {
			const { path, method, accessor } = operation;
			const operationTags = _map(accessor.operation.getTags(), "name").filter(
				(tag): tag is string => typeof tag === "string" && tag.length > 0,
			);
			const tags = operationTags.length > 0 ? operationTags : ["default"];
			for (const tag of tags) {
				const tagName = camelCase(tag) || "default";
				if (!grouped[tagName]) {
					grouped[tagName] = [];
				}
				grouped[tagName].push({ ...operation, path, method, tagName, accessor });
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
	getOperation(
		path: string,
		method: string,
		source?: OpenAPIOperationSource,
	): OperationAccessor | null {
		const key = `${path}\0${method}`;
		const cached = this.operationAccessors.get(key);
		if (cached) return cached;
		const operation =
			source?.sourceKind === "additional"
				? new Operation(
						this.oas,
						path,
						method as HttpMethods,
						source.operation as OperationObject,
					)
				: this.oas.operation(path, method as HttpMethods);
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
	getAllOperations(): Array<Omit<OperationWrapper, "tagName">> {
		const result: Array<Omit<OperationWrapper, "tagName">> = [];
		for (const source of enumerateOpenAPIOperations(
			this.oas.api as CompatibleOpenAPIDocument,
		)) {
			const accessor = this.getOperation(
				source.path,
				source.sourceMethod,
				source,
			);
			if (accessor) result.push({ ...source, accessor });
		}
		return result;
	}
}
