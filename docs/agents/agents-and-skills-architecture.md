# AGENTS and Skills architecture（AGENTS 与 Skills 架构）

本文记录 Repository 的 Agent-rule 与 Skill architecture。它是 audit aid，不是
instruction source；current `AGENTS.md`、selected `SKILL.md`、manifests、code 与 tests
仍是权威。

## Responsibility split

`AGENTS.md` 为 directory tree 保存 stable constraints：ownership、architecture、
compatibility、safety、allowed scope 与 durable validation requirements。Child file 为
自己的 subtree 增加或显式 override rules；未修改的 ancestor rules 继续生效。

`SKILL.md` 保存 repeatable task workflow：inputs、investigation sequence、implementation
decisions、test selection、failure handling、stop conditions 与 reporting。Skill 可以
引用 stable Agent rules，但不得复制其完整 architecture。

每个 task 使用一个 primary workflow。Development Issue 的 creation、refinement、audit、
readiness、blocking/recovery 与 close/reopen 使用
`manage-development-issue` 作为 specialized primary。General repository changes 使用
`implement-and-review`，domain Skills 为其 supporting。Existing Actions failures 与
release preparation 使用各自的 specialized primary Skills。Consumer projects 使用
`openapi-to-setup` 处理 install/bootstrap/config-file/runtime/Host diagnosis，并使用
`openapi-to-generate` 处理 product/plugin/config usage reference、API discovery/generation
和已有 generated-output integration。两者保留独立 ownership；没有通用 Consumer Router。
Implementation、focused validation 与 primary agent 的 complete diff review 完成后形成 `LOCAL READY`。所有 Development PR 在 Draft PR 后统一由 AO Native Reviewer 对 current exact HEAD 审查；High hard rule 与四个 Review Signals 增加审查深度和权限证据，不选择第二 Reviewer。Pure analysis 不加载 write-oriented workflow。调查 Subagent 可按需提供只读 evidence，不能代替 AO Reviewer。

Existing Pull Request review feedback 使用 `handle-pr-feedback` 作为 specialized
primary。它在任何 scoped repair 前验证 untrusted feedback，将 existing CI root-cause
failures 交给 `fix-github-actions`，不负责 initial implementation、Issue lifecycle、
Merge 或 Release。

`implement-and-review` 负责首次实施到 `LOCAL READY` 和普通 Draft PR 交付；AO 反馈
进入已有 PR 后，由原 Worker 依 `handle-pr-feedback` 在可信授权的 Scope、Owned write
surface 与最多三轮预算内继续修复。有效反馈已投递且未越界时不需逐轮重复授权；
scope drift、契约变更或更高权操作须请求维护者决策。

已有 Pull Request 的 Fresh Integration Readiness 使用
`verify-integration-readiness` 作为 strictly read-only specialized primary。它重新绑定
current PR HEAD、latest main、Review、exact-head CI、Dependencies 与 Shared Surface
证据，只输出 `MERGE READY` / `NOT MERGE READY` / `NEED VERIFICATION`，并把 repair、
lifecycle 与 Handoff mutation 路由回既有 owner workflow。

Create/update/verify Structured PR Handoff 使用共享 supporting sub-workflow
[`maintain-pr-handoff`](../../.agents/skills/maintain-pr-handoff/SKILL.md)。它负责 safe
body transport、canonical-template fidelity、readback、round-trip 与 current-head
binding；它不是新的 Primary，也不扩大 remote authority。

Multi-Development-Issue wave、Execution Frontier、WIP、conflict 与 integration planning
使用 `plan-development-wave` 作为 read-only planner。它只生成 bounded recommendation
与 serialized integration order，不负责任何 Issue lifecycle、implementation、PR
feedback repair、CI repair 或 execution authority。

