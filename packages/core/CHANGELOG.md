# @openapi-to/core

## 4.0.0

### Major Changes

- e373f8c: Freeze the P0 compiler and P1 Codex governance baseline. This release adds the
  OpenAPI compiler pipeline, structured diagnostics, general generated artifacts,
  validation, inspection, contract diffing, deterministic dry-run/check modes,
  safe remote loading, and the expanded CLI surface.

  The major bump records compatibility-sensitive behavior changes: explicitly
  authorized HTTP(S) roots may reach internal networks, conflicting artifact paths
  fail instead of depending on write order, managed output cleanup is
  manifest-aware, and CLI failures now return classified non-zero exit codes.
- b474478: Use Node built-in fetch for remote OpenAPI loading and remove Core's Axios runtime dependency and custom DNS/IP/Agent layer.

  Explicit HTTP(S) roots are caller-authorized, including internal networks. Same-origin references and redirects are allowed; derived cross-origin requests require allowedHosts, and configured headers stay within the original root origin. Retain bounded streaming response reads, timeout/cancellation, manual redirect limits, HTTPS downgrade protection and diagnostic redaction.

  Remove allowPrivateNetwork and the MCP --allow-private-network option during the 4.0 RC cycle. allowedHosts now grants additional derived cross-origin hostname access rather than restricting explicit roots. Remote loading follows Node native fetch proxy semantics; Core no longer implements private-address or DNS rebinding protection.
- d71e14f: Raise the minimum supported Node.js runtime from Node 20 to Node 22.
- ed854a9: Move automatic configuration discovery to root `openapi.config.ts`, `.js`,
  `.cjs`, or `.mjs` files and move tool-managed state and managed output to
  `.openapi-to`.

  The former `.OpenAPI` configuration location is no longer discovered, and Core
  replaces the removed `folderName` export with `stateDirectoryName`. No
  compatibility fallback or automatic migration is provided; move the
  configuration and any state that must be retained manually.
- f405e1a: Generate Zod 4-only schemas, including top-level string formats, explicit key/value records, executable unions and intersections, safe enum literals and property names, additional-properties policies, and recursive references. Generated consumers now require `zod@^4`; Zod 3 is no longer supported.

  Component schema, parameter, request-body, and response references now import the category's real named export. Operation responses use collision-free per-status declarations, success/error aggregates, and `z.undefined()` for documented no-body responses. OpenAPI 3.1 boolean and empty schemas retain their accept-all/reject-all semantics. Date-time schemas accept required-second RFC3339 values with `Z` or numeric offsets; `int32`, safe-integer, password, and validation-sibling boundaries are explicit and tested. Recursive runtime parsing remains supported while recursive `z.infer` is documented as `unknown`.

  Referenced parameters now retain optional query/header/cookie and required path semantics, including resolved parameter objects that also carry `$ref`. Boolean and empty schemas are preserved at parameter entry points. Response generation includes case-insensitive `1XX` through `5XX` wildcard keys with stable unique names; informational responses use the current non-success aggregate, and `default` keeps its existing fallback behavior.

  Every legal component response now has a real export, with responses lacking content represented by `z.undefined()`. Existing Media Type Objects without `schema` are distinct from absent bodies and generate `z.unknown()` for operation/component request and response entry points, so Zod-backed request services never call an undefined parser. Response header references are excluded from body-schema imports because response-header validation is not currently generated.

  Schema-level `$ref` values with supported validation siblings now pass through the common renderer from operation and component parameter, request-body, and response builders. The renderer continues to apply one uniform intersection/nullable policy rather than dialect-specific OpenAPI 3.0 versus 3.1 behavior. Recursive inference, exact-one `oneOf`, the complete int64 domain, and RFC3339 leap seconds remain outside this change.

  Core now exposes stable path/query/header/cookie parameter classification,
  shared Parameter Object `schema`/`content` extraction, and response semantic
  descriptors. TypeScript and Zod consume those semantics consistently:
  request-header and cookie schemas/types are generated, a selected Media Type
  without `schema` is `unknown`/`z.unknown()`, and a response without content is
  `undefined`/`z.undefined()`. TypeScript retains every documented response
  status member, including mixed `200 + 204` and only-204 operations, and routes
  request-body schema `$ref` siblings such as `nullable` and composition through
  the schema renderer.

  Schema `$ref` siblings now retain one cross-plugin meaning at every parameter,
  request-body, and response entry point: the referenced schema and sibling
  schema both apply. TypeScript renders `$ref + anyOf/oneOf` as
  `Ref & (A | B)`, `$ref + allOf` as intersections, and keeps nullable as
  `Ref | null`; Zod emits the matching intersections/nullable schema. Deep
  sibling refs are imported without duplicates, component response refs use
  their real named export, nullable/composed object responses bypass the
  plain-interface shortcut, and component parameters collect imports per file
  without self-imports.

  Core public Parameter Object types now include OpenAPI 3.1 parameters and keep
  boolean schemas and type arrays valid at parameter entry points. Generated
  header/cookie types and Zod schemas do not change the TypeScript request
  client's public method signature: callers still provide transport values
  through request/client configuration. Exact-one `oneOf`, dialect-specific
  `$ref` sibling rules, recursive `z.infer`, complete int64, leap seconds,
  response-header validation, intelligent multi-Media-Type selection, and
  independent request-client header/cookie parameters remain outside this
  change.

  TypeScript component schemas now use the common schema renderer unless the
  schema is a plain object that can be represented faithfully as an interface.
  Primitive, array, enum, composition, nullable, type-array, boolean, and
  `$ref`-sibling components always emit a real named export. Boolean `true` and
  `false` map to `unknown` and `never`, including required and optional
  properties. Schema-valued `additionalProperties` supplies the index-signature
  value directly and is widened with fixed-property types where TypeScript
  requires compatibility. Component imports are path-aware, deterministic, and
  exclude self-imports while retaining external recursive references.

  Enum collection now traverses validation siblings beside `$ref` without
  resolving the referenced target, so operation and component `$ref + enum`
  outputs import a declared enum value type. Scalar `$ref + const` values are
  rendered as literal intersections in TypeScript and matching intersections in
  Zod. Exact-one `oneOf`, dialect-specific `$ref` sibling rules, recursive
  `z.infer`, the complete int64 domain, leap seconds, response-header validation,
  intelligent multi-Media-Type selection, and independent request-client
  header/cookie parameters remain unchanged.

