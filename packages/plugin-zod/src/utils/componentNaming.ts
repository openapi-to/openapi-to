import { getRefAlias } from "@openapi-to/core/utils";
import { kebabCase, lowerFirst, upperFirst } from "lodash-es";

export type ZodComponentCategory =
	| "schemas"
	| "parameters"
	| "requestBodies"
	| "responses";

const componentDirectories: Record<ZodComponentCategory, string> = {
	schemas: "models",
	parameters: "parameters",
	requestBodies: "requestBodies",
	responses: "responses",
};

export function getComponentExportName(
	category: ZodComponentCategory,
	formattedName: string,
): string {
	switch (category) {
		case "schemas":
		case "requestBodies":
			return `${lowerFirst(formattedName)}Schema`;
		case "parameters":
			return `Parameter${upperFirst(formattedName)}Model`;
		case "responses":
			return `Response${upperFirst(formattedName)}`;
	}
}

export function parseComponentRef(ref: string): {
	category: ZodComponentCategory;
	name: string;
} {
	const match =
		/^#\/components\/(schemas|parameters|requestBodies|responses)\/(.+)$/.exec(
			ref,
		);
	if (!match) {
		throw new Error(`Unsupported Zod component reference: ${ref}`);
	}
	return {
		category: match[1] as ZodComponentCategory,
		name: getRefAlias(ref),
	};
}

export function getComponentRefExportName(ref: string): string {
	const { category, name } = parseComponentRef(ref);
	return getComponentExportName(category, name);
}

export function getSchemaOutputTypeName(formattedName: string): string {
	return `${upperFirst(getComponentExportName("schemas", formattedName))}Output`;
}

export function getComponentRefOutputTypeName(ref: string): string {
	const { category, name } = parseComponentRef(ref);
	if (category !== "schemas") {
		throw new Error(`Zod recursive output types require a schema reference: ${ref}`);
	}
	return getSchemaOutputTypeName(name);
}

export function getComponentFilePath(
	ref: string,
	componentOutputDir: string,
): string {
	const { category, name } = parseComponentRef(ref);
	return `${componentOutputDir}/${componentDirectories[category]}/${kebabCase(name)}.schema.ts`;
}
