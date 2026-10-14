# openapi-to

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
- d71e14f: Raise the minimum supported Node.js runtime from Node 20 to Node 22.
- ed854a9: Move automatic configuration discovery to root `openapi.config.ts`, `.js`,
  `.cjs`, or `.mjs` files and move tool-managed state and managed output to
  `.openapi-to`.

  The former `.OpenAPI` configuration location is no longer discovered, and Core
  replaces the removed `folderName` export with `stateDirectoryName`. No
  compatibility fallback or automatic migration is provided; move the
  configuration and any state that must be retained manually.

### Minor Changes

- d541ed5: 新增官方 Faker generator，支持从 OpenAPI schema 与 operation responses 生成 bounded factories，并在 Core operation metadata 中记录 response factory identities。Consumer 自行安装和配置 Faker runtime。
- 7c1ca56: Add the official TanStack Query v5 generator with typed query and mutation
  options factories, operation query keys, and optional thin React hooks. The
  capability is stable after dependent packed React consumer verification.
- 862f0ae: Add shared microservice Target selection and generator-managed Workspace output
  roots. The CLI now accepts repeatable `generate --target` options while Core,
  CLI, MCP, and packed-package smoke workflows share deterministic Target naming,
  output resolution, overlap protection, and write preflight.

  Preserve and verify JSON, YAML, YML, and HTTP(S) OpenAPI inputs across
  multi-target CLI and MCP workflows. Default output remains
  `.openapi-to/<output.dir>`; opting into `output.base: "workspace"` keeps ownership
  inside the selected project output root while Operation selection remains in
  `.openapi-to/selections`.
- acfb118: Make `openapi-to` the complete user installation entrypoint. The aggregate now
  depends on the MCP runtime and installs the `openapi-to-mcp` command alongside
  the `openapi` and `openapi-to` CLI aliases, so most users no longer need to
  install `@openapi-to/mcp` separately.

  Expose the shared MCP CLI runner through the stable `@openapi-to/mcp/cli`
  subpath so both package bins use one argument parser and stdio Server startup
  implementation.
- 69a5fb8: 支持 OpenAPI 3.2 `querystring` 的独立类型与 schema、受限 form/JSON URL 序列化、框架缓存身份和转发，以及有界 MCP operation contract。Form 序列化在空数组或零参数时于请求发送前失败。

### Patch Changes

- fca1c07: Harden the packaged openapi-to-setup Skill with an Inspector-first setup-plan
  gate, exact plan hashing, existing dependency preservation, and an explicit
  Codex Host restart boundary.
- 642c834: Align published package metadata, documented capabilities, CLI aliases, MCP Host setup, and release verification with the shipped package surfaces.
- 0ad72c4: Add the deterministic `openapi setup --host codex --scope project` consumer
  bootstrap for generation config, packaged Skills, the state ignore rule, and
  project-level read-only Codex MCP configuration.
- fd923e2: Ship the openapi-to Setup and Generate Skills with the npm distribution and add an explicit offline Codex Skill installer.
- 3d1c17f: 将 Codex 的普通 `openapi setup --host codex --scope project` bootstrap 默认配置为
  Developer MCP generation mode；Read-only 与 Hardened 保留为显式选择，并同步更新
  Setup/Generate Skills、handoff 校验和 packed consumer smoke 的 capability 证据。
- 6b87c66: Make the default initialized configuration directly generatable by selecting
  SWR as its single query plugin, and emit one structured JSON document for
  `init --json`.

  Keep inline enum declarations and references on one collision-safe symbol,
  remove the unused implicit-any SWR fetcher parameter, and narrow schema-less
  JSON response data only at MSW's `HttpResponse.json` boundary.

  Disambiguate distinct inline-enum schema paths that normalize to the same
  readable TypeScript identifier.
- 461924b: Correct the repository, issue tracker, and homepage URLs in all public package metadata to point to the openapi-to GitHub organization.
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
- 45775a6: Bind the Codex MCP `cwd` generated by `openapi setup` to the consuming
  project's absolute root, with bounded migration for legacy and stale canonical
  configurations.
