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

## V1：当前推荐触发规则

当前版本采用“状态可自动同步，执行显式启动”的方式。

### 1. ChatGPT 创建/补全 Issue

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

### 2. 用户显式启动 Codex

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

### 3. Codex 完成实现并交付 Draft PR

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

### 4. 进入 ChatGPT Review

当 current PR head 已达到仓库允许的 Ready for Review 条件，且用户/现有授权允许该 PR 状态变化时：

1. 将 PR 从 Draft 切换为 Ready for Review；
2. 将 Agent Label 切换为 `agent:gpt-review`；
3. 网页 ChatGPT 按 `docs/maintainers/chatgpt-pr-review.md` Review 当前 exact head。

如果 ChatGPT Work 配置了 PR Ready for Review 事件任务，可以把该事件作为 Review 的启动入口；没有配置时由用户显式发起 Review。

不要使用“每次 push 都自动 Review”的默认策略，避免实现阶段的多个中间 commit 造成重复 Review 和无意义额度消耗。

### 5. Review 发现阻塞问题

网页 ChatGPT 只报告有具体证据的 finding。

P0 / P1 finding 会阻止进入 MERGE READY，并将可见状态切为：

`agent:needs-fix`

V1 下，Codex 仍由用户显式请求处理 PR feedback，例如：

```text
处理 PR #<pr-number> 的 review feedback。

遵守 handle-pr-feedback Skill。
只处理 confirmed、current-head relevant、in-scope 的 finding。
不要 Merge。
```

Codex 处理时使用现有 `handle-pr-feedback`，最多执行 3 个真正修改代码的 feedback repair passes；不要因为 wording 变化重置计数。

修复产生新 head 后，旧 head 的 Review 和 CI evidence 不自动继承。

### 6. Review 通过

同时满足以下条件时，可以将 Agent Label 切到：

`agent:merge-ready`

- 当前 exact PR head 没有 unresolved P0 / in-scope P1；
- required Independent Review 已满足或有合法 structured skip evidence；
- required checks 对当前 exact head 为 PASS；
- Structured PR Handoff 已刷新并绑定 current head；
- 没有 unresolved integration blocker。

这只是“建议可集成”的可见状态。

**Merge 仍由用户执行。**

### 7. Merge 后

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

- 只在相关配置进入 `main` 或人工 `workflow_dispatch` 时执行；
- 不使用 `pull_request_target`；
- 不 checkout 或执行 PR-controlled code；
- 不读取 PR/Issue/日志中的动态文本作为 shell command；
- 不依赖 repository secrets；
- 只申请 `contents: read` 与 `issues: write`；
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
