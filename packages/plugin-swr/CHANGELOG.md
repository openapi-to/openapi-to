# @openapi-to/plugin-swr

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

### Minor Changes

- b455553: 支持 OpenAPI 3.2 fixed `QUERY` 与 `additionalOperations` 的统一 operation 发现、catalog、inspect、diff、projection 与生成。TypeScript types、Zod 和 request plugin 保留 custom method 的精确 wire casing；React Query、Vue Query 和 SWR 生成包含 body/query 的 `QUERY` cache key，不能精确表达的 query/MSW methods 以 structured diagnostics fail closed。
- f933e41: 在 4.0 RC 中将 generated request API 迁移为 `request(input, requestConfig?)`，统一使用仅包含 path/query/body 的 operation RequestInput；framework wrappers 在调用前组装相同输入。Core 统一 group requiredness，并按 Header case-insensitive identity 合并有效参数。已有独立 HeaderParams/CookieParams 保留，本次不实现 typed Header/Cookie transport 或 Fetch。
- 69a5fb8: 支持 OpenAPI 3.2 `querystring` 的独立类型与 schema、受限 form/JSON URL 序列化、框架缓存身份和转发，以及有界 MCP operation contract。Form 序列化在空数组或零参数时于请求发送前失败。

### Patch Changes

- d3fabf2: 对 OpenAPI 3.2 的 sequential JSON、SSE、`itemSchema` 与 positional multipart media 建立有界生成契约：Core 提供可复用 media 的本地引用检查，并退役已由插件明确处理的通用 media gap warning；TypeScript/Zod 保留 schema-only 的完整内容表示，对 item-level 语义分别生成 `never`/`z.never()` 与 error，包括有效 querystring Parameter 的 media；Request/MSW 对缺少 wire codec 的 media 在 artifact 创建前报错。React Query、Vue Query 和 SWR 在 Request 未生成 service 时跳过对应 hook。
- 3170c09: Refresh the compiler toolchain compatibility baseline to TypeScript 6,
  ts-morph 28, and code-block-writer 13 while setting the minimum generated-
  consumer TypeScript version to 5.9. Validate the same generated consumer with
  TypeScript 5.9.3, 6.0.3, and 7.0.2 using strict mode and full declaration
  checking.
- Align published package metadata, documented capabilities, CLI aliases, MCP Host setup, and release verification with the shipped package surfaces.
- 6b87c66: Make the default initialized configuration directly generatable by selecting
  SWR as its single query plugin, and emit one structured JSON document for
  `init --json`.
  
  Keep inline enum declarations and references on one collision-safe symbol,
  remove the unused implicit-any SWR fetcher parameter, and narrow schema-less
  JSON response data only at MSW's `HttpResponse.json` boundary.
  
  Disambiguate distinct inline-enum schema paths that normalize to the same
  readable TypeScript identifier.
- c0dbf3b: Upgrade the compiler and official generator plugins to `oas` 38 while preserving
  operation discovery, OpenAPI 3.0/3.1/3.2 compatibility, referenced parameter and
  request-body semantics, response component identity, response media and composition
  semantics, selective generation, and deterministic generated output.
- 461924b: Correct the repository, issue tracker, and homepage URLs in all public package metadata to point to the openapi-to GitHub organization.
- 73f775e: 为 Request plugin 增加第一方 Fetch transport，并让 React Query、Vue Query 与 SWR hooks 读取 Request-owned Fetch config/error metadata。
- bcfd52e: 为生成的请求输入和 transport 增加类型安全的 OpenAPI Header 参数支持。
- f5eec93: Refresh runtime and compiler dependencies, remove deprecated and unused direct
  dependencies, and preserve the Node.js 22.13+ and pnpm 11 compatibility floors.
- 29bc037: 将有效 OpenAPI Cookie 参数加入 `RequestInput.cookies`，并让 requiredness 驱动输入类型。`pluginTSRequest` 新增默认关闭的 `cookieTransport: "header"` opt-in；关闭时提供或要求 Cookie 都会在 dispatch 前 fail closed。显式 Header transport 只支持有界、安全的参数子集，浏览器显式设置 Cookie Header 不受支持；此变更不包含 Fetch transport。
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