- 6b6ea14: Add explicit project and user scopes to the packaged Agent Skills installer. Project installs use the current `$CWD/.agents/skills` subtree, user installs use `$HOME/.agents/skills`, and historical `~/.codex/skills` installs are detected without automatic migration.
- Updated dependencies [4b1251e]
- Updated dependencies [4b1251e]
- Updated dependencies [c63ac63]
- Updated dependencies [001cc4c]
- Updated dependencies [66b9e20]
- Updated dependencies [d3fabf2]
- Updated dependencies [e373f8c]
- Updated dependencies [bfd381d]
- Updated dependencies [b9c16ee]
- Updated dependencies [3170c09]
- Updated dependencies [d541ed5]
- Updated dependencies [04e3c1b]
- Updated dependencies [7051c3c]
- Updated dependencies [fca1c07]
- Updated dependencies [25162c7]
- Updated dependencies [dc00fa4]
- Updated dependencies [83ab495]
- Updated dependencies [4f10867]
- Updated dependencies [a85be9a]
- Updated dependencies [9802099]
- Updated dependencies [642c834]
- Updated dependencies [b4631c8]
- Updated dependencies [3e1078b]
- Updated dependencies [dd6a3e9]
- Updated dependencies [0ad72c4]
- Updated dependencies [fd923e2]
- Updated dependencies [3d1c17f]
- Updated dependencies [f3d4d04]
- Updated dependencies [6b87c66]
- Updated dependencies [7c1ca56]
- Updated dependencies [f5a38fd]
- Updated dependencies [2954661]
- Updated dependencies [953f366]
- Updated dependencies [ce3f9f2]
- Updated dependencies [4314a0f]
- Updated dependencies [1e25317]
- Updated dependencies [862f0ae]
- Updated dependencies [c0dbf3b]
- Updated dependencies [b474478]
- Updated dependencies [d71e14f]
- Updated dependencies [5dba19b]
- Updated dependencies [b455553]
- Updated dependencies [b4130f7]
- Updated dependencies [be348f6]
- Updated dependencies [461924b]
- Updated dependencies [0b24e79]
- Updated dependencies [5ab16c0]
- Updated dependencies [73f775e]
- Updated dependencies [c3720a7]
- Updated dependencies [bcfd52e]
- Updated dependencies [0e34a32]
- Updated dependencies [f5eec93]
- Updated dependencies [2528324]
- Updated dependencies [75291e7]
- Updated dependencies [3eabedc]
- Updated dependencies [a1f8d25]
- Updated dependencies [b91f54a]
- Updated dependencies [f0a38b1]
- Updated dependencies [6aac98f]
- Updated dependencies [b4130f7]
- Updated dependencies [7c87d42]
- Updated dependencies [d0008b7]
- Updated dependencies [0dd9024]
- Updated dependencies [2f3ff06]
- Updated dependencies [45775a6]
- Updated dependencies [528eeeb]
- Updated dependencies [ca8f1cb]
- Updated dependencies [42c9331]
- Updated dependencies [235162c]
- Updated dependencies [29bc037]
- Updated dependencies [acfb118]
- Updated dependencies [f933e41]
- Updated dependencies [ed854a9]
- Updated dependencies [69a5fb8]
- Updated dependencies [6b6ea14]
- Updated dependencies [f405e1a]
  - @openapi-to/core@4.0.0
  - @openapi-to/mcp@4.0.0
  - @openapi-to/plugin-zod@4.0.0
  - @openapi-to/plugin-ts-type@4.0.0
  - @openapi-to/plugin-ts-request@4.0.0
  - @openapi-to/plugin-msw@4.0.0
  - @openapi-to/plugin-vue-query@4.0.0
  - @openapi-to/plugin-swr@4.0.0
  - @openapi-to/cli@4.0.0
  - @openapi-to/plugin-faker@4.0.0
  - @openapi-to/plugin-react-query@4.0.0

## 4.0.0-rc.3

### Patch Changes

- fd923e2: Ship the openapi-to Setup and Generate Skills with the npm distribution and add an explicit offline Codex Skill installer.
- Updated dependencies [fd923e2]
  - @openapi-to/cli@4.0.0-rc.3
  - @openapi-to/core@4.0.0-rc.3
  - @openapi-to/mcp@4.0.0-rc.3
  - @openapi-to/plugin-msw@4.0.0-rc.3
  - @openapi-to/plugin-swr@4.0.0-rc.3
  - @openapi-to/plugin-ts-request@4.0.0-rc.3
  - @openapi-to/plugin-ts-type@4.0.0-rc.3
  - @openapi-to/plugin-vue-query@4.0.0-rc.3
  - @openapi-to/plugin-zod@4.0.0-rc.3

