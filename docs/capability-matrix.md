# Capability matrix

This document is the single status reference for shipped `openapi-to` capabilities. Package manifests, the root README, and release checks link here instead of maintaining separate feature checklists.

## Status definitions

| Status | Meaning |
| --- | --- |
| Stable | Shipped, covered by maintained tests, and part of the supported public contract. |
| Experimental | Shipped for evaluation, but its contract may still change. |
| Partial | Shipped with an explicitly bounded scope or diagnosed gaps. |
| Planned | Intentionally on the roadmap but not shipped. Do not configure or depend on it. |
| Not supported | No official package or supported implementation exists in this repository. |

## Code generation

| Capability | Status | Package/export | Scope |
| --- | --- | --- | --- |
| TypeScript types | Stable | `@openapi-to/plugin-ts-type` / `pluginTSType` | Component and operation types. Primitive, array, object, enum, composition, nullable, type-array, boolean, and `$ref`-sibling components emit named exports through the shared schema renderer. Boolean `true`/`false` map to `unknown`/`never`, including properties. Schema-valued `additionalProperties` is the index value, widened with fixed-property types when required for a compilable interface. Recursive components use local declarations without self-imports. Path/query/header/cookie parameters share requiredness and Parameter Object `schema`/first-declared-`content` handling. Response Media Types without `schema` map to `unknown`, responses without content map to `undefined`, and per-status members remain declared before aggregation. Under the current uniform OpenAPI 3.0/3.1 policy, schema `$ref` siblings are simultaneous constraints: `anyOf`/`oneOf` become `Ref & (A \| B)`, `allOf` members are intersected, and nullable remains `Ref \| null`. Scalar `$ref + enum/const` siblings become intersections with the enum/literal constraint. `oneOf` is not exact-one. |
| TypeScript request client | Stable | `@openapi-to/plugin-ts-request` / `pluginTSRequest` | Request functions with the existing configurable client/import contract. Header/cookie types and Zod schemas are generated, but the request method signature does not add independent header/cookie parameters; callers use request/client configuration. Browser/Node cookie transport and header merge precedence are therefore not claimed as complete. |
| Zod schemas | Partial | `@openapi-to/plugin-zod` / `pluginZod` | Zod 4-only component and operation schemas with category-aware reference names. Request path/query/header/cookie parameters use one classification and requiredness model; Parameter Object `content` selects the first declared Media Type, maps a missing selected schema to `z.unknown()`, and preserves `schema:false` as `z.never()`. Concrete 2xx and `2XX` form the success aggregate; concrete/wildcard 1xx and 3xx–5xx form the non-success aggregate; `default` is success only when no 2xx exists and otherwise is non-success. Response Media Type Objects without `schema` map to `z.unknown()` while responses without content map to `z.undefined()`. OpenAPI 3.1 `true`/`{}`/`false` map to `z.unknown()`/`z.unknown()`/`z.never()`, including parameter and body entry points. Response headers are not validated and header references do not become body imports. `date-time` accepts calendar-valid values with required seconds and `Z` or a bounded numeric offset, but excludes leap seconds. `int32` is bounded; plain `integer` and `int64` are JavaScript safe-integer numbers, not the complete int64 domain. Supported validation siblings are intersected and known unsafe combinations are diagnosed; preserved `$ref` siblings currently use this uniform policy rather than dialect-specific 3.0/3.1 rendering. Recursive runtime validation and precise `z.infer` output types are maintained for structurally guarded direct-object, array, schema-valued map, and mutually recursive component shapes; runtime cycles remain guarded by `z.lazy()`. Unguarded composition cycles that TypeScript cannot express use a bounded `unknown` output fallback. `oneOf` uses ordinary union rather than exact-one semantics. Zod 3 is not supported. |
| SWR hooks | Stable | `@openapi-to/plugin-swr` / `pluginSWR` | SWR hooks built on generated operation metadata. |
| Vue Query hooks | Stable | `@openapi-to/plugin-vue-query` / `pluginVueQuery` | Vue Query hooks built on generated operation metadata. |
| MSW handlers | Stable | `@openapi-to/plugin-msw` / `pluginMSW` | Mock Service Worker handler generation. |
| Faker generator | Not supported | None | No official package, aggregate export, or published runtime exists. |
| NestJS generator | Not supported | None | No official package, aggregate export, or published runtime exists. |
| React Query generator | Not supported | None | Vue Query is shipped; an official React Query package is not. |

