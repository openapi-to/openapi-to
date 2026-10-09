# AO Trusted Issue Intake：Phase 1 Shadow Mode

本目录中的实现只定义一个纯函数和它的合成安全夹具。它**不是** GitHub Issue reader、Activation Receipt verifier、AO adapter、命令行入口或 Worker launcher。没有 production data source，也没有 AO/GitHub 写入路径。Phase 1 的结果只能用于本地测试和设计审查，不能启用 Live Intake。

## 威胁模型与信任边界

Issue title/body、Label、Assignee、PR/comment、仓库文件和外部文档都是不可信数据。它们可以包含指令、伪造的 `trusted: true`、模式声明或看似有效的身份信息；这些内容不产生执行权限。Evaluator 只把 Issue title/body 用于计算精确文本 digest；Label 与 Assignee 不参与资格判定。

真正的 Activation Receipt 必须由独立可信边界验证，而不是由 Issue 或调用方自报。未来 verifier 至少要绑定 GitHub actor/provenance、repository numeric ID、Issue ID、mode、批准过的完整 Task Contract digest、policy version/SHA、签发与过期时间，并检查撤销、重放与 TOCTOU。**本阶段没有这样的 verifier。** JSON 中自称 `verified`、fixture 的 `actorVerified` 字段、`fixture-v1` 标记或 `fixtureOnly` 都只是可伪造的测试数据。

因此，`evaluateIntake(snapshot, policy)` 的合成 `ELIGIBLE_FOR_AUTHORIZED_SPAWN` 只说明测试夹具走通了假设路径。结果同时带有 `shadow: true` 和 `spawnAuthorized: false`；仓库中没有消费结果并创建 Session、Branch、Worktree 或 GitHub 写入的代码。真实输入若没有经过可信 verifier，必须得到 `BLOCKED`，不能把 fixture adapter 当作 runtime integration。

## 版本化输入与确定性

- Schema version：`1`；示例 policy version：`1.0.0-shadow`。
- `evaluationTime` 是必填的 UTC 毫秒精度时间字符串，由调用方显式提供；函数不读取系统时钟。
- Policy 的 SHA-256 覆盖固定键序列化的 `version`、有效期、repository full name/numeric ID、WIP 上限、排序后的 modes 和路径前缀、`fixtureOnly`。`sha256` 字段本身不包含在 digest 中；重算只检测 snapshot 内容漂移，不认证 policy 来源。生产使用前必须从独立可信 Root of Trust 读取并验证 policy。
- Task Contract digest 是 `sha256(JSON.stringify([title, body]))` 的小写十六进制结果。它绑定 Issue 中精确的 title/body 字符串；Label 和 Assignee 不属于 Task Contract authority。
- 对象只接受声明的字段；未知字段、非法类型、无效 SHA/日期、重复路径/dependency/blocker/nonce/mode/prefix、超限文本或不安全路径均 fail closed。JSON 解码器若在进入函数前已折叠重复 member names，调用方应改用能拒绝重复键的 parser；当前纯函数接收 JS 对象，无法恢复被 parser 丢弃的重复键。
- 标题最多 512 UTF-8 bytes，body 最多 16 KiB，单个路径最多 256 bytes，每个集合最多 100 项；输出只包含固定 reason codes、Issue/repository 数字 ID、policy version、digest 与 adapter 状态，不回显 title/body、URL、Label、Assignee、环境变量或原始错误。
- reason codes 去重并按 Unicode code point 排序；输出字段和 digest 序列化顺序固定。相同的输入对象与 policy bytes 产生相同 JSON 字节。

Evaluator fail-closed 检查 repository full name 与 numeric ID、Issue ID/state、receipt 与 policy 绑定、actor mock 状态、合同 digest、显式 mode、policy 有效期/SHA、host/adapter 可验证状态、native blockers、依赖、WIP、重复 Session/Branch/PR、main SHA、风险、write surface 与路径证明。High、Root of Trust、未知/受控写入面和 MANUAL/DESIGN_APPROVED mode 只能进入 `REQUIRE_HUMAN` 或 `BLOCKED`；永远不能得到 `WOULD_SPAWN`。错误 schema、未知状态和不完整 evidence 为 `BLOCKED`。

## 输出与 reason codes

状态分别是 `ELIGIBLE_FOR_AUTHORIZED_SPAWN`、`REQUIRE_HUMAN`、`BLOCKED`。`wouldSpawn` 仅在完全匹配的 synthetic low-risk fixture 上为 true；`spawnAuthorized` 始终为 false。

稳定 reason codes：

