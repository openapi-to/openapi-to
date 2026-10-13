# @openapi-to/plugin-zod

## 4.0.0-rc.4

### Major Changes

- Freeze the P0 compiler and P1 Codex governance baseline. This release adds the
  OpenAPI compiler pipeline, structured diagnostics, general generated artifacts,
  validation, inspection, contract diffing, deterministic dry-run/check modes,
  safe remote loading, and the expanded CLI surface.
  
  The major bump records compatibility-sensitive behavior changes: private-network
  remote sources are blocked by default, conflicting artifact paths fail instead of
  depending on write order, managed output cleanup is manifest-aware, and CLI
  failures now return classified non-zero exit codes.
- d71e14f: Raise the minimum supported Node.js runtime from Node 20 to Node 22.
- Move automatic configuration discovery to root `openapi.config.ts`, `.js`,
  `.cjs`, or `.mjs` files and move tool-managed state and managed output to
  `.openapi-to`.
  
  The former `.OpenAPI` configuration location is no longer discovered, and Core
  replaces the removed `folderName` export with `stateDirectoryName`. No
  compatibility fallback or automatic migration is provided; move the
  configuration and any state that must be retained manually.
- Generate Zod 4-only schemas, including top-level string formats, explicit key/value records, executable unions and intersections, safe enum literals and property names, additional-properties policies, and recursive references. Generated consumers now require `zod@^4`; Zod 3 is no longer supported.
  
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

- 83ab495: 为 Core 增加共享的 Response Header 语义描述，并让 Zod 生成按状态隔离的逻辑响应头 validators。
- b455553: 支持 OpenAPI 3.2 fixed `QUERY` 与 `additionalOperations` 的统一 operation 发现、catalog、inspect、diff、projection 与生成。TypeScript types、Zod 和 request plugin 保留 custom method 的精确 wire casing；React Query、Vue Query 和 SWR 生成包含 body/query 的 `QUERY` cache key，不能精确表达的 query/MSW methods 以 structured diagnostics fail closed。
- 69a5fb8: 支持 OpenAPI 3.2 `querystring` 的独立类型与 schema、受限 form/JSON URL 序列化、框架缓存身份和转发，以及有界 MCP operation contract。Form 序列化在空数组或零参数时于请求发送前失败。

### Patch Changes

- c63ac63: 对未实现的标准 JSON Schema validation keywords 产生 error diagnostic，并将受影响的 Zod schema entrypoint fail closed，避免静默生成过宽 validator。
- 001cc4c: 将 required 缺少安全 object context 的 Zod diagnostic 提升为 error，与既有 `z.never()` fail-closed 行为保持一致。
- d3fabf2: 对 OpenAPI 3.2 的 sequential JSON、SSE、`itemSchema` 与 positional multipart media 建立有界生成契约：Core 提供可复用 media 的本地引用检查，并退役已由插件明确处理的通用 media gap warning；TypeScript/Zod 保留 schema-only 的完整内容表示，对 item-level 语义分别生成 `never`/`z.never()` 与 error，包括有效 querystring Parameter 的 media；Request/MSW 对缺少 wire codec 的 media 在 artifact 创建前报错。React Query、Vue Query 和 SWR 在 Request 未生成 service 时跳过对应 hook。
- bfd381d: date-time validators now accept RFC3339 positive leap-second insertion positions, including numeric-offset representations, while rejecting arbitrary `:60` values. The bounded position profile does not use an IERS occurrence database.
- 3170c09: Refresh the compiler toolchain compatibility baseline to TypeScript 6,
  ts-morph 28, and code-block-writer 13 while setting the minimum generated-
  consumer TypeScript version to 5.9. Validate the same generated consumer with
  TypeScript 5.9.3, 6.0.3, and 7.0.2 using strict mode and full declaration
  checking.
- 04e3c1b: 在 Core 中保留所有 Response media representation 的确定性 inventory，并拒绝违反 OAS cardinality 的多项 Parameter/Header content。Zod 对无 Content-Type 上下文的多媒体 RequestBody/Response 生成 `z.never()` 和 error diagnostic；对含歧义 status 的 success/error aggregate 整体 fail closed。
- 25162c7: 明确 Zod `integer/int64` 使用 JavaScript safe-integer number 契约，并在生成时发出有界 warning。
- Align published package metadata, documented capabilities, CLI aliases, MCP Host setup, and release verification with the shipped package surfaces.
- c0dbf3b: Upgrade the compiler and official generator plugins to `oas` 38 while preserving
  operation discovery, OpenAPI 3.0/3.1/3.2 compatibility, referenced parameter and
  request-body semantics, response component identity, response media and composition
  semantics, selective generation, and deterministic generated output.
