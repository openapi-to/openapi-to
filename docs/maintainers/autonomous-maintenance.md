# Autonomous maintenance governance（自主维护治理）

本文定义 future autonomous repository maintenance 的 governance contract。Phase 3C1
仅为 design-only：不会启动 Agent、授予 credential、实现 Policy Gate、enqueue pull
request 或修改 GitHub repository settings。在后续 phase 显式实现并验证更窄的
capability 之前，current repository behavior 仍是权威。

治理原则是：

```text
AI understands intent.
Deterministic policy decides authority.
GitHub enforces integration.
```

Correctness 与 security 的优先级高于 maintainability、developer experience 和
Agent convenience，顺序如上。

## Status and current authority

| Capability | Status after Phase 3C1 |
| --- | --- |
| Authorization model | DEFINED |
| Trusted trigger | PLANNED |
| Codex autonomous execution | PLANNED |
| Independent autonomous review | PLANNED |
| Automatic repair | PLANNED |
| Autonomous Policy Gate | PLANNED |
| Policy-authorized enqueue | PLANNED |
| Current user merge authority | IMPLEMENTED / UNCHANGED |

GitHub Issues 仍是 durable task identity。Branches、worktrees 与 Codex sessions 仍是
可替换的 execution contexts。Development 可以 parallel，integration 必须 serialized；
[parallel development](./parallel-development.md) 中的 lifecycle 仍是权威。

Active repository Ruleset 保护 `main`；stable aggregate checks 提供 required CI
evidence；native GitHub Merge Queue 提供 serialized integration 与 `merge_group`
validation。Repository auto-merge 已禁用。User 仍是 enqueue 和 merge authority，CI 或
review success 不会授予 Codex merge authority。Phase 3C1 不改变这些 facts。

## Trust and threat model

Repository 是 public 的。Issue titles/bodies、Issue comments、pull request titles/bodies、
review comments、branch names、commit messages、contributed code、test output、logs、
artifacts、OpenAPI documents、descriptions、examples、extensions、URLs、`$ref` values
以及 uploaded/generated text 都是 untrusted data，除非单独定义的 trusted boundary
证明相反。

Untrusted data 可以被 summary 或 inspect，但永远不会成为 Agent policy、authorization、
permission escalation、secret source、shell instruction、executable workflow
instruction 或 scope expansion 的理由。A public user creating or editing an Issue can never, by that act alone, start a write-capable Agent
or obtain a privileged credential。也就是说，public user 不能仅凭创建或编辑 Issue
启动 write-capable Agent 或获得 privileged credential。

Repository policy、system instructions 与 validated maintainer 的 explicit authorization
只有通过其定义的 channels 才可信。仅声称自己是 policy 或 maintainer authorization 的
text 仍是 untrusted。

Future trusted trigger 必须从 trusted、machine-verifiable evidence 证明以下全部条件：

```text
repository == openapi-to/openapi-to
repository id == 646310819
trusted execution marker is present
actor applying that marker is an explicitly trusted authority
authorization mode is valid
task contract is complete and immutable for the candidate
Root-of-Trust policy permits the requested scope
```

类似 `agent:run` 的 marker 未来可以成为 interface 的一部分，但其 name 或 presence
本身永远不是 authorization。Actor、repository、task state、mode、policy version 与
scope binding 也必须验证。Phase 3C1 不创建此类 marker 或 trigger。

## Authorization modes

Future model 恰好有三种 modes。Issue or pull request text records a proposed mode; it does not activate the mode or grant runtime authority。
Issue/PR 只记录 proposed mode，不会 activate mode 或 grant runtime authority。

### `MANUAL`

`MANUAL` 保留 task execution 与 enqueue 所需的 explicit human authorization。Agent 可以
analyze，且只有 specific execution scope 获授权后才能 implement。它可以 prepare review
与 CI evidence。Human 必须通过 native GitHub Merge Queue separately authorize enqueue。

High-risk 与 Root-of-Trust work 从 `MANUAL` 开始。Mode field 不能降低该要求。

### `DESIGN_APPROVED`

