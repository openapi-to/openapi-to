import { isEmpty } from "lodash-es";
import { type ImportDeclarationStructure, StructureKind } from "ts-morph";

export function buildSchemaImports(
	refNames: string[],
	moduleSpecifier: string,
	typeNames: string[] = [],
) {
	if (isEmpty(refNames) && isEmpty(typeNames)) {
		return [];
	}
	const imports: ImportDeclarationStructure[] = [];
	if (!isEmpty(refNames)) {
		imports.push({
			kind: StructureKind.ImportDeclaration,
			namedImports: [...new Set(refNames)].sort(),
			isTypeOnly: false,
			moduleSpecifier,
		});
	}
	if (!isEmpty(typeNames)) {
		imports.push({
			kind: StructureKind.ImportDeclaration,
			namedImports: [...new Set(typeNames)].sort(),
			isTypeOnly: true,
			moduleSpecifier,
		});
	}
	return imports;
}