## 4.0.0-rc.2

### Patch Changes

- Updated dependencies [f5a38fd]
- Updated dependencies [7c87d42]
- Updated dependencies [f405e1a]
  - @openapi-to/core@4.0.0-rc.2
  - @openapi-to/mcp@4.0.0-rc.2
  - @openapi-to/plugin-zod@4.0.0-rc.2
  - @openapi-to/plugin-ts-type@4.0.0-rc.2
  - @openapi-to/cli@4.0.0-rc.2
  - @openapi-to/plugin-msw@4.0.0-rc.2
  - @openapi-to/plugin-swr@4.0.0-rc.2
  - @openapi-to/plugin-ts-request@4.0.0-rc.2
  - @openapi-to/plugin-vue-query@4.0.0-rc.2

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
  - @openapi-to/mcp@4.0.0-rc.1
  - @openapi-to/cli@4.0.0-rc.1
  - @openapi-to/plugin-msw@4.0.0-rc.1
  - @openapi-to/plugin-swr@4.0.0-rc.1
  - @openapi-to/plugin-ts-request@4.0.0-rc.1
  - @openapi-to/plugin-ts-type@4.0.0-rc.1
  - @openapi-to/plugin-vue-query@4.0.0-rc.1
  - @openapi-to/plugin-zod@4.0.0-rc.1

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

- 862f0ae: Add shared microservice Target selection and generator-managed Workspace output
  roots. The CLI now accepts repeatable `generate --target` options while Core,
  CLI, MCP, and packed-package smoke workflows share deterministic Target naming,
  output resolution, overlap protection, and write preflight.

  Preserve and verify JSON, YAML, YML, and HTTP(S) OpenAPI inputs across
  multi-target CLI and MCP workflows. Default output remains
  `.OpenAPI/<output.dir>`; opting into `output.base: "workspace"` keeps ownership
  inside the selected project output root while Operation selection remains in
  `.OpenAPI/selections`.

- acfb118: Make `openapi-to` the complete user installation entrypoint. The aggregate now
  depends on the MCP runtime and installs the `openapi-to-mcp` command alongside
  the `openapi` and `openapi-to` CLI aliases, so most users no longer need to
  install `@openapi-to/mcp` separately.

  Expose the shared MCP CLI runner through the stable `@openapi-to/mcp/cli`
  subpath so both package bins use one argument parser and stdio Server startup
  implementation.

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

- Updated dependencies [e373f8c]
- Updated dependencies [4f10867]
- Updated dependencies [642c834]
- Updated dependencies [3e1078b]
- Updated dependencies [f3d4d04]
- Updated dependencies [ce3f9f2]
- Updated dependencies [862f0ae]
- Updated dependencies [b4130f7]
- Updated dependencies [f0a38b1]
- Updated dependencies [6aac98f]
- Updated dependencies [b4130f7]
- Updated dependencies [ca8f1cb]
- Updated dependencies [235162c]
- Updated dependencies [acfb118]
  - @openapi-to/core@4.0.0-rc.0
  - @openapi-to/cli@4.0.0-rc.0
  - @openapi-to/plugin-msw@4.0.0-rc.0
  - @openapi-to/plugin-swr@4.0.0-rc.0
  - @openapi-to/plugin-ts-request@4.0.0-rc.0
  - @openapi-to/plugin-ts-type@4.0.0-rc.0
  - @openapi-to/plugin-vue-query@4.0.0-rc.0
  - @openapi-to/plugin-zod@4.0.0-rc.0
  - @openapi-to/mcp@4.0.0-rc.0

## 3.2.2

### Patch Changes

- fix bug
- Updated dependencies
  - @openapi-to/cli@3.2.2
  - @openapi-to/core@3.2.2
  - @openapi-to/plugin-msw@3.2.2
  - @openapi-to/plugin-swr@3.2.2
  - @openapi-to/plugin-ts-request@3.2.2
  - @openapi-to/plugin-ts-type@3.2.2
  - @openapi-to/plugin-vue-query@3.2.2
  - @openapi-to/plugin-zod@3.2.2

