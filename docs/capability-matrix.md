# Capability matrix

本文是 shipped `openapi-to` capabilities 的唯一 status reference。Package manifests、root README 和 release checks 都链接到这里，而不是维护重复的 feature checklist。

## Status definitions

| Status | 含义 |
| --- | --- |
| Stable | 已发布、由 maintained tests 覆盖，并属于 supported public contract。 |
| Experimental | 已发布供评估，但 contract 仍可能变化。 |
| Partial | 已发布，但范围有明确边界或仍有已诊断 gaps。 |
| Planned | 已列入 roadmap，尚未发布；不要配置或依赖。 |
| Not Supported | Repository 中没有 official package 或 supported implementation。 |

<!-- Repository contract compatibility marker: | Not supported |; canonical capability status is `Not Supported`. -->

## Code generation

| Capability | Status | Package/export | Scope |
| --- | --- | --- | --- |
| TypeScript types | Stable | `@openapi-to/plugin-ts-type` / `pluginTSType` | Component 和 operation types。支持 primitive、array、object、enum、composition、nullable、type-array、boolean 和 `$ref`-sibling components，并通过 shared schema renderer 生成 named exports。Boolean `true`/`false` 映射为 `unknown`/`never`；schema-valued `additionalProperties` 作为 index value，必要时纳入 fixed-property types；recursive components 使用 local declarations。Path/query/header/cookie parameters 共用 requiredness，以及 Parameter Object `schema`/first-declared-`content` handling。 |
| TypeScript request client | Stable | `@openapi-to/plugin-ts-request` / `pluginTSRequest` | 生成 request functions，并遵循现有 configurable client/import contract。会生成 header/cookie types 和 Zod schemas，但 request method signature 不增加独立的 header/cookie parameters；调用方使用 request/client configuration。因此不宣称 browser/Node cookie transport 或 header merge precedence 已完整支持。 |
| Zod schemas | Partial | `@openapi-to/plugin-zod` / `pluginZod` | 仅支持 Zod 4 的 component 和 operation schemas。Path/query/header/cookie parameters 使用统一 requiredness；Parameter Object `content` 选择第一个 Media Type，缺少 `schema` 时为 `z.unknown()`，`schema: false` 为 `z.never()`。Concrete `2xx`/`2XX` 组成 success aggregate；concrete/wildcard `1xx` 和 `3xx`–`5xx` 组成 non-success aggregate；`default` 在没有 2xx 时才属于 success。无 response content 时为 `z.undefined()`；response headers 尚未生成 validators。`oneOf` 是普通 union，不是 exact-one。 |
| SWR hooks | Stable | `@openapi-to/plugin-swr` / `pluginSWR` | 基于 generated operation metadata 生成 SWR hooks。 |
| Vue Query hooks | Stable | `@openapi-to/plugin-vue-query` / `pluginVueQuery` | 基于 generated operation metadata 生成 Vue Query hooks。 |
| MSW handlers | Stable | `@openapi-to/plugin-msw` / `pluginMSW` | 生成 Mock Service Worker handlers。 |
| Faker generator | Not Supported | None | 没有 official package、aggregate export 或 published runtime。 |
| NestJS generator | Not Supported | None | 没有 official package、aggregate export 或 published runtime。 |
| React Query generator | Not Supported | None | 已发布 Vue Query；没有 official React Query package。 |

aggregate `openapi-to` package re-export Core 和以上六个 official generator factories，并在 runtime 依赖 MCP runtime 以提供 `openapi-to-mcp` command。MCP server internals 不会从 aggregate JavaScript API re-export。

## OpenAPI inputs

