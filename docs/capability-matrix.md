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

Zod schemas 已按 #188 Delta Final Stable Gate 审计结果标记为 Stable；其 bounded contract 与限制见下表。Peer range 是 `^4.3.0`。`test:consumer:codegen` 验证当前 Zod profile，`test:consumer:codegen:zod-peer-floor` 从 public `catalog:zod-peer` 经 `semver.minVersion()` 推导 exact floor，在 packed external consumer 中验证类型、运行时语义和 determinism。对象 rendering context 中，`required` 的声明与未声明名称都由 own-property presence guard 校验：缺失 key 拒绝，显式 `undefined` 按当前 Zod 行为接受；`properties` 与 `additionalProperties` 继续负责 value validation。没有显式 type、properties 或 additionalProperties object context 的 `required` 产生 `ZOD_UNSUPPORTED_REQUIRED_WITHOUT_OBJECT_CONTEXT` error diagnostic，并以 `z.never()` fail closed。

| Capability | Status | Package/export | Scope |
| --- | --- | --- | --- |
| TypeScript types | Stable | `@openapi-to/plugin-ts-type` / `pluginTSType` | Component 和 operation types。支持 primitive、array、object、enum、composition、nullable、type-array、boolean 和 `$ref`-sibling components，并通过 shared schema renderer 生成 named exports。Boolean `true`/`false` 映射为 `unknown`/`never`；显式 object Schema 中 `properties` 外的 required 名称保留存在性，value type 取自 effective `additionalProperties`：省略或 `true` 为 `unknown` 且保留任意额外属性，schema-valued 使用对应类型，`false` 以必需 `never` 属性表示不可满足组合。schema-valued index signature 必要时沿用 fixed-property widening；recursive components 使用 local declarations。Path/query/header/cookie parameters 共用 requiredness，以及 Parameter Object `schema`/first-declared-`content` handling。 |
| TypeScript request client | Stable | `@openapi-to/plugin-ts-request` / `pluginTSRequest` | 生成 grouped `request(input, requestConfig?)` functions；effective OpenAPI Header `schema` parameters 使用 simple serialization（primitive、array、flat object），requiredness 决定 `RequestInput.headers` 是否必需。Cookie parameters 加入 `RequestInput.cookies` 并由其 requiredness 决定输入可选性。Cookie Header transport 默认关闭；调用方提供 Cookie 或 operation 要求 Cookie 时，在 dispatch 前 fail closed。显式 `cookieTransport: "header"` 仅适用于允许程序化设置 Cookie Header 的 runtime/adapter。OAS 3.0/3.1 `style: form` 仅支持无需 percent-encoding 的 primitive；OAS 3.2 `style: cookie` 支持 tested primitive、flat array、flat object 的 `explode: true` 组合；content、nested 和其它组合 fail closed。无自动 encoding、quoting 或 escaping；Header precedence 为 generated/system < typed headers < serialized cookies→`Cookie` < explicit `requestConfig.headers`。Browser explicit Cookie injection 和 Fetch transport 不支持。Zod parser 在 dispatch 前复用 Header/Cookie schema；Axios 使用 `AxiosHeaders`; Common client 只接受 plain object/record。React Query、Vue Query、SWR 转发 typed Cookie options，不将值放进 keys、mutation variables、SWR mutation arg 或 infinite params。 |
| Zod schemas | Stable | `@openapi-to/plugin-zod` / `pluginZod` | 仅支持 Zod 4.3+ 的 component 和 operation schemas。Schema Object `$ref` siblings 按源 OAS dialect 处理：3.0 忽略，3.1/3.2 保留当前支持的 validation siblings。对当前 maintained dialect 中已知、会影响 validation truth 但尚未实现的标准 validation keywords，产生 deterministic error diagnostic，并将整个 schema entrypoint fail closed 为 `z.never()`；任意未知 keyword、annotations 与 `x-*` extensions 不会被机械拒绝。这不代表支持所有 JSON Schema vocabulary。Reference Objects 继续走现有的专用处理。`oneOf` runtime validators 要求恰好一个分支匹配，`anyOf` 保持至少一个匹配；inferred TypeScript types 保持 union。Path/query/header/cookie parameters 使用统一 requiredness；单项 Parameter Object `content` 缺少 `schema` 时为 `z.unknown()`，`schema: false` 为 `z.never()`；违反 OAS cardinality 的多项 Parameter/Header content 由 Core error 诊断拒绝，Zod entrypoint 也生成 `z.never()`。无安全 object rendering context 的 `required` 产生 error diagnostic 并将 schema entrypoint 设为 `z.never()`。单媒体 RequestBody/Response 保持现有行为。多个合法 RequestBody/Response media entries 在缺少 Content-Type-aware validation context 时产生 `ZOD_MULTIPLE_MEDIA_TYPES_UNSUPPORTED` error 并生成 `z.never()`；不选择首项或用 union 扩宽验证。任一多媒体 status 会令对应 success/error aggregate 整体为 `z.never()`。Concrete `2xx`/`2XX` 组成 success aggregate；concrete/wildcard `1xx` 和 `3xx`–`5xx` 组成 non-success aggregate；`default` 在没有 2xx 时才属于 success。无 response content 时为 `z.undefined()`。Response Object headers 生成 status-specific `z.looseObject` validators，使用 ASCII 小写 canonical key 校验逻辑响应头记录；支持 Header Object `schema` / 单一 `content` schema、requiredness 和 local Header/schema refs；未知字段放行，Content-Type 忽略，canonical name 冲突以 diagnostic 和 `z.never()` fail closed。它们不解析 raw HTTP headers，也不包含 Encoding Object headers。 |

