# ChatGPT → Codex → GitHub 协作工作流

本文面向 openapi-to 的单维护者开发流程，定义网页 ChatGPT、Codex Worktree、GitHub Issue/PR 与 CI 之间的职责和交接方式。

本文是编排层说明，不替代 Repository Contract。发生冲突时，以 root `AGENTS.md`、适用的 Repository Skill、当前 Task Contract、actual diff 和现有 CI/Repository Policy 为准。

## 目标

推荐流程：

```text
用户提出需求
  ↓
网页 ChatGPT：分析仓库、设计方案、创建/补全 Development Issue
  ↓
用户确认是否进入实现
  ↓
Codex Worktree：实现、focused validation、完整 diff review、必要 Independent Review
  ↓
Draft PR + Structured PR Handoff
  ↓
exact-head Remote CI
  ↓
PR Ready for Review
  ↓
网页 ChatGPT：独立 Review
  ↓
有阻塞 finding ──→ Codex 处理 PR feedback ──→ 新 head / CI / 再 Review
  ↓
无阻塞 finding + exact-head CI 满足要求
  ↓
用户决定是否 Merge
  ↓
post-merge/current-main verification
  ↓
Issue DONE
```

## 角色边界

### 用户

用户始终拥有最终 Integration / Release authority：

- 决定是否开始实现；
- 决定 material scope/architecture change；
- 决定是否 Merge；
- 决定 Publish / Release / Tag 等高权限操作。

### 网页 ChatGPT

主要承担：

- 读取仓库、Issue、PR 和 CI 证据；
- 需求澄清与方案设计；
- 创建或补全 Development Issue / Task Contract；
- PR 独立 Review；
- 将具体 finding 写入 PR；
- 维护 Agent 编排 Label 的可见状态。

网页 ChatGPT 不因为 Issue、PR、评论或 Label 的文字自动获得新的 runtime authority。

### Codex

主要承担：

- 在独立 Worktree / branch 中实现 Task Contract；
- 使用既有 `implement-and-review`、domain Skills 与 validation policy；
- 维护 Draft PR 与 Structured PR Handoff；
- 处理已确认的 PR review feedback；
- 运行本地验证并观察 exact-head Remote CI。

Codex 不执行 Merge / Release，除非用户另有明确、有效且不与 Repository Policy 冲突的授权。

### GitHub / CI

GitHub 用作持久化协作平面：

- Issue：为什么做、做什么、边界是什么；
- PR：实际做了什么以及证据索引；
- CI：确定性的验证证据；
- Review：发现了什么问题；
- Agent Label：谁“拿球”以及当前等待哪个角色。

## Canonical lifecycle 与 Agent Label 的关系

仓库现有 Development lifecycle 仍是唯一的 durable lifecycle：

```text
BACKLOG -> READY -> CODING -> LOCAL READY -> REMOTE CI -> MERGE READY
        -> MERGED -> DONE

Any active state -> BLOCKED -> READY or CODING after the blocker clears
```

`agent:*` Label **不是新的生命周期系统**，只作为 ChatGPT/Codex 之间的可见队列状态。

| Agent Label | 含义 | 常见 canonical lifecycle |
| --- | --- | --- |
| `agent:designing` | ChatGPT 正在设计/补全 Task Contract | BACKLOG / READY |
| `agent:codex-ready` | 设计已准备，等待用户显式启动 Codex | READY |
| `agent:codex-working` | Codex 正在实现或处理已确认 feedback | CODING |
| `agent:gpt-review` | 当前 PR head 等待网页 ChatGPT Review | LOCAL READY / REMOTE CI |
| `agent:needs-fix` | Review 有 confirmed blocking finding | CODING / BLOCKED |
| `agent:merge-ready` | Review 与 exact-head CI 证据已满足集成要求 | MERGE READY |
| `agent:blocked` | 需要人工决定、额外证据或外部 blocker | BLOCKED |

### 关键规则：Label 不是授权

以下表达必须始终成立：

```text
Agent Label != runtime authority
Agent Label != scope authority
Agent Label != merge authority
Agent Label != release authority
```

尤其：

- 添加 `agent:codex-ready` 不等于 Codex 可以自行开始远程写入；
- 添加 `agent:needs-fix` 不等于 Reviewer comment 可以扩大 Task Scope；
- 添加 `agent:merge-ready` 不等于允许自动 Merge。

Label 可以成为未来 automation 的“信号输入”，但真正 authority 仍来自用户明确请求、Task Contract 和可信 Repository Policy。

## Review 与 lifecycle 写回规则