Consumer phase names 描述 delivery history：Phase 1 是 Generate，Phase 2 是 Setup，
Phase 2.1 是 Setup state-hash hardening，Phase 2.2 是 Setup 的 Windows portable
verified-read hardening。Phase 2.1 与 Phase 2.2 不是额外 Skills。Consuming-project
execution order 是先 Setup，再新建 Codex chat/session 并 verify current Tool Schemas；若 runtime
仍 stale 或 Host reload behavior 不明确，再完整 restart Codex Host 后验证，最后 Generate。

## Rule discovery boundary

Agent discovery 从 current repository root 开始，使用
`git ls-files '*AGENTS.md'` 或等价的 Git-tracked repository-scoped query。它不扫描
parent directory、sibling repository、other worktree、dependency tree 或 untracked
file。Untracked `AGENTS.md` 不是 formal repository rule source。Git discovery 失败是
blocker，不能因此退回 filesystem scan。

## Rule inheritance graph

```text
AGENTS.md
├── .github/AGENTS.md
├── packages/cli/AGENTS.md
├── packages/core/AGENTS.md
└── packages/mcp/AGENTS.md
```

四个 subtrees 之外的 files 只继承 root `AGENTS.md`。对于 governed subtree 下的 file，
读取 root 与 closest child。Deeper rule 只有在显式声明 override 时才胜出。无法协调
的 conflict 会阻止受影响 edit。

## AGENTS audit

### `AGENTS.md`

- Scope：complete repository。
- Adds：product purpose、package ownership、evidence precedence、runtime、deterministic
  generation、worktree/scope safety、global input/path security、release/external-write
  authority、multi-agent ownership、Skill routing 与 truthful completion。
- Override：none；它是 root。
- Allowed changes：task-authorized 的最小 source、tests、fixtures、documentation、
  exports 与 release metadata。
- Prohibited changes：无关 refactors/upgrades、不安全 input execution、generated-output
  masking 与 unauthorized external writes。
- Validation/reporting：narrowest sufficient checks、complete diff review、P0/P1 closure、
  fresh final Git state 以及明确的 `PASS`/`FAIL`/`SKIPPED`。
- Audit result：保留 stable policy，增加 explicit inheritance、unique routing、
  multi-agent write ownership 与 completion truthfulness。Detailed implementation/
  review steps 位于 `implement-and-review`。

### `packages/core/AGENTS.md`

- Scope：Core compiler、diagnostics、plugin orchestration、artifacts、comparison 与 writer。
- Inherits：all root rules。
- Adds：pipeline/representation ownership、diagnostic ownership、plugin scheduling/state
  isolation、artifact/writer invariants、Core validation gates 与 generator-related Skill
  routing。
- Override：none。
- Product boundary：CLI、MCP 与 plugins 调用 Core，不重新实现 semantics 或 writing。
- Audit result：保留。其 pipeline、concurrency、artifact 与 transaction constraints 是
  stable subsystem facts，不是一次性 workflow。

### `packages/cli/AGENTS.md`

- Scope：CLI parsing、Core invocation、presentation 与 exit selection。
- Inherits：all root rules。
- Adds：JSON stdout purity、stderr diagnostics、centralized exit codes、read/write command
  boundaries、binary aliases 与 CLI validation gates。
- Override：none。
- Product boundary：CLI 不拥有 compilation、comparison 或 writing。
- Audit result：保留。内容精简，不重复 root policy。

### `packages/mcp/AGENTS.md`

- Scope：independently published stdio MCP adapter。
- Inherits：all root rules。
- Adds：protocol framing、stable schemas/results、startup authority、Tool matrix、
  cancellation、Prepare/Apply security、transaction integration、test layers 与 explicit
  feature exclusions。
- Override：none。
- Product boundary：MCP 调用 public Core APIs，不能扩大 startup authority 或增加 parallel
  writer。
- Audit result：保留。Detailed security constraints 是 durable protocol invariants；task
  sequencing 仍由 MCP Skills 负责。

### `.github/AGENTS.md`