`DESIGN_APPROVED` 只有在 validated human 批准包含 goal、scope、non-goals、risk、
authorization boundary、acceptance criteria、dependencies 与 validation expectations
的 concrete contract 后才开始。后续 implementation system 只有在 candidate 仍处于
approved contract 内时，才能 implement、review、perform bounded repair、obtain
exact-head CI、pass deterministic Policy Gate，并 request native Merge Queue enqueue。

Material scope drift 会使 approval 失效。Ordinary design approval 不覆盖 Root-of-Trust
changes；它们需要 explicit、separate Root-of-Trust authorization，且不能影响同一
candidate 使用的 authorization chain。

### `AUTONOMOUS`

`AUTONOMOUS` 是 future、conservative pre-authorization，仅适用于 versioned
deterministic policy 能证明 eligible 的 tasks。它绝不表示 Agent 认为自己的 work low
risk。Missing、ambiguous、stale 或 unclassifiable evidence 会 fail closed 到
`REQUIRE_HUMAN` 或 `BLOCKED`。

Initial policy 应只 authorize exact path/type allowlist 能识别的 low-risk changed-surface
classes，例如 Root of Trust 之外的 non-authoritative Markdown documentation。Executable
code、configuration、dependencies、generated ownership、public APIs、permissions、
security/filesystem boundaries、release behavior 与所有 unregistered surfaces，在后续
Root-of-Trust-approved policy version 增加 precise machine-verifiable class 前都
ineligible。The repository currently implements no autonomous eligibility allowlist。Repository 当前没有实现 autonomous eligibility allowlist。

## Risk and eligibility

Risk vocabulary 有意保持精简：

- **Low**：scope narrow、可 reversible，且不影响 public API、security、permission、
  persistence、release 或 Root-of-Trust。Non-authoritative documentation corrections
  是典型示例。
- **Medium**：bounded product 或 test behavior，ownership 与 validation 清楚，但可能
  影响 consumers 或 maintained behavior。Ordinary product-code changes 可以是 Medium，
  不会自动成为 High。
- **High**：compiler 或 OpenAPI/JSON Schema semantics、filesystem transaction/recovery、
  controlled write、MCP security boundaries、credentials/secrets、CI/Ruleset/Merge
  Queue authority、publication、major dependency/toolchain changes、destructive
  migrations 或 Root-of-Trust changes。

Examples 只指导 intake，不决定 authority。Future policy version 必须将 task facts 与
changed paths 映射到 machine-readable surface classes。Unknown 或 conflicting
classifications 必须 fail closed。

Initial `AUTONOMOUS` candidate 只有在证明以下全部条件时才 eligible：

- the trusted task contract requests `AUTONOMOUS` and the trusted trigger is
  valid;
- declared and policy-derived risk are both Low;
- every changed path belongs to the same explicit, pre-authorized allowlist
  class and no path is a symlink or untracked ownership surprise;
- the diff has no Root-of-Trust intersection;
- the candidate introduces no dependency, external write, network or
  filesystem authority, public API, generated ownership, release behavior, or
  security-boundary change;
- task dependencies are satisfied and the approved scope still matches the
  actual diff;
- exact-head independent review, CI, repair-budget, and integration-state
  evidence satisfy the pinned policy version.

无法证明任一条件时，不得改由 Agent judgment 决定；结果为 `REQUIRE_HUMAN` 或
`BLOCKED`。

## Root of Trust

Root of Trust 包含所有能以 repository authority 定义、授予、review、enforce、integrate
或 publish 的 surfaces。Candidate 必须依据 trusted policy 与 immutable authorized
A candidate is evaluated against the trusted policy and files from its immutable authorized baseline，绝不依据 candidate 自己提供的 replacements。

### Repository Root of Trust

Future machine policy 必须为每个 policy version 将以下 categories 解析为 exact paths：

- **Agent authority**: root and nested `AGENTS.md`, autonomous-maintenance
  policy and machine policy, authorization-mode definitions, trusted-trigger
  contracts, and Policy Gate logic or configuration.
- **Review authority**: the independent P0/P1 review Skill, implementer/reviewer
  separation rules, structured review schemas, and code that accepts review
  evidence.