### Minor Changes

- 66b9e20: 新增 OpenAPI 3.2 Media Type 语义分类器，保留完整 `schema` 与逐项 `itemSchema`，区分 by-name、positional 和规范忽略的 encoding 字段，并对互斥组合产生精确结构诊断。该 Core 能力不包含 streaming 或 multipart runtime codec。
- d541ed5: 新增官方 Faker generator，支持从 OpenAPI schema 与 operation responses 生成 bounded factories，并在 Core operation metadata 中记录 response factory identities。Consumer 自行安装和配置 Faker runtime。
- 83ab495: 为 Core 增加共享的 Response Header 语义描述，并让 Zod 生成按状态隔离的逻辑响应头 validators。
- 4f10867: Add optional invocation-scoped cancellation to compiler, config, plugin, artifact, and comparison APIs, and harden the read-only stdio MCP server with bounded per-tool deadlines, cancellation-safe generation queuing, stable progress, structured stderr logging, fixed evaluation corpora, performance/stress gates, and operational security documentation. Existing Core and CLI calls remain source-compatible because every new execution option is optional. The repository fixed-version group coordinates the eventual public-package minor release; no versioning or publication is performed here.
- 3e1078b: Enable operator-gated controlled Selective Apply through the existing Prepare/Apply Tools. Selective plans now issue kind- and owner-bound one-time tokens, recompile and revalidate the frozen operation projection at Apply time, and atomically commit generated artifacts, ownership, and persistent selection through Core's generation-state transaction. Full generation and controlled full Apply semantics are unchanged.
- ce3f9f2: Add a deterministic Operation Catalog with bounded lexical search and single-operation contract summaries, plus trusted-target MCP discovery, search, and contract Tools with process-local compilation caching.
- 862f0ae: Add shared microservice Target selection and generator-managed Workspace output
  roots. The CLI now accepts repeatable `generate --target` options while Core,
  CLI, MCP, and packed-package smoke workflows share deterministic Target naming,
  output resolution, overlap protection, and write preflight.

  Preserve and verify JSON, YAML, YML, and HTTP(S) OpenAPI inputs across
  multi-target CLI and MCP workflows. Default output remains
  `.openapi-to/<output.dir>`; opting into `output.base: "workspace"` keeps ownership
  inside the selected project output root while Operation selection remains in
  `.openapi-to/selections`.