The aggregate `openapi-to` package re-exports Core plus the six official generator factories above and depends on the MCP runtime so it can provide the `openapi-to-mcp` command. MCP server internals are not re-exported from the aggregate JavaScript API.

## OpenAPI inputs

| Input/dialect | Status | Actual boundary |
| --- | --- | --- |
| JSON, YAML, and YML | Stable | Local/object and policy-constrained HTTP(S) loading share content-aware parsing; URL suffixes are only a hint. |
| Swagger 2.0 | Stable | Converted into the legacy-compatible OpenAPI document before resolution and validation; conversion is diagnosed. |
| OpenAPI 3.0 | Stable | Read, resolve, validate, normalize, inspect, diff, and generate for the constructs covered by official plugins. |
| OpenAPI 3.1 | Stable | Read, resolve, validate, normalize, inspect, diff, and generate for the constructs covered by official plugins. This is not a claim that every JSON Schema vocabulary changes every generator. |
| OpenAPI 3.2 | Partial | Compatible reading and diagnostics only for 3.2-specific gaps. `$self` participates in reference-base resolution; standard document/operation content remains readable. Existing generators do not emit code for 3.2-only `query`, `additionalOperations`, `querystring`, streaming `itemSchema`/encoding fields, or tag hierarchy. |
| External local `$ref` | Stable | Resolved inside the configured local-file/Workspace boundary with cycle and missing-target diagnostics. |
| Remote documents and `$ref` | Stable | HTTP(S) only; Target requirements intersect MCP operator bounds. Origin-aware redirects clear configured headers cross-Origin, block HTTPS downgrade, and retain DNS/host/private-network/timeout/size limits on every hop. |

“Stable” describes the maintained contract above; it does not mean complete implementation of every keyword in every OpenAPI or JSON Schema dialect.

## CLI

The published `openapi-to` package installs two CLI aliases that execute the same entrypoint (`openapi` and `openapi-to`) plus the separate `openapi-to-mcp` stdio command.

| Command | Status | Contract |
| --- | --- | --- |
| `init` | Stable | Creates the project configuration scaffold. |
| `generate` / `g` | Stable | All-Target or repeatable `--target` selection in config order, plus write, `--dry-run`, and selected-only `--check` with deterministic comparison and ownership cleanup. |
| `validate` | Stable | Compilation diagnostics and optional warning failure. |
| `inspect` | Stable | Deterministic bounded document summary. |
| `diff` | Partial | The command and JSON/exit-code contract are stable; the comparison rules are a deterministic first stage, not a complete breaking-change oracle. |
| `--json` | Stable | Exactly one JSON document on stdout; diagnostics and incidental logs stay on stderr. |
| Exit codes | Stable | Central `ExitCode`, `exitCodeForDiagnostics()`, and `process.exitCode` handling. |

Generation supports independent `managed` (default `.openapi-to/<dir>`) and `workspace` output bases. Both are generator-owned, reject protected/escaping/symlinked/overlapping Target roots and non-portable Windows device/character/trailing-dot-or-space segments, and keep ownership inside each output root. Native Windows absolute inputs are accepted only inside the Workspace; drive-relative, UNC, and configured `file:` inputs are rejected. Multi-Target CLI writes have per-Target transaction boundaries, not one cross-root transaction.

## MCP

The aggregate installation provides the local stdio server through its runtime dependency on `@openapi-to/mcp`. The MCP package remains independently publishable as an advanced/internal entrypoint and does not add code-generation plugins.

| Mode | Status | Tools | Writes |
| --- | --- | --- | --- |
| No config | Stable | 3: validate, inspect, diff | None |
| Trusted config | Stable | 8: the 3 analysis tools plus target listing, operation search, one-operation contract reading, generation dry-run, and generation check | None |
| Trusted config plus `--allow-write` | Stable | 10: the configured 8 plus Prepare and Apply | Only the existing two-phase, plan-bound transaction |

The server does not support Streamable HTTP, OAuth, server API keys, multi-tenancy, LLM calls, chat UI, background tasks, telemetry, arbitrary writes, OpenAPI/config editing, or business API execution. See [MCP security](./mcp-security.md) and [MCP limitations](./mcp-limitations.md).

## Evidence and maintenance

The matrix is derived from current package directories and aggregate exports, CLI command registration and integration tests, Core dialect fixtures/diagnostics, MCP Tool registration/schema tests, and real packed-package installation smoke tests. `pnpm verify:package-surface`, `pnpm release:smoke`, and `pnpm test:release-scripts` guard the package, binary, script, and documentation references used here.
