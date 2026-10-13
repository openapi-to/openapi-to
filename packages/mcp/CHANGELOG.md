# @openapi-to/mcp

## 4.0.0-rc.4

### Major Changes

- 2954661: 切换 MCP Generation v2 public Tool surface：移除 `--allow-write` 与 `openapi_generate_dry_run`，统一为 `openapi_generate`，并引入 developer、read-only、hardened capability mode、Core 绑定的 selection/output intent 与共享事务写入路径。
- b474478: Use Node built-in fetch for remote OpenAPI loading and remove Core's Axios runtime dependency and custom DNS/IP/Agent layer.
  
  Explicit HTTP(S) roots are caller-authorized, including internal networks. Same-origin references and redirects are allowed; derived cross-origin requests require allowedHosts, and configured headers stay within the original root origin. Retain bounded streaming response reads, timeout/cancellation, manual redirect limits, HTTPS downgrade protection and diagnostic redaction.
  
  Remove allowPrivateNetwork and the MCP --allow-private-network option during the 4.0 RC cycle. allowedHosts now grants additional derived cross-origin hostname access rather than restricting explicit roots. Remote loading follows Node native fetch proxy semantics; Core no longer implements private-address or DNS rebinding protection.
- d71e14f: Raise the minimum supported Node.js runtime from Node 20 to Node 22.
- Move automatic configuration discovery to root `openapi.config.ts`, `.js`,
  `.cjs`, or `.mjs` files and move tool-managed state and managed output to
  `.openapi-to`.
  
  The former `.OpenAPI` configuration location is no longer discovered, and Core
  replaces the removed `folderName` export with `stateDirectoryName`. No
  compatibility fallback or automatic migration is provided; move the
  configuration and any state that must be retained manually.

### Minor Changes

- Add optional invocation-scoped cancellation to compiler, config, plugin, artifact, and comparison APIs, and harden the read-only stdio MCP server with bounded per-tool deadlines, cancellation-safe generation queuing, stable progress, structured stderr logging, fixed evaluation corpora, performance/stress gates, and operational security documentation. Existing Core and CLI calls remain source-compatible because every new execution option is optional. The repository fixed-version group coordinates the eventual public-package minor release; no versioning or publication is performed here.
- Enable operator-gated controlled Selective Apply through the existing Prepare/Apply Tools. Selective plans now issue kind- and owner-bound one-time tokens, recompile and revalidate the frozen operation projection at Apply time, and atomically commit generated artifacts, ownership, and persistent selection through Core's generation-state transaction. Full generation and controlled full Apply semantics are unchanged.
- Add a deterministic Operation Catalog with bounded lexical search and single-operation contract summaries, plus trusted-target MCP discovery, search, and contract Tools with process-local compilation caching.
- Add shared microservice Target selection and generator-managed Workspace output
  roots. The CLI now accepts repeatable `generate --target` options while Core,
  CLI, MCP, and packed-package smoke workflows share deterministic Target naming,
  output resolution, overlap protection, and write preflight.
  
  Preserve and verify JSON, YAML, YML, and HTTP(S) OpenAPI inputs across
  multi-target CLI and MCP workflows. Default output remains
  `.openapi-to/<output.dir>`; opting into `output.base: "workspace"` keeps ownership
  inside the selected project output root while Operation selection remains in
  `.openapi-to/selections`.
- b455553: 支持 OpenAPI 3.2 fixed `QUERY` 与 `additionalOperations` 的统一 operation 发现、catalog、inspect、diff、projection 与生成。TypeScript types、Zod 和 request plugin 保留 custom method 的精确 wire casing；React Query、Vue Query 和 SWR 生成包含 body/query 的 `QUERY` cache key，不能精确表达的 query/MSW methods 以 structured diagnostics fail closed。
- Add a versioned deterministic operation Selection model and additive Selective Prepare. Prepare unions persisted and requested operations, binds selection/projection/artifacts into a review-only plan, and writes nothing. Selected plans cannot Apply in this phase, while full Prepare/Apply and existing write authority remain unchanged.
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
- Add deterministic projected OpenAPI compilations with exact operation selection, transitive named-component closure, and selective `openapi_generate_dry_run` previews. Omitted scope keeps full generation unchanged, and selective previews remain nonpersistent and add no write authority.
- Add exact non-empty `replace` semantics to persistent operation selection while preserving the original add-only Core mutation, merge-result, and runtime return-shape contracts. The new generic mutation API lets Selective Prepare replace every legal persisted selection of up to 5,000 operations in one request while retaining per-key, manifest-byte, plan-memory, and bounded-summary limits. Approved Apply commits the complete frozen desired artifacts, ownership-constrained managed deletions, ownership manifest, and selection together while preserving unmanaged files, rollback, and recovery behavior.
- Add the independent read-only stdio MCP server with bounded validate, inspect,
  diff, generation dry-run, and generation check Tools. Core gains opt-in local
  file-root confinement for entry and transitive reference reads plus the shared
  trusted configuration loader; the CLI now reuses that loader without changing
  its command contract.