- 5dba19b: 修正 OAS 3.0 与 3.1/3.2 的 Schema `$ref` sibling 语义：忽略 3.0 Reference Object siblings，并保留 3.1/3.2 Schema Object 中当前支持的 sibling validation。
- be348f6: Preserve precise `z.infer` output types for supported direct, array, map, and
  mutually recursive Zod component schemas while retaining cycle-safe runtime
  validation through `z.lazy()`.
- 461924b: Correct the repository, issue tracker, and homepage URLs in all public package metadata to point to the openapi-to GitHub organization.
- c3720a7: 生成的 `oneOf` Zod validators 现在只接受恰好一个匹配分支，同时保持 `anyOf` 的至少一个匹配语义与现有 inferred TypeScript union。Peer dependency 最低版本提升至 Zod 4.3，以使用公开的 `z.xor()` API。
- bcfd52e: 为生成的请求输入和 transport 增加类型安全的 OpenAPI Header 参数支持。
- f5eec93: Refresh runtime and compiler dependencies, remove deprecated and unused direct
  dependencies, and preserve the Node.js 22.13+ and pnpm 11 compatibility floors.
- 75291e7: 修复 Zod 4.3 consumer 中必需 unconstrained object 属性缺失时的运行时校验。
- 0dd9024: 修复对象 Schema 的 `required` 存在性校验，使未在 `properties` 声明的名称也必须存在。
- Updated dependencies [4b1251e]
- Updated dependencies [66b9e20]
- Updated dependencies [d3fabf2]
- Updated dependencies
- Updated dependencies [3170c09]
- Updated dependencies [d541ed5]
- Updated dependencies [04e3c1b]
- Updated dependencies [7051c3c]
- Updated dependencies [83ab495]
- Updated dependencies
- Updated dependencies [a85be9a]
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies [953f366]
- Updated dependencies
- Updated dependencies [1e25317]
- Updated dependencies
- Updated dependencies [c0dbf3b]
- Updated dependencies [b474478]
- Updated dependencies [d71e14f]
- Updated dependencies [5dba19b]
- Updated dependencies [b455553]
- Updated dependencies
- Updated dependencies [461924b]
- Updated dependencies [73f775e]
- Updated dependencies [bcfd52e]
- Updated dependencies [f5eec93]
- Updated dependencies [a1f8d25]
- Updated dependencies [b91f54a]
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies [528eeeb]
- Updated dependencies
- Updated dependencies
- Updated dependencies [29bc037]
- Updated dependencies [f933e41]
- Updated dependencies
- Updated dependencies [69a5fb8]
- Updated dependencies
  - @openapi-to/core@4.0.0-rc.4

## 4.0.0-rc.3

### Patch Changes

- @openapi-to/core@4.0.0-rc.3

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

### Patch Changes

- Updated dependencies [f5a38fd]
- Updated dependencies [7c87d42]
- Updated dependencies [f405e1a]
  - @openapi-to/core@4.0.0-rc.2

## 4.0.0-rc.1

### Major Changes

- ed854a9: Move automatic configuration discovery to root `openapi.config.ts`, `.js`,
  `.cjs`, or `.mjs` files and move tool-managed state and managed output to
  `.openapi-to`.

  The former `.OpenAPI` configuration location is no longer discovered, and Core
  replaces the removed `folderName` export with `stateDirectoryName`. No
  compatibility fallback or automatic migration is provided; move the
  configuration and any state that must be retained manually.

### Patch Changes

- Updated dependencies [ed854a9]
  - @openapi-to/core@4.0.0-rc.1

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

### Patch Changes

- 642c834: Align published package metadata, documented capabilities, CLI aliases, MCP Host setup, and release verification with the shipped package surfaces.
- Updated dependencies [e373f8c]
- Updated dependencies [4f10867]
- Updated dependencies [642c834]
- Updated dependencies [3e1078b]
- Updated dependencies [ce3f9f2]
- Updated dependencies [862f0ae]
- Updated dependencies [b4130f7]
- Updated dependencies [f0a38b1]
- Updated dependencies [6aac98f]
- Updated dependencies [b4130f7]
- Updated dependencies [ca8f1cb]
- Updated dependencies [235162c]
  - @openapi-to/core@4.0.0-rc.0