- 5dba19b: 修正 OAS 3.0 与 3.1/3.2 的 Schema `$ref` sibling 语义：忽略 3.0 Reference Object siblings，并保留 3.1/3.2 Schema Object 中当前支持的 sibling validation。
- b455553: 支持 OpenAPI 3.2 fixed `QUERY` 与 `additionalOperations` 的统一 operation 发现、catalog、inspect、diff、projection 与生成。TypeScript types、Zod 和 request plugin 保留 custom method 的精确 wire casing；React Query、Vue Query 和 SWR 生成包含 body/query 的 `QUERY` cache key，不能精确表达的 query/MSW methods 以 structured diagnostics fail closed。
- b4130f7: Add a versioned deterministic operation Selection model and additive Selective Prepare. Prepare unions persisted and requested operations, binds selection/projection/artifacts into a review-only plan, and writes nothing. Selected plans cannot Apply in this phase, while full Prepare/Apply and existing write authority remain unchanged.
- a1f8d25: Add deterministic Generation Intent, dynamic output-root validation, and atomic
  intent transaction foundations. Generation now fails closed instead of
  overwriting unmanaged desired paths or overwriting/deleting managed files that
  have changed since their ownership manifest was written.
- f0a38b1: Add operator-gated, two-phase MCP generation writes through a short-lived HMAC-bound Prepare plan and an exact one-time Apply. Apply re-generates and rejects stale config, source, reference, output, manifest, or file state before committing only managed artifacts.

  Core gains public source/config fingerprints plus a shared cross-process output lock and transaction writer with same-filesystem staging, a stable ownership manifest, rollback, crash journal recovery, commit cancellation/deadline semantics, and fail-closed TOCTOU checks. The CLI keeps its command and output contract while using the same transaction/lock path, so its direct SemVer impact is patch; the fixed-version group will coordinate the eventual release version. No version or publication command is run by this change.
- b4130f7: Add deterministic projected OpenAPI compilations with exact operation selection, transitive named-component closure, and selective `openapi_generate_dry_run` previews. Omitted scope keeps full generation unchanged, and selective previews remain nonpersistent and add no write authority.
- 7c87d42: Add exact non-empty `replace` semantics to persistent operation selection while preserving the original add-only Core mutation, merge-result, and runtime return-shape contracts. The new generic mutation API lets Selective Prepare replace every legal persisted selection of up to 5,000 operations in one request while retaining per-key, manifest-byte, plan-memory, and bounded-summary limits. Approved Apply commits the complete frozen desired artifacts, ownership-constrained managed deletions, ownership manifest, and selection together while preserving unmanaged files, rollback, and recovery behavior.
- ca8f1cb: Add the independent read-only stdio MCP server with bounded validate, inspect,
  diff, generation dry-run, and generation check Tools. Core gains opt-in local
  file-root confinement for entry and transitive reference reads plus the shared
  trusted configuration loader; the CLI now reuses that loader without changing
  its command contract.
- 235162c: Add a bounded controlled sidecar-state abstraction to the shared Core transaction writer, with checksummed journal v2 state operations, physical preconditions, same-parent staging and backup, three-state rollback, and lock-triggered crash recovery. Existing no-state full writes retain journal v1 and the existing full Prepare/Apply contract.

  Selective plan binding now includes the previous selection physical snapshot and exact desired serialized-byte hash and length. Selective Prepare remains review-only with no returned token, selective Apply remains disabled before locks and writes, and no new MCP write authority or Tool is added.
- f933e41: 在 4.0 RC 中将 generated request API 迁移为 `request(input, requestConfig?)`，统一使用仅包含 path/query/body 的 operation RequestInput；framework wrappers 在调用前组装相同输入。Core 统一 group requiredness，并按 Header case-insensitive identity 合并有效参数。已有独立 HeaderParams/CookieParams 保留，本次不实现 typed Header/Cookie transport 或 Fetch。
- 69a5fb8: 支持 OpenAPI 3.2 `querystring` 的独立类型与 schema、受限 form/JSON URL 序列化、框架缓存身份和转发，以及有界 MCP operation contract。Form 序列化在空数组或零参数时于请求发送前失败。

### Patch Changes