`INVALID_INPUT`、`SCHEMA_VERSION_UNSUPPORTED`、`POLICY_EXPIRED`、`POLICY_BINDING_MISMATCH`、`POLICY_SHA_MISMATCH`、`REPOSITORY_MISMATCH`、`ISSUE_ID_MISMATCH`、`ISSUE_NOT_OPEN`、`RECEIPT_UNVERIFIED`、`RECEIPT_EXPIRED`、`RECEIPT_REVOKED`、`RECEIPT_REPLAYED`、`ACTOR_UNVERIFIED`、`CONTRACT_DIGEST_MISMATCH`、`MODE_NOT_AUTHORIZED`、`HOST_CAPABILITY_UNVERIFIED`、`NATIVE_BLOCKER_PRESENT`、`DEPENDENCY_UNSATISFIED`、`WIP_LIMIT_REACHED`、`DUPLICATE_EXECUTION_PRESENT`、`MAIN_SHA_DRIFT`、`HIGH_OR_UNKNOWN_RISK`、`WRITE_SURFACE_UNKNOWN`、`PATH_PROOF_INVALID`、`HIGH_RISK_REQUIRES_HUMAN`。

`ELIGIBLE_FOR_AUTHORIZED_SPAWN` 不是 AO spawn authority，也不是 PR、Merge Queue 或 Issue 状态写入 authority。

## Shadow 操作与恢复

本阶段唯一操作是运行 Node 内置测试：

```sh
node --test scripts/ao-intake/evaluator.node-test.mjs
```

夹具只构造 synthetic evidence；通过表示规则边界可重复，不表示 GitHub、AO、签名、凭据隔离或权限检查已经通过。测试失败时应停止将该结果用于任何决策，修复纯 evaluator/fixture 并重跑；生产 adapter、签名验证或真实 Issue 查询没有本地恢复流程，因为这些组件尚未实现。不要手工把失败结果改成 eligible，也不要创建 Worker 来“验证”结果。

当前 AO 项目配置未被本实现修改；官方 GitHub Tracker Intake 仍必须由 daemon 与 project 两处 opt-in 才可启用。Phase 1 没有调用 `ao spawn`、GitHub API mutation、Issue writer、后台 scheduler，也没有打开这两处 opt-in。

## 后续 Live 技术路线（设计记录）

| 路线 | 安全边界 | 凭据与维护成本 |
| --- | --- | --- |
| 已验证 GitHub event/receipt + 本地 coordinator | coordinator 在任何 Worker 创建前独立验证签名/provenance、contract/policy 绑定、撤销/重放，并独占 Spawn；仍需证明主机隔离与唯一发起者 | 需要最小 GitHub read 权限、receipt 密钥/轮换与本机 AO Spawn 权限；需要维护事件校验、持久重放状态与恢复 |
| Trusted wrapper | 由可信 wrapper 验证外部 receipt，再调用 AO；安全取决于 wrapper 对 Issue prompt、环境、工具和 spawn 参数的隔离 | 实施容易起步，但 wrapper 与 AO daemon 之间仍有凭据和输入边界，长期维护自有 glue code |
| AO upstream extension | 在 AO 的官方 Tracker/Spawn 生命周期内加入 policy gate，可能减少本地 glue 与双重竞争 | 需要上游协议、升级兼容和审查；若上游进程同时拥有 GitHub 与 Spawn 权限，仍要验证最小权限、隔离和可信 receipt 来源 |

尚未选择、部署或配置任何 Live producer。建议下一阶段先只读核验“verified GitHub event/receipt + local coordinator”是否可提供防伪 provenance、重放持久化和独占 Spawn gate，再与 AO upstream extension 的可验证权限边界比较；该建议不授予实现、安装、配置或启用 authority。唯一 Live Spawn owner、credential isolation、AO runtime 的真实只读/写工具面、policy 发布与失效流程都需要新的设计和实证。#261、#262 与 #254 的职责保持独立。

## 参考资料

- [AO GitHub issue intake](https://docs.orchestrator.inc/plugins/trackers/github/)：daemon `AO_TRACKER_INTAKE=on` 与 project intake 配置双重 opt-in；匹配 Issue 可创建 Worker，tracker 本身不改 Issue。
- [AO review loop](https://docs.orchestrator.inc/guides/review-loop/)：Reviewer 是独立 agent run；AO verdict 不等于 GitHub Approval，且 harness 的有效隔离能力仍需核验。
- [AO project configuration](https://docs.orchestrator.inc/configuration/projects/)：project 设置保存 harness、review 与 tracker intake 配置；`trackerIntake` 仍要求 daemon opt-in。