- Scope：workflows 与 local/reusable Actions。
- Inherits：all root rules。
- Adds：gate integrity、permissions、fork/secret boundaries、artifact sanitization、
  privileged-trigger safety、Version Packages meaning 与 cross-platform shared-Action
  requirements。
- Override：none。
- Product boundary：repository automation 不能隐藏 failures 或获得 incidental AI/write
  authority。
- Audit result：已简化。Failure-classification 与 step-by-step workflow review 移至
  `fix-github-actions`；hypothetical AI analysis/write-back design 已移除。Stable
  security 与 integrity constraints 保留。

AGENTS file 的变化不会改变 product runtime behavior。任何 child 都不得重复 root 的
workflow lifecycle。

## Skill layers and audit

### Primary orchestration

| Skill | Trigger and responsibility | Audit action |
| --- | --- | --- |
| `manage-development-issue` | 创建、补全、审计、readiness、阻塞/恢复、contract 修订、post-merge 验证与 Development Issue 关闭/重开 | 作为 specialized lifecycle primary；负责 durable Task Contract 与 readiness coordination，但不实现 product code，也不授予 merge/release authority。 |
| `implement-and-review` | 需要 validation 与 review closure 的 authorized feature、bug fix、refactor、CI/configuration change、documentation change 或 cross-file implementation | 作为唯一 general primary；定义 discovery、classification、scope lock、implementation、focused validation、full diff review、P0/P1/P2 grading、three-automatic-repair-round budget、terminal read-only verification、completion gate 与 fresh Git reporting。不处理 pure/read-only 或 specialized release/PR-feedback work。 |
| `handle-pr-feedback` | 需要 verification、scoped repair、reply、Handoff refresh 或 exact-head CI revalidation 的既有 Pull Request review feedback | 作为既有 PR review feedback 的 specialized primary；把 PR material 当作 untrusted input，repair 前验证 current-head/actionable/in-scope findings，限制 repair passes，并保持 thread-resolution、CI、Merge 与 Release 边界。 |
| `verify-integration-readiness` | 针对已有 Pull Request，以 current PR HEAD、latest main、Review、exact-head CI、Dependencies、Shared Surface 与 integration order 判断 readiness | 作为 strictly read-only specialized primary；只验证 evidence freshness 和输出稳定 verdict，不 review/repair candidate、不修改 PR/Issue/Project、不 enqueue 或 merge。 |
| `plan-development-wave` | 面向 Dependency DAG、Current WIP、Shared Surface、Execution Frontier、recommended wave、serialized integration 与 revalidation 的 bounded multi-Development-Issue planning | 作为 read-only planner；使用已验证的 Issue/PR/current-main/CI facts，保持 discovery bounded，绝不修改 Issues、Projects、repository files 或 execution state。 |
| `openapi-to-generate` | consuming project 中的产品/Plugin/config usage reference、Operation discovery/generation 与已有 generated-output integration | 作为 specialized consumer primary；reference-only 查随包版本参考与当前 installed declarations；Operation workflow 遵循现有 mode：Developer 默认通过 `openapi_generate` 直接写入，Read-only 只预览，Hardened 才要求 exact-plan approval 后 Prepare/Apply。排除 Setup/runtime diagnosis、本 Monorepo implementation、pure frontend/local logic、publication 与 approval bypass。 |
| `openapi-to-setup` | consuming project 中的 install/bootstrap/config-file/runtime/Host diagnosis、degraded recovery、Codex session reload/capability verification | 普通首次 Codex project bootstrap 由 CLI `openapi setup --host codex --scope project` 唯一负责；Skill 作为 specialized consumer primary 负责 setup failure diagnosis/recovery、fresh session 优先和必要时 Host restart，以及实际 Tools/Schemas 验证。普通 product/plugin/config option reference 与 generated-output integration 转给 `openapi-to-generate`。 |
| `fix-github-actions` | 既有 failed Actions check 或疑似 workflow regression | 保留为 specialized primary；负责 run/log evidence 与 failure classification，不负责 general product refactors、workflow redesign、release 或 unauthorized reruns。 |
| `release-monorepo` | release planning 或 publication-readiness verification | 保留为 specialized primary；准备 evidence 与 plan，publication、push 与 tags 仍需 exact authorization。 |

