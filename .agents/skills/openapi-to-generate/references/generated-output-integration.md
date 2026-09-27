# Generated output → handwritten business integration

只在用户授权的 consuming project 内工作；先读取适用 `AGENTS.md` 与 current Git state，
保留 pre-existing changes。真实 artifact 可用于授权的 handwritten 集成；本流程不新增
installation、generation、Apply 或 business API execution 权限。

## Golden path：artifact-first

`Generation persisted successfully OR relevant generated output already exists`
→ identify exact relevant artifacts
→ read only relevant generated files
→ discover actual exports / signatures
→ inspect nearby handwritten project conventions
→ choose the smallest existing integration surface
→ modify handwritten business code
→ run smallest sufficient validation。

禁止 `operationId/path → guess getUser()/useGetUserQuery() → write imports`。
必须 `actual artifact → actual export declaration → actual signature → integration`。
名字只是搜索线索；确认 module、export、参数、返回值与所需直接 types 后才写 import/call。
缺失 export 或 incompatible signature 必须 fail closed，说明 gap；不能根据文档示例发明符号。

## Bounded reads 与 existing output

- 只读 selected/relevant operation artifacts、理解 imports/signatures 必需的 direct generated dependencies，以及附近 handwritten consuming code。
- 可用有界 filename/symbol search 定位 relevant file，但结论必须 grounded in actual file contents。不要 broad-read whole OpenAPI、默认遍历整个 generated Target tree，或把大规模 generated tree 填入 context。
- “已经生成 deleteUser，帮我接到页面”：先验证当前真实文件、actual export/signature 与任务相关性。已足够就直接集成，不因 Skill 名为 generate 默认 regenerate。
- Artifact stale / missing / incompatible 时不能静默假设；停止依赖该 artifact 的修改，明确 generation need 并返回 Skill 的 MCP-first discovery/generation 流程。Generator defect 交回 owning workflow，不由 business integration 掩盖。

## Project convention first，import 而非 copy

查看附近 services、features、hooks、queries、API adapter、stores 或 component data layer，
选择当前项目已有最小 surface，沿用 error/loading/cache/validation pattern。无必要不新增 wrapper
或 adapter architecture。Handwritten code import generated output，不复制 generated implementation；
generated files 始终 generator-owned，不能手改它们让测试通过。

| 已验证的 output | 集成方向（exact 名称从文件读取） |
| --- | --- |
| TS types | Compile-time type integration。 |
| TS request | Actual generated request function，与现有 client/config 配合。 |
| Zod | 仅项目需要的 runtime validation boundary。 |
| SWR | Actual generated SWR surface。 |
| React Query | Actual key/options/hook surface；不假定 hooks 一定存在。 |
| Vue Query | Actual generated Vue Query surface。 |
| MSW | Test/mock integration，不用于 production request。 |

不把 concrete generated symbol names 写成长久 invariant；不执行 business API 来验证集成。

## Mode / provenance

| Evidence | 可以继续的动作 |
| --- | --- |
| Existing real files | 按授权读取 actual on-disk artifacts，验证后集成；无需 generation 时不做 MCP preflight。 |
| Developer write success | `openapi_generate` 持久化成功后，验证真实新落盘 artifacts，再集成。Tool 成功预览不等于 write success。 |
| Read-only / Dry Run | 不创建真实文件。只能分析、说明 integration approach、展示 Tool returned preview，或把 Agent 自写示例标为 `illustrative Agent-generated example`；不能声称 import 不存在的 generated file。已有真实文件可按独立的 handwritten 修改授权消费，不把 preview 当文件。 |
| Hardened | Dry Run → Prepare → exact user approval（当前 `planHash`）→ Apply success → verify actual artifacts → integrate。Prepare plan 本身不是落盘。 |

Generation workflow 继续以 actual Tool/schema/runtime evidence 为准。Hardened Apply 后先核对
真实 added/modified/deleted changes 与 approved plan（包括 managed deletions）；不一致立即停止。
Transaction failure、rollback、token consumption 或 recovery-required 时遵守
[controlled write](controlled-write.md) 的 stop/re-Prepare rules，不猜状态或重试旧 Apply。

## Validation / completion

运行 consuming project 已定义的最小充分 targeted tests、typecheck、lint 或 build；先确认 command
存在，失败时修 handwritten integration 的真实问题，不改 generated code 掩盖缺陷。
报告 exact commands 与 PASS / FAIL / SKIPPED，并区分 MCP/generated files、Agent-written handwritten
integration、pre-existing project changes。说明 artifact 来源、已核实 exports/signatures、未验证或
截断的 generated output limitation；reference-only / existing-file 工作不得伪造 MCP call evidence。
