# @openapi-to/plugin-react-query

## 4.0.0-rc.4

### Minor Changes

- 7c1ca56: Add the official TanStack Query v5 generator with typed query and mutation
  options factories, operation query keys, and optional thin React hooks. The
  capability is stable after dependent packed React consumer verification.
- b455553: 支持 OpenAPI 3.2 fixed `QUERY` 与 `additionalOperations` 的统一 operation 发现、catalog、inspect、diff、projection 与生成。TypeScript types、Zod 和 request plugin 保留 custom method 的精确 wire casing；React Query、Vue Query 和 SWR 生成包含 body/query 的 `QUERY` cache key，不能精确表达的 query/MSW methods 以 structured diagnostics fail closed。
- f933e41: 在 4.0 RC 中将 generated request API 迁移为 `request(input, requestConfig?)`，统一使用仅包含 path/query/body 的 operation RequestInput；framework wrappers 在调用前组装相同输入。Core 统一 group requiredness，并按 Header case-insensitive identity 合并有效参数。已有独立 HeaderParams/CookieParams 保留，本次不实现 typed Header/Cookie transport 或 Fetch。
- 69a5fb8: 支持 OpenAPI 3.2 `querystring` 的独立类型与 schema、受限 form/JSON URL 序列化、框架缓存身份和转发，以及有界 MCP operation contract。Form 序列化在空数组或零参数时于请求发送前失败。

### Patch Changes

- 461924b: Correct the repository, issue tracker, and homepage URLs in all public package metadata to point to the openapi-to GitHub organization.
- 73f775e: 为 Request plugin 增加第一方 Fetch transport，并让 React Query、Vue Query 与 SWR hooks 读取 Request-owned Fetch config/error metadata。
- bcfd52e: 为生成的请求输入和 transport 增加类型安全的 OpenAPI Header 参数支持。
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