## 3.2.2

### Patch Changes

- fix bug
- Updated dependencies
  - @openapi-to/core@3.2.2

## 3.2.1

### Patch Changes

- fix bug
- Updated dependencies
  - @openapi-to/core@3.2.1

## 3.2.0

### Minor Changes

- feat msw

### Patch Changes

- Updated dependencies
  - @openapi-to/core@3.2.0

## 3.1.1

### Patch Changes

- fix bug
- Updated dependencies
  - @openapi-to/core@3.1.1

## 3.1.0

### Minor Changes

- feature: vue query

### Patch Changes

- Updated dependencies
  - @openapi-to/core@3.1.0

## 3.0.1

### Patch Changes

- fix bug
- Updated dependencies
  - @openapi-to/core@3.0.1

## 3.0.0

### Major Changes

- fix bug
- fix: bug
- update
- refactor

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @openapi-to/core@3.0.0

## 3.0.0-alpha.5

### Major Changes

- fix: bug

### Patch Changes

- Updated dependencies
  - @openapi-to/core@3.0.0-alpha.5

## 3.0.0-alpha.4

### Major Changes

- fix bug

### Patch Changes

- Updated dependencies
  - @openapi-to/core@3.0.0-alpha.4

## 3.0.0-alpha.3

### Major Changes

- refactor

### Patch Changes

- Updated dependencies
  - @openapi-to/core@3.0.0-alpha.3

## 3.0.0-alpha.2

### Major Changes

- fix

### Patch Changes

- Updated dependencies []:
  - @openapi-to/core@3.0.0-alpha.2

## 2.4.0-alpha.1

### Patch Changes

- fix bug

- Updated dependencies []:
  - @openapi-to/core@2.4.0-alpha.1

## 2.4.0-alpha.0

### Minor Changes

- update all

### Patch Changes

- Updated dependencies []:
  - @openapi-to/core@2.4.0-alpha.0

## 2.3.0

### Minor Changes

- generate swr

### Patch Changes

- Updated dependencies []:
  - @openapi-to/core@2.3.0

## 2.2.0

### Minor Changes

- fix bug

### Patch Changes

- Updated dependencies []:
  - @openapi-to/core@2.2.0

## 2.1.0

### Minor Changes

- optimize request type zod

### Patch Changes

- Updated dependencies []:
  - @openapi-to/core@2.1.0

## 2.0.0

### Major Changes

- [`e519466`](https://github.com/Vc-great/openapi-to/commit/e5194667c7416e817a498d592c357a7ae9c05f22) Thanks [@Vc-great](https://github.com/Vc-great)! - v2

- [`a39a900`](https://github.com/Vc-great/openapi-to/commit/a39a9002dda434d8a65768f55c69875ed8ad1eea) - fix bug

- 2.0

- [`367be25`](https://github.com/Vc-great/openapi-to/commit/367be252aa434487c09c4566e77792839867b509) - fix bug

- [`7fd9e58`](https://github.com/Vc-great/openapi-to/commit/7fd9e58417ef5563dedf945fbb030b70b8b09bd6) - rc

### Patch Changes

- Updated dependencies [[`e519466`](https://github.com/Vc-great/openapi-to/commit/e5194667c7416e817a498d592c357a7ae9c05f22), [`a39a900`](https://github.com/Vc-great/openapi-to/commit/a39a9002dda434d8a65768f55c69875ed8ad1eea), [`367be25`](https://github.com/Vc-great/openapi-to/commit/367be252aa434487c09c4566e77792839867b509), [`7fd9e58`](https://github.com/Vc-great/openapi-to/commit/7fd9e58417ef5563dedf945fbb030b70b8b09bd6)]:
  - @openapi-to/core@2.0.0

## 2.0.0-rc.5

### Major Changes

- rc

### Patch Changes

- Updated dependencies []:
  - @openapi-to/core@2.0.0-rc.5

## 2.0.0-alpha.4

### Major Changes

- fix bug

### Patch Changes

- Updated dependencies []:
  - @openapi-to/core@2.0.0-alpha.4

## 2.0.0-alpha.3

### Major Changes

- fix bug

## 2.0.0-alpha.2

### Major Changes

- v2
