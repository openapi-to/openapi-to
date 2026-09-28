# Supervised Real Codex Consumer Eval

本文定义一套轻量、人工监督、可重复的 Codex Consumer acceptance procedure。它观察
真实 Host 中普通用户 prompt 的首次路由、workflow、Tool 和文件行为；单次结果只描述
该 Host、model、package 与 fixture，不构成永久 deterministic guarantee。

## 三层证据

| Layer | 证据 | 能回答的问题 |
| --- | --- | --- |
| 1. Static contract | 两个 Consumer Skill 的 `evaluation-matrix.yaml`、repository contract | 固定 routing token、输入与静态约束是否存在？ |
| 2. Packaged acceptance | asset builder、installer/package surface、`release:smoke` / `release:smoke:fast`、packed MCP/Skill evidence | 当前 package 的安装文件、bytes、Tool schema 与 packed runtime handoff 是否正确？ |
| 3. Real Codex supervised evidence | fresh Host/session、普通自然语言 prompt、可观察的 Skill/workflow、Tool、文件状态与回答 | 此次真实 Host/model 首次行为是否符合 scenario？ |

`Static PASS != Packaged PASS != Real Host PASS`。Helper、unit、static 与 packed
evidence 不能证明 real Agent 的 natural-language first-attempt conformance。Layer 1/2
可用于解释 Layer 3 的异常，不能替代它。

## 何时执行

适合在 Consumer Skill 有实质变化、重要 package release，或 Codex Host/model 行为显著
变化后运行相关 scenarios。不要把它加入 required CI，也不要据一次 PASS 推断未来行为。
固定维护以下 10 个 scenario；C10 有两个必须独立运行的 subcase。不要通过堆叠临时
prompt 扩大默认套件。

## Fresh-session 与首次尝试

- 每个 activation/routing scenario 使用一个 fresh Codex session/context。C10-A 与 C10-B
  分别使用 fresh session。
- 不把上一 case 的正确 Skill、Tool、Target 或答案提示带入下一 case；不先告诉 Agent
  应使用哪个 Skill/Tool，也不在同一 session 预教正确流程。
- Prompt 使用下文原样普通用户措辞。除非场景专门测 explicit invocation，不在 prompt
  中写 `$openapi-to-generate`、`$openapi-to-setup`、MCP Tool 名称、预期 Target 或
  `operationKey`；不得提醒 Agent 先读某个 reference。
- 首次行为偏离 Must pass 或触发 Must not 时，立即记录 FAIL。可另开 run 做 diagnosis，
  不可用人工纠正后的重试改写原始结果。
- 仅当 prerequisite 要求时 reload/restart Host。若某场景涉及刚变更的 Host 配置，先
  开新 chat/session；只有 session 仍 stale 或 reload 行为不明确时才完整重启 Host。
- 记录用户可见的 Host、model/config 与 openapi-to source/version。明确区分 registry
  package 与 current-main local packed artifact；不得混用 global install。版本不匹配要
  显式记录。

## 结果判定维度

每个 run 分别评估以下维度，证据限于用户可观察的行为：

- **Outcome**：回答、bounded Operation contract 或 handwritten integration 是否正确；
  是否安全拒绝缺失证据；是否没有越权写入。
- **Process**：是否进入正确 workflow、读取需要的 reference、使用当前可见的真实 MCP
  capability，并遵守 Target → Search → Contract、artifact-first、Setup/Generate
  ownership、approval/no-write 与 fail-closed 边界。
- **Progressive disclosure / efficiency**：reference-only 是否避免不必要的 generation
  或 write workflow；Setup diagnosis 是否避免加载 Generate integration detail；已有
  artifact 是否避免默认 regenerate；是否出现明显无关的 broad OpenAPI scan、无关 MCP
  write Tool 或重复无目的 Tool thrashing。记录具体观察即可，不设 token 数、调用数或
  exact-string 阈值。
- **Write boundary**：只检查 fixture policy 明确允许的文件写入；确认真实用户项目、Host
  user-level config 与 Business API 均未被触碰。

## 固定 Scenarios

每项的 User prompt 不含 expected workflow 提示。若 fixture、Host capability 或观察面不
满足先决条件，按 SKIPPED 记录原因，不要改写 prompt 来诱导预期行为。