`format: date-time` 保持 `string` input/output 与推断类型，并要求带 seconds 和 timezone 的当前 uppercase RFC3339-qualified 形式。普通时间戳使用 Zod ISO validation；positive leap-second `:60` 仅当以合法 offset 归一后落在 UTC 月末插入位置时接受，包括 RFC3339 UTC 和 numeric-offset 示例。fractional leap second 沿用相同位置规则。此 bounded profile 不维护 IERS 实际事件表，也不验证历史/未来事件是否确实发生或建模 negative leap-second schedule。
| SWR hooks | Stable | `@openapi-to/plugin-swr` / `pluginSWR` | 基于 generated operation metadata 生成 SWR hooks。 |
| Vue Query hooks | Stable | `@openapi-to/plugin-vue-query` / `pluginVueQuery` | 基于 generated operation metadata 生成 Vue Query hooks。 |
| MSW handlers | Stable | `@openapi-to/plugin-msw` / `pluginMSW` | 生成 Mock Service Worker handlers。 |
| Faker generator | Not Supported | None | 没有 official package、aggregate export 或 published runtime。 |
| NestJS generator | Not Supported | None | 没有 official package、aggregate export 或 published runtime。 |
| React Query generator | Stable | `@openapi-to/plugin-react-query` / `pluginReactQuery` | 生成 TanStack Query v5 的 operation-local query/mutation keys、options factories 和可选 thin React hooks。真实 packed consumer 已验证 QueryClient imperative usage、React hooks、typed mutations、select/error inference、AbortSignal/config boundary、aggregate/direct exports 与 deterministic regeneration；Core selective projection 由对应 integration test 验证。Consumer 仍必须自行提供 React 与 `@tanstack/react-query`。 |

Zod 的 `type: integer`（包括 `format: int64`）保持 JavaScript `number` 表示，并使用 `z.int()` safe-integer 校验，精确范围为 `Number.MIN_SAFE_INTEGER` 至 `Number.MAX_SAFE_INTEGER`。对于 `format: int64`，OpenAPI 定义的 full signed 64-bit 范围无法由 JavaScript number 精确表示；超出 safe-integer 范围的值（包括解析后已丢失精度的 JSON number）会被拒绝，并通过 `ZOD_INT64_SAFE_INTEGER_ONLY` warning 暴露该 format 边界。Generated TypeScript 与 Zod inference 仍为 `number`；当前不把 bigint 或 string 纳入该 contract。

aggregate `openapi-to` package re-export Core 和以上七个 official generator factories，并在 runtime 依赖 MCP runtime 以提供 `openapi-to-mcp` command。MCP server internals 不会从 aggregate JavaScript API re-export。

## OpenAPI inputs

