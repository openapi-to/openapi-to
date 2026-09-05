export const SCHEMA_VERSION = 2;
export const DIAGNOSTIC_KIND = "openapi-to-ci-diagnostic";
export const COMMAND_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const COMMAND_STATUSES = Object.freeze([
	"success",
	"failure",
	"timeout",
	"signalled",
	"cancelled",
	"not-run",
	"infrastructure-error",
]);
export const MAX_TAIL_LINES = 100;
export const MAX_LINE_CHARS = 1_024;
export const MAX_ERROR_CANDIDATES = 10;
export const MAX_COMMAND_REPORT_BYTES = 256 * 1024;
export const MAX_PLAN_BYTES = 64 * 1024;
export const MAX_DIAGNOSTIC_BYTES = 256 * 1024;
export const MAX_SUMMARY_CHARS = 24 * 1024;
export const MAX_KNOWN_REPORT_BYTES = 8 * 1024 * 1024;
export const MAX_NORMALIZED_REPORT_BYTES = 256 * 1024;
export const MAX_ARTIFACT_MANIFEST_BYTES = 64 * 1024;
export const ARTIFACT_RETENTION_DAYS = 14;
export const STEP_STATUSES = Object.freeze([
	"success",
	"failure",
	"cancelled",
	"skipped",
	"unknown",
]);

export function assertCommandId(value) {
	if (!COMMAND_ID_PATTERN.test(value ?? "")) {
		throw new Error(
			"Command id must contain only lowercase letters, digits, and single hyphens.",
		);
	}
	return value;
}

export function jsonBytes(value) {
	return Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`);
}

export function stableObject(entries) {
	return Object.fromEntries(
		entries
			.filter(([, value]) => value !== undefined)
			.sort(([left], [right]) => left.localeCompare(right)),
	);
}
