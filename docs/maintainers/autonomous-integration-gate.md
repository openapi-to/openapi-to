# 自治集成 Policy Gate：Phase 1 Shadow-only

本目录的 evaluator 是一个版本化、默认关闭的纯函数。它根据结构化 evidence 和 pinned policy 输出 `WOULD_ALLOW_ENQUEUE`、`REQUIRE_HUMAN` 或 `BLOCKED`。所有输出都标记 `shadowOnly: true`、`enqueueAuthorized: false`；没有 GitHub、AO、shell 或 filesystem writer，也没有 Live runner。

`WOULD_ALLOW_ENQUEUE` 只表示合成或上游已验证证据满足当前 policy 的模拟判断。它不授权调用 GitHub Merge Queue、Enqueue、Merge 或 Auto-merge API，不改变 CI、Review、人工集成或 Release 的现有权限边界。任何消费者都必须把该字段当作审计结果，不能把它当成 bearer capability。

## 输入契约

`evaluateIntegration(snapshot, policy)` 接受 schema version `1`。输入必须是已验证适配器产生的有界数据；evaluator 会再次检查结构、policy/hash 绑定、contract 摘要、PR/main SHA、时间戳、AO Review provenance、required CI、依赖、WIP、重复候选和预算。未知字段、缺失字段、无效类型、不安全路径、过期或不匹配 evidence 都会得到 `BLOCKED`。

Policy 至少绑定 repository numeric ID、可信 actor allowlist、版本、有效期、evidence age、repair/CI rerun/WIP 上限、非治理文档 allowlist、Root-of-Trust paths 和 policy source marker。Policy SHA 覆盖除 SHA 和 provenance envelope 外的整个规范化 policy。Snapshot digest 绑定 snapshot 中的其他字段；snapshot 同时固定 policy version 与 SHA。真实系统仍须在 evaluator 外验证 policy provenance 和 adapter 的签名/来源；一个 JSON marker 或自报 digest 本身不是身份认证。

Evidence 要求 trusted actor provenance 且 actor 在 pinned allowlist 内；Issue Task Contract 当前摘要与批准摘要相同；PR repository/Issue identity 已绑定、开放且以 `main` 为 base，base 等于新鲜 main；changed-path 集合完整、untracked files 已核查，每个路径均有 repository containment、无 symlink、属于批准 scope 的证明；snapshot、AO Review 和 GitHub Actions evidence 均有新鲜且未重放的 provenance；AO Native Review 已完成、针对当前 PR/head、Review feedback 已投递、无开放 P0/P1，且 Reviewer 独立于 author/implementer；GitHub Actions 所有 required checks 对同一 PR/head 为 PASS；dependencies、WIP 与 duplicate 查询均已验证；repair 与 CI rerun 未超 policy 预算。缺失任何 provenance 都 fail closed。此契约只使用 AO Native Review，不接受旧 Independent Reviewer 路径，也不把 AO verdict 等同 GitHub-native approval。

## 分类与决策

- `WOULD_ALLOW_ENQUEUE` 仅用于 LOW risk、完整绑定、全部证据有效且改动只包含 policy allowlist 内的非治理 Markdown 文档。
- `REQUIRE_HUMAN` 用于 MEDIUM/HIGH/ROOT_OF_TRUST/UNKNOWN risk、Root-of-Trust、代码/配置和未批准分类。治理文件不能通过 candidate 自带 policy 替换其 immutable trusted policy。
- `BLOCKED` 用于无效、伪造、缺失、stale 或互相冲突的 evidence；actor/reviewer 自我批准；contract、PR head、main、policy、AO Review 或 CI provenance drift；开放 finding；未满足依赖、WIP 满额、重复 candidate 或超预算。Gate 自身路径在 evaluator 中硬编码为 `SELF_POLICY_CHANGE` 并阻断。
- reason codes 去重并按字典序稳定排序。输出只保留 repository/Issue/PR 数字 ID、contract 摘要、policy 版本、snapshot/AO Review/GitHub Review/CI IDs、head SHA、验证状态与 reason codes，不回显 contract 原文、评论、路径、URL、环境或原始错误。输入序列化上限为 128 KiB，输出上限为 8 KiB，各集合最多 100 项。

## Shadow evidence 边界

本阶段没有 production policy signer、可信 actor verifier、GitHub/AO evidence adapter、撤销服务、持久 replay store、PR 查询器或 Enqueue writer。测试使用 synthetic fixtures；它们验证规则、确定性、边界和负例，不证明运行时身份、Review 写权限隔离、远端数据真实性或任何 Live 能力。不可核验的生产来源必须由上游标成未验证，不能把测试 marker 当作认证。

验证 evaluator：

```sh
node --test scripts/autonomous-policy.node-test.mjs
```

全量 release-script collector 已通过 `scripts/*.node-test.mjs` 收集此 Node test 文件，无需改动 CI workflow 或 package script。Phase 1 不运行 writer，不接触 Issue 状态、GitHub Project、Secrets、Ruleset、AO daemon 配置或自动化调度。