- **CI and integration authority**: required workflows, their reusable or
  composite Actions, required-check aggregation, repository-contract logic and
  tests that protect required governance, and Merge Queue integration logic.
- **Task and evidence contracts**: trusted task schema, authorization metadata,
  pull request evidence schema, policy-version binding, and exact-head evidence
  verification.
- **Release and supply chain**: publication workflow and scripts, package and
  version authority, dependency and lockfile policy, provenance/signing rules,
  tag and GitHub Release creation, and credential-handling contracts.

The Version Packages workflow prepares versions and changelogs; it is not npm publication。Publication
仍是 separate、high-risk authorization boundary。

因此，current governance files 本身——包括本文档、`AGENTS.md`、`.github/AGENTS.md`、
Development Task Issue Form、pull request template 及其 repository-contract
enforcement——都属于 Root of Trust。

### External Root of Trust

Remote settings 单独建模，因为它们不是 repository-file changes：Rulesets 与 branch
protection、required status-check configuration、Merge Queue settings、bypass actors、
repository auto-merge policy、GitHub App/Actions token permissions、Environments、
secrets/credentials、npm Trusted Publishing 以及 repository/tag/release permissions。

An ordinary `AUTONOMOUS` task must not change any Root-of-Trust surface。任何 intersection 都会使
autonomous eligibility 失效并产生 `REQUIRE_HUMAN`。`DESIGN_APPROVED` candidate 也需要
explicit Root-of-Trust authorization；ordinary design approval 不足够。

Root-of-Trust change 只有在 human review、protected integration 与 post-merge validation
之后，才能对后续 candidates 生效。它不能改变用于 authorize 自身 current enqueue 的
policy、reviewer、required CI 或 remote settings。There is no self-approval path.

## Deterministic Policy Gate

Future Policy Gate 消费 bounded structured evidence。An Agent may produce evidence, but an LLM does not make the final enqueue decision where deterministic data is available。Agent 可以 produce evidence，但在 deterministic data 可用时，LLM 不作最终 enqueue decision。

Conceptually:

```text
task contract -> authorization mode -> risk -> changed surfaces
-> Root-of-Trust check -> dependencies -> review -> exact-head CI
-> repair/rerun budgets -> integration state -> decision
```

### Inputs（输入）

Minimum inputs 包括：

- repository full name and numeric identity;
- Issue/task identity and immutable task-contract hash;
- authorization mode and trusted-trigger evidence, including initiating actor;
- declared risk and policy-derived changed-surface classifications;
- exact changed paths and Root-of-Trust intersection;
- immutable task base, exact pull request head SHA, and immutable reviewed SHA;
- reviewer identity/context evidence, result, readiness, and unresolved P0,
  P1, and P2 counts;
- material repair count and exact-head CI rerun count;
- required-check names, conclusions, candidate SHAs, and exact-head
  relationship;
- task dependencies, current `main`/integration state, and invalidated
  assumptions;
- requested or observed external operations, including prohibited operations;
- exact, immutable policy version used for evaluation.

有可用 repository IDs、actors、paths、hashes、status conclusions、counters 或 policy
versions 时，绝不以 natural-language claims 替代。

### Outcomes and reason codes（结果与 reason codes）

Gate 恰好返回一个 decision：

- `ALLOW_ENQUEUE`：pinned policy 授权为 exact head 请求 native GitHub Merge Queue
  enqueue；不授予 direct merge 或 `DONE`。
- `REQUIRE_HUMAN`：evidence 足以完成 route，但 risk、scope、mode 或 Root-of-Trust
  policy 要求 explicit human decision。
- `BLOCKED`：required evidence 或 state incomplete、stale、inconsistent 或 failed，
  当前不能继续。

Stable reason categories 包括：

