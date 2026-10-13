# @openapi-to/cli

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

- Add shared microservice Target selection and generator-managed Workspace output
  roots. The CLI now accepts repeatable `generate --target` options while Core,
  CLI, MCP, and packed-package smoke workflows share deterministic Target naming,
  output resolution, overlap protection, and write preflight.
  
  Preserve and verify JSON, YAML, YML, and HTTP(S) OpenAPI inputs across
  multi-target CLI and MCP workflows. Default output remains
  `.openapi-to/<output.dir>`; opting into `output.base: "workspace"` keeps ownership
  inside the selected project output root while Operation selection remains in
  `.openapi-to/selections`.

### Patch Changes

- 7051c3c: 让 Consumer Skill 将独立的 API-looking path 和 `METHOD path` 识别为只读 Operation discovery 输入，并明确要求用户表达实现意图后才进入生成流程。
- fca1c07: Harden the packaged openapi-to-setup Skill with an Inspector-first setup-plan
  gate, exact plan hashing, existing dependency preservation, and an explicit
  Codex Host restart boundary.
- dc00fa4: 将 canonical capability matrix 确定性地打包为版本匹配的离线 Generate Skill reference，并移除 product reference 中重复维护的易变 capability 状态细节。
- a85be9a: Remove unused direct dependencies from the Core and CLI package manifests,
  reducing their published install footprint without changing runtime behavior.
- 9802099: 明确 Codex Consumer Front Door 路由，并区分 Setup 与 Generate 的职责；不改变 MCP、Core 或 plugin runtime capability。
- Align published package metadata, documented capabilities, CLI aliases, MCP Host setup, and release verification with the shipped package surfaces.
- b4631c8: 为随包 Consumer Skill 增加版本匹配的离线产品参考与生成后业务集成指南，按当前安装声明查找 exact API，并基于真实 artifact/export 集成现有项目代码；不新增 MCP 或 Compiler runtime capability。
- dd6a3e9: 修正 openapi-to-generate 随包产品参考中的 Cookie transport 能力描述，使其与当前
  pluginTSRequest shipped contract 保持一致。
- 0ad72c4: Add the deterministic `openapi setup --host codex --scope project` consumer
  bootstrap for generation config, packaged Skills, the state ignore rule, and
  project-level read-only Codex MCP configuration.
- Ship the openapi-to Setup and Generate Skills with the npm distribution and add an explicit offline Codex Skill installer.
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
- 0b24e79: Upgrade the CLI runtime and presentation dependencies while preserving the
  existing command, help, output, diagnostic, and exit-code contracts.
- 0e34a32: 精简随包 Consumer Skills 根说明，并将产品参考、generation、受控写入、生成物集成与 Setup 诊断细节路由到现有 references；保持 runtime capability、API、生成与 approval authority 不变。
- f5eec93: Refresh runtime and compiler dependencies, remove deprecated and unused direct
  dependencies, and preserve the Node.js 22.13+ and pnpm 11 compatibility floors.
- 2528324: 澄清 Codex Setup 与 Skill 安装后的重载指引：优先新建 chat/session；仅在运行时能力仍陈旧或 Host surface 生命周期不明确时完整重启 Host。
- Add operator-gated, two-phase MCP generation writes through a short-lived HMAC-bound Prepare plan and an exact one-time Apply. Apply re-generates and rejects stale config, source, reference, output, manifest, or file state before committing only managed artifacts.
  
  Core gains public source/config fingerprints plus a shared cross-process output lock and transaction writer with same-filesystem staging, a stable ownership manifest, rollback, crash journal recovery, commit cancellation/deadline semantics, and fail-closed TOCTOU checks. The CLI keeps its command and output contract while using the same transaction/lock path, so its direct SemVer impact is patch; the fixed-version group will coordinate the eventual release version. No version or publication command is run by this change.
- Harden remote loading by clearing trusted request headers on cross-Origin
  redirects and rejecting HTTPS-to-HTTP downgrades. Merge trusted Target remote
  requirements with MCP operator ceilings instead of replacing them; the MCP
  server API can now supply optional remote timeout, response-size, and redirect
  upper bounds while Tool schemas remain unchanged.
  
  Classify native Windows absolute inputs without treating drive letters as URL
  schemes, reject drive-relative and UNC configured inputs, and require portable
  output segments across Linux, macOS, and Windows. Extend cross-platform CI,
  stable lint coverage, package-surface checks, and real tarball consumers for the
  three aggregate binaries and shared MCP CLI subpath.
- d0008b7: 强化 `openapi-to-setup` 的 MCP runtime capability 证据门，避免从配置态推断当前 Tools。
- 2f3ff06: 中文化随包分发的 Consumer Skill reference 说明，保持机器标识与工作流契约不变。
- 45775a6: Bind the Codex MCP `cwd` generated by `openapi setup` to the consuming
  project's absolute root, with bounded migration for legacy and stale canonical
  configurations.
- 528eeeb: Upgrade the Core process-execution and configuration-loading runtime dependencies while preserving the published Node.js 22 compatibility contract. The shared execa catalog update also keeps the CLI runtime dependency surface aligned; cosmiconfig remains on its maintained Node-22-compatible 9.x line because 10.x requires Node 22.18 or newer.
- Add the independent read-only stdio MCP server with bounded validate, inspect,
  diff, generation dry-run, and generation check Tools. Core gains opt-in local
  file-root confinement for entry and transitive reference reads plus the shared
  trusted configuration loader; the CLI now reuses that loader without changing
  its command contract.
- 6b6ea14: Add explicit project and user scopes to the packaged Agent Skills installer. Project installs use the current `$CWD/.agents/skills` subtree, user installs use `$HOME/.agents/skills`, and historical `~/.codex/skills` installs are detected without automatic migration.
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

- fd923e2: Ship the openapi-to Setup and Generate Skills with the npm distribution and add an explicit offline Codex Skill installer.
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

### Patch Changes

- 642c834: Align published package metadata, documented capabilities, CLI aliases, MCP Host setup, and release verification with the shipped package surfaces.
- f0a38b1: Add operator-gated, two-phase MCP generation writes through a short-lived HMAC-bound Prepare plan and an exact one-time Apply. Apply re-generates and rejects stale config, source, reference, output, manifest, or file state before committing only managed artifacts.

  Core gains public source/config fingerprints plus a shared cross-process output lock and transaction writer with same-filesystem staging, a stable ownership manifest, rollback, crash journal recovery, commit cancellation/deadline semantics, and fail-closed TOCTOU checks. The CLI keeps its command and output contract while using the same transaction/lock path, so its direct SemVer impact is patch; the fixed-version group will coordinate the eventual release version. No version or publication command is run by this change.

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

- ca8f1cb: Add the independent read-only stdio MCP server with bounded validate, inspect,
  diff, generation dry-run, and generation check Tools. Core gains opt-in local
  file-root confinement for entry and transitive reference reads plus the shared
  trusted configuration loader; the CLI now reuses that loader without changing
  its command contract.
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

### Patch Changes

- Updated dependencies []:
  - openapi-to@2.0.0-alpha.5
  - @openapi-to/core@2.0.0-alpha.3

## 2.0.0-alpha.2

### Major Changes

- v2

### Patch Changes

- Updated dependencies []:
  - @openapi-to/core@2.0.0-alpha.2
