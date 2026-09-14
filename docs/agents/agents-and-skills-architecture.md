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
`openapi-to-setup` 做 installation/configuration diagnosis 与 approval-bound setup，
再通过 local openapi-to MCP 由 `openapi-to-generate` 交付 API-dependent feature。
Implementation、focused validation 与 primary agent 的 complete diff review 完成后，
non-trivial behavior-changing writes 还要使用 `independent-p0-p1-review` 作为 fresh、
read-only review gate。Pure analysis 不加载 write-oriented workflow。

Existing Pull Request review feedback 使用 `handle-pr-feedback` 作为 specialized
primary。它在任何 scoped repair 前验证 untrusted feedback，将 existing CI root-cause
failures 交给 `fix-github-actions`，不负责 initial implementation、Issue lifecycle、
Merge 或 Release。

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
execution order 是先 Setup，再 restart 并 verify current Tool Schemas，最后 Generate。

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
| `plan-development-wave` | 面向 Dependency DAG、Current WIP、Shared Surface、Execution Frontier、recommended wave、serialized integration 与 revalidation 的 bounded multi-Development-Issue planning | 作为 read-only planner；使用已验证的 Issue/PR/current-main/CI facts，保持 discovery bounded，绝不修改 Issues、Projects、repository files 或 execution state。 |
| `openapi-to-generate` | consuming project 中需要 Operation discovery、bounded contract reading、selective generation、controlled Prepare/Apply 与 business-code integration 的 backend-API-dependent feature | 作为 specialized consumer primary；使用 consuming project 的 local dependency 与实际 MCP Tool list，优先 operation-scoped generation，要求 exact-plan approval，并排除本 Monorepo implementation、pure frontend work、setup automation、publication 与 approval bypass。 |
| `openapi-to-setup` | consuming project 中的 installation、root config initialization、Codex MCP configuration 或 setup diagnosis | 作为 phase-two specialized consumer primary；先做 read-only diagnosis，默认 read-only，把每次 write 绑定到 exact Setup Plan，停下来等待 Host restart，验证实际 Tools/Schemas，再把业务 generation 交给 `openapi-to-generate`。 |
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

### Validation helper

| Skill | Trigger and responsibility | Overlap decision |
| --- | --- | --- |
| `run-codegen-tests` | 验证可能改变 generated output 的 change，或判断 fixture/snapshot change 是否正确 | 保留为 helper；负责 output 与 idempotency validation，但不诊断或实现 owning fix。 |

### Independent review gate

| Skill | Trigger and responsibility | Overlap decision |
| --- | --- | --- |
| `independent-p0-p1-review` | 在 implementation 与 initial validation 后，针对 complete task-base diff 检查 concrete blocking P0/P1 defects | 作为 read-only gate，而非 primary 或 implementation workflow；在 fresh sub-agent context 中运行，把 findings 返回 primary agent，never repairs, stages, commits, or performs remote writes。 |

全部十七个 Skills 都有 unique directory-matching name、specific positive/negative
triggers、required `agents/openai.yaml`、explicit inputs/preconditions、bounded
modification authority、validation guidance、failure/stop handling 与 completion/report
boundary。Domain Skills 可以提及 release classification，但只有 `release-monorepo`
拥有 release readiness。没有任何 Skill 在无 user authorization 时授予 commit、push、
tagging、publication、reruns 或其他 external writes。

## Contract-verified Skill roles

Tracked Skill count: `17`.

此 fixed table 是 architecture document 的 machine-validated role inventory。Contract
会将它与 Git-tracked Skill entrypoints 及 root routing table 比较；Skill prose 不分配
role。

| Skill | Contract role |
| --- | --- |
| `manage-development-issue` | specialized-primary |
| `handle-pr-feedback` | specialized-primary |
| `plan-development-wave` | read-only-planner |
| `implement-and-review` | general-primary |
| `independent-p0-p1-review` | review-gate |
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
| `run-codegen-tests` | validation-helper |