| Reason | Meaning |
| --- | --- |
| `REPOSITORY_MISMATCH` | Repository name 或 numeric identity 错误。 |
| `UNTRUSTED_TRIGGER` | Marker、actor 或 trigger provenance 不可信。 |
| `AUTHORIZATION_INVALID` | Mode 或 task authorization 缺失、stale 或 invalid。 |
| `RISK_REQUIRES_HUMAN` | Risk 超出 autonomous policy。 |
| `ROOT_OF_TRUST_TOUCHED` | Diff 与 protected surface 相交。 |
| `TASK_SCOPE_DRIFT` | Actual work material 超出或改变 authorized contract。 |
| `DEPENDENCY_BLOCKED` | Declared dependency 或 integration order 未满足。 |
| `REVIEW_INCOMPLETE` | Independent exact-diff review evidence 缺失或 incomplete。 |
| `P0_REMAINING` | 至少存在一个 unresolved P0。 |
| `P1_REMAINING` | 至少存在一个 unresolved P1。 |
| `CI_INCOMPLETE` | Required exact-head CI 尚未完成。 |
| `CI_FAILED` | Required exact-head CI failed。 |
| `REPAIR_BUDGET_EXCEEDED` | Material repair count 超出 policy。 |
| `RERUN_BUDGET_EXCEEDED` | Exact-head CI rerun count 超出 policy。 |
| `HEAD_CHANGED` | PR head 与 reviewed 或 checked SHA 不同。 |
| `POLICY_VERSION_STALE` | Evidence 在非 current policy 下评估。 |
| `PROHIBITED_EXTERNAL_OPERATION` | Candidate 请求或执行了 unauthorized write。 |

Decision 与 reasons 绑定 exact head 和 policy version。任何 head、task、dependency、
trusted-trigger、policy、required-check 或 remote governance change 都会使之前的
`ALLOW_ENQUEUE` evidence stale。Ambiguity 必须 fail closed；不存在 `MAYBE_READY` 或
`AGENT_RECOMMENDS_MERGE` result。

## Independent review and bounded recovery

### Independent review（独立 Review）

Implementer 与 independent reviewer 必须使用不同 contexts。Reviewer 必须 fresh 且
read-only，并检查 immutable task base、complete task diff、task contract、actual
changed surfaces 及相关 authority/security boundary。Implementer 不能 self-declare
review success。

Future machine-consumable review evidence 必须绑定 task 与 reviewed head，标识
independent context，声明 `READY` 或 `NOT READY`，并报告 P0、P1、P2 findings/counts。
Zero unresolved P0/P1 是 `ALLOW_ENQUEUE` 的必要但非充分条件。弱化 reviewer contract
会使 candidate 视为 Root-of-Trust-changing，并要求 human。

### Repair budget（Repair budget）

Initial future autonomous budget 最多为 **two material repair rounds**。The initial future autonomous budget is at most **two material repair rounds**。只有发生 review
或 CI evidence、confirmed actionable issue、implementation change、affected
revalidation 与 new complete diff review 时，才消耗一个 round。Read-only diagnosis
不消耗 round。

耗尽后产生 `REQUIRE_HUMAN` 或 `BLOCKED`；在 green 前不能继续 repair。High-risk changes
可以使用更小 budget 或立即 human escalation。这个 governance budget 与 current
maintainer-led `implement-and-review` workflow 分离，Phase 3C1 不修改该 Skill。

### CI rerun budget（CI rerun budget）

CI reruns 与 code repair 分离。Future autonomous system 最多可对每个 exact head 请求
**one evidence-based failed-jobs rerun**。A future autonomous system may request at most **one evidence-based failed-jobs rerun per exact head**，且必须有 evidence 表明是 environmental 或
infrastructure failure、head 未变化、failed run 属于同一 candidate，并且没有 product
或 test failure evidence。

相同或相关 failure 再次出现时产生 `REQUIRE_HUMAN` 或 `BLOCKED`。不存在 rerun-until-
green policy，Phase 3C1 也不为 required CI 增加 retry mechanism。

## Scope drift

当 actual candidate material 改变 approved goal、risk、authority、ownership 或
dependency contract 时，authorization 即 stale。Material drift 包括 scope 外的新
package；新的 Root-of-Trust path、dependency、network permission、filesystem
authority 或 external write；public API、security boundary、release behavior 或
generated-file ownership change；以及改变 task dependency 或 integration order。

对于 `DESIGN_APPROVED`，material drift 会使 approval 失效并将 task 返回 human review。
对于 `AUTONOMOUS`，超出 pinned eligibility policy 的 drift 产生 `REQUIRE_HUMAN`。
如果 deterministic comparison 不能证明 contract 仍成立，Gate 必须 fail closed。