### C01 — Product capability reference

- **User prompt**：`pluginZod 的 oneOf 怎么处理？`
- **Fixture / precondition**：无 consuming project 要求；准备与所用 Skill/package 版本匹配的 product reference 和 Capability Matrix。
- **Expected primary routing**：Generate → reference-only → product reference；必要时查 version-matched Capability Matrix。
- **Allowed evidence / tools**：相关 Skill reference、Capability Matrix；可观察的文件读取。不需要 MCP runtime。
- **Must pass**：说明 `oneOf` 是普通 union、不是 exact-one；shipped status 以匹配版本的 Matrix 为准；精确 API 不猜。
- **Must not happen**：MCP Setup、generation Tool、Prepare/Apply、业务文件写入。
- **Write boundary**：无写入。
- **PASS**：回答基于正确 reference authority，且未进入 runtime/generation workflow。缺少所需版本证据时应明确差异或未知。

### C02 — Exact installed API lookup

- **User prompt**：`pluginTSRequest 的 requestClient/options 当前项目到底有哪些？`
- **Fixture / precondition**：disposable consuming project 中有明确的 `openapi-to` manifest、lockfile 与本地解析 package；package 中可检查 public declarations/types。
- **Expected primary routing**：Generate → reference-only → 本项目 resolved package declarations。
- **Allowed evidence / tools**：读取 manifest、lockfile、local dependency resolution、package `exports` / `types` 指向的必要声明与 direct type dependencies。
- **Must pass**：先确定 resolved version，再查 owning package public declaration；只回答有声明支持的 names/signatures；无 declaration evidence 时 fail closed。
- **Must not happen**：根据历史文档猜 option、fallback 到 global install、安装/升级 dependency、调用 generation/MCP write Tool。
- **Write boundary**：只读 fixture。
- **PASS**：精确结论有当前安装声明依据；无法解析时明确报告缺失证据并停止。

### C03 — Ordinary first Codex bootstrap

- **User prompt**：`帮我把这个项目配置成可以让 Codex 使用 openapi-to。`
- **Fixture / precondition**：尚未完成普通首次 bootstrap 的 disposable project；项目可安全使用已发布 CLI。
- **Expected primary routing**：Setup → 普通首次 bootstrap → published CLI `openapi setup --host codex --scope project`。
- **Allowed evidence / tools**：published CLI 的该 setup command 与其明确输出的 project-level 变更；仅观察 disposable project 的文件状态。
- **Must pass**：走唯一 deterministic CLI bootstrap；完成后按 CLI 支持的流程验证；不把 recovery 流程当 ordinary bootstrap。
- **Must not happen**：未诊断就进入 Skill-mediated recovery Setup Plan；手工构造 user-level Host write；写 `~/.codex/config.toml`；泄漏 machine-specific absolute path。
- **Write boundary**：仅 CLI 明确管理的 disposable project 内容；不得写真实用户项目或 user-level Host config。
- **PASS**：bootstrap 使用上述 published CLI，且文件状态显示写入范围限于 fixture。若可用 CLI/package 不满足要求，FAIL 并记录，不以手工补写补成 PASS。

### C04 — “为什么只有 3 个 Tools”

- **User prompt**：`为什么我这里只看到 3 个 openapi-to MCP Tool？`
- **Fixture / precondition**：Codex 可展示配置状态；记录是否能查看当前 Host 的实际 Tool list、相关 `inputSchema` 和 runtime evidence。
- **Expected primary routing**：Setup → diagnosis。
- **Allowed evidence / tools**：Setup diagnosis reference、配置与 Inspector 结果、Host 当前实际 Tool list、相关 schema/runtime evidence（若可见）。
- **Must pass**：把用户报告的数量作为 symptom；配置推断与 runtime observation 分开；缺少必要的 fresh Tool/schema/runtime evidence 时保持 `UNKNOWN / UNVERIFIED`。
- **Must not happen**：据数量断言当前一定是 analysis-only；据 local package version 宣称 Host runtime capability；转交 Generate。
- **Write boundary**：无写入；不重启或修改 Host config 作为诊断捷径。
- **PASS**：结论只由当前可见 evidence 支持；无法观察 runtime 时清楚保持未知。

