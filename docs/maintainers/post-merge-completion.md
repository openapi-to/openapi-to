# Post-Merge Completion Observer

本文说明阶段一只读 observer 的入口、证据边界、分类结果与恢复方式。observer 部署后
也不会自行把 Development Issue 标记为 `DONE`。`MERGED != DONE`。

## 阶段一范围与权限

`.github/workflows/post-merge-completion.yml` 监听 Quality、E2E、A1 cross-platform
contracts 的 `workflow_run.completed`，只处理 `main` 上游 push。它在默认分支中执行；
代码显式 checkout 当前受信 `main`，不 checkout PR head、不下载或执行 upstream artifact，
也不运行 install/build/test/package hook。该 workflow 文件必须先由维护者合入默认分支，
合入前不会接收目标事件，bootstrap PR 也不会依赖它验证或关闭自己。

observer 的 Job permissions 为 `contents: read`、`actions: read`、
`pull-requests: read`、`issues: read`。脚本的 GitHub adapter 只暴露 GET 方法，运行时只
向本次 Job Summary 追加有界报告。它不创建 PR/Issue comment，不改 Issue、PR、Label，
不 dispatch、rerun、写 artifact 或启用任何 live mode；workflow 没有 `schedule` 或
`workflow_dispatch`。

Issue、PR、Handoff、workflow 输出和 API 文本均视为不可信数据。它们只进入受限解析器，
不会进入 shell、动态代码或 import。Job Summary 会移除控制字符和常见 Markdown/HTML
注入符号并限制长度。API 响应和分页均有数量上限。API 权限/endpoint 不可用时结果为
`BLOCKED`，不会将缺失读数当成无 blocker。

## 事件身份与当前候选

收到事件后，observer fresh-read repository 和上游 run，并逐项比较事件与 API 的
repository numeric ID/full name、workflow ID/name/path、Run ID、attempt、event、branch、
head SHA、status/conclusion。目标 run 必须是上述三条 workflow 中之一，`event=push`、
`head_branch=main`。用于验证的 SHA 是 `workflow_run.head_sha`；完成 observer 自己的
`GITHUB_SHA` 不代表上游 CI SHA。

接着通过 GitHub commit-associated PR API 查询该 SHA，并 fresh-read 每一个关联 PR 及其
merge endpoint。只有唯一满足 `merged=true`、`base=main`、同仓库且
`merge_commit_sha == verification SHA` 的 PR 才可继续。事件数组为空、没有合并身份、
多个 PR 共享候选关系或身份不完整都不会转而扫描 Issues，也不会按时间、标题、分支名
推测。

候选 Issue 只从 canonical Structured PR Handoff 的“摘要”字段解析同仓库精确
`Refs #N`。随后读取原生 Issue 和 dependency API，确认它是完整 Development Task、仍
开放且没有 native blocker。缺失、重复、非 Development Task、非开放、跨仓库或 blocker
读数不可用都 fail closed。

v1 要求 fresh-read `main` HEAD 与 verification SHA 完全相同。祖先关系不证明改动仍然
成立或没有被 revert；main 前进时输出 `BLOCKED / STALE_MAIN`。本批不实现自动恢复入口；
维护者可在后续真实上游 completion 或人工启动的新运维流程中重新核验全部 facts。没有
轮询、sleep、自动重触发、schedule 或自触发。

## Main CI 聚合

每次完成事件只唤醒一次检查，不表示其他 workflow 已完成。observer 对候选 SHA 分页读取
Actions runs，严格只接受 `event=push`、`head_branch=main`、同 SHA 和当前 workflow
identity。对每个 workflow 选择最新适用 run/attempt；新 run 的 pending/failure 不会被旧
success 覆盖。PR、`merge_group`、其他 branch 或其他 SHA 的 green run 不参与聚合。

当前 Main CI 由以下事实组成：

- Quality：workflow success 且 `Required quality` Job 成功。
- E2E：workflow success、`Required E2E` Job 成功，并额外要求当前 Main-only 的
  `MCP performance and bounded stress` 成功。它不属于 `Required E2E` 的 needs 集合，
  因此单看 aggregate Job 不够。