| Input/dialect | Status | Actual boundary |
| --- | --- | --- |
| JSON、YAML 和 YML | Stable | Local/object 和受策略约束的 HTTP(S) loading 使用 content-aware parsing；URL suffix 只是提示。 |
| Swagger 2.0 | Stable | 在 resolution 和 validation 前转换为 legacy-compatible OpenAPI document，并产生 conversion diagnostics。 |
| OpenAPI 3.0 | Stable | 对 official plugins 覆盖的 constructs 执行 read、resolve、validate、normalize、inspect、diff 和 generate。 |
| OpenAPI 3.1 | Stable | 对 official plugins 覆盖的 constructs 执行 read、resolve、validate、normalize、inspect、diff 和 generate；不代表所有 JSON Schema vocabulary 都改变每个 generator。 |
| OpenAPI 3.2 | Stable | Bounded maintained Core/compiler contract：deterministic read、`$self`-aware resolve、validate、normalize、inspect、catalog、diff、selective project 与 generation。`$self` 作为 reference base 使用并在 projection 保留；Tag `parent` 缺失、循环和重复名称由 Core error diagnostics 拒绝，选中 child 时保留完整 ancestor Tag Objects 及其 metadata。`info.summary` 与 Example `dataValue` / `serializedValue` 是 preserve-only metadata，不改变 generated TypeScript；规范互斥的 Example 字段组合由 Core error diagnostics 拒绝。没有通用的 `not generated` 或 compatibility-mode warning。Core 统一发现 `query` 与 `additionalOperations`，并在 catalog、inspect、diff 和 projection 中保留 custom method 的精确大小写。TypeScript types、Zod 和 request plugin 支持两者；React Query、Vue Query 和 SWR 支持 body-aware `QUERY`，但对未知 custom method fail closed；MSW 对 `QUERY` 和 custom method fail closed。`querystring` 独立于普通 `query`：TypeScript、Zod、Request、React Query、Vue Query、SWR、MCP operation contract 与 selective projection 均支持；Request 仅生成有 schema 的 `application/json` 或受限对象形状的 `application/x-www-form-urlencoded`，其他合法 media/encoding 由 Request 插件诊断为 unsupported。Form 序列化要求至少一对参数，空数组和零参数在发送前失败；整个 query text 上限 8192 UTF-8 bytes。Core 已分类 sequential/streaming 与 positional media。TypeScript 和 Zod 对 schema-only media 保留 schema-ready data model，对 `itemSchema`（包括有效 `querystring` Parameter media）给出 error 并分别生成 `never` / `z.never()`；仅有 positional encoding 时继续表达完整 schema。Request 与 MSW 对 sequential JSON、SSE、item-level 和 positional multipart 缺少 wire codec 的路径在 artifact 前 deterministic fail closed。完整 streaming/positional runtime 仍 Not Supported，并通过明确 diagnostics fail closed。Stable 不表示每个 OAS keyword 都改变每个 generator，也不声称支持全部 JSON Schema vocabularies。 |
| External local `$ref` | Stable | 在配置的 local-file/Workspace boundary 内解析，并对 cycle 和 missing target 给出 diagnostics。 |
| Remote documents 和 `$ref` | Stable | Node 原生 fetch；Explicit HTTP(S) root 为 caller-authorized，derived cross-origin `$ref` / redirect 需 allowedHosts。Target/operator 的额外 host grants 求交集；跨 Origin 清除 configured headers，保留 downgrade/redirect/timeout/size/cancellation bounds，不保证 private-address 或 DNS rebinding 隔离。 |

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
| Trusted config, developer (default) | Stable | 8：以上 3 个 analysis Tools，加 target listing、operation search、one-operation contract reading、unified generation 和 generation check | `openapi_generate` 可通过 Core intent/transaction 持久化 |
| Trusted config, read-only | Stable | 8：同上 | None; generation preview only |
| Trusted config, hardened | Stable | 10：以上 8 个，加 Prepare 和 Apply | 仅通过 exact-plan two-phase transaction |

Server 不支持 Streamable HTTP、OAuth、server API keys、multi-tenancy、LLM calls、chat UI、background tasks、telemetry、arbitrary writes、OpenAPI/config editing 或 business API execution。参阅 [MCP security](./mcp-security.md) 和 [MCP limitations](./mcp-limitations.md)。

## Evidence and maintenance

本表依据当前 package directories 和 aggregate exports、CLI command registration 与 integration tests、Core dialect fixtures/diagnostics、MCP Tool registration/schema tests，以及 real packed-package installation smoke tests 维护。`pnpm verify:package-surface`、`pnpm release:smoke` 和 `pnpm test:release-scripts` 会检查这里引用的 package、binary、script 和文档关系。