### Domain workflows

| Skill | Trigger and responsibility | Overlap decision |
| --- | --- | --- |
| `add-cli-command` | 在 `packages/cli` 中新增或实质改变 command/option | 支持 `implement-and-review`；CLI ownership 与 stream invariants 仍由 CLI AGENTS 负责。 |
| `add-mcp-tool` | 新增或实质改变 read-only MCP Tool | 支持 `implement-and-review`；拒绝 write Tools 以及更宽的 transports/auth/LLM scope。 |
| `add-mcp-write-tool` | 扩展或修复既有 Prepare/Apply generation | 支持 `implement-and-review`；组合 `add-mcp-tool` 的 protocol requirements，但不接管任意 MCP work。 |
| `add-openapi-plugin` | 新增 plugin package 或 substantial output mode | 支持 `implement-and-review`；不负责 parser-only、CLI、release-only 或 documentation-only work。 |
| `fix-codegen-regression` | 修复已观察到的 generated-code/file-set/import/type/determinism defect | 支持 `implement-and-review`；把 output verification 交给 `run-codegen-tests`，不重复实现。 |
| `upgrade-openapi-support` | 改变 Swagger/OpenAPI dialect 或 JSON Schema semantics | 支持 `implement-and-review`；不处理与 generator 无关的 presentation changes。 |
| `upgrade-dependencies` | scoped dependency upgrade、Renovate candidate 验证、安全修复与 compatibility hold | 支持 `implement-and-review`；Renovate 只提出 candidate，release preparation 和既有 CI 故障分别由 `release-monorepo` 与 `fix-github-actions` 负责；语义或 generated output 变化再使用 `upgrade-openapi-support` / `run-codegen-tests`。 |

### Validation helper

| Skill | Trigger and responsibility | Overlap decision |
| --- | --- | --- |
| `run-codegen-tests` | 验证可能改变 generated output 的 change，或判断 fixture/snapshot change 是否正确 | 保留为 helper；负责 output 与 idempotency validation，但不诊断或实现 owning fix。 |

### AO Native Review gate

AO Native Reviewer 是 PR 后唯一正式代码审查 owner；它是外部 AO Run，不是 Repository Skill。`AGENTS.md` 定义统一 exact-head Evidence Contract，`verify-integration-readiness` 只读消费证据，`handle-pr-feedback` 负责 Worker 修复。High 权限证据不明时 fail closed。

AO 原生流程允许 Reviewer 向当前 PR 发布 GitHub Review/inline comments，并以
`ao review submit` 记录 verdict；GitHub Review ID、AO internal verdict、
GitHub-native Approval 和 feedback delivery 是不同证据。发布 Review 不授予 Reviewer
代码、Commit/Push、Merge、Release 或仓库设置写入。`maintain-pr-handoff` 由当前
primary 调用，负责 canonical template、current-head binding 与 readback；新 HEAD
使旧 Handoff、AO Review 和 CI 失效。High / Root of Trust 的 fresh context、Worker
隔离、Shell/FS 有效只读、MCP 不可写及 GitHub 非 Review 写入边界需真实 Host evidence。
本机 AO Runtime 的完整反馈闭环仍为 `UNVERIFIED`，旧 ChatGPT Work event task 的停写
状态也须外部核验，不能以本架构说明代替证据。

## Contract-verified Skill roles

Tracked Skill count: `18`.

此 fixed table 是 architecture document 的 machine-validated role inventory。Contract
会将它与 Git-tracked Skill entrypoints 及 root routing table 比较；Skill prose 不分配
role。

