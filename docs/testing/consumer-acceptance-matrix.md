# Consumer acceptance coverage matrix（Consumer 验收覆盖矩阵）

本矩阵为每项 consumer-facing acceptance capability 指定一个 canonical owner。Secondary coverage 只是佐证，不是第二个 source of truth。各 command 有意复用现有 pack/install harness；不存在独立的 consumer golden path。

下文使用的 owner 名称：

- `openapi-to-setup.node-test` 指 `node --test scripts/openapi-to-setup.node-test.mjs`。
- `test:consumer:codegen` 指 `pnpm test:consumer:codegen`。
- `consumer-codegen review export` 指 `pnpm test:consumer:codegen:review`；它是同一 specialist test 通过后的 artifact export，不是另一个 test layer。
- `release:smoke` 指 `pnpm release:smoke`，即 canonical full packed consumer acceptance entry。
- `MCP tests` 指由 `packages/mcp/scripts/run-test-group.mjs` 分类的 unit、integration、stdio、write、recovery 和 E2E group。
- `repository contract` 指 `pnpm verify:repository-contract`。
- `A1 cross-platform` 指 `.github/workflows/a1-cross-platform.yml`。

| Capability（能力） | Canonical owner（规范 owner） | Secondary coverage（辅助覆盖） | Packed artifact? | External consumer? | Cross-platform? | Notes / intentional gap（说明/有意保留的 gap） |
| --- | --- | --- | --- | --- | --- | --- |
| Setup package detection | `openapi-to-setup.node-test` | repository contract | No | Temporary project | Yes: A1 | 区分 aggregate、MCP-only、missing 和 version-conflict state。 |
| Setup CLI project bootstrap | `@openapi-to/cli` focused setup integration + `release:smoke` packed consumer | repository contract, A1 built-bin smoke | Yes | Yes | Yes: source-built A1; packed Linux | 验证 `openapi setup --host codex --scope project` 的 deterministic preflight、config/ignore/Skills/Codex writes、dry-run no-write、rerun/no-op、Developer default、显式 Read-only/Hardened modes、restart boundary 与 fail-closed conflicts；重启后的 Desktop actual Tool/schema evidence 仍由 supervised/manual Host acceptance 负责。 |
| Setup package-manager detection | `openapi-to-setup.node-test` | A1 cross-platform | No | Temporary project | Yes: A1 | 覆盖 declared manager、unique lockfile evidence、unknown manager 及 conflicting/multiple lockfile。 |
| Setup config detection | `openapi-to-setup.node-test` | repository contract | No | Temporary project | Yes: A1 | 读取 supported config byte 但不执行 config；多个 candidate 会阻塞。 |
| Setup Codex Host detection | `openapi-to-setup.node-test` | `release:smoke` bridge | No | Temporary project | Yes: A1 | Conservative text inspection 负责 state inference；bridge 只验证 packed runtime agreement。 |
| Setup Host runtime classification | `repository contract` / supervised Host evidence | `openapi-to-setup.node-test` | No | Yes for Desktop | No deterministic Desktop UI gate | 区分 `MCP_SERVER_UNAVAILABLE`、`MCP_STARTUP_FAILED` 与 `MCP_HOST_COMPATIBILITY_SUSPECTED`；SDK、Codex CLI、Desktop evidence 分别标注。 |
| Setup observedStateHash | `openapi-to-setup.node-test` | `release:smoke` bridge | No | Temporary project | Yes: A1 | 绑定 manifest、lockfile、generation config、ignore file、Codex config 和相关 state。 |
| Setup portable verified reads | `openapi-to-setup.node-test` | A1 cross-platform | No | Temporary project | Yes: A1 | 在可用时使用 `O_NOFOLLOW`，其他平台使用 verified `O_RDONLY` fallback。 |
| Setup symlink/root boundary | `openapi-to-setup.node-test` | A1 cross-platform | No | Temporary project | Yes: A1 | 仅当 Windows 拒绝创建 symlink 时，才可 skip symlink capability。 |
| Public package pack | `release:smoke` | `test:consumer:codegen` | Yes | Yes | Linux CI | 两者调用相同的 `packReleasePackages`；release smoke 负责完整 packed acceptance claim。 |
| Packed dependency override | `release:smoke` | `test:consumer:codegen` | Yes | Yes | Linux CI | 两者复用 `createPackedOverrides`，不存在第二套 override implementation。 |
| Aggregate-only install | `release:smoke` | publication-manifest smoke | Yes | Yes | Linux CI | 只安装 `openapi-to`，并强制所有 transitive workspace package 使用同一组 tarball。 |
| Installed CLI bins | `release:smoke` | `test:consumer:codegen`, A1 binary checks | Yes | Yes | Linux packed; A1 source builds on all OSes | 验证 installed `openapi` 与 `openapi-to`；A1 是 portability evidence，不是 packed acceptance。 |
| Versioned consumer Skill assets | `release:smoke` | asset-builder Node tests, package-surface contract | Yes | Yes | Linux packed; deterministic builder tests on local/CI host | 单个 CLI tarball 携带两个 Skill 与 version-bound manifest；repository `.agents/skills` directory 仍是 authoritative，并作为显式 Turbo cache input。 |
| Codex Skill installer dry-run | `release:smoke` | focused installer tests, A1 built-bin smoke | Yes | Yes | Linux packed; source-built aliases on Ubuntu/macOS/Windows | 使用带空格的 isolated Host/notifier home；human 与 JSON dry-run 都不得创建 state，aggregate wrapper 也不得运行 update-notifier。 |
| Codex Skill installer commit/rollback | focused installer tests | `release:smoke`, A1 built-bin smoke | Packed in secondary | Temporary project | Yes: A1 | Unit coverage 注入 copy、staging、concurrent target creation/replacement、rollback 和 destination-identity failure。Atomic target reservation 不覆盖后来出现的 destination；interrupted owned target 通过 bounded journal 与 ownership marker recovery，包括两个 target 已 commit 时报告 success。Packed smoke 按 byte 验证两个 installed Skill tree。 |
| Codex Skill existing-destination rejection | `release:smoke` | focused installer tests, A1 built-bin smoke | Yes | Yes | Linux packed; source-built aliases on Ubuntu/macOS/Windows | 第二次 invocation 以 nonzero 退出，并保持所有 installed byte 不变。 |
| Installed MCP bin | `release:smoke` | MCP stdio E2E, A1 binary checks | Yes | Yes | Linux packed; MCP/A1 smoke on all OSes | 覆盖 aggregate wrapper 与 independently installed MCP package path。 |
| ESM/CJS exports | `release:smoke` | package unit tests | Yes | Yes | Linux CI | 从 installed tarball 测试 aggregate 与 direct package export。 |
| TypeScript package surface | `release:smoke` | package typechecks | Yes | Yes | Linux CI | 以 strict mode 编译 installed package set 的 public import。 |
| Formal-plugin generation | `test:consumer:codegen` | `release:smoke` | Yes | Yes | Local/CI host | Release smoke 复用 `runConsumerCodegenScenario`，不拥有 duplicate fixture suite。 |
| Generated TypeScript compile | `test:consumer:codegen` | `release:smoke` | Yes | Yes | Local/CI host | `skipLibCheck: false` 的 strict compile 负责 generated-consumer validity。 |
| React Query consumer type contract | `test:consumer:codegen` | `release:smoke` | Yes | Yes | Local/CI host | Consumer 显式安装 React、`@types/react` 与 TanStack Query v5；以 `QueryClient.fetchQuery`、generated React hooks、typed mutation variables/options、select inference 和 error typing 验证真实 public API 使用。 |
| React Query cancellation/config boundary | `test:consumer:codegen` | `release:smoke` | Yes | Yes | Local/CI host | Generated query 的 `AbortSignal` forwarding 与 caller-owned request config immutable merge 由 packed generated-source assertions 锁定。 |
| React Query aggregate/direct exports | `test:consumer:codegen` | `release:smoke` | Yes | Yes | Local/CI host | 同一 packed consumer 解析 aggregate `pluginReactQuery` 与 direct `@openapi-to/plugin-react-query` entrypoint；普通 aggregate-only consumer 不安装 React/TanStack runtime。 |
| Selective React Query projection | `packages/openapi` selective-generation integration | `release:smoke` packed MCP selective Apply | No | No | Local/CI host | Core projection 验证 selected operation 只生成对应 React Query artifacts，并保持与 full generation 的 bytes 一致；packed MCP selective Apply 另行验证安装后的 selective protocol。正式 React Query consumer 的 packed contract 由上方 rows 负责，不重复建立 selection harness。 |
| Generated Zod runtime | `test:consumer:codegen` | plugin tests, `release:smoke` | Yes | Yes | Local/CI host | 使用 Zod 4 执行 generated schema。 |
| Idempotent regeneration | `test:consumer:codegen` | plugin fixtures | Yes | Yes | Local/CI host | 比较完整 generated file set 与 byte。 |
| Drift detection and recovery | `test:consumer:codegen` | Core/CLI generation tests | Yes | Yes | Local/CI host | 注入 managed-file drift，要求 exit 6，重新 generation/recompile，并检查原始 byte。 |
| Review snapshot export | `consumer-codegen review export` | `consumer-codegen-smoke.node-test` | Derived from packed run | Yes | Local maintainer workflow | 仅是 human-review artifact，有意不作为独立 authoritative E2E。 |
| MCP stdio startup | `MCP tests` | `release:smoke` | Yes in secondary | Yes in secondary | Yes: MCP cross-platform smoke | MCP lifecycle 与 protocol stdout integrity 仍由 MCP test 负责。 |
| MCP startup diagnostics | `MCP tests` | `release:smoke` | Yes in secondary | Yes in secondary | Yes: MCP cross-platform smoke | stderr-only、phase/category、bounded redaction 与 stdout integrity；不会把 Desktop Host failure 伪装成 local root cause。 |
| Tool name matrix | `MCP tests` | `release:smoke` | Yes in secondary | Yes in secondary | Yes: MCP cross-platform smoke | Name 与 mode semantic 很重要；单独的 count 不是 capability evidence。 |
| Tool input/output Schema | `MCP tests` | `release:smoke` | Yes in secondary | Yes in secondary | Linux packed | Schema unit test 负责 production contract；packed smoke 验证 installed metadata。 |
| Tool annotations | `MCP tests` | `release:smoke` | Yes in secondary | Yes in secondary | Linux packed | Packed smoke 检查 read-only、destructive 与 idempotent hint。 |
| Target listing | `MCP tests` | `release:smoke` | Yes in secondary | Yes in secondary | Linux packed | Release smoke 从 installed tarball 验证 target order。 |
| Operation search | `MCP tests` | `release:smoke` | Yes in secondary | Yes in secondary | Linux packed | 覆盖 target-scoped same-operation-name isolation。 |
| Operation contract retrieval | `MCP tests` | `release:smoke` | Yes in secondary | Yes in secondary | Linux packed | 验证有界的 target-scoped contract retrieval。 |
| Dry Run | `MCP tests` | `release:smoke`, `test:consumer:codegen` CLI dry-run | Yes in secondary | Yes in secondary | Linux packed | MCP test 负责 Tool semantic；specialist codegen 另负责 CLI no-write behavior。 |
| Prepare | `release:smoke` | MCP integration/E2E | Yes | Yes | Linux packed | Canonical packed-consumer proof；MCP test 保留更深的 protocol 与 failure-path coverage。Prepare 仍 write-free，并独立绑定 approval。 |
| Apply | `release:smoke` | MCP integration/E2E | Yes | Yes | Linux packed | Canonical packed-consumer proof；MCP test 保留更深的 protocol 与 failure-path coverage。Developer direct generation 不等于 Hardened Apply；`--allow-write` 已被拒绝，Hardened Apply 仍需 exact approval。 |
| Token replay rejection | `MCP tests` | `release:smoke` | Yes in secondary | Yes in secondary | Linux packed | Bridge 不重复 token protocol coverage。 |
| planHash drift rejection | `MCP tests` | `release:smoke` current-plan binding | Yes in secondary | Yes in secondary | Linux packed | Source/config/ownership/selection drift 属于 controlled-write test；bridge 只检查 Setup evidence drift。 |
| Three-state commit | MCP write/recovery tests | `release:smoke` | Yes in secondary | Yes in secondary | Linux packed | Generated output、ownership 和 selection state 一起 commit 或 rollback。 |
| Output ownership | MCP write/recovery tests | `release:smoke` | Yes in secondary | Yes in secondary | Linux packed | 保留 unmanaged file，并拒绝 stale/unsafe ownership。 |
| Remote document policy | MCP integration/E2E | `release:smoke` | Yes in secondary | Yes in secondary | Linux packed | 覆盖 operator ceiling、private host、redirect header 和 redaction。 |
| Setup Inspector ↔ packed MCP Developer/Read-only/Hardened agreement | `release:smoke` bridge | `openapi-to-setup.node-test`, MCP tests | Yes | Yes | Release-smoke platform | Repository-Skill Inspector 必须区分 Developer 与 Read-only 的 8-Tool Schema 与 runtime effect，并验证 Hardened 的 Prepare/Apply；等价的 packed MCP command 必须暴露匹配的 current Schemas。 |
| Setup first-plan safety contract | `repository contract` | `openapi-to-setup.node-test`, static evaluation matrix | No | No | Platform-neutral Node | 守护 Inspector-first、PACKAGE_READY provenance preservation、supported config authority、project-level relative Host config、真实 hash helper、exact approval 和 `RESTART_REQUIRED` 边界；static contract 不声称真实 LLM 一定遵守。 |
| Setup natural-language first-attempt conformance | Supervised/manual real Codex acceptance（Issue #112） | `repository contract`, `release:smoke` bridge | Yes in secondary | Yes | Host-dependent | 使用普通用户 prompt 验证第一次 Setup Plan；不得用人工纠正后的第二版 Plan、helper/unit/static/packed PASS 冒充 real-Agent conformance PASS。 |
| Generate natural-language first-attempt conformance | Supervised/manual real Codex acceptance（Issue #113） | `repository contract`, static evaluation matrix, `release:smoke` bridge | Yes in secondary | Yes | Host-dependent | 使用普通用户 backend API preview prompt 验证 MCP-authoritative discovery、完整 bounded evidence、preview provenance 与 no-write；不得用 helper/unit/static/packed PASS 冒充 real-Agent conformance PASS。 |
| Consumer acceptance entrypoint and no-duplication contract | `repository contract` | bridge Node tests | No | No | Platform-neutral Node | 守护 matrix、三个 canonical command、一次 release-smoke pack call、bridge wiring/check ID 以及禁止 duplicate golden-path pattern。 |