- A1 cross-platform contracts：workflow success 且 `Required A1 cross-platform` Job
  成功。

Main push 下不接受 docs-only skip；必要 workflow/job 缺失且尚未产生时返回
`WAIT_FOR_MAIN_CI`。Run 未完成也返回 WAIT。失败、取消、非法 skip、未知 terminal
conclusion、缺失 aggregate/Main-only Job、API 读数失败或必要事实未知返回 `BLOCKED`。
已终结却缺少必要事实时，报告恢复缺口，不假设一定会收到另一个 completion event。

## 结果与 DONE Gate

| Result | 含义 |
| --- | --- |
| `SKIPPED` | 明确非目标事件或非目标上游 workflow。 |
| `WAIT_FOR_MAIN_CI` | 上游未完成，或同 SHA 的适用 Main CI 尚未产生/完成。当前运行结束，等待真实后续事件。 |
| `BLOCKED` | 失败、身份/关联歧义、stale main、native blocker、证据缺失或其他 Unknown。报告 reason 与可观察恢复缺口。 |
| `WOULD_CLOSE` | 阶段一不会产生。只有未来受信 contract 的全部 DONE Gate 真实可证时才可考虑该结果。 |

当前 Issue 尚未冻结可信 acceptance provenance contract。即便所有 Main CI 成功，evaluator
也会输出 `BLOCKED / ACCEPTANCE_EVIDENCE_UNVERIFIED`，同时列出未证明的 AC、Independent
Review 和 post-merge validation gate。Issue/PR checkbox、自报 PASS、Project 状态、CI
green 或测试 fixture 都不是这些真实证据。`WOULD_CLOSE` 只作为未来接口概念，不是本批
的可达分支；没有 Issue/PR/Label 写入路径。

Job Summary 分开列出事件 Run identity、verification SHA、candidate、CI 状态、未证明
gate、result/reason 和 recovery gap。observer workflow 自己成功，最多表示只读分类脚本
成功运行，不等于候选 Issue 达到 `DONE`。

## Bootstrap 与恢复

部署顺序：先审阅并合入 observer workflow 与 evaluator；从该时点后的真实 completion
事件检查权限、身份和 Summary。bootstrap PR 不依赖该功能自我关闭。阶段一不 dispatch
历史事件、不关闭任何 Issue，也不修改 Work/AO 状态。

遇到 `WAIT_FOR_MAIN_CI`，无需本地轮询；等待真实适用 CI completion event。遇到
`STALE_MAIN`、关联不清、event 可能遗漏或所有 CI 已结束但必要 facts 不存在时，需人工
使用当前 main、PR、Issue、native dependency、Review 和 CI facts 重新评估恢复方式。没有
已实现的 manual dispatch 恢复入口；后续如增加，只能接收有界候选身份和 expected main
SHA，并重新读取所有 native facts，输入本身不是证据，也不能改变 observe 权限。

## 阶段二至四待决事项

1. **阶段二：可信 acceptance contract。** 冻结版本化 contract、Task Contract/AC
   snapshot、producer provenance、PR/head/merge SHA binding、撤销/过期规则、post-merge
   复验范围与完整 AC 覆盖验证。实现前不能把任意文本、actor login、checkbox、旧 Review
   或 artifact 当作 receipt。
2. **阶段三：default-off writer。** 另行设计唯一 writer、最小 Issue write 权限、并发与
   部分成功恢复、去重、fresh-read-before-mutation 和 readback。该批未实现 writer、
   `issues: write`、live flag 或写 API。
3. **阶段四：受控 live rollout。** 在明确授权后重新核验 Work、AO、Agent 与人工 API
   writer ownership，确认唯一 writer，并由维护者指定真实 Development Task 验证一次写回、
   重复事件与 readback。GitHub Actions concurrency 不能锁住外部 writer；#254 仍须经过
   独立的 post-merge verification 才可能 DONE。