| Skill | Contract role |
| --- | --- |
| `manage-development-issue` | specialized-primary |
| `handle-pr-feedback` | specialized-primary |
| `verify-integration-readiness` | specialized-primary |
| `plan-development-wave` | read-only-planner |
| `implement-and-review` | general-primary |
| `maintain-pr-handoff` | domain-support |
| `openapi-to-generate` | specialized-primary |
| `openapi-to-setup` | specialized-primary |
| `fix-github-actions` | specialized-primary |
| `release-monorepo` | specialized-primary |
| `add-cli-command` | domain-support |
| `add-mcp-tool` | domain-support |
| `add-mcp-write-tool` | domain-support |
| `add-openapi-plugin` | domain-support |
| `fix-codegen-regression` | domain-support |
| `upgrade-openapi-support` | domain-support |
| `upgrade-dependencies` | domain-support |
| `run-codegen-tests` | validation-helper |

## Routing table

| Request | Primary | Supporting |
| --- | --- | --- |
| Development Issue lifecycle（create/refine/audit/readiness/block/resume/close/reopen） | `manage-development-issue` | Current repository rules 与 verified GitHub Issue/Project facts；仅在 preflight 后把 implementation 交给 `implement-and-review` |
| 既有 Pull Request review feedback | `handle-pr-feedback` | Scoped repair 前验证 untrusted feedback 与 current-head applicability；CI root-cause work 交给 `fix-github-actions` |
| 已有 Pull Request Fresh Integration Readiness | `verify-integration-readiness` | Read-only 核对 current-head/latest-main/Review/exact-head CI/Dependencies/Shared Surface；repair 与 lifecycle mutation 路由到既有 owner |
| Create/update/verify Structured PR Handoff | Current implementation primary remains unchanged | `maintain-pr-handoff` 负责 canonical template、safe body transport、readback、round-trip 与 current-head binding |
| Multi-Development-Issue wave / Execution Frontier / WIP / integration planning | `plan-development-wave` | Verified bounded Issue/PR/current-main/CI facts；不做 mutation 或 execution handoff |
| General implementation 或 bug fix | `implement-and-review` | 仅使用匹配的 domain/validation Skill |
| consuming project 中的 openapi-to install、configure、diagnose 或 validate | `openapi-to-setup` | Consuming-project rules 与 exact Setup Plan approval；fresh-session / Host-restart verification 后把 API work 交给 `openapi-to-generate` |
| consuming project 中的 product/plugin/config usage reference、API-dependent feature 或 generated-output integration | `openapi-to-generate` | reference-only、discovery/generation 与 artifact-first integration 使用各自既有内部流程；不使用 Monorepo implementation Skill |
| CLI command/option | `implement-and-review` | `add-cli-command`；仅在 output changes 时增加 `run-codegen-tests` |
| Read-only MCP Tool | `implement-and-review` | `add-mcp-tool` |
| MCP Prepare/Apply | `implement-and-review` | `add-mcp-write-tool` 及其声明的 MCP/Core references |
| New/substantial plugin | `implement-and-review` | `add-openapi-plugin`，之后使用 `run-codegen-tests` |
| Generated-output regression | `implement-and-review` | `fix-codegen-regression`，之后使用 `run-codegen-tests` |
| Dialect/schema semantics | `implement-and-review` | `upgrade-openapi-support`，之后使用 `run-codegen-tests` |
| Dependency upgrade / modernization | `implement-and-review` | `upgrade-dependencies`；Renovate candidate 仍需兼容性、lockfile 与影响验证 |
| Existing Actions failure | `fix-github-actions` | 只有 evidence 指向 product code 时才使用 owning package Skill |
| Release preparation | `release-monorepo` | 仅在 affected generator output 时使用 `run-codegen-tests` |
| Pure explanation/analysis/status | none | 只读取适用的 AGENTS 与 source |
| Commit/push/Draft PR | Current implementation primary remains unchanged | 获得 explicit authorization 后使用 host publication workflow |