## Routing table

| Request | Primary | Supporting |
| --- | --- | --- |
| Development Issue lifecycle（create/refine/audit/readiness/block/resume/close/reopen） | `manage-development-issue` | Current repository rules 与 verified GitHub Issue/Project facts；仅在 preflight 后把 implementation 交给 `implement-and-review` |
| 既有 Pull Request review feedback | `handle-pr-feedback` | Scoped repair 前验证 untrusted feedback 与 current-head applicability；CI root-cause work 交给 `fix-github-actions` |
| Create/update/verify Structured PR Handoff | Current implementation primary remains unchanged | `maintain-pr-handoff` 负责 canonical template、safe body transport、readback、round-trip 与 current-head binding |
| Multi-Development-Issue wave / Execution Frontier / WIP / integration planning | `plan-development-wave` | Verified bounded Issue/PR/current-main/CI facts；不做 mutation 或 execution handoff |
| General implementation 或 bug fix | `implement-and-review` | 仅使用匹配的 domain/validation Skill |
| Non-trivial behavior-changing write 的 Independent P0/P1 gate | Current implementation primary remains unchanged | focused validation 与 primary complete diff review 后使用 `independent-p0-p1-review` |
| consuming project 中的 openapi-to install、configure、diagnose 或 validate | `openapi-to-setup` | Consuming-project rules 与 exact Setup Plan approval；restart verification 后把 API work 交给 `openapi-to-generate` |
| consuming project 中的 API-dependent feature | `openapi-to-generate` | consuming project 自身 rules 与 validation；不使用 Monorepo implementation Skill |
| CLI command/option | `implement-and-review` | `add-cli-command`；仅在 output changes 时增加 `run-codegen-tests` |
| Read-only MCP Tool | `implement-and-review` | `add-mcp-tool` |
| MCP Prepare/Apply | `implement-and-review` | `add-mcp-write-tool` 及其声明的 MCP/Core references |
| New/substantial plugin | `implement-and-review` | `add-openapi-plugin`，之后使用 `run-codegen-tests` |
| Generated-output regression | `implement-and-review` | `fix-codegen-regression`，之后使用 `run-codegen-tests` |
| Dialect/schema semantics | `implement-and-review` | `upgrade-openapi-support`，之后使用 `run-codegen-tests` |
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
  -> require a clean worktree or establish an authorized isolation boundary
  -> classify one primary domain
  -> record task base SHA, initial Git state, scope, and authority
  -> plan
  -> implement
  -> focused validation
  -> discover and fully review task-created untracked text files
  -> review unstaged/staged and task-base-to-current-tree diff
  -> review task-base-to-HEAD and untracked files again after commit
  -> run a fresh-context independent read-only P0/P1 review
  -> independently verify and grade reviewer findings
  -> repair confirmed in-scope P0/P1
  -> rerun affected validation and complete primary diff review
  -> after the first or second automatic repair round, use a new reviewer
     after a materially behavior-changing repair
  -> consume at most three automatic finding-confirm-repair rounds
  -> after a material third repair, run exactly one terminal read-only reviewer
     that cannot trigger another repair
  -> re-read final Git state
  -> READY, or NOT READY with blockers