- 4b1251e: 保持 OpenAPI 3.2 `$self` 与 Tag hierarchy 在 selective projection 中完整，并验证 Tag parent 与 Example Object 的规范约束；移除已不准确的通用兼容性 warning。
- d3fabf2: 对 OpenAPI 3.2 的 sequential JSON、SSE、`itemSchema` 与 positional multipart media 建立有界生成契约：Core 提供可复用 media 的本地引用检查，并退役已由插件明确处理的通用 media gap warning；TypeScript/Zod 保留 schema-only 的完整内容表示，对 item-level 语义分别生成 `never`/`z.never()` 与 error，包括有效 querystring Parameter 的 media；Request/MSW 对缺少 wire codec 的 media 在 artifact 创建前报错。React Query、Vue Query 和 SWR 在 Request 未生成 service 时跳过对应 hook。
- 3170c09: Refresh the compiler toolchain compatibility baseline to TypeScript 6,
  ts-morph 28, and code-block-writer 13 while setting the minimum generated-
  consumer TypeScript version to 5.9. Validate the same generated consumer with
  TypeScript 5.9.3, 6.0.3, and 7.0.2 using strict mode and full declaration
  checking.
- 04e3c1b: 在 Core 中保留所有 Response media representation 的确定性 inventory，并拒绝违反 OAS cardinality 的多项 Parameter/Header content。Zod 对无 Content-Type 上下文的多媒体 RequestBody/Response 生成 `z.never()` 和 error diagnostic；对含歧义 status 的 success/error aggregate 整体 fail closed。
- 7051c3c: 让 Consumer Skill 将独立的 API-looking path 和 `METHOD path` 识别为只读 Operation discovery 输入，并明确要求用户表达实现意图后才进入生成流程。
- a85be9a: Remove unused direct dependencies from the Core and CLI package manifests,
  reducing their published install footprint without changing runtime behavior.
- 642c834: Align published package metadata, documented capabilities, CLI aliases, MCP Host setup, and release verification with the shipped package surfaces.
- f5a38fd: Generated TypeScript files now include a uniform `Generated by openapi-to. DO NOT EDIT.` header.
- 953f366: Migrate Core YAML/OpenAPI and pnpm catalog loading to js-yaml 5.4.1 while preserving YAML merge support and bounded parser protections for untrusted input.
- 1e25317: Preserve Core-validated persisted output identities during generation checks while keeping caller-selected Workspace output validation unchanged.
- c0dbf3b: Upgrade the compiler and official generator plugins to `oas` 38 while preserving
  operation discovery, OpenAPI 3.0/3.1/3.2 compatibility, referenced parameter and
  request-body semantics, response component identity, response media and composition
  semantics, selective generation, and deterministic generated output.
- 461924b: Correct the repository, issue tracker, and homepage URLs in all public package metadata to point to the openapi-to GitHub organization.
- 73f775e: 为 Request plugin 增加第一方 Fetch transport，并让 React Query、Vue Query 与 SWR hooks 读取 Request-owned Fetch config/error metadata。
- bcfd52e: 为生成的请求输入和 transport 增加类型安全的 OpenAPI Header 参数支持。
- f5eec93: Refresh runtime and compiler dependencies, remove deprecated and unused direct
  dependencies, and preserve the Node.js 22.13+ and pnpm 11 compatibility floors.
- b91f54a: Update the YAML parser to the maintained secure js-yaml 4.x baseline, preserving OpenAPI YAML anchors and merges while applying the upstream prototype-pollution and parser-complexity protections.
- 6aac98f: Harden remote loading by clearing trusted request headers on cross-Origin
  redirects and rejecting HTTPS-to-HTTP downgrades. Merge trusted Target remote
  requirements with MCP operator ceilings instead of replacing them; the MCP
  server API can now supply optional remote timeout, response-size, and redirect
  upper bounds while Tool schemas remain unchanged.

  Classify native Windows absolute inputs without treating drive letters as URL
  schemes, reject drive-relative and UNC configured inputs, and require portable
  output segments across Linux, macOS, and Windows. Extend cross-platform CI,
  stable lint coverage, package-surface checks, and real tarball consumers for the
  three aggregate binaries and shared MCP CLI subpath.
- 528eeeb: Upgrade the Core process-execution and configuration-loading runtime dependencies while preserving the published Node.js 22 compatibility contract. The shared execa catalog update also keeps the CLI runtime dependency surface aligned; cosmiconfig remains on its maintained Node-22-compatible 9.x line because 10.x requires Node 22.18 or newer.
- 29bc037: 将有效 OpenAPI Cookie 参数加入 `RequestInput.cookies`，并让 requiredness 驱动输入类型。`pluginTSRequest` 新增默认关闭的 `cookieTransport: "header"` opt-in；关闭时提供或要求 Cookie 都会在 dispatch 前 fail closed。显式 Header transport 只支持有界、安全的参数子集，浏览器显式设置 Cookie Header 不受支持；此变更不包含 Fetch transport。