- Make `openapi-to` the complete user installation entrypoint. The aggregate now
  depends on the MCP runtime and installs the `openapi-to-mcp` command alongside
  the `openapi` and `openapi-to` CLI aliases, so most users no longer need to
  install `@openapi-to/mcp` separately.
  
  Expose the shared MCP CLI runner through the stable `@openapi-to/mcp/cli`
  subpath so both package bins use one argument parser and stdio Server startup
  implementation.
- 69a5fb8: 支持 OpenAPI 3.2 `querystring` 的独立类型与 schema、受限 form/JSON URL 序列化、框架缓存身份和转发，以及有界 MCP operation contract。Form 序列化在空数组或零参数时于请求发送前失败。

### Patch Changes

- 4b1251e: 让 OpenAPI 3.2 inspect 的能力分类准确区分 Core maintained boundary、preserve-only metadata 与 fail-closed runtime media。
- Align published package metadata, documented capabilities, CLI aliases, MCP Host setup, and release verification with the shipped package surfaces.
- Use the native realpath representation for the trusted MCP Workspace so Windows
  temporary paths remain Workspace-relative across config loading, generation
  results, and cross-platform stdio smoke tests.
- 4314a0f: Migrate the MCP server to Zod 4 only while preserving its existing Tool schemas, stdio protocol, capability modes, bounded results, and controlled Prepare/Apply contract.
- 1e25317: Preserve Core-validated persisted output identities during generation checks while keeping caller-selected Workspace output validation unchanged.
- 461924b: Correct the repository, issue tracker, and homepage URLs in all public package metadata to point to the openapi-to GitHub organization.
- 5ab16c0: Report bounded, sanitized startup phase and failure-category diagnostics on stderr while preserving stdio protocol integrity and project-relative MCP setup semantics.
- Add a bounded controlled sidecar-state abstraction to the shared Core transaction writer, with checksummed journal v2 state operations, physical preconditions, same-parent staging and backup, three-state rollback, and lock-triggered crash recovery. Existing no-state full writes retain journal v1 and the existing full Prepare/Apply contract.
  
  Selective plan binding now includes the previous selection physical snapshot and exact desired serialized-byte hash and length. Selective Prepare remains review-only with no returned token, selective Apply remains disabled before locks and writes, and no new MCP write authority or Tool is added.
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

### Minor Changes

- 7c87d42: Add exact non-empty `replace` semantics to persistent operation selection while preserving the original add-only Core mutation, merge-result, and runtime return-shape contracts. The new generic mutation API lets Selective Prepare replace every legal persisted selection of up to 5,000 operations in one request while retaining per-key, manifest-byte, plan-memory, and bounded-summary limits. Approved Apply commits the complete frozen desired artifacts, ownership-constrained managed deletions, ownership manifest, and selection together while preserving unmanaged files, rollback, and recovery behavior.

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

- b4130f7: Add deterministic projected OpenAPI compilations with exact operation selection, transitive named-component closure, and selective `openapi_generate_dry_run` previews. Omitted scope keeps full generation unchanged, and selective previews remain nonpersistent and add no write authority.
- ca8f1cb: Add the independent read-only stdio MCP server with bounded validate, inspect,
  diff, generation dry-run, and generation check Tools. Core gains opt-in local
  file-root confinement for entry and transitive reference reads plus the shared
  trusted configuration loader; the CLI now reuses that loader without changing
  its command contract.
- acfb118: Make `openapi-to` the complete user installation entrypoint. The aggregate now
  depends on the MCP runtime and installs the `openapi-to-mcp` command alongside
  the `openapi` and `openapi-to` CLI aliases, so most users no longer need to
  install `@openapi-to/mcp` separately.

  Expose the shared MCP CLI runner through the stable `@openapi-to/mcp/cli`
  subpath so both package bins use one argument parser and stdio Server startup
  implementation.

### Patch Changes

- 642c834: Align published package metadata, documented capabilities, CLI aliases, MCP Host setup, and release verification with the shipped package surfaces.
- f3d4d04: Use the native realpath representation for the trusted MCP Workspace so Windows
  temporary paths remain Workspace-relative across config loading, generation
  results, and cross-platform stdio smoke tests.
- 235162c: Add a bounded controlled sidecar-state abstraction to the shared Core transaction writer, with checksummed journal v2 state operations, physical preconditions, same-parent staging and backup, three-state rollback, and lock-triggered crash recovery. Existing no-state full writes retain journal v1 and the existing full Prepare/Apply contract.

  Selective plan binding now includes the previous selection physical snapshot and exact desired serialized-byte hash and length. Selective Prepare remains review-only with no returned token, selective Apply remains disabled before locks and writes, and no new MCP write authority or Tool is added.

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

## Unreleased

### Minor Changes

- Add the first read-only stdio MCP server with three analysis Tools and two trusted-config generation preview/check Tools.
