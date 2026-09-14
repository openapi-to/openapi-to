# 文档语言收敛审计（Issue #101）

本记录是 DOC-ZH initiative 的 bounded acceptance audit，不是第二份语言规范。语言规则
以 [`documentation-language.md`](./documentation-language.md) 为唯一 canonical source；本
记录只保存本次审计的范围、分类、事实核验和剩余边界。

## 审计基线

- 审计 revision：`cf8c5dbdaa1667a1ea1640d591fd4187f1f678d1`（`origin/main`，2026-09-14）。
- Issue prerequisites：#97、#98、#99、#100 均为 `CLOSED / COMPLETED`；#101 的 native
  `blocked_by` 为 #97、#99、#100，均已满足。
- 当前 open PR 只有 Version Packages #15；它不修改本审计的 developer-facing documentation
  surface。
- 审计入口：tracked root Markdown、`docs/**`、package `README`/`AGENTS`、`.agents/skills/**`、
  `.github` human-readable templates，以及其他 tracked developer-facing Markdown。

## 分类结果

### Chinese-first

root README、root 与 package `AGENTS.md`、公开 developer guides、architecture/MCP/security/
testing 文档、package README、`.github` human-readable templates，以及主要 `.agents/skills/**/
SKILL.md` 已以简体中文自然语言为主。代码、命令、路径、URL、Tool 名、schema 字段、status
values 和其他 machine-readable identifiers 按规范保留原文。

`docs/migration-v4.md` 在本次任务中完成了低风险 long-tail 收敛；其 command、path、API、
policy 和 compatibility boundary 未被改名或改写为新的行为。

### Intentional English

- `**/CHANGELOG.md` 和 `.changeset/*.md`：历史发布记录或 Changesets 输入；package names、
  version、依赖关系和 release wording 需要保持可追溯，不在语言验收中批量改写。
- `docs/releases/*.md` 和 `docs/validation/*.md`：带日期、版本、run evidence、gate status
  和未完成项的历史记录。它们明确记录过去的候选版本或验证会话，翻译可能让历史证据看起来
  像 current contract，因此保留原文并按历史资料处理。
- `.agents/skills/**/references/*.md`：Skill 的 checklist、contract reference 和调查矩阵。
  这些文件服务于 agent workflow，包含上游术语、机器接口和可复制的 review token；当前
  Issue 的 owned write surface 不允许借语言收敛修改其 behavior/metadata。
- `packages/config-ts/README.md`：tracked file 当前为空，不包含需要选择语言的自然语言内容。

### Mixed but acceptable

中文段落中保留 `Target`、`Workspace`、`Operation`、`Prepare`、`Apply`、`planHash`、
`Need Verification`、`Implemented`、CLI flags、package names 和 upstream specification
terminology，属于规范明确允许的 stable technical identifiers 或 status values。代码块和
命令输出保持原样。

### Needs migration

无。面向开发者的 prose 已有中文优先入口；本次唯一确认的 current English-first guide
`docs/migration-v4.md` 已完成低风险迁移。

### Need Verification

无未解决项。旧 validation records 中的历史版本、旧 runtime floor、7-Tool observation、
`NOT_RUN`、`UPSTREAM_POLICY_BLOCKED` 和 `READY_FOR_CI` 均被视为记录内容，不升级为当前事实。
当前事实重新以 repository source、tests、package manifests、CI 和现行 docs 核验：Node.js
runtime floor 为 22，MCP matrix 为无 config 3 个、trusted config 8 个、controlled write
10 个 Tools。

## 事实与链接核验

- `docs/mcp-operations.md`、`docs/capability-matrix.md`、root/package manifests、CI Node 22
  lanes 与 `.agents/skills/release-monorepo/**` 的 runtime/release boundary 相互一致。
- 没有新增第二份 language policy，也没有重命名历史路径、改变 capability/security/release
  status 或修改 MCP schema。
- `docs/migration-v4.md` 的相对链接继续指向现有 `docs/mcp-operations.md`、
  `docs/mcp-security.md` 和 `docs/mcp-write-recovery.md`。

## 结论与后续门

本 revision 的 audit surface 满足 Chinese-first、intentional English 有理由、无 unresolved
`Need Verification` 和无双 canonical truth。由于本次审计产生了文档变更，Issue #101 仍需在
该候选合入后重新执行 current-main post-merge verification，才能把 initiative 标记为
`DONE`；本记录不授予 Merge、Auto-merge、Release、Publish、Tag、Project 或 Repository
Settings authority。