## 3.2.1

### Patch Changes

- fix bug
- Updated dependencies
  - @openapi-to/cli@3.2.1
  - @openapi-to/core@3.2.1
  - @openapi-to/plugin-msw@3.2.1
  - @openapi-to/plugin-swr@3.2.1
  - @openapi-to/plugin-ts-request@3.2.1
  - @openapi-to/plugin-ts-type@3.2.1
  - @openapi-to/plugin-vue-query@3.2.1
  - @openapi-to/plugin-zod@3.2.1

## 3.2.0

### Minor Changes

- feat msw

### Patch Changes

- Updated dependencies
  - @openapi-to/cli@3.2.0
  - @openapi-to/core@3.2.0
  - @openapi-to/plugin-msw@3.2.0
  - @openapi-to/plugin-swr@3.2.0
  - @openapi-to/plugin-ts-request@3.2.0
  - @openapi-to/plugin-ts-type@3.2.0
  - @openapi-to/plugin-vue-query@3.2.0
  - @openapi-to/plugin-zod@3.2.0

## 3.1.1

### Patch Changes

- fix bug
- Updated dependencies
  - @openapi-to/cli@3.1.1
  - @openapi-to/core@3.1.1
  - @openapi-to/plugin-swr@3.1.1
  - @openapi-to/plugin-ts-request@3.1.1
  - @openapi-to/plugin-ts-type@3.1.1
  - @openapi-to/plugin-vue-query@3.1.1
  - @openapi-to/plugin-zod@3.1.1

## 3.1.0

### Minor Changes

- feature: vue query

### Patch Changes

- Updated dependencies
  - @openapi-to/cli@3.1.0
  - @openapi-to/core@3.1.0
  - @openapi-to/plugin-swr@3.1.0
  - @openapi-to/plugin-ts-request@3.1.0
  - @openapi-to/plugin-ts-type@3.1.0
  - @openapi-to/plugin-vue-query@3.1.0
  - @openapi-to/plugin-zod@3.1.0

## 3.0.1

### Patch Changes

- fix bug
- Updated dependencies
  - @openapi-to/cli@3.0.1
  - @openapi-to/core@3.0.1
  - @openapi-to/plugin-swr@3.0.1
  - @openapi-to/plugin-ts-request@3.0.1
  - @openapi-to/plugin-ts-type@3.0.1
  - @openapi-to/plugin-zod@3.0.1

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
  - @openapi-to/cli@3.0.0
  - @openapi-to/core@3.0.0
  - @openapi-to/plugin-swr@3.0.0
  - @openapi-to/plugin-ts-request@3.0.0
  - @openapi-to/plugin-ts-type@3.0.0
  - @openapi-to/plugin-zod@3.0.0

## 3.0.0-alpha.5

### Major Changes

- fix: bug

### Patch Changes

- Updated dependencies
  - @openapi-to/plugin-ts-request@3.0.0-alpha.5
  - @openapi-to/plugin-ts-type@3.0.0-alpha.5
  - @openapi-to/plugin-swr@3.0.0-alpha.5
  - @openapi-to/plugin-zod@3.0.0-alpha.5
  - @openapi-to/cli@3.0.0-alpha.5
  - @openapi-to/core@3.0.0-alpha.5

## 3.0.0-alpha.4

### Major Changes

- fix bug

### Patch Changes

- Updated dependencies
  - @openapi-to/cli@3.0.0-alpha.4
  - @openapi-to/core@3.0.0-alpha.4
  - @openapi-to/plugin-swr@3.0.0-alpha.4
  - @openapi-to/plugin-ts-request@3.0.0-alpha.4
  - @openapi-to/plugin-ts-type@3.0.0-alpha.4
  - @openapi-to/plugin-zod@3.0.0-alpha.4

## 3.0.0-alpha.3

### Major Changes

- refactor

### Patch Changes

- Updated dependencies
  - @openapi-to/cli@3.0.0-alpha.3
  - @openapi-to/core@3.0.0-alpha.3
  - @openapi-to/plugin-swr@3.0.0-alpha.3
  - @openapi-to/plugin-ts-request@3.0.0-alpha.3
  - @openapi-to/plugin-ts-type@3.0.0-alpha.3
  - @openapi-to/plugin-zod@3.0.0-alpha.3

