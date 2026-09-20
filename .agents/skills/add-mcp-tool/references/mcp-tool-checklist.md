# MCP tool checklist

## Contract

- Stable `openapi_*` name, title, limitation-aware description.
- Bounded Zod input and output schemas visible in `tools/list`.
- `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true` only when truthful and supported by the installed stable SDK.
- Short `content` summary and non-duplicated, JSON-safe `structuredContent` matching `outputSchema`.
- `isError: true` for expected compilation, Workspace, config, plugin, stale-generation, remote-policy, and result-limit failures.
- Protocol error only for unknown tools, invalid arguments, lifecycle, or SDK/protocol failure.

## Security and limits

- Direct Core API call; no CLI subprocess.
- Workspace covers entry, transitive refs, config/imports, output/check/manifest, symlinks, traversal, Windows paths, and case folding.
- Tool cannot select config/plugins/Workspace/output, execute code/shell, set env, or relax remote/private-network policy.
- Stable sort before truncation; errors and breaking changes receive priority.
- Preserve totals/returned/omitted counts and add `MCP_RESULT_TRUNCATED` when bounded.
- No full document, full generated output by default, binary Base64, stack, secrets, URL credentials/query, environment dump, config source, or absolute machine paths.

## Runtime

- stdin/stdout contain JSON-RPC only; stderr contains bounded sanitized logs.
- Plugin `console.log/info/debug` cannot corrupt stdout.
- Analysis state is call-local; generation lock is per server and releases in `finally`.
- SDK request cancellation and bounded Server timeout use call-local signals; active and queued generation release cleanly, timers/listeners are removed, and cancellation is not mislabeled as generic execution failure.
- Optional progress uses only stable standard notifications, a client-supplied token, coarse monotonic phases, and stops after cancellation/completion.
- Text/NDJSON logs contain duration/status/counts only; no arguments, documents, generated content, headers, environment, or config source.
- No resources, prompts, sampling, elicitation, Apps UI, LLM calls, background tasks, or HTTP half-implementation.

## Tests and release

- Package/root script: place the test in the correct package-owned `test:*` layer and expose only a short root `test:mcp:*` route; missing files or zero collected tests fail.
- Unit: schemas, success/error, ordering, sanitization, limits, target/config/remote policy.
- Security: relative/absolute inside, traversal, transitive ref, symlink entry/ref/output/config, Windows drive/UNC, case conflict, missing file, URL redaction.
- stdio subprocess: initialize, list, schemas, annotations, call, structured content, error, stderr, clean close, no stdout pollution.
- Hardening: remote/inspect/diff/generation cancellation, Tool timeout, queue wait cancellation, disconnect, SIGINT/SIGTERM/EOF, two Server instances, and no timer/listener/handle leak.
- Safety races: source/config/ref/output/manifest replacement fails closed; document residual TOCTOU limits.
- Evaluation: fixed licensed local small/medium/large/pathological corpus, multi-run machine-readable benchmark, bounded stress test, and real Codex selection/argument/no-call rates.
- Matrix: 3 analysis Tools without config; 8 Developer or 8 Read-only Tools with fixed trusted config; 10 Hardened Tools with trusted config plus Prepare/Apply capability.
- Doctor: update the synthetic 3/8/8/10 matrix, schemas/annotations, core call, cleanup, and stable JSON report without persisting tokens or output bodies.
- CI: keep a named Node 22 stdio E2E job plus Linux/Windows/macOS built-bin smoke; do not depend only on Quality's indirect root Vitest discovery.
- Determinism: repeat results byte-stably without time/random/temp paths.
- Run official Inspector through the authenticated localhost foreground launcher for Tool discovery and user-visible results. Keep failpoint/crash/cancellation synchronization in automated tests. Run Codex smoke with current official config fields when policy permits.
- Check package exports/bin/files/engines, project references, package-surface script, tarball install smoke, fixed Changesets group, and SemVer.
- Never add a write tool without separate explicit user authorization.
