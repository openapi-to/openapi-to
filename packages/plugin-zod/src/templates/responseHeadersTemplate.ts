import type {
	ResponseHeaderDescriptor,
	ResponseHeadersDescriptor,
} from "@openapi-to/core";
import type { StatementStructures } from "ts-morph";
import { createVariable } from "@/templates/operationResponseTemplate.ts";
import {
	schemaTemplate,
	type SchemaRenderOptions,
} from "@/templates/schemaTemplate.ts";

export function responseHeadersTemplate(
	descriptor: ResponseHeadersDescriptor,
	name: string,
	options: SchemaRenderOptions = {},
): StatementStructures {
	if (descriptor.collisions.length > 0) {
		const collision = descriptor.collisions[0];
		const names = collision?.sourceNames ?? [];
		const shownNames = names.slice(0, 4).map((name) =>
			JSON.stringify(name.length > 64 ? `${name.slice(0, 61)}...` : name),
		);
		if (names.length > shownNames.length) {
			shownNames.push(`${names.length - shownNames.length} more`);
		}
		const canonicalName = collision?.canonicalName ?? "";
		options.onDiagnostic?.({
			code: "ZOD_RESPONSE_HEADER_NAME_COLLISION",
			message: `Response header names ${shownNames.join(", ")} share the canonical HTTP identity ${JSON.stringify(canonicalName.length > 64 ? `${canonicalName.slice(0, 61)}...` : canonicalName)}; generated z.never().`,
		});
		return createVariable(name, "z.never()", []);
	}

	const fields = descriptor.headers.map((header: ResponseHeaderDescriptor) => {
		if (
			header.resolution === "unresolved" ||
			header.resolution === "cycle" ||
			header.resolution === "external"
		) {
			options.onDiagnostic?.({
				code: "ZOD_RESPONSE_HEADER_REFERENCE_UNRESOLVED",
				message: `Response header ${JSON.stringify(header.sourceName)} has a ${header.resolution} reference; generated z.never() for its value.`,
			});
		}
		const schema = schemaTemplate(header.schema, header.canonicalName, "", options);
		const property =
			header.canonicalName === "__proto__"
				? `[${JSON.stringify(header.canonicalName)}]`
				: JSON.stringify(header.canonicalName);
		return `${property}: ${header.required ? schema : `${schema}.optional()`}`;
	});
	return createVariable(name, `z.looseObject({ ${fields.join(", ")} })`, []);
}