## 4.0.0-rc.3

## 4.0.0-rc.2

### Major Changes

- f405e1a: Generate Zod 4-only schemas, including top-level string formats, explicit key/value records, executable unions and intersections, safe enum literals and property names, additional-properties policies, and recursive references. Generated consumers now require `zod@^4`; Zod 3 is no longer supported.

  Component schema, parameter, request-body, and response references now import the category's real named export. Operation responses use collision-free per-status declarations, success/error aggregates, and `z.undefined()` for documented no-body responses. OpenAPI 3.1 boolean and empty schemas retain their accept-all/reject-all semantics. Date-time schemas accept required-second RFC3339 values with `Z` or numeric offsets; `int32`, safe-integer, password, and validation-sibling boundaries are explicit and tested. Recursive runtime parsing remains supported while recursive `z.infer` is documented as `unknown`.

  Referenced parameters now retain optional query/header/cookie and required path semantics, including resolved parameter objects that also carry `$ref`. Boolean and empty schemas are preserved at parameter entry points. Response generation includes case-insensitive `1XX` through `5XX` wildcard keys with stable unique names; informational responses use the current non-success aggregate, and `default` keeps its existing fallback behavior.

  Every legal component response now has a real export, with responses lacking content represented by `z.undefined()`. Existing Media Type Objects without `schema` are distinct from absent bodies and generate `z.unknown()` for operation/component request and response entry points, so Zod-backed request services never call an undefined parser. Response header references are excluded from body-schema imports because response-header validation is not currently generated.

  Schema-level `$ref` values with supported validation siblings now pass through the common renderer from operation and component parameter, request-body, and response builders. The renderer continues to apply one uniform intersection/nullable policy rather than dialect-specific OpenAPI 3.0 versus 3.1 behavior. Recursive inference, exact-one `oneOf`, the complete int64 domain, and RFC3339 leap seconds remain outside this change.

  Core now exposes stable path/query/header/cookie parameter classification,
  shared Parameter Object `schema`/`content` extraction, and response semantic
  descriptors. TypeScript and Zod consume those semantics consistently:
  request-header and cookie schemas/types are generated, a selected Media Type
  without `schema` is `unknown`/`z.unknown()`, and a response without content is
  `undefined`/`z.undefined()`. TypeScript retains every documented response
  status member, including mixed `200 + 204` and only-204 operations, and routes
  request-body schema `$ref` siblings such as `nullable` and composition through
  the schema renderer.

  Schema `$ref` siblings now retain one cross-plugin meaning at every parameter,
  request-body, and response entry point: the referenced schema and sibling
  schema both apply. TypeScript renders `$ref + anyOf/oneOf` as
  `Ref & (A | B)`, `$ref + allOf` as intersections, and keeps nullable as
  `Ref | null`; Zod emits the matching intersections/nullable schema. Deep
  sibling refs are imported without duplicates, component response refs use
  their real named export, nullable/composed object responses bypass the
  plain-interface shortcut, and component parameters collect imports per file
  without self-imports.

  Core public Parameter Object types now include OpenAPI 3.1 parameters and keep
  boolean schemas and type arrays valid at parameter entry points. Generated
  header/cookie types and Zod schemas do not change the TypeScript request
  client's public method signature: callers still provide transport values
  through request/client configuration. Exact-one `oneOf`, dialect-specific
  `$ref` sibling rules, recursive `z.infer`, complete int64, leap seconds,
  response-header validation, intelligent multi-Media-Type selection, and
  independent request-client header/cookie parameters remain outside this
  change.

  TypeScript component schemas now use the common schema renderer unless the
  schema is a plain object that can be represented faithfully as an interface.
  Primitive, array, enum, composition, nullable, type-array, boolean, and
  `$ref`-sibling components always emit a real named export. Boolean `true` and
  `false` map to `unknown` and `never`, including required and optional
  properties. Schema-valued `additionalProperties` supplies the index-signature
  value directly and is widened with fixed-property types where TypeScript
  requires compatibility. Component imports are path-aware, deterministic, and
  exclude self-imports while retaining external recursive references.

  Enum collection now traverses validation siblings beside `$ref` without
  resolving the referenced target, so operation and component `$ref + enum`
  outputs import a declared enum value type. Scalar `$ref + const` values are
  rendered as literal intersections in TypeScript and matching intersections in
  Zod. Exact-one `oneOf`, dialect-specific `$ref` sibling rules, recursive
  `z.infer`, the complete int64 domain, leap seconds, response-header validation,
  intelligent multi-Media-Type selection, and independent request-client
  header/cookie parameters remain unchanged.

