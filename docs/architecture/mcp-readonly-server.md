# Read-only MCP server architecture

Status: accepted for the P2 read-only foundation (2026-07-18), extended by the Phase 1 trusted-target Operation Catalog. The configured read-only matrix is now eight Tools; historical P2 evidence below retains its original five-Tool wording.

## Decision

Phase 1 adds fixed target-list, operation-search, and single-contract Tools to the five-Tool P2 configured-mode foundation. See [Operation Catalog and bounded contract discovery](./operation-catalog.md) for the current 3/8/10 matrix and limits.

Publish an independent `@openapi-to/mcp` package that exposes eight bounded read-only MCP Tools over stdio. The server uses `@modelcontextprotocol/sdk` **1.30.0**, the repository's selected v1 maintenance-line package. The official SDK now has a separate v2 stable line with split packages; this repository remains on the monolithic v1 package because the current implementation, imports, and release surface have not adopted that migration. The package pins 1.30.0 in `package.json` and `pnpm-lock.yaml`; it uses Zod **4.6.3**, the repository's exact MCP runtime pin, so the package does not reintroduce a Zod 3 runtime alongside the repository's Zod 4 consumers.

The stable protocol target is MCP revision **2025-11-25**. The server does not hard-code a protocol version; the SDK performs initialization negotiation.

The SDK package itself declares Node.js 18 or newer. Repository development
and test commands require Node.js **22.13 or newer**, while every public
`openapi-to` runtime package retains a **22 or newer** `engines.node` floor.
`@openapi-to/mcp` therefore keeps the published-package runtime contract.