```

P0 覆盖 security、data corruption/loss、release blockers 与 severe regressions。P1
覆盖 definite bugs、important compatibility defects、critical test gaps 与 incorrect
safety/error boundaries。Independent reviewer 只报告 P0/P1；P2 由 primary-agent 作为
non-blocking quality classification 处理。Primary agent 必须在 repair 前验证每个
finding，再修复全部 confirmed in-scope P0/P1。它只处理 low-risk、tightly scoped 的
P2 findings。

没有 confirmed file-changing repair 的 Review 不消耗 three-round budget（Reviews without
a confirmed file-changing repair do not consume the three-round budget.）。Material repair
消耗第三个 automatic round 后，必须由 exactly one additional terminal reviewer uses a fresh context to inspect the complete task-base-to-current-state diff. 它严格 read-only，
strictly read-only, is outside the automatic repair budget, and cannot trigger another automatic repair. 只有 `VERDICT: READY` 与 `No P0/P1 findings.` 同时出现才通过（Only
`VERDICT: READY` together with `No P0/P1 findings.` passes.）。P0/P1、`VERDICT: NOT READY`
或 materially incomplete scope 会使 task 变为 `NOT READY`；stops the task as `NOT READY`。
Primary agent 不能 rename rounds、reset counters 或 start a second terminal reviewer（cannot
rename rounds, reset counters, or start a second terminal reviewer.）。

Automatic repair round 只有在 fresh read-only reviewer 报告 P0/P1、primary agent 确认
in-scope finding、repair 实际修改 code/tests/configuration/workflows/documentation，且
重新运行 affected validation 与 complete primary diff review 时才存在。没有 confirmed
file-changing repair 的 review 不消耗 three-round budget。第一次或第二次 automatic
round 后的 material repair 必须再次接受 ordinary fresh review，才能继续 bounded loop。

Material repair 消耗第三个 automatic round 后，必须由 exactly one additional terminal
reviewer 在 fresh context 中检查 complete task-base-to-current-state diff。它严格
read-only，不计入 automatic repair budget，也不能触发 another automatic repair。只有
`VERDICT: READY` 与 `No P0/P1 findings.` 同时出现才通过。P0/P1、`VERDICT: NOT READY`
或 materially incomplete scope 都会使 task 为 `NOT READY`；primary agent 报告 finding，
等待新 task 或新 repair budget，而不是在当前 loop 中修复。

Separate three-plus-one limits 用于避免无效 churn，并弥补 third-repair coverage gap，
但不创建 fourth automatic repair round。Primary agent 不能 rename rounds、reset
counters 或 start a second terminal reviewer。任何一个 limit 都不能把 unresolved P0/P1
或 materially incomplete independent review 变成 success。无关 P2 与 broad architectural
follow-ups 仍在 diff 之外。

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
Draft PR
  -> local validation complete
  -> autonomous primary diff review complete
  -> independent read-only P0/P1 review complete
  -> repair P0/P1
  -> push the latest commit
  -> Ready for review
  -> wait for remote required checks
  -> human review of the PR diff
  -> user decides whether to merge
```

Local `PASS` is not remote CI `PASS`；报告 remote success 前必须写明成功的 remote workflow
或 check 以及 commit SHA。`Draft` status is not completed remote acceptance。PR 变为 Ready
for review 后再查询 checks。如果 check evidence 缺失、不可用，或 Repository 没有 verified
required-check policy，必须报告 `REMOTE CI UNVERIFIED`，不能报告 `PASS`。Only the user may decide whether to merge；本 Pilot 永远不执行 merge。

## Real-task routing validation

### Small CLI exit-code bug

- Rules：root 加 `packages/cli/AGENTS.md`。
- Primary: `implement-and-review`.
- Support: `add-cli-command`; `run-codegen-tests` only if generation changes.
- Skipped：MCP、plugin、release 与 Actions Skills。
- Authority：只允许 CLI source/test writes；除非另行请求，不涉及 public API 或 external
  write。
- Gate：focused failing regression、适用的 CLI test/typecheck/build、complete primary
  diff review、independent read-only review，且无 P0/P1。

### Optional filter on an existing read-only MCP Tool

- Rules：root 加 `packages/mcp/AGENTS.md`；只有 Core API 必须改变时才加 Core rules。
- Primary: `implement-and-review`.
- Support: `add-mcp-tool`.
- Skipped：`add-mcp-write-tool`，因为 request 是 read-only。
- Authority：stable startup boundary 内的 schema/handler/tests/docs。
- Gate：registration/schema visibility changes 时运行 unit/integration/stdio 与 Doctor，
  并完成 primary diff review、independent read-only review，且无 P0/P1。

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