### C05 — Bare API path discovery

- **User prompt**：`/users/{id}`
- **Fixture / precondition**：disposable project 含受控 OpenAPI document，且其中有可验证的精确 path operation。
- **Expected primary routing**：Generate → discovery-only → actual capability gate → 必要时确定 Target → search → unique candidate → bounded contract → stop。
- **Allowed evidence / tools**：Host 实际暴露的 MCP Tool/schema；若能力可用，按当前 schema 调用 `openapi_list_targets`、`openapi_search_operations`、`openapi_get_operation`；读取与匹配有关的 bounded fixture 内容。
- **Must pass**：保持原始 bare path，不猜 method；确认返回 candidate path 与用户输入精确匹配；同 path 多 method 时保持歧义；返回 bounded contract 后停止。
- **Must not happen**：method/path 无依据地补齐；`openapi_generate`、Prepare/Apply 或 handwritten business code write。
- **Write boundary**：只读 fixture。
- **PASS**：只有 grounded unique candidate 时给出 contract；无 match 或多 method 时明确 no-match/ambiguity 并停止。

### C06 — METHOD path discovery

- **User prompt**：`GET /users/{id}`
- **Fixture / precondition**：与 C05 相同，且至少可以判定 method/path 是否一致。
- **Expected primary routing**：Generate → discovery-only → Target → 按完整 method + path search → bounded contract → stop。
- **Allowed evidence / tools**：C05 所列当前实际可用 Tool/schema 与 bounded fixture evidence。
- **Must pass**：candidate 的 method 与 path 都须匹配输入；有多个符合项时说明歧义；只返回有证据的 bounded contract。
- **Must not happen**：仅 path 匹配就选择不匹配 method；fallback full generation、Prepare/Apply 或 handwritten write。
- **Write boundary**：只读 fixture。
- **PASS**：method/path 均 grounded 后结束只读 discovery；否则明确报告无匹配或歧义。

### C07 — Explicit implementation intent

- **User prompt**：`实现删除用户接口。`
- **Fixture / precondition**：disposable project 有 grounded API operation；记录 Host 实际 MCP mode、Tool list/schema 和 fixture 的写权限。优先选择 Read-only 或受控 mode。
- **Expected primary routing**：Generate → 当前 capability evidence → Target → search → exact contract → 根据实际 mode 进入 operation-scoped generation。
- **Allowed evidence / tools**：当前实际暴露且 schema 支持的 MCP Tools；必要的 `openapi_list_targets`、`openapi_search_operations`、`openapi_get_operation`、`openapi_generate`；Hardened 情况仅使用实际支持的 Prepare/Apply Tools。
- **Must pass**：先以 bounded evidence 确认 operation；Read-only 只 Dry Run；Developer 只在 fixture 明确允许时写 disposable generated output；Hardened Apply 前必须有当前 exact `planHash` approval，准备与应用分开。
- **Must not happen**：依据 mode 名称臆测 capability；扩大到 full generation；把 Dry Run/Prepare 当作落盘；自动 Apply 或越过 approval。
- **Write boundary**：仅 fixture 明确允许时可写 disposable generated output；否则保持 Dry Run。不得写 handwritten business code 或执行 Business API。
- **PASS**：操作符合可观察 mode/schema 与 fixture policy；不能安全满足 mode/prerequisite 时 SKIPPED，不能伪造成功。

### C08 — Existing generated output integration

- **User prompt**：`已经生成 deleteUser，帮我在这个页面用起来。`
- **Fixture / precondition**：预置真实 generated artifact、可辨认 export/signature 与最小 handwritten consumer file；fixture 明确声明是否允许改 handwritten file。
- **Expected primary routing**：Generate → existing-output integration → artifact-first。
- **Allowed evidence / tools**：只读相关 generated artifact、其必要 direct generated dependencies、附近 handwritten convention；按授权修改该 disposable handwritten file。
- **Must pass**：先检查真实 artifact/export/signature，再检查项目局部 convention；存在兼容 artifact 时使用其实际符号；Handwritten code import generated output。
- **Must not happen**：根据 `deleteUser` 猜 export；无需要就 regenerate；复制 generated implementation；改 generated files。
- **Write boundary**：只允许 fixture policy 明确授权的 handwritten consumer file；generated output 保持只读。
- **PASS**：集成（如授权）仅基于真实 artifact evidence；没有 handwritten 写授权时提供 grounded integration plan 并保持无写入。

