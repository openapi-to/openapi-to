# Core Agent guide

本文件为 `packages/core/` 扩展 root `AGENTS.md`。Core 负责 compiler semantics、
diagnostics、plugin orchestration、artifacts、comparison 与 formal writer。CLI、MCP 和
plugins 必须调用这些 public capabilities，不得重新实现。

## Pipeline and representations

按 owning stage 对 change 分类：

1. Source loading — local/object/HTTP(S) acquisition and remote policy in
   `src/openapi/sourceLoader.ts`.
2. Parsing and Swagger conversion — JSON/YAML parsing and Swagger 2.0
   conversion in `src/openapi/sourceLoader.ts`.
3. Reference resolution — internal/external `$ref`, pointer, cycle, cache, and
   missing-target handling in `src/openapi/refResolver.ts`.
4. Validation — dialect/version and structural diagnostics in
   `src/openapi/validator.ts`.
5. Normalization — deterministic, non-mutating key ordering in
   `src/openapi/normalizer.ts`.
6. Legacy-compatible plugin context — `src/OpenAPIContext/`.
7. Plugin generation — Hook execution and plugin contributions in
   `src/pluginManager/`.
8. Artifact formatting — typed artifact materialization and configured
   formatting in `src/artifacts/`.
9. Comparison — hashes, managed deletions, dry-run/check manifests.
10. Writing — locks, transactions, journal/recovery, files, and the ownership
    manifest.

`compileOpenAPI()` 当前负责 load/parse 或 convert、resolve references、validate 转换后的
legacy-compatible document，并 normalize resolved representation。

- `OpenAPICompilation.document` 是 converted、legacy-compatible document。Existing
  plugin Hooks 通过 `HookContext.openAPIDocument` 接收此 representation。
- `resolvedDocument` 展开可解析 references，同时将 detected cycles 保留为 `$ref`。
- `normalizedDocument` 在 resolved representation 中递归排序 object keys，同时保留
  array order 与 unknown fields。

Plugins 当前不能通过 `HookContext` 选择 `resolvedDocument` 或 `normalizedDocument`。
需要这些 forms 的 caller 必须直接使用 `compileOpenAPI()`。当 representation 影响
behavior 时必须明确写出名称。

不要从 parser 或 dependency support 推断 Repository 对 OpenAPI version 或 JSON Schema
keyword 的支持。用 focused end-to-end evidence 区分 complete support、compatible
read、accepted-not-generated behavior 与 unsupported input。

## Diagnostic ownership

使用 `src/diagnostics.ts` 的 public `Diagnostic` contract；codes 是 compatibility
surface，public results 必须排序。

- Loader/parser 负责 acquisition、protocol、syntax、conversion 与 remote failures。
- Resolver 负责 `$ref` failures。
- Validator 负责 dialect 与 structural findings。
- Artifact stages 负责 serialization、path、format、comparison、lock 与 write failures。
- Plugins 只负责自身 generation limitations 与 Hook failures。

不要在每个 plugin 中重复一个 compiler finding，也不要在 CLI/MCP presentation 中重新
创建它。Plugins 尽可能使用带 plugin name 与 precise OpenAPI path 的
`ctx.addDiagnostic()`。Library code 不得调用 `process.exit`。

## Plugin scheduling and state

Dependency stages 按 topological order 运行。在每个 current stage 内：

- `buildStart` completes before component Hooks.
- Component Hook groups can run concurrently and finish before the tag loop.
- Each `tagStart` is awaited before scheduling that tag's `operation` Hooks.
- Operations in one tag run concurrently, and work from different tags may
  overlap.
- `tagEnd` is invoked while scheduled operations for that tag may still be in
  flight; it is not a completion barrier.
- All scheduled operations for the stage finish before `buildEnd`, so
  `buildEnd` is the current stage aggregation barrier.

每当 lifecycle code 变化时重新读取 `src/pluginManager/runPluginsByTags.ts`。不要使用
共享的 `currentTag`/`currentOperation` variables，也不要让 concurrent operation Hooks
mutate 未分区的 SourceFile、import collection、`Map` 或 `Set`。优先使用 namespaced
build-local `ctx.store`。若既有 plugin architecture 需要 compatibility storage，只
允许在 `buildStart` 初始化的 per-config `WeakMap<OpenapiToSingleConfig, State>`；绝不
使用 module-global strong-reference registry、counter、`Project` 或 cross-build
collection。测试 consecutive builds 是否发生 leakage。

使用 component Hooks 生成 matching component output，使用 `operation` 生成
operation-local artifacts/metadata，使用 `buildEnd` 生成 sorted aggregate files。Core
的 final sort 无法把被并发 mutation 的 aggregate content 变成 deterministic。

## Artifact and writer contract

Legacy TypeScript plugins 可以通过 `ctx.setSourceFiles()` 注册 `ts-morph` SourceFiles。
New output 应使用带正确 TypeScript、JSON、text 或 bounded binary kind 的
`ctx.addArtifact()`。Hooks 永远不直接写 output directories。

- Artifact paths 必须留在 `output.dir` 内。Traversal、absolute escapes、reserved
  transaction paths、unsafe symlink segments 与 case-only collisions 都必须 fail。
- 相同 path 且 serialized bytes 相同则 deduplicate；同一 path 的 bytes 冲突则 fail。
- 默认 serialized limit 为每个 artifact 64 MiB。必须有意识地保持或收紧 resource bounds。
- `output.clean` 只能删除 prior `.openapi-to-manifest.json` 记录且未变化的 paths。没有
  manifest 时不进行 legacy directory sweep，unmanaged files 必须保留。
- Dry-run 与 check 只做 compare：不更新 files、ownership、transaction state 或 manifest。
- Core transaction writer 是唯一 formal filesystem writer。它负责 shared output lock、
  staging、journal、commit、rollback 与 recovery。CLI 和 MCP 不得实现 parallel writers
  或不兼容的 locks。

## Validation

对于 compiler/OpenAPI behavior，添加最小 legal fixture，以及 focused invalid、unsupported
或 cross-dialect case。Broad Petstore fixture 只能作为额外 smoke evidence。

确认 manifests 中存在 commands 后再运行。通常的 Core baseline 是：

```sh
pnpm --filter @openapi-to/core test
pnpm --filter @openapi-to/core typecheck
```

还要运行每个受影响 official plugin test。Shared public types、lifecycle 或 emitted
behavior 通常需要 focused fixture generation，然后运行 `pnpm typecheck` 与
`pnpm build`。Artifact、path、naming、import 或 ordering changes 需要 full file-set
review、适用时的 generated consumer validation，以及 byte-stable second generation。
Plugin、OpenAPI-support 或 codegen-regression work 使用匹配的 Repository Skill。
