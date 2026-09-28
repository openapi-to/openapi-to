---
name: openapi-to-setup
description: Use when a consuming project needs openapi-to installed or initialized, generation-config or ignore-file setup, Codex MCP connection, runtime mode diagnosis, restart/recovery, or verification of expected 3/8/8/10 Tools. Do not use for API operation discovery or client generation, ordinary consumer product/plugin/config-option reference, product capability explanation, or already-generated output integration; hand those requests to openapi-to-generate. This Skill does not upgrade existing versions, publish packages, modify the openapi-to Monorepo, configure unrelated MCP Servers, or bypass Setup Plan or Apply approval.
---

# 设置 openapi-to

用于 consuming project 的安装/bootstrap、generation config、Codex Host 配置、runtime diagnosis 与 capability
verification。此 Skill 不负责普通产品/plugin/config 用法、API discovery/generation、generated output integration、
openapi-to Monorepo maintenance、dependency upgrade、publish 或无关 MCP Server。

普通首次 Codex project bootstrap（package install、init、ignore、Skills 与 Codex MCP config）必须直接使用
published CLI `openapi setup --host codex --scope project`；这是唯一 deterministic writer。不要把本 Skill 的
Setup Plan 或手动 Host instructions 用作普通 bootstrap 的替代。此 Skill 只负责 CLI bootstrap 后的 degraded diagnosis、
recovery 与 Host/runtime workflow；以下 exact-plan gate 只约束这些 workflow 中由 Skill 执行的 recovery/config mutations。

## Mandatory first-plan gate

Inspector 必须先于任何 Skill-mediated Setup Plan：

1. 先读取适用规则与 Git state，再运行 project Inspector；将结果用于区分配置证据与 runtime 证据。
2. Inspector 的 `BLOCKED` 状态必须停止相关规划，不得通过宽泛文件猜测绕过。
3. 任何 Skill-mediated mutation 前，读取 [safe writes](references/safe-writes.md)，构造有界的 exact Setup Plan，
   展示完整 plan 与 `setupPlanId`，并等待对该 ID 的明确 approval。
4. 修改 Codex Host config 后必须停在 `RESTART_REQUIRED`。新 session 中重新检查实际 Tools、相关 current `inputSchema` 与
   runtime evidence；stale 或 reload 不明确时完整重启 Host。

Inspector 字段、state classification 与 degraded diagnosis 见 [diagnosis](references/diagnosis.md)；
supported project/Codex configuration 与平台差异见 [Codex setup](references/codex-setup.md)。

## Runtime evidence boundary

配置存在、`codex.inferredMode`、预期 3/8/8/10 topology 和用户报告的 Tool 数量都不能证明 observed MCP
capability。只有 fresh actual Tool list、相关 current `inputSchema` 与可用 runtime evidence 才能建立
`MCP_*` 状态；缺少任一必要证据时必须报告 `UNKNOWN / UNVERIFIED`，不得推断为 analysis-only 或转交 Generate。

## Intent routing

- **诊断状态、Inspector 结果、缺失/仅有 3 个 Tools 或 degraded Host/runtime**：读取
  [diagnosis](references/diagnosis.md)。诊断不产生写入授权。
- **普通首次 bootstrap**：直接运行 published CLI `openapi setup --host codex --scope project`；不要进入
  Skill Setup Plan 写入路径。
- **CLI bootstrap 后的 Codex Host/platform diagnosis 或 recovery**：按需读取
  [Codex setup](references/codex-setup.md)。该 reference 不授权替代普通 CLI bootstrap。
- **Degraded/Host recovery 中的 Skill-mediated file/package mutation、exact plan、approval、Apply 或 state drift**：读取
  [safe writes](references/safe-writes.md)。没有 exact plan approval 不写入；不得用于普通首次 bootstrap。
- **Setup 已完成并有 runtime capability 证据**：按 observed state hand off 给
  `openapi-to-generate`；不满足所需状态或仍为 `UNKNOWN / UNVERIFIED` 时停止受影响流程。

Setup 只拥有 package/config/Host setup writes；Generate 拥有 Operation selection、generation Apply 与 business
code integration only.