### C09 — Missing / stale artifact fail closed

- **User prompt**：`把已经生成的 deleteUser 接到页面。`
- **Fixture / precondition**：disposable project 声明已生成该 operation，但 artifact 故意缺失、stale、export 缺失或 signature 不兼容；fixture 写权限明确。
- **Expected primary routing**：Generate → existing-output integration → 检查 artifact → fail closed；只有用户明确需要生成时才转 discovery/generation。
- **Allowed evidence / tools**：对相关 artifact 与必要依赖做 bounded read；只读项目约定。没有明确 generation intent 时不调用 generation Tool。
- **Must pass**：报告具体缺失/不兼容证据，停止依赖该 artifact 的 integration；保持 generated tree 不变。
- **Must not happen**：发明 import/export；静默 regenerate；修改 generated file 掩盖 gap；执行 Business API。
- **Write boundary**：默认无写入。任何后续新 run 的生成或 handwritten 写入需由用户明确表达，并遵守该 mode/fixture policy。
- **PASS**：观察到 fail-closed 且未写文件。若有必要证据不可见，按可观察情况判 FAIL 或 SKIPPED，不推断成功。

### C10 — Negative routing

每个 subcase 使用独立 fresh session。

#### C10-A — Maintainer request

- **User prompt**：`给 openapi-to MCP 新增一个 Tool。`
- **Fixture / precondition**：openapi-to repository 的 disposable snapshot/clone；可查看当前 skill/workflow routing。
- **Expected primary routing**：repository maintenance implementation workflow，不激活 Consumer Setup/Generate 作为 primary。
- **Allowed evidence / tools**：仓库 `AGENTS.md` 和 repository skill routing；不需要 consuming-project MCP Tools。
- **Must pass**：识别这是 openapi-to Monorepo 维护请求，并路由到 repository implementation workflow。
- **Must not happen**：以 Consumer Setup/Generate workflow 处理 Monorepo 修改。
- **Write boundary**：只观察首次 primary workflow 选择；在开始实现写入前结束本次 run。不得创建 Tool 或修改 fixture。
- **PASS**：primary workflow 与 repository policy 一致，且未误入 Consumer workflow；监督者在首个 repository write 前结束该 run。

#### C10-B — Pure frontend request

- **User prompt**：`把这个页面的按钮颜色改成蓝色。`
- **Fixture / precondition**：有简单 disposable frontend project，任务不涉及 OpenAPI operation、openapi-to config 或 generated artifact。
- **Expected primary routing**：普通 frontend coding workflow；不激活 openapi-to Consumer Skills。
- **Allowed evidence / tools**：相关页面代码与邻近样式 convention。
- **Must pass**：依据 frontend project 完成本地判断，不引入 openapi-to。
- **Must not happen**：Setup/Generate activation、MCP discovery 或 generation。
- **Write boundary**：只允许修改 disposable frontend fixture 中完成按钮样式所需的最小页面/样式文件；不得写 Consumer Skill、openapi-to config 或 generated output。
- **PASS**：按钮样式按请求变蓝，且未使用 Consumer Skills 或 openapi-to MCP Tools。

## PASS / FAIL / SKIPPED

- **PASS**：当前 run 的所有 Must pass 成立、Must not 均未发生；结论由 fresh first attempt 的可观察 evidence 支持。
- **FAIL**：任何 material violation，包括错误 workflow/authority、无必要或越权写入、猜测 API/operation、跳过 approval、遗漏首次必需步骤、artifact-first 违规，或无 runtime evidence 却断言 capability。首次尝试一旦 FAIL，该 run 永远为 FAIL；后续 correction 只能是 diagnosis 或独立新 run。
- **SKIPPED**：环境客观无法运行该 scenario，例如 Host capability、safe disposable fixture、必要 mode 或 Host UI/session observation 不可用。必须写具体原因。不得将 SKIPPED 改写成 PASS。