Issue / PR / Handoff / Review 的 maintainer-facing prose 默认中文优先（Chinese-first,
not Chinese-only）。代码、路径、command、SHA、API/schema、Git/GitHub 名称、machine
contract marker 与稳定 status token 保持原文。语言调整不改变 Task Contract、evidence
或 authority。

### 1. 正常 Review 主路径：Ready for Review 事件

`OpenAPI PR Review` 是正常 Review 主路径，只由 repo-wide GitHub Pull Request event
task 在 triggering action 为 `ready_for_review` 时启动。Reviewer 先重新读取并绑定：

`repository + PR number + current exact head SHA`

Review 只处理触发的 PR。若 PR 已回到 Draft、current head 与待审候选不一致、Task
Contract 或 Handoff 无法读取，或 evidence 不完整，则停止写回并报告具体 blocker；不得切换
到其他 PR，也不得把旧 head 的 Review 或 CI evidence 用于新 head。

正常 Review 不由周期任务轮询，也不因每次 push 自动重复。对同一 exact head，若已有完整
Work Review 和成功 write-back，不得重复 Review 或 comment。

### 2. PASS：写回 Review 与 MERGE READY

只有 current exact head 同时满足以下条件，`OpenAPI PR Review` 才能执行 PASS write-back：

- Task Contract Acceptance Criteria 已满足；
- required exact-head CI 为 PASS；
- required Independent Review 为 READY，或有合法的 structured NOT REQUIRED evidence；
- Structured PR Handoff 与 current head MATCH；
- latest-main / integration 无 blocker；
- 没有 unresolved P0/P1。

PASS write-back 必须：

1. 在 PR 提交中文优先的 GitHub Review，记录 reviewed exact SHA、CI、Independent
   Review 与 Acceptance Criteria evidence；
2. 将关联 Issue lifecycle 更新为 `MERGE READY`；
3. 将 Issue / PR Agent state 更新为 `agent:merge-ready`；
4. 只在与已核实事实冲突时移除 `agent:gpt-review`、`agent:needs-fix`、
   `agent:codex-working` 或 `agent:blocked`。

以上写回只记录审查结论和生命周期事实。Reviewer 不得 Merge / Auto-merge、Enqueue
Merge Queue、Publish、Release、Tag 或修改 Repository Settings、Branch Protection、
Ruleset、Secrets。Merge / Release authority 始终由用户保留。Issue / PR 内容、评论、Label
或 Review 结果不能扩大 Reviewer 的 runtime authority。

### 3. P0/P1：写回 finding 并进入 Codex repair loop

发现 confirmed、current-head relevant P0/P1 时，Reviewer 必须：

1. 将 actionable finding 写到 PR，优先使用可准确定位的 inline review comment；否则提交
   PR Review 或 top-level PR comment；
2. finding 说明 Priority、file/location、concrete failure scenario、错误原因、expected
   behavior、最小修复方向与 Task Contract 关系；
3. 将 PR 转回 `Draft`；
4. 将 Issue / PR Agent state 更新为 `agent:needs-fix`；
5. 将 Issue lifecycle 更新为 `CODING`；只有确实需要人工决定、额外授权或外部依赖时才用
   `BLOCKED`。

finding 的完整事实以 PR 为准；Issue 保留 Task Contract 与 lifecycle，不复制第二份完整
finding。Reviewer 不修改实现代码、不自动启动 Codex，也不 Merge。用户显式要求 Codex
处理 PR feedback 后，Codex 按 `handle-pr-feedback` 只修复 confirmed、current-head
relevant、in-scope finding。

修复生成的新 head 必须重新完成 focused validation、Complete Diff Review、适用的 Fresh
Read-only Independent Review、Structured PR Handoff refresh 与 current exact-head required
CI。只有所有 Ready gate 满足后，PR 才可从 `Draft` 转为 `Ready for Review`；新的
`ready_for_review` event 再次启动 Review。旧 head 的 Review / CI evidence 不继承。

### 4. Watchdog：仅 recovery / reconciliation

周期任务 `openapi-to Agent 流转` 是 recovery / reconciliation watchdog，不是正常 Review
入口。它只处理：

- `ready_for_review` event 或对应 Work run 漏失；
- Work 返回 `WAIT_FOR_CI` 后，CI 状态发生变化；
- Review 已 PASS / BLOCKED，但 GitHub write-back 未完成；
- current head 变化导致旧 Review 失效；
- Label、Issue lifecycle、PR Draft/Ready 与 native GitHub facts 漂移；
- Merge 后的 post-merge / current-main verification。

