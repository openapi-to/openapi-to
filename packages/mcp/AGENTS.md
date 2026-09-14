# MCP Agent guide（MCP Agent 规则）

本文件为 `packages/mcp/` 扩展 root `AGENTS.md`。当前 package 仅通过 stdio 使用
production-stable `@modelcontextprotocol/sdk`。

## Protocol and adapter boundary

stdin/stdout 只承载 MCP JSON-RPC。Operational logs 与 plugin incidental console output
写入有界、已 sanitized 的 stderr。不要替换 `process.stdout.write`，不要安装并发的
per-call console restore logic，也不要手写 protocol versions。

Handlers 直接调用 public Core APIs。绝不 spawn CLI、parse CLI output、递归调用 MCP
server，或把 generator plugin 作为 adapter 添加。

每个 Tool 都必须保持 stable name、title、limitation-aware description、bounded
input/output schemas、truthful stable annotations、一个简短 text summary，以及符合
`outputSchema` 且不重复的 JSON-safe `structuredContent`。
Expected compilation、Workspace、policy、config、plugin、stale-plan 与 result limit
failures return `isError: true`；protocol errors 用于 unknown Tools、invalid schema input、
lifecycle 与 unrecoverable SDK/protocol failures。

Results 在 truncation 前必须使用 stable priority ordering，保留 total/returned/omitted
counts，并在受限时 emit `MCP_RESULT_TRUNCATED`。默认绝不返回 complete document 或
generated tree、binary Base64、raw errors、stacks、absolute machine paths、config
source、environment、tokens、headers、cookies、credentials 或 URL queries。

## Startup authority and Tool matrix

Workspace、config、remote policy、deadlines、limits、output roots 与 write permission
属于 startup authority。Tool arguments 不能选择 executable config/plugins/code/shell/
environment，扩大 Workspace/output scope，或放宽 network/private-address policy。
Startup `configPath` 是 operator-authorized project code，并在 server lifetime 内缓存。

注册变化时重新检查 `src/server.ts` 与 `src/tools/index.ts`。当前 total Tool matrix 是：

| Startup mode | Tools |
| --- | ---: |
| no config | 3 analysis Tools |
| trusted config | 8 read-only Tools |
| trusted config plus operator `allowWrite` | 10 Tools |

The five config-gated read-only Tools list/search/read trusted operations and
dry-run/check configured generation. Dry-run and check may execute plugins and
read managed output but never write, repair, format user files, clean, or update
ownership.

Analysis calls 使用 call-local state。Generation 通过每个 Server instance 的一个
`GenerationLock` serialized，并在 `finally` 中释放；绝不引入 module-global
cross-Server lock。

## Cancellation and deadlines

使用 SDK handler 的 call-local AbortSignal，与已验证的 startup-owned deadlines 组合，
并传播至 remote loading、compiler checkpoints、plugin Hooks、artifact work、generation
queues 与 lock waits。区分 client cancellation、server deadline 与 HTTP timeout。所有
退出路径都要移除 timers/listeners，并证明 active 或 queued cancellation 不会遗留
generation lock。Standard progress 是可选的、粗粒度、monotonic/content-free，且只在
client-supplied token 存在时发送。

保留 source、config、reference、output 与 manifest reads 周围的 fail-closed TOCTOU
checks。适当时使用 opened handles 或 revalidation；不要声称完全消除了 races，也不要
在出现 inconsistency 后返回 `current`。

## Controlled Prepare/Apply writes

Write Tools 只有在 startup-trusted config 加 operator `allowWrite` 时存在。Tool
arguments 不能授予或扩大该 authority。严格保留现有的
`openapi_prepare_generation` 与 `openapi_apply_generation` pair；不添加 direct-write
shortcut 或 additional write Tool。

Prepare 运行完整的 deterministic generation/comparison pipeline，但不创建 Workspace/
output file、directory、selection state、lock、staging area、journal、cache 或 ownership
manifest。其 external summary 可以 truncated，但 internal plan 必须完整。将 plans
绑定到一个 Server、Workspace、trusted config/target、所有 input/reference/remote
hashes、output/manifest/file state、适用时的 selection/projection、generator/plugin
identity 与所有 artifact hashes。

Plans 使用 per-Server memory、random HMAC key、bounded count/bytes、TTL、deterministic
cleanup、restart invalidation、constant-time verification 与 one-time consumption。
绝不 persist 或 log key、full token 或 generated content。

Apply 只接受 `planId`、`token` 与 `approvedPlanHash`。它不能接受 targets、paths、
content、deletes、config、plugins、force、stale overrides、validation bypasses 或
safety policy。在 per-Server queue 与 shared Core output lock 下，Apply revalidate
每个 bound precondition、re-run generation、要求 exact plan equality、拒绝 appeared/
changed targets，并且只删除 ownership 与 approved plan 中同时存在且未变化的 regular
files。它绝不 silently re-plan。

所有 commits 使用 Core 的 transaction writer 与 output lock。Files、ownership manifest
与 controlled selection state 一起 commit 或 rollback。Commit 前 cancellation 会清理
staging 并释放 locks，且不会遗留 queue。Commit 开始后，在 independent commit deadline
下延迟 cancellation，直到 commit/rollback 完成。Unsafe/tampered locks 或 journals、
incomplete recovery、root replacement、symlinks 与 detected stale state 都 fail closed。

## Test layers

选择与 change 匹配的 maintained package/root script：

- `test:unit` — schemas、limits、sanitization、options、plan store 与 focused helpers。
- `test:integration` — in-process 与 subprocess service interactions。
- `test:stdio` — official SDK Client 加真实 built-bin protocol/stdout integrity。
- `test:write` — Prepare/Apply plan 与 disk behavior。
- `test:recovery` — transaction、lock、rollback、cancellation、failpoints、SIGKILL、
  journal 与 recovery。
- `test:performance` — bounded benchmark/stress。
- `test:e2e` 与 `test:all` — maintained aggregate gates。
- Doctor（`pnpm mcp:check`）— built-bin matrix、schemas、annotations、results、cleanup
  与 sanitized report。

Declared group 在缺少 files 或收集到 zero tests 时必须 fail。Tool registration/schema
changes 要更新 stdio E2E 与 Doctor。Controlled-write changes 要更新 write E2E；
transaction/cancellation/lock/crash/recovery changes 还要运行 recovery。

Inspector 只用于 user-visible discovery、schema、annotation 与 result inspection。它
不能替代 automated failpoint、SIGKILL、journal、lock 或 commit-critical cancellation
tests。不要为简化测试添加 production Tool argument、environment switch、public
failpoint 或 packed test helper。

不要把 Streamable HTTP、auth、Resources、Prompts、Sampling、Elicitation、Apps UI、Tasks、
background jobs、LLM/chat calls 或 another write Tool 作为 incidental MCP work 加入。
Read-only Tools 使用 `.agents/skills/add-mcp-tool/SKILL.md`，Prepare/Apply work 使用
`.agents/skills/add-mcp-write-tool/SKILL.md`。