This prevents a validation helper, release workflow, or publication workflow
from taking over implementation.

Root `AGENTS.md` 的 `## Skill routing` table 是唯一 machine-validated routing source。
其 lightweight parser 只接受 Repository 的 two-column Markdown subset，不是 general
Markdown parser。每个 Git-tracked Skill 必须在该表中按上述 role 恰好出现一次。Duplicate、
missing、unknown、untracked、malformed、multi-path 或 role-mismatched rows 都会使
repository contract fail。Prose 中其他位置提到的 Skill 不算 route。

## `implement-and-review` lifecycle

```text
discover Git-tracked repository rules
  -> clean isolated worktree and immutable task base
  -> implement -> focused validation -> Complete Diff Review -> LOCAL READY
  -> Commit -> Push -> Draft PR -> Structured Handoff readback
  -> AO Native exact-head Review + GitHub Review/inline comments + ao review submit
     || required CI
  -> if actionable findings: verified feedback delivery -> Worker verify findings
  -> bounded repair -> new HEAD -> refresh Handoff -> repeat AO Review + required CI
  -> if no blocking findings: independent Integration Readiness
  -> maintainer-authorized Merge
  -> main CI + post-merge Acceptance -> DONE
```

AO evidence 记录 Run ID、reviewed SHA、verdict、findings、feedback delivery、High 有效权限与 GitHub write-back 区别；缺失为 UNVERIFIED。可信授权范围内最多三轮自动修复；新 HEAD 使旧 AO Review/Handoff/CI stale。没有第二 Reviewer fallback，也不从仓库契约推断本机 AO v0.13.6 E2E 已通过。

A task base 是编辑前记录的 immutable `git rev-parse HEAD`，不会自动变为 `origin/main`。
Complete review 包括 unstaged/staged changes、task base 到 current working tree，以及
task base 到 `HEAD` 的 two-dot tree change。Commit 后，空的 ordinary `git diff` 不能
隐藏 task：必须结合 fresh status、branch、HEAD、log 与 untracked-file evidence 再次
review task-base-to-HEAD diff。

Clean worktree 是 ordinary write-task default。Pre-existing changes 必须记录并保留，
不能假定为 agent work。Unrelated changes 优先使用 clean isolated worktree；没有
explicit authorization 时 overlapping targets 会阻止 editing。如果无法 isolation，
task-base-to-current-tree view 是 combined diff，不能全部归属于 agent。这是保守的
ownership boundary，不是任意的 patch attribution。

Untracked discovery 使用 `git ls-files --others --exclude-standard`。每个 task-created
text file 都要检查 size 并完整读取；unexpected 或 unreviewed files 会阻止 readiness。
Staging 使用 explicit authorized paths，之后完成 cached stat、whitespace 与 content
review。

Completion gates 按 authority 区分。所有 tasks 都要 re-check request、区分 fact 与
inference、报告 limitations/external operations，并避免 unauthorized writes。Read-only
analysis 只检查必要 evidence，除非回答需要，否则不要求 build、test 或 diff ceremony。
Write tasks 记录 task base、validate change、关闭 in-scope P0/P1 并 review complete
task diff。Read-only task 中发现 P1 不会自动授权 repair。

## Real-task Pilot PR gate

```text
LOCAL READY -> Commit -> Push -> Draft PR -> Handoff readback
  -> AO Native Review + exact-head required CI
  -> latest-main / Shared Surface / GitHub protection verification
  -> MERGE READY -> user decides whether to merge
```

Local `PASS` 不能替代 remote CI `PASS`；AO internal verdict 不能替代 GitHub-native Approval。`MERGED != DONE`。

## Real-task routing validation

### Small CLI exit-code bug