Primary references: [official TypeScript SDK v1 maintenance line](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x), [official TypeScript SDK v2 server package](https://github.com/modelcontextprotocol/typescript-sdk/tree/main/packages/server), [this server's protocol specification](https://modelcontextprotocol.io/specification/2025-11-25), and [tool schema](https://modelcontextprotocol.io/specification/2025-11-25/schema).

## Why stdio first

Codex and other local MCP Hosts can spawn stdio servers without a listening socket, HTTP routing, authentication, CORS, DNS-rebinding, session, or deployment surface. stdin and stdout remain MCP JSON-RPC only; all bounded logs and plugin incidental console output go to stderr. This MVP intentionally contains no Streamable HTTP server, OAuth, API key, resource, prompt, sampling, elicitation, task, Apps UI, or LLM code.

## Why stable SDK v1

`@modelcontextprotocol/sdk` 1.30.0 is the selected v1 maintenance-line package and supports the required `McpServer`, stdio transports, tool annotations, `outputSchema`, and `structuredContent`. The current v2 stable line uses split `@modelcontextprotocol/server` and `@modelcontextprotocol/client` packages and targets a newer protocol revision. Simultaneous v1/v2 compatibility would enlarge the protocol and test surface without a current repository requirement.

Migration to v2 remains a separate change. It requires an explicit compatibility decision, updated imports and package surface, a protocol/Host support review, and the complete stdio/schema/error/security/release matrix on the split packages. Streamable HTTP requires a separate deployment threat model, authentication decision, host/origin controls, session/load-balancing design, and operator demand.

## Direct Core boundary

The dependency direction is:

```text
MCP protocol adapter
        ↓
MCP application/security service
        ↓
@openapi-to/core public API
```

Tools call `compileOpenAPI`, `inspectOpenAPIDocument`, `diffOpenAPIDocuments`, `build`, Diagnostics, and Artifact/Manifest APIs directly. Spawning `openapi-to` and parsing CLI stdout would add process, presentation, escaping, error-code, and stdout-contamination failure modes and would couple one machine interface to another.

## Workspace boundary

Server creation canonicalizes one `workspaceRoot` with `realpath`. MCP validates local entry/config/output/check paths with resolved paths, `lstat`, `realpath`, and `relative`; it rejects traversal, absolute escapes, symlink escapes, Windows drive/UNC input on incompatible platforms, and output paths whose nearest existing ancestor escapes. Core's optional `localFileRoot` applies the same boundary during Loader and Resolver reads, so transitive local `$ref` cannot escape. CLI callers that omit this option retain prior behavior.

Artifact comparison retains Core's path confinement, symlink checks, managed ownership manifest, and case-folded collision detection. Dry-run and check call `build` only with non-writing modes and never call the writer.

## Trusted configuration

TypeScript/JavaScript configuration is executable project code. Only the server operator can select `--config`; Tool arguments cannot replace it, inject plugins/code/packages/shell/env, change output roots, or loosen network policy. The path must be inside the Workspace without a symlink escape. Core's shared loader uses a bundler boundary plugin that rejects bundled local config imports outside the Workspace before module execution. Bare installed package imports remain part of the operator-trusted project dependency graph.

The configuration Promise is created once per server and cached, including failure. A file change is not observed until the Host restarts the server. Generation tools are registered only when a startup config path is supplied, so `tools/list` stays stable for the connection.

## Read-only tools and state

Without config: `openapi_validate`, `openapi_inspect`, `openapi_diff`. With config: those plus `openapi_list_targets`, `openapi_search_operations`, `openapi_get_operation`, `openapi_generate_dry_run`, and `openapi_check_generation`. Catalog calls share a process-local, target-isolated compile Promise cache; other analysis calls use independent compile state and may run concurrently. Generation calls use one `GenerationLock` per server instance; the `finally` release prevents a failed call from blocking the queue, and instances share no lock.

All results use stable schemas, a short text summary, bounded `structuredContent`, sorted diagnostics/changes/artifacts, totals and omitted counts, and `MCP_RESULT_TRUNCATED` warnings. Expected execution failures return `isError: true`; invalid tool arguments and MCP lifecycle failures remain protocol-level errors. Sources, diagnostics, causes, and logs redact Workspace prefixes, URL credentials/query strings, authorization/cookie/token-like values, stack/config/document/generated bodies, and binary content.

The eight tools in this ADR remain read-only. P3 adds a separate operator-gated Prepare/Apply protocol with explicit authorization, plan binding, revalidation, filesystem locking, rollback, and crash recovery; see [controlled MCP generation write architecture](./mcp-controlled-write.md). It does not turn any existing tool into a writer or add a direct-write shortcut.

## Protocol smoke evidence

MCP Inspector **0.22.0** was checked against its current official CLI help and used against the built stdio bin on 2026-07-18. The successful and expected-error calls were:

```bash
npx --yes --package @modelcontextprotocol/inspector@0.22.0 \
  mcp-inspector --cli -- \
  node packages/mcp/bin/openapi-to-mcp.js --workspace-root . \
  --method tools/list

npx --yes --package @modelcontextprotocol/inspector@0.22.0 \
  mcp-inspector --cli -- \
  node packages/mcp/bin/openapi-to-mcp.js --workspace-root . \
  --method tools/call --tool-name openapi_validate \
  --tool-arg source=packages/mcp/src/fixtures/valid.yaml

npx --yes --package @modelcontextprotocol/inspector@0.22.0 \
  mcp-inspector --cli -- \
  node packages/mcp/bin/openapi-to-mcp.js --workspace-root . \
  --method tools/call --tool-name openapi_validate \
  --tool-arg source=../outside.yaml
```

The list exposed three tools without config, including input/output schemas and read-only annotations. The valid call returned OpenAPI 3.1.0; the escape returned `isError: true` and `MCP_WORKSPACE_PATH_OUTSIDE_ROOT`. The local npm wrapper attempted to start the Inspector UI when asked for its version, so the smoke invoked the installed 0.22.0 package CLI entry directly; this changes only command dispatch, not the Inspector client implementation.

Codex CLI was then run with an ephemeral, read-only session and configuration overrides matching `docs/codex-mcp.md`. Codex discovered `openapi_to` and called all five tools. Validate and inspect succeeded, diff returned one breaking and one non-breaking change, dry-run returned one planned artifact without creating its output directory, and check returned the expected structured outdated result without writing. The smoke used no committed machine-specific Codex configuration.

## P2.5 protocol and SDK revalidation

Revalidated on **2026-09-14** against the merged #89 dependency update and current repository tree: this server's v1 SDK target remains **1.30.0**, its exact MCP Zod runtime is **4.6.3**, and its negotiated protocol target remains **2025-11-25**. The official SDK now has a separate v2 stable line using split packages and the newer [2026-07-28 protocol revision](https://modelcontextprotocol.io/specification/2026-07-28); this repository has not migrated to that line, so the v2 protocol is not an implemented capability of this server. Inspector **0.22.0** is the version used by the historical smoke evidence below. Codex currently documents `startup_timeout_sec` (default 10 seconds) and `tool_timeout_sec` (default 60 seconds) for MCP servers.

Stable SDK v1 exposes `RequestHandlerExtra.signal`, `_meta.progressToken`, and `sendNotification`. The server therefore propagates request cancellation and emits only coarse standard `notifications/progress` notifications when a client supplied a token. It does not use experimental Tasks or hand-code cancellation/progress JSON-RPC. Sources: [cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation), [progress](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress), [TypeScript SDK v1 maintenance line](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x), and [Codex MCP configuration](https://developers.openai.com/codex/mcp/).

Server timeouts are invocation-scoped AbortSignals, separate from client and HTTP timeouts. Defaults are based on the versioned synthetic corpus and are bounded to 100–600000 ms. Timers and listeners are released in `finally`. Analysis has call-local state; generation is serialized per Server instance and a cancelled waiter releases its queue position only after the preceding position completes, preserving ordering.

Local source/config reads use opened handles plus pre/open/post identity and metadata checks. This narrows TOCTOU windows; it does not claim to eliminate all hostile same-user filesystem races. A detected change fails closed. Trusted config remains cached for the Server lifetime, so a config edit requires restart.

P2.5 Inspector smoke used the actual 0.22.0 bin and current help syntax:

```bash
npx --yes --package @modelcontextprotocol/inspector@0.22.0 \
  mcp-inspector --cli -- node packages/mcp/bin/openapi-to-mcp.js \
  --workspace-root . --method tools/list

npx --yes --package @modelcontextprotocol/inspector@0.22.0 \
  mcp-inspector --cli -- node packages/mcp/bin/openapi-to-mcp.js \
  --workspace-root . --method tools/call --tool-name openapi_validate \
  --tool-arg source=packages/mcp/src/evaluation/fixtures/large/openapi.json
```

It exposed exactly three no-config tools with input/output schemas, annotations, and task support forbidden; the 700-operation local validate succeeded. The escape case `source=../outside.yaml` returned `isError: true` and `MCP_WORKSPACE_PATH_OUTSIDE_ROOT`. stderr did not break the connection.

The real Codex CLI selection evaluation ran 17 independent ephemeral read-only sessions against the five-tool configured Server. It observed **100% tool selection**, **94.1% strict argument accuracy**, **0% unnecessary calls**, and **0% forbidden calls**. The single argument miss omitted the optional target restriction for dry-run; because the fixture config has one target, execution remained read-only and selected the intended startup-trusted target. The fixed threshold is 80% tool/argument accuracy and at most 10% unnecessary calls.
