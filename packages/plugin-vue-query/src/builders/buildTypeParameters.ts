import { isQueryOperation, type OperationWrapper } from "@openapi-to/core";
import {
	type OptionalKind,
	type TypeParameterDeclarationStructure,
	TypeParameterVariance,
} from "ts-morph";

export function buildTypeParameters(
	operation: OperationWrapper,
): OptionalKind<TypeParameterDeclarationStructure>[] {
	const isGet = isQueryOperation(operation);

	return isGet
		? []
		: [{ name: "TContext", variance: TypeParameterVariance.None }];
}