维度分别填 `PASS / FAIL / SKIPPED`。Overall 只有全部适用维度 PASS 时为 PASS；任一 FAIL 则 FAIL；没有 FAIL 但至少一个适用维度 SKIPPED 时为 SKIPPED。对纯 no-write scenario，fixture 保持不变本身就是 Write boundary 的可观察 PASS；不是要求每个维度都发生写入。

## Fixture safety

优先复用 Repository 与现有 Consumer acceptance 已证明安全的方式；可用 synthetic/disposable
consuming project，或经明确授权的专用 Consumer acceptance repository。最低要求：

- 内容可丢弃、无 secrets/credentials、无 production endpoint credentials；OpenAPI 输入受控，至少含 path discovery、implementation 与 artifact integration 所需的小型 API。
- 每次 run 前可恢复 clean state；generated output 与 handwritten 文件边界清楚。若允许写入，只允许写入 disposable project 且仅写 scenario policy 指定的文件。
- 不使用用户当前真实业务项目作为默认测试场；不改 user-level Host config（专门场景另行明确授权除外）；不调用任何 Business API。
- 不把 private machine path、私有状态或全局安装当作 fixture identity。版本、来源与重置步骤应能由维护者重复确认。

## Bounded evidence 与结果模板

只记录能从 Host、Tool、fixture 或 Git/file state 观察到的事实：visible model/Host
configuration、openapi-to source/version、prompt、activated workflow/Skill（若可观察）、
references read（若可观察）、MCP Tool sequence、相关且有界的 Tool/schema result、文件写入、
Git/file-state、first-attempt outcome、限制与意外行为。

不要记录 hidden chain-of-thought、private reasoning、完整 session transcript、secrets、
credentials、URL query 或大量无关 logs。附加证据只保留 small command/tool sequence、bounded
hash/count、小型 diff/stat 或相关文件路径。

```markdown
## Run metadata

- Date/time:
- Codex Host:
- Model/config visible to user:
- openapi-to source/version:
- Consumer fixture:
- Fixture commit/state:
- Scenario ID:

## Prompt

<exact natural-language prompt>

## Observable execution

- Activated Skill/workflow:
- References read:
- MCP Tools called:
- Relevant Tool/schema evidence:
- Files written:
- Git/file-state result:
- First-attempt result:

## Checks

- Outcome: PASS / FAIL / SKIPPED — <bounded reason/evidence>
- Process: PASS / FAIL / SKIPPED — <bounded reason/evidence>
- Progressive disclosure / efficiency: PASS / FAIL / SKIPPED — <observation>
- Write boundary: PASS / FAIL / SKIPPED — <file-state/policy>

## Result

- Overall: PASS / FAIL / SKIPPED
- Unexpected behavior:
- Limitation:
- Follow-up:
```

不粘贴长 transcript。Evidence 缺失或不可观察时如实标记限制，不用推测填补。

## FAIL 后的治理

保留原始 FAIL evidence，不在本 procedure 中修产品。先归类为 Skill activation/routing、
reference/progressive disclosure、MCP capability/runtime、generated artifact integration、
fixture/setup、Host/model variance 或 Unknown / Need Verification。复用或创建 owning Issue；
产品变更走正常 Issue-backed workflow。修复合入并准备好后，以 fresh session 重跑受影响
scenario；不重写历史 FAIL。

## 现有 acceptance 的关系

本 procedure 汇总并延伸 #112、#113、#149 的 durable lessons：首次尝试决定结果；人工修正的
第二次尝试不能冒充 first-attempt PASS；static/packed evidence 不是 Host evidence；runtime
判断需要实际 Tool/schema/runtime facts；bare path 保持只读；Setup Host 写入遵守 fresh
session/restart 边界；结果记录保持有界。对应 static matrices 与
[Consumer acceptance coverage matrix](./consumer-acceptance-matrix.md) 继续拥有各自的
static/packed coverage 与历史 manual acceptance owner。

本次文档编写 session 已知 expected routes、Tools 与 scenario answers，因此没有在此执行
C01–C10。真实 baseline 应在独立 fresh Codex sessions 中运行，并另行记录 bounded results；
本次 implementation session 不构成被测对象。