## 边界与有意保留的 gap（Boundaries and intentional gaps）

`release:smoke` 只创建一次 tarball，并将其复用于 formal-plugin scenario 和所有 packed package/MCP check，同时在已安装的 external consumer 中运行 Setup-to-MCP bridge。Bridge 使用 exact repository checkout 中的 Setup Inspector，以及从该 checkout 的 tarball 安装的 MCP runtime。本文不声称 Inspector 会随 npm package 发布。

同一次 pack run 会安装 aggregate tarball，解析 CLI package 的 versioned Skill asset；在隔离且完全启用 update-notifier 的环境中运行 human dry-run，证明它既不创建 Host state，也不创建 notifier state；随后重复 machine-readable dry-run，安装两个 Skill，比较 installed hash 与 packaged byte，并证明第二次 install 会失败且不产生 mutation。Restart Codex 仍是文档化的 user action；CI 不模拟 Host UI restart behavior。

Bridge 只证明：

```text
Inspector inferred mode ↔ packed MCP actual named Tool capability
```

它不会重复 formal-plugin edge case、CLI coverage、remote policy、Prepare/Apply transaction content、replay 或 recovery；这些仍由上方的 canonical owner 负责。

`helper/unit/static/packed evidence != real-Agent natural-language first-attempt conformance`。Real Agent natural-language behavior、Host trust prompt、Host restart/UI interaction 和 generated code 的 human review，有意不建模为确定性的 automated test；它们由 Issue #112 的 supervised/manual acceptance owner 负责。Static Skill contract、packed bridge 和 Tool count 不能替代这些 behavior。Packed bridge 的报告明确标记为 `packed-runtime-handoff-only`，其 fresh packed process Tool/schema 检查也不等于用户重启后的 Host evidence。