### Minor Changes

- 7c87d42: Add exact non-empty `replace` semantics to persistent operation selection while preserving the original add-only Core mutation, merge-result, and runtime return-shape contracts. The new generic mutation API lets Selective Prepare replace every legal persisted selection of up to 5,000 operations in one request while retaining per-key, manifest-byte, plan-memory, and bounded-summary limits. Approved Apply commits the complete frozen desired artifacts, ownership-constrained managed deletions, ownership manifest, and selection together while preserving unmanaged files, rollback, and recovery behavior.

### Patch Changes

- f5a38fd: Generated TypeScript files now include a uniform `Generated by openapi-to. DO NOT EDIT.` header.

## 4.0.0-rc.1

### Major Changes

- ed854a9: Move automatic configuration discovery to root `openapi.config.ts`, `.js`,
  `.cjs`, or `.mjs` files and move tool-managed state and managed output to
  `.openapi-to`.

  The former `.OpenAPI` configuration location is no longer discovered, and Core
  replaces the removed `folderName` export with `stateDirectoryName`. No
  compatibility fallback or automatic migration is provided; move the
  configuration and any state that must be retained manually.

## 4.0.0-rc.0

### Major Changes

- e373f8c: Freeze the P0 compiler and P1 Codex governance baseline. This release adds the
  OpenAPI compiler pipeline, structured diagnostics, general generated artifacts,
  validation, inspection, contract diffing, deterministic dry-run/check modes,
  safe remote loading, and the expanded CLI surface.

  The major bump records compatibility-sensitive behavior changes: private-network
  remote sources are blocked by default, conflicting artifact paths fail instead of
  depending on write order, managed output cleanup is manifest-aware, and CLI
  failures now return classified non-zero exit codes.

### Minor Changes

- 4f10867: Add optional invocation-scoped cancellation to compiler, config, plugin, artifact, and comparison APIs, and harden the read-only stdio MCP server with bounded per-tool deadlines, cancellation-safe generation queuing, stable progress, structured stderr logging, fixed evaluation corpora, performance/stress gates, and operational security documentation. Existing Core and CLI calls remain source-compatible because every new execution option is optional. The repository fixed-version group coordinates the eventual public-package minor release; no versioning or publication is performed here.
- 3e1078b: Enable operator-gated controlled Selective Apply through the existing Prepare/Apply Tools. Selective plans now issue kind- and owner-bound one-time tokens, recompile and revalidate the frozen operation projection at Apply time, and atomically commit generated artifacts, ownership, and persistent selection through Core's generation-state transaction. Full generation and controlled full Apply semantics are unchanged.
- ce3f9f2: Add a deterministic Operation Catalog with bounded lexical search and single-operation contract summaries, plus trusted-target MCP discovery, search, and contract Tools with process-local compilation caching.
- 862f0ae: Add shared microservice Target selection and generator-managed Workspace output
  roots. The CLI now accepts repeatable `generate --target` options while Core,
  CLI, MCP, and packed-package smoke workflows share deterministic Target naming,
  output resolution, overlap protection, and write preflight.

  Preserve and verify JSON, YAML, YML, and HTTP(S) OpenAPI inputs across
  multi-target CLI and MCP workflows. Default output remains
  `.OpenAPI/<output.dir>`; opting into `output.base: "workspace"` keeps ownership
  inside the selected project output root while Operation selection remains in
  `.OpenAPI/selections`.