- Rules：root 加 `packages/cli/AGENTS.md`。
- Primary: `implement-and-review`.
- Support: `add-cli-command`; `run-codegen-tests` only if generation changes.
- Skipped：MCP、plugin、release 与 Actions Skills。
- Authority：只允许 CLI source/test writes；除非另行请求，不涉及 public API 或 external
  write。
- Gate：focused failing regression、适用的 CLI test/typecheck/build、Complete Diff Review
  形成 `LOCAL READY`；Development PR 再取得 AO Native exact-head Review，且无 P0/P1。

### Optional filter on an existing read-only MCP Tool

- Rules：root 加 `packages/mcp/AGENTS.md`；只有 Core API 必须改变时才加 Core rules。
- Primary: `implement-and-review`.
- Support: `add-mcp-tool`.
- Skipped：`add-mcp-write-tool`，因为 request 是 read-only。
- Authority：stable startup boundary 内的 schema/handler/tests/docs。
- Gate：registration/schema visibility changes 时运行 unit/integration/stdio 与 Doctor；
  完成 Complete Diff Review 形成 `LOCAL READY`；Development PR 再取得 AO Native
  exact-head Review，且无 P0/P1。

### Cross-platform GitHub Actions failure

- Rules：root 加 `.github/AGENTS.md`；若涉及 source，再加 owner package rules。
- Primary: `fix-github-actions`.
- Support: an owning domain Skill only after log/reproduction evidence.
- Skipped：不使用 general `implement-and-review` 作为 primary；release 保持在 scope 外。
- Authority：只做 minimal owner fix；没有 explicit authorization 不得 rerun、push 或
  change settings。
- Gate：focused reproduction、affected CI-equivalent command、relevant matrix conclusion，
  并如实区分 local 与 remote evidence。

### Prepare the next RC

- Rules：root 与 `.github/AGENTS.md`。
- Primary: `release-monorepo`.
- Support：只有 release diff 需要时才做 generator validation。
- Skipped：除非另有 defect 被 explicit 纳入 scope，不使用 general implementation
  workflow。
- Authority：默认 read-only planning/verification；没有 exact authorization 不得 publish、
  tag 或 push。
- Gate：affected-package/semver graph、Changesets state、exports/declarations、pack/install
  evidence，且没有 skipped required release check。

### Analyze duplicate generated types

- Rules：root、Core rules 与 affected plugin source facts。
- Primary：none；这是 read-only diagnosis。
- Support：在 user 请求 fix 前不使用 support；必要时只把 codegen Skills 作为 routing
  context 阅读。
- Authority：no writes。
- Gate：evidence-backed owning-stage explanation，报告 uncertainty 与 unrun checks；不
  声称已实现。

## Adding or changing rule sources

只有当某个 directory 存在无法由 nearest ancestor 表达的 durable constraints 时，才
添加 `AGENTS.md`。说明 inherited scope，只添加 local rules，避免写入 task commands
或 historical incidents。

只有为具有 recognizable trigger、inputs、authority、validation、stop/exit conditions 与
reporting contract 的 distinct repeatable workflow 才添加 Skill。优先扩展 domain Skill，
不要再创建 general orchestrator。保持 frontmatter decisive、body concise；必要时将可选
细节放在一层 references 中。

合入 rule change 前：

1. 检查 routing tables 中的每个 AGENTS 与 Skill path。
2. 运行 repository contract 及其 negative tests。
3. 在不改变 product behavior 的情况下执行上述 real-task scenarios。
4. 两次 review task-base-to-current-tree 与 task-base-to-HEAD diff：一次检查 rule
   consistency，一次从 executing Codex user 的视角检查。
5. 每次 commit 后，用 fresh evidence 确认 complete task diff、final Git state 与
   external operations。

Commit、push、Draft PR creation、workflow reruns、versioning、tagging 与 publication 是
彼此独立的 external capabilities。Local implementation 或 passing validation 不会
授权这些操作。