## 3.0.0-alpha.2

### Major Changes

- fix

### Patch Changes

- Updated dependencies []:
  - @openapi-to/cli@3.0.0-alpha.2
  - @openapi-to/core@3.0.0-alpha.2
  - @openapi-to/plugin-faker@3.0.0-alpha.2
  - @openapi-to/plugin-msw@3.0.0-alpha.2
  - @openapi-to/plugin-nestjs@3.0.0-alpha.2
  - @openapi-to/plugin-swr@3.0.0-alpha.2
  - @openapi-to/plugin-ts-request@3.0.0-alpha.2
  - @openapi-to/plugin-ts-type@3.0.0-alpha.2
  - @openapi-to/plugin-vue-query@3.0.0-alpha.2
  - @openapi-to/plugin-zod@3.0.0-alpha.2

## 2.4.0-alpha.1

### Patch Changes

- fix bug

- Updated dependencies []:
  - @openapi-to/cli@2.4.0-alpha.1
  - @openapi-to/core@2.4.0-alpha.1
  - @openapi-to/plugin-faker@2.4.0-alpha.1
  - @openapi-to/plugin-msw@2.4.0-alpha.1
  - @openapi-to/plugin-nestjs@2.4.0-alpha.1
  - @openapi-to/plugin-swr@2.4.0-alpha.1
  - @openapi-to/plugin-ts-request@2.4.0-alpha.1
  - @openapi-to/plugin-ts-type@2.4.0-alpha.1
  - @openapi-to/plugin-vue-query@2.4.0-alpha.1
  - @openapi-to/plugin-zod@2.4.0-alpha.1

## 2.4.0-alpha.0

### Minor Changes

- update all

### Patch Changes

- Updated dependencies []:
  - @openapi-to/cli@2.4.0-alpha.0
  - @openapi-to/core@2.4.0-alpha.0
  - @openapi-to/plugin-faker@2.4.0-alpha.0
  - @openapi-to/plugin-msw@2.4.0-alpha.0
  - @openapi-to/plugin-nestjs@2.4.0-alpha.0
  - @openapi-to/plugin-swr@2.4.0-alpha.0
  - @openapi-to/plugin-ts-request@2.4.0-alpha.0
  - @openapi-to/plugin-ts-type@2.4.0-alpha.0
  - @openapi-to/plugin-vue-query@2.4.0-alpha.0
  - @openapi-to/plugin-zod@2.4.0-alpha.0

## 2.3.0

### Minor Changes

- generate swr

### Patch Changes

- Updated dependencies []:
  - @openapi-to/cli@2.3.0
  - @openapi-to/core@2.3.0
  - @openapi-to/plugin-faker@2.3.0
  - @openapi-to/plugin-msw@2.3.0
  - @openapi-to/plugin-nestjs@2.3.0
  - @openapi-to/plugin-swr@2.3.0
  - @openapi-to/plugin-ts-request@2.3.0
  - @openapi-to/plugin-ts-type@2.3.0
  - @openapi-to/plugin-zod@2.3.0

## 2.2.0

### Minor Changes

- fix bug

### Patch Changes

- Updated dependencies []:
  - @openapi-to/cli@2.2.0
  - @openapi-to/core@2.2.0
  - @openapi-to/plugin-faker@2.2.0
  - @openapi-to/plugin-msw@2.2.0
  - @openapi-to/plugin-nestjs@2.2.0
  - @openapi-to/plugin-ts-request@2.2.0
  - @openapi-to/plugin-ts-type@2.2.0
  - @openapi-to/plugin-zod@2.2.0

## 2.1.0

### Minor Changes

- optimize request type zod

### Patch Changes

- Updated dependencies []:
  - @openapi-to/cli@2.1.0
  - @openapi-to/core@2.1.0
  - @openapi-to/plugin-faker@2.1.0
  - @openapi-to/plugin-msw@2.1.0
  - @openapi-to/plugin-nestjs@2.1.0
  - @openapi-to/plugin-ts-request@2.1.0
  - @openapi-to/plugin-ts-type@2.1.0
  - @openapi-to/plugin-zod@2.1.0

## 2.0.0