- b4130f7: Add a versioned deterministic operation Selection model and additive Selective Prepare. Prepare unions persisted and requested operations, binds selection/projection/artifacts into a review-only plan, and writes nothing. Selected plans cannot Apply in this phase, while full Prepare/Apply and existing write authority remain unchanged.
- f0a38b1: Add operator-gated, two-phase MCP generation writes through a short-lived HMAC-bound Prepare plan and an exact one-time Apply. Apply re-generates and rejects stale config, source, reference, output, manifest, or file state before committing only managed artifacts.

  Core gains public source/config fingerprints plus a shared cross-process output lock and transaction writer with same-filesystem staging, a stable ownership manifest, rollback, crash journal recovery, commit cancellation/deadline semantics, and fail-closed TOCTOU checks. The CLI keeps its command and output contract while using the same transaction/lock path, so its direct SemVer impact is patch; the fixed-version group will coordinate the eventual release version. No version or publication command is run by this change.

- b4130f7: Add deterministic projected OpenAPI compilations with exact operation selection, transitive named-component closure, and selective `openapi_generate_dry_run` previews. Omitted scope keeps full generation unchanged, and selective previews remain nonpersistent and add no write authority.
- ca8f1cb: Add the independent read-only stdio MCP server with bounded validate, inspect,
  diff, generation dry-run, and generation check Tools. Core gains opt-in local
  file-root confinement for entry and transitive reference reads plus the shared
  trusted configuration loader; the CLI now reuses that loader without changing
  its command contract.
- 235162c: Add a bounded controlled sidecar-state abstraction to the shared Core transaction writer, with checksummed journal v2 state operations, physical preconditions, same-parent staging and backup, three-state rollback, and lock-triggered crash recovery. Existing no-state full writes retain journal v1 and the existing full Prepare/Apply contract.

  Selective plan binding now includes the previous selection physical snapshot and exact desired serialized-byte hash and length. Selective Prepare remains review-only with no returned token, selective Apply remains disabled before locks and writes, and no new MCP write authority or Tool is added.

### Patch Changes

- 642c834: Align published package metadata, documented capabilities, CLI aliases, MCP Host setup, and release verification with the shipped package surfaces.
- 6aac98f: Harden remote loading by clearing trusted request headers on cross-Origin
  redirects and rejecting HTTPS-to-HTTP downgrades. Merge trusted Target remote
  requirements with MCP operator ceilings instead of replacing them; the MCP
  server API can now supply optional remote timeout, response-size, and redirect
  upper bounds while Tool schemas remain unchanged.

  Classify native Windows absolute inputs without treating drive letters as URL
  schemes, reject drive-relative and UNC configured inputs, and require portable
  output segments across Linux, macOS, and Windows. Extend cross-platform CI,
  stable lint coverage, package-surface checks, and real tarball consumers for the
  three aggregate binaries and shared MCP CLI subpath.

## 3.2.2

### Patch Changes

- fix bug

## 3.2.1

### Patch Changes

- fix bug

## 3.2.0

### Minor Changes

- feat msw

## 3.1.1

### Patch Changes

- fix bug

## 3.1.0

### Minor Changes

- feature: vue query

## 3.0.1

### Patch Changes

- fix bug

## 3.0.0

### Major Changes

- fix bug
- fix: bug
- update
- refactor

## 3.0.0-alpha.5

### Major Changes

- fix: bug

## 3.0.0-alpha.4

### Major Changes

- fix bug

## 3.0.0-alpha.3

### Major Changes

- refactor

## 3.0.0-alpha.2

### Major Changes

- fix

## 2.4.0-alpha.1

### Patch Changes

- fix bug

## 2.4.0-alpha.0

### Minor Changes

- update all

## 2.3.0

### Minor Changes

- generate swr

## 2.2.0

### Minor Changes

- fix bug

## 2.1.0

### Minor Changes

- optimize request type zod

## 2.0.0

### Major Changes

- [`e519466`](https://github.com/Vc-great/openapi-to/commit/e5194667c7416e817a498d592c357a7ae9c05f22) Thanks [@Vc-great](https://github.com/Vc-great)! - v2

- [`a39a900`](https://github.com/Vc-great/openapi-to/commit/a39a9002dda434d8a65768f55c69875ed8ad1eea) - fix bug

- 2.0

- [`367be25`](https://github.com/Vc-great/openapi-to/commit/367be252aa434487c09c4566e77792839867b509) - fix bug

- [`7fd9e58`](https://github.com/Vc-great/openapi-to/commit/7fd9e58417ef5563dedf945fbb030b70b8b09bd6) - rc

## 2.0.0-rc.5

### Major Changes

- rc

## 2.0.0-alpha.4

### Major Changes

- fix bug

## 2.0.0-alpha.3

### Major Changes

- fix bug

## 2.0.0-alpha.2

### Major Changes

- v2
