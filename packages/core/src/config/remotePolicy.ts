import type { RemoteSourceOptions } from "../types";

export interface ResolveRemoteSourcePolicyOptions {
	targetRemote?: RemoteSourceOptions;
	/** Operator-owned upper bounds. Omitting this layer preserves CLI behavior. */
	operatorPolicy?: Omit<RemoteSourceOptions, "headers">;
	targetName?: string;
}

export function remoteSourcePolicyIdentity(
	remote: RemoteSourceOptions | undefined,
): string {
	return JSON.stringify({
		allowedHosts: normalizedHosts(remote?.allowedHosts),
		headers: Object.entries(remote?.headers ?? {}).sort(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0,
		),
		timeoutMs: remote?.timeoutMs,
		maxResponseBytes: remote?.maxResponseBytes,
		maxRedirects: remote?.maxRedirects,
	});
}

function normalizedHosts(hosts: readonly string[] | undefined): string[] {
	return [...new Set((hosts ?? []).map((host) => host.toLowerCase()))].sort();
}

function wildcardSuffix(pattern: string): string | undefined {
	return pattern.startsWith("*.") ? pattern.slice(1) : undefined;
}

function hostMatchesPattern(host: string, pattern: string): boolean {
	const suffix = wildcardSuffix(pattern);
	return suffix
		? host.endsWith(suffix) && host.length > suffix.length
		: host === pattern;
}

function intersectHostPattern(left: string, right: string): string | undefined {
	if (left === right) return left;
	const leftSuffix = wildcardSuffix(left);
	const rightSuffix = wildcardSuffix(right);
	if (!leftSuffix && hostMatchesPattern(left, right)) return left;
	if (!rightSuffix && hostMatchesPattern(right, left)) return right;
	if (leftSuffix && rightSuffix) {
		if (leftSuffix.endsWith(rightSuffix)) return left;
		if (rightSuffix.endsWith(leftSuffix)) return right;
	}
	return undefined;
}

function intersectAllowedHosts(
	targetHosts: readonly string[] | undefined,
	operatorHosts: readonly string[] | undefined,
): string[] | undefined {
	const target = normalizedHosts(targetHosts);
	const operator = normalizedHosts(operatorHosts);
	if (target.length === 0) return operator.length > 0 ? operator : undefined;
	if (operator.length === 0) return target;
	const intersection = new Set<string>();
	for (const targetPattern of target) {
		for (const operatorPattern of operator) {
			const pattern = intersectHostPattern(targetPattern, operatorPattern);
			if (pattern) intersection.add(pattern);
		}
	}
	return [...intersection].sort();
}

function minimum(
	left: number | undefined,
	right: number | undefined,
): number | undefined {
	if (left === undefined) return right;
	if (right === undefined) return left;
	return Math.min(left, right);
}

/**
 * Resolve trusted Target access requirements against an optional operator-owned
 * upper bound on extra derived cross-origin grants. A disjoint intersection grants
 * no extra hosts and does not block caller-authorized roots. Headers always come only from the trusted Target layer.
 */
export function resolveRemoteSourcePolicy({
	targetRemote,
	operatorPolicy,
}: ResolveRemoteSourcePolicyOptions): RemoteSourceOptions | undefined {
	if (!operatorPolicy) {
		return targetRemote
			? {
					...targetRemote,
					...(targetRemote.allowedHosts
						? { allowedHosts: normalizedHosts(targetRemote.allowedHosts) }
						: {}),
					...(targetRemote.headers
						? { headers: { ...targetRemote.headers } }
						: {}),
				}
			: undefined;
	}
	const allowedHosts = intersectAllowedHosts(
		targetRemote?.allowedHosts,
		operatorPolicy.allowedHosts,
	);
	return {
		...(allowedHosts ? { allowedHosts } : {}),
		...(targetRemote?.headers ? { headers: { ...targetRemote.headers } } : {}),
		...(minimum(targetRemote?.timeoutMs, operatorPolicy.timeoutMs) !== undefined
			? {
					timeoutMs: minimum(targetRemote?.timeoutMs, operatorPolicy.timeoutMs),
				}
			: {}),
		...(minimum(
			targetRemote?.maxResponseBytes,
			operatorPolicy.maxResponseBytes,
		) !== undefined
			? {
					maxResponseBytes: minimum(
						targetRemote?.maxResponseBytes,
						operatorPolicy.maxResponseBytes,
					),
				}
			: {}),
		...(minimum(targetRemote?.maxRedirects, operatorPolicy.maxRedirects) !==
		undefined
			? {
					maxRedirects: minimum(
						targetRemote?.maxRedirects,
						operatorPolicy.maxRedirects,
					),
				}
			: {}),
	};
}