### Major Changes

- [`a39a900`](https://github.com/Vc-great/openapi-to/commit/a39a9002dda434d8a65768f55c69875ed8ad1eea) - fix bug

- [`e519466`](https://github.com/Vc-great/openapi-to/commit/e5194667c7416e817a498d592c357a7ae9c05f22) Thanks [@Vc-great](https://github.com/Vc-great)! - v2

- [`a39a900`](https://github.com/Vc-great/openapi-to/commit/a39a9002dda434d8a65768f55c69875ed8ad1eea) - fix bug

- 2.0

- [`367be25`](https://github.com/Vc-great/openapi-to/commit/367be252aa434487c09c4566e77792839867b509) - fix bug

- [`7fd9e58`](https://github.com/Vc-great/openapi-to/commit/7fd9e58417ef5563dedf945fbb030b70b8b09bd6) - rc

- [`a39a900`](https://github.com/Vc-great/openapi-to/commit/a39a9002dda434d8a65768f55c69875ed8ad1eea) - fix bug

### Patch Changes

- Updated dependencies [[`e519466`](https://github.com/Vc-great/openapi-to/commit/e5194667c7416e817a498d592c357a7ae9c05f22), [`a39a900`](https://github.com/Vc-great/openapi-to/commit/a39a9002dda434d8a65768f55c69875ed8ad1eea), [`367be25`](https://github.com/Vc-great/openapi-to/commit/367be252aa434487c09c4566e77792839867b509), [`7fd9e58`](https://github.com/Vc-great/openapi-to/commit/7fd9e58417ef5563dedf945fbb030b70b8b09bd6)]:
  - @openapi-to/cli@2.0.0
  - @openapi-to/core@2.0.0
  - @openapi-to/plugin-ts-request@2.0.0
  - @openapi-to/plugin-ts-type@2.0.0
  - @openapi-to/plugin-zod@2.0.0
  - @openapi-to/plugin-faker@2.0.0
  - @openapi-to/plugin-msw@2.0.0
  - @openapi-to/plugin-nestjs@3.0.0

## 2.0.0-rc.7

### Major Changes

- rc

### Patch Changes

- Updated dependencies []:
  - @openapi-to/cli@2.0.0-rc.5
  - @openapi-to/core@2.0.0-rc.5
  - @openapi-to/plugin-faker@2.0.0-rc.2
  - @openapi-to/plugin-msw@2.0.0-rc.2
  - @openapi-to/plugin-ts-request@2.0.0-rc.5
  - @openapi-to/plugin-ts-type@2.0.0-rc.5
  - @openapi-to/plugin-zod@2.0.0-rc.5

## 2.0.0-alpha.6

### Major Changes

- fix bug

### Patch Changes

- Updated dependencies []:
  - @openapi-to/cli@2.0.0-alpha.4
  - @openapi-to/core@2.0.0-alpha.4
  - @openapi-to/plugin-faker@2.0.0-alpha.1
  - @openapi-to/plugin-msw@2.0.0-alpha.1
  - @openapi-to/plugin-ts-request@2.0.0-alpha.4
  - @openapi-to/plugin-ts-type@2.0.0-alpha.4
  - @openapi-to/plugin-zod@2.0.0-alpha.4

## 2.0.0-alpha.5

### Major Changes

- fix bug

### Patch Changes

- Updated dependencies []:
  - @openapi-to/cli@2.0.0-alpha.3
  - @openapi-to/core@2.0.0-alpha.3
  - @openapi-to/plugin-ts-request@2.0.0-alpha.3
  - @openapi-to/plugin-ts-type@2.0.0-alpha.3
  - @openapi-to/plugin-zod@2.0.0-alpha.3

## 2.0.0-alpha.4

### Major Changes

- fix bug

## 2.0.0-alpha.3

### Major Changes

- fix bug

## 2.0.0-alpha.2

### Major Changes

- v2

### Patch Changes

- Updated dependencies []:
  - @openapi-to/cli@2.0.0-alpha.2
  - @openapi-to/core@2.0.0-alpha.2
  - @openapi-to/plugin-ts-request@2.0.0-alpha.2
  - @openapi-to/plugin-ts-type@2.0.0-alpha.2
  - @openapi-to/plugin-zod@2.0.0-alpha.2