| Input/dialect | Status | Actual boundary |
| --- | --- | --- |
| JSON、YAML 和 YML | Stable | Local/object 和受策略约束的 HTTP(S) loading 使用 content-aware parsing；URL suffix 只是提示。 |
| Swagger 2.0 | Stable | 在 resolution 和 validation 前转换为 legacy-compatible OpenAPI document，并产生 conversion diagnostics。 |
| OpenAPI 3.0 | Stable | 对 official plugins 覆盖的 constructs 执行 read、resolve、validate、normalize、inspect、diff 和 generate。 |
| OpenAPI 3.1 | Stable | 对 official plugins 覆盖的 constructs 执行 read、resolve、validate、normalize、inspect、diff 和 generate；不代表所有 JSON Schema vocabulary 都改变每个 generator。 |
| OpenAPI 3.2 | Partial | 兼容读取并对 3.2-specific gaps 给出 diagnostics。`$self` 参与 reference-base resolution；现有 generators 不为 3.2-only `query`、`additionalOperations`、`querystring`、streaming `itemSchema`/encoding fields 或 tag hierarchy 生成代码。 |
| External local `$ref` | Stable | 在配置的 local-file/Workspace boundary 内解析，并对 cycle 和 missing target 给出 diagnostics。 |
| Remote documents 和 `$ref` | Stable | 仅 HTTP(S)；Target requirements 与 MCP operator bounds 求交集。Origin-aware redirects 会跨 Origin 清除 configured headers，并在每一 hop 保留 DNS/host/private-network/timeout/size limits。 |

“Stable” 只表示上表列出的 maintained contract，不表示每个 OpenAPI 或 JSON Schema dialect 的每个 keyword 都完整实现。

## CLI

已发布的 `openapi-to` package 安装两个执行同一 entrypoint 的 CLI aliases（`openapi` 和 `openapi-to`），以及独立的 `openapi-to-mcp` stdio command。

| Command | Status | Contract |
| --- | --- | --- |
| `init` | Stable | 创建 project configuration scaffold。 |
| `generate` / `g` | Stable | 按 config order 生成全部 Target，或使用可重复的 `--target` 选择；支持 write、`--dry-run` 和 selected-only `--check`，并使用 deterministic comparison 与 ownership cleanup。 |
| `validate` | Stable | 产生 compilation diagnostics，并可用 warning failure。 |
| `inspect` | Stable | 生成 deterministic、bounded 的 document summary。 |
| `diff` | Partial | Command 及 JSON/exit-code contract 稳定；comparison rules 是 deterministic first stage，不是完整 breaking-change oracle。 |
| `--json` | Stable | stdout 恰好一个 JSON document；diagnostics 和 incidental logs 留在 stderr。 |
| Exit codes | Stable | 使用 centralized `ExitCode`、`exitCodeForDiagnostics()` 和 `process.exitCode` handling。 |

Generation 支持独立的 `managed`（默认 `.openapi-to/<dir>`）和 `workspace` output bases。两者都由 generator 管理，会拒绝 protected/escaping/symlinked/overlapping Target roots 和 non-portable Windows device/character/trailing-dot-or-space segments，并将 ownership 保存在每个 output root 内。Native Windows absolute inputs 只有在 Workspace 内才接受；drive-relative、UNC 和 configured `file:` inputs 会被拒绝。Multi-Target CLI writes 使用 per-Target transaction boundary，不是一个跨 root transaction。

## MCP

aggregate installation 通过对 `@openapi-to/mcp` 的 runtime dependency 提供 local stdio server。`@openapi-to/mcp` 仍可作为 advanced/internal entrypoint 独立发布，但不增加 code-generation plugins。

| Mode | Status | Tools | Writes |
| --- | --- | --- | --- |
| No config | Stable | 3：validate、inspect、diff | None |
| Trusted config | Stable | 8：以上 3 个 analysis Tools，加 target listing、operation search、one-operation contract reading、generation dry-run 和 generation check | None |
| Trusted config plus `--allow-write` | Stable | 10：以上 8 个，加 Prepare 和 Apply | 仅已有 two-phase、plan-bound transaction |

Server 不支持 Streamable HTTP、OAuth、server API keys、multi-tenancy、LLM calls、chat UI、background tasks、telemetry、arbitrary writes、OpenAPI/config editing 或 business API execution。参阅 [MCP security](./mcp-security.md) 和 [MCP limitations](./mcp-limitations.md)。

## Evidence and maintenance

本表依据当前 package directories 和 aggregate exports、CLI command registration 与 integration tests、Core dialect fixtures/diagnostics、MCP Tool registration/schema tests，以及 real packed-package installation smoke tests 维护。`pnpm verify:package-surface`、`pnpm release:smoke` 和 `pnpm test:release-scripts` 会检查这里引用的 package、binary、script 和文档关系。