## Local and remote writes

Authority 通过 transition 授予，绝不从听起来更宽泛的 task instruction 推断。

- **Local writes** 包括 source、test、documentation edits 与 local Git commits。
- **Remote writes** 包括 pushes、pull request creation/updates、Issue updates、Actions
  reruns、enqueue、merge、Ruleset/secret changes、releases/tags 与 npm publication。

Permission to analyze 不授予 local edits。Permission to edit 不授予 commit。Commit 不
授予 push。Push 不授予 pull request mutation、rerun、enqueue 或 merge。Enqueue
authority 不授予 direct merge。Repository governance 与 publication operations 仍是
分别授权的 high-risk capabilities。

## Merge Queue and completion

### Enqueue and integration（Enqueue 与 integration）

Native GitHub Merge Queue 仍是唯一 intended ordinary integration queue。Future
automation 可以 produce `ALLOW_ENQUEUE`，但 it must not produce or exercise `DIRECT_MERGE`。
它不得 create custom queue、directly write `main`、force-push、use admin bypass，或用
repository auto-merge 替代 Merge Queue。

Policy-authorized enqueue 后，GitHub 创建 `merge_group` candidate、运行 required
integration checks 并执行 protected squash integration。Phase 3C1 grants no enqueue capability，
user 仍是 current enqueue 与 merge authority。

### Post-merge failure（Post-merge failure）

如果 Merge Queue 集成 pull request 后，post-merge `main` validation 失败，task 变为
`BLOCKED`，不是 `DONE`。the task becomes `BLOCKED`, not `DONE`。保留 exact merge 与 failure evidence，通知或升级到 maintainer
authority，并 create 或 route 到 repair/follow-up task。不要 force-push 或 rewrite
`main`、weakening CI、repeat merges，或假设拥有 automatic revert authority。Future
revert policy 需要单独 design。

### Completion states（完成状态）

`LOCAL READY`、`REMOTE CI`、`MERGE READY`、`MERGED` 与 `DONE` 仍是不同状态。
`ALLOW_ENQUEUE` 仅是针对 exact-head 请求进入 queue 的 authorization。它不是 `MERGE READY`、
`MERGED` 或 `DONE`。`DONE` 仍要求 completed integration、observed relevant
post-merge validation 与 task lifecycle closure。

## Security review

| Question | Required answer |
| --- | --- |
| Can an untrusted public Issue start a write-capable Agent? | No. |
| Can a candidate change the rules used to authorize its own enqueue? | No. |
| Can it weaken and rely on its independent reviewer in one chain? | No. |
| Can it weaken and immediately rely on required CI? | No. |
| Can CI success alone authorize enqueue? | No. |
| Can ordinary `AUTONOMOUS` work touch the Root of Trust? | No. |
| Can public Issue text become executable instruction? | No. |
| Can repair continue indefinitely? | No. |
| Can repeated reruns be used to obtain green status? | No. |
| Can autonomous work force-push or directly update `main`? | No. |
| Does the final Gate use LLM judgment where deterministic evidence exists? | No. |
| Does Phase 3C1 grant new autonomous authority? | No. |

任何意外的 `Yes` 都是 blocking governance defect。

## Rollout roadmap

这些 stages 只是 planned，不声称已实现：

1. **Phase 3C1 — Autonomous Maintenance Governance Contract**：定义本 contract。
2. **Phase 3C2 — Trusted Task Trigger + Codex Implementer**：实现 bounded trusted
   trigger 与 implementation boundary。
3. **Phase 3C3 — Independent Review + Bounded Repair**：实现 independent structured
   review 与 repair orchestration。
4. **Phase 3C4 — Deterministic Autonomous Policy Gate**：实现 pinned、fail-closed
   decision engine。
5. **Phase 3C5 — Policy-authorized Native Merge Queue Integration**：只允许
   Gate-authorized enqueue，永不 direct merge。
6. **Phase 3C6 — Post-merge Recovery / Operations / Telemetry**：增加 bounded
   observation 与 separately designed recovery operations。
