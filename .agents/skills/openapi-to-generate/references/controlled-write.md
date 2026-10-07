# 受控 Prepare 与 Apply

只有当实际 MCP Tool 列表同时包含 `openapi_prepare_generation` 和 `openapi_apply_generation` 时，才使用本参考；选择参数前还必须检查它们当前的 `inputSchema`。Tool 名称匹配并不能证明存在较新的 `inputSchema` capability。Hardened startup 授予 operator capability，但不代表用户已经 approval。旧版 `--allow-write` flag 会被拒绝。

## Prepare

对且仅对一个可信 Target 调用 Prepare。要执行 selective generation，必须传入一个明确的 `selection` mutation 和精确的 `operationKeys`。不要提供或推断 source paths、config paths、plugins、output paths、file content、cleanup policy 或 remote permissions。

只有当整个集合的替换语义符合用户明确表达的意图，且当前 Prepare inputSchema 明确支持 `selection.type = replace` 时才可使用 `replace`。如果 Schema 只支持 `add`，可以按增量意图继续，但必须停止 replace 请求。如果不存在 `selection`，不要臆造 selective Prepare。无法查看 `inputSchema` 时，除非已由解析出的本地版本文档或当前 Tool call 验证该 capability，否则 `replace` 必须 fail closed。

Tool input: `openapi_prepare_generation` — 替换整个集合的 selective Prepare

```json
{
  "targets": ["<exact-target>"],
  "selection": {
    "type": "replace",
    "operationKeys": ["<exact-operation-key>"]
  }
}
```

Prepare 必须保持 read-only。请求 approval 前，先展示以下 review record：

```text
Target:
Mutation: add | replace
Requested operationKeys:
Previous / new / already-selected counts and bounded keys:
Retained / removed / desired counts and bounded keys:
Projection counts and hash:
Added / modified / deleted counts and important paths:
Truncation or limiting diagnostics:
Apply supported:
Exact planHash:
Expiry or freshness information:
```

数组发生 truncation 时，展示精确的 total 和 returned counts。不得声称查看了未显示的 paths 或 keys。特别指出每一项 managed deletion，尤其是 `replace` 产生的删除。

如果 Prepare 未返回 `success`、`plan.applySupported = true`、精确 plan ID、one-time token、精确 plan hash、尚未过期的 plan，或足以供用户知情 approval 的完整结果，则在 approval 和 Apply 前停止。Prepare plan 和 one-time token 不是文件系统变更，也不代表用户已经 approval。

## 精确 approval

必须取得明确指向当前唯一 plan 的陈述，例如：

```text
Approve plan <exact-plan-hash> for Apply.
```

不得接受 “generate”、“continue”、“update”、“execute the preview”、“looks good” 或 “same as before”。存在多个 hashes 时，要求用户指定其中一个。绝不能代替用户选择 hash。

不得自动串联 Prepare 与 Apply。Host config 必须继续要求对 `openapi_apply_generation` 进行 prompt approval；不要建议一律自动批准。

## Apply

收到精确 approval 后，调用 Apply 时只能传入该次 Prepare 返回的 plan ID、one-time token 和 approved plan hash。Server 会重新生成并验证冻结的 plan。对于 expired、replayed、tampered 或 stale state，Server 必须拒绝，而不能采用新内容。

Tool input: `openapi_apply_generation` — 对当前 plan 的已批准 Apply

```json
{
  "planId": "123e4567-e89b-42d3-a456-426614174000",
  "token": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "approvedPlanHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}
```

Apply 不能接收 operation keys，也不能动态覆盖 Target、config、source、plugin、output path、content 或 cleanup policy。不得臆造 force flag 或 stale override。

## 失败时封闭处理

- **Plan expired：**重新 Prepare，展示新 summary 和 hash，并请求新的精确 approval。
- **Plan stale 或发生 input/config/`$ref` drift：**重新 Prepare 前先解释 binding 的变化；绝不能复用之前的 approval。
- **Selection 或 ownership drift：**停止，使用新的 Prepare 重新读取有界状态，并要求用户批准新的 hash。
- **Token consumed 或 replayed：**不得重试旧 plan。只读检查实际 output state；如需继续，再次 Prepare。
- **Apply transaction 在 commit 前失败：**报告有界 diagnostic，并核实没有任何计划写入被报告为成功。
- **Rollback 已完成：**报告 Apply 失败及已回滚状态；不得声称 generation 成功。
- **需要 rollback 或 recovery：**停止所有写入并升级给 consuming project 的 operator。不得手动修改 journals、locks、ownership 或 generated files。
- **存在 managed deletions：**确保它们列在展示并批准的 plan 中；核实 Apply 后只有 generator-owned paths 发生变化；如有其他路径变化，停止并报告。

## Apply 后的 integration

将实际 worktree 与已批准的 added/modified/deleted plan 对照。区分 generator-owned files、handwritten integration 和既存变更。如有不匹配，停止后续 business edits 并报告差异。

不要手动编辑 generated output 来让测试通过。通过 consumer 已有的 import 和 API 层进行集成，然后运行范围最小且充分的 targeted tests、typecheck、lint 或 build。准确报告执行过的 commands 和结果。

<!-- Repository contract anchors (keep exact text; the Chinese guidance above is authoritative):
exact approval
expired, replayed, tampered, or stale state
Do not chain Prepare and Apply automatically
Rollback or recovery is required
-->