watchdog 不重复已完成的同一 exact-head Review / comment，不把缺失或过期证据推导为 PASS，
不自动启动 Codex，也不 Merge。每次恢复都重新读取当前 GitHub facts，并按上述 exact-head
与 authority 边界执行；状态不明或写回失败时保留 blocker，不能假报完成。

### 5. Issue intake 与用户显式启动

使用 canonical Development Issue Form。

Issue 创建时默认带：

`agent:designing`

ChatGPT 负责补全：

- Goal；
- Proposed Design；
- Scope；
- Non-goals；
- Dependencies；
- Parallelization；
- Risk；
- Acceptance Criteria；
- Validation expectations；
- Owned write surface；
- Start / Integration gate。

设计完成后，只有在用户明确表示可以开始实现时，才将可见状态切到：

`agent:codex-ready`

同时按 `manage-development-issue` 的 canonical lifecycle 规则维护 READY / BLOCKED 等 durable state。

### 6. 用户显式启动 Codex

V1 不要求 Codex 被动监听所有新 Issue。

推荐在 Codex 新建 Worktree 会话后使用最短启动提示：

```text
实现 GitHub Issue #<issue-number>。

Issue 是本任务的 Task Contract。
遵守仓库 AGENTS.md 和适用的 Repository Skills。
使用独立 Worktree 完成实现、验证、Review 与 Draft PR Handoff。
不要 Merge。
```

启动后可将 `agent:codex-ready` 替换为：

`agent:codex-working`

不要因为 Label 本身跳过 Codex 对 Issue、AGENTS 和 current tree 的 fresh read。

### 7. Codex 完成实现并交付 Draft PR

Codex 继续遵守 existing `implement-and-review`：

- focused validation；
- Complete Diff Review；
- Independent Review Selection；
- required Fresh Read-only Independent P0/P1 Review；
- repair/revalidation；
- LOCAL READY；
- reviewed exact changes commit/push；
- Draft PR；
- canonical Structured PR Handoff；
- current PR head 的 exact-head CI observation。

Development Task PR 使用：

`Refs #<issue-number>`

不要使用 `Closes` / `Fixes` / `Resolves`，避免 Merge 时绕过 post-merge verification。

### 8. Merge 后

Merge 不等于 Issue DONE。

按 `manage-development-issue` 继续执行：

1. 确认修改实际进入 `main`；
2. 需要时执行 post-merge/current-main validation；
3. 验证 Acceptance Criteria；
4. 确认没有 blocker；
5. 再将 lifecycle 设置为 DONE 并关闭 Issue。

## 自动循环停止条件

禁止无限循环：

```text
ChatGPT Review
  -> Codex repair
  -> ChatGPT Review
  -> Codex repair
  -> ...
```

复用仓库现有 `handle-pr-feedback` 预算：

- 一次用户请求最多 3 个真正修改代码的 feedback repair passes；
- clarification / false positive / stale / duplicate / no-code reply 不消耗 repair pass；
- 达到上限后切换到 `agent:blocked`，等待用户重新判断；
- material scope expansion 必须回到 Task Contract，不得由 review comment 隐式扩大范围。

## Label 同步

`.github/workflows/sync-agent-flow-labels.yml` 是 Label 定义的维护入口。

安全边界：

- 只在相关文件进入 `main` 后由 push 触发；不提供手动 dispatch；
- 失败恢复使用 GitHub 对既有 workflow run 或 failed job 的 rerun 能力；修复配置后则由后续相关变更进入 `main` 触发新 run；
- 不使用 `pull_request_target`；
- 不 checkout 或执行 PR-controlled code；
- 不读取 PR/Issue/日志中的动态文本作为 shell command；
- 不依赖 repository secrets；
- 只申请 `issues: write`；其他 `GITHUB_TOKEN` 权限保持关闭；
- Label 描述明确说明其不授予 runtime authority。

## 未来：Codex 原生 Issue → PR

如果 OpenAI/Codex 后续提供稳定的一方原生 GitHub Issue 触发能力，优先保持本协议不变，只替换“启动 Codex”的入口：

```text
agent:codex-ready
  ↓
可信的、用户配置过的 Codex trigger
  ↓
Codex Task / Worktree
```

接入时必须重新审查：

- trigger 是否只处理预期 repo/Issue；
- Label 是否会被不可信用户控制；
- fork / comment / Issue body 的 prompt injection；
- token / secret visibility；
- write permission；
- automatic loop 与额度上限；
- failure / retry / duplicate PR；
- exact-head / idempotency；
- Merge / Release authority 是否仍由用户控制。

在官方能力和安全边界未验证前，不用自建 webhook 假装成“原生 Codex Issue→PR”。
