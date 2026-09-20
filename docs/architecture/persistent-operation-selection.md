# Persistent operation selection and Selective Prepare（持久化 operation selection 与 Selective Prepare）

> Current implementation note: Issue #130 将持久化 selection 的唯一 authority 统一为 Core Generation Intent，状态位于 `.openapi-to/generation-intents/<target>-<identity>.json`。本文保留 operation-selection 术语作为用户可见 scope 的概念说明；旧的 `.openapi-to/selections` 路径仅代表历史设计。

状态：controlled additive 与 exact-replace Selective Apply 已实现。

本文描述项目意图如何在 trusted generation target 中持久化，以及它如何与 read-only
discovery、Selective Prepare 和受控 Apply 衔接。所有 selection 都受 bounded input、
Workspace confinement、plan binding、显式 approval 和 Core 三状态 transaction 约束；
Prepare 始终无副作用，未列出的 mutation 不会因为翻译而变成 supported capability。

## 状态含义与 identity

Operation selection 是项目希望为一个 trusted generation target 保留的完整 operation 集合，不是最近一次 request 传入的临时列表。Selective Prepare 支持两种 mutation：

```text
add:     desired = previous ∪ requested
replace: desired = requested
```

两种 mutation 都会去重并按 code point 对 operation key 排序。Add 保留现有的 500-key request batch limit，因为 caller 可以逐步构建 selection。Replace 接受完整的 5,000-operation persisted-selection limit，因为它必须在一个 request 中表达 desired set。Replace 至少要指定一个 operation；空 replace 为未来的 clear capability 保留，并会被拒绝。只生成新增项或差异项会使 tag/global aggregate、shared schema 和 ownership manifest 不完整，因此 Selective Prepare 每次都会 projection 并生成完整的 desired selection。

每个 current config target 已经确定一个 input、plugin set、Workspace、output root 和 ownership manifest。因此 B1 直接使用 target 作为 selection owner，不增加 destination abstraction。Owner 绑定 trusted config display identity、target name 和 normalized Workspace-relative output root；有界 opaque hash 不暴露 machine path。状态位于固定的内部派生路径：

```text
.openapi-to/generation-intents/<target>-<identity>.json
```

Caller 只能传入 trusted target name，不能传入该 path、output path、config、source、plugin、content、cleanup policy 或 destination。

## Manifest v1

```json
{
  "version": 1,
  "target": "backend",
  "selectionOwner": "target:backend|config:<hash>|output:<hash>",
  "operations": ["getUser", "updateUser"],
  "metadata": {
    "lastAppliedSpecHash": "optional audit value",
    "updatedAt": "optional audit value"
  }
}
```

Operations 唯一，并独立于 request order 按 code-point lexical order 排序。Version、target、owner 和排序后的 operations 共同形成 semantic SHA-256 hash。Metadata、timestamp、PID、random value 和 machine path 不影响该 hash。Unknown field 会被拒绝。Core 保留原有 add-only 的 `OperationSelectionMutation`、`OperationSelectionMergeResult` 和 `mergeOperationSelection()` contract，包括 legacy runtime result shape。新的 add-or-replace consumer 使用 `PersistentOperationSelectionMutation`、`OperationSelectionMutationResult` 和 `applyOperationSelectionMutation()`。Mutation result 以确定性方式暴露 mutation type、previous、requested、newly added、already selected、retained、removed 和 desired key。

文件大小限制为 1 MiB，最多 5,000 个 operation，每个 key 最多 500 个 UTF-8 bytes。读取过程有界且稳定，会拒绝 symlink、hard link 和 Workspace escape，并比较读取前后的 file identity。损坏的 JSON、unsupported version、重复/空/无效 key、target/owner mismatch 以及并发读取 drift 都会 fail closed。Prepare 永不创建 directory 或写入该文件。

## Bootstrap 与 drift

Bootstrap 仅在 selection 不存在、ownership 不存在且 output root 不存在或为空时允许；此时 initial previous selection 为空。以下状态会 fail closed：

- ownership exists but selection does not: `SELECTION_BOOTSTRAP_REQUIRED`;
- selection is absent while the output is non-empty: `SELECTION_BOOTSTRAP_REQUIRED`;
- selection exists, ownership is absent, and output is non-empty: `SELECTION_STATE_INCONSISTENT`;
- manifest target/owner differs from trusted identity: `SELECTION_TARGET_MISMATCH` or `SELECTION_OWNER_MISMATCH`.

没有 ownership 的 selection 只允许与空 output 并存，这样可以在不猜测 ownership 的情况下 review 新的 desired artifact set。Replace 也可在同一规则下为 empty Workspace bootstrap 第一个 non-empty selection。Selection 永不从 historical full ownership manifest 推断，因为 current manifest 只记录 artifact path/hash/bytes/kind，没有无歧义的 operationKey mapping。

每个 historical 和 requested key 都会对照 current cached Operation Catalog 检查。缺失或已重命名的 key 以 `SELECTION_OPERATION_NOT_FOUND` 失败；缺失或当前重复的 `operationId` 以 `SELECTIVE_PREPARE_OPERATION_ID_REQUIRED` 或 `SELECTIVE_PREPARE_DUPLICATE_OPERATION_ID` 失败。任何 operation 都不会被自动迁移、移除或重命名。

## Selective Prepare 与 plan binding

```text
trusted target
  -> bounded previous selection read
  -> exact requested mutation
  -> normalized desired selection
  -> cached compilation
  -> projected compilation(desired selection)
  -> complete desired artifacts
  -> output/ownership comparison
  -> applyable selective plan (Prepare still writes nothing)
```

省略 `selection` 时，`openapi_prepare_generation` 仍执行 full generation。传入 `selection: { type: "add" | "replace", operationKeys: [...] }` 时，它要求一个 trusted target，复用 compiled target cache，并 projection 全部 desired key。Add 保留 trusted target 既有的 `output.clean` 行为，因为它不会缩小 desired selection。Replace 在内部启用受 ownership 约束的 managed cleanup，因此即使 target 通常保留旧 generated file，收缩 selection 仍保持 exact；这由 Server 派生，不是 caller 可控的 cleanup policy。新的 desired projection 之外、保持不变且由 ownership 管理的 artifact 会作为显式 managed deletion 出现；unmanaged file 不进入 delete set。

确定性 plan 绑定 `kind=selective`、mutation type、manifest version、selection owner/file identity、prior physical snapshot 与 semantic hash、normalized previous/requested/new/already-selected/retained/removed/desired key、desired semantic hash、exact desired serialized-byte SHA-256/length、projection hash/stats，以及现有 full plan 的 Workspace/config/source/reference/remote/output/ownership/file/generator/plugin/artifact/delete binding。磁盘状态不变时，等价的 request order 产生相同 plan；即使 add 与 replace 恰好得到相同 desired set，两者仍是不同 plan。Audit metadata 不参与 semantic operation hash，但 physical file 或 final byte 的变化会有意改变 transaction plan binding。External array 每个 category 最多返回 50 个 key，并提供 exact count 和 explicit truncation；internal plan 保持完整。

## Apply 边界与 lifecycle

Selective Prepare 返回 `kind: "selective"`、`applySupported: true` 和 one-time token。Token 绑定 selective kind、trusted target/output、selection owner、plan hash、expiry、Workspace 与 Server process。短生命周期的 internal plan 还保留 exact desired serialized selection bytes；caller 只收到有界 summary。Prepare 仍不创建 selection、generated output、ownership、lock、stage、backup 或 journal。

明确 approval 后，Apply 会在获取 output lock 前重新验证 previous physical snapshot 和 semantic hash。获取 lock 后，它消费 token，重新编译 trusted target，精确 projection frozen desired operation key，比较 projection hash/statistics 以及每个 artifact 的 path/kind/order/hash/byte length、deletion、desired ownership bytes 和 desired selection，然后再次验证 selection。Apply 永不接受 operation key。只有这些检查全部通过后，才会携带 frozen desired selection bytes 调用 `commitGenerationStateTransaction()`。Transaction 安装 generated artifact，执行已批准的安全 managed deletion，依次安装 ownership 与 selection，并在成功前验证三者。Rollback 和 crash recovery 会一起恢复 prior artifact、ownership 与 selection state。

Full Prepare 仍返回 token；full Apply 保留既有的 revalidation、shared lock、atomic artifact/ownership transaction、rollback、recovery、cancellation、expiry 和 replay behavior。Restart 会清除全部 plan 并刷新 trusted config/catalog state。B1 不增加 file watcher，也不增加 write permission。

## 当前边界

Add 与 non-empty replace 是唯一的 selection mutation。Remove、clear、prune、automatic full-output migration、operation rename migration，以及 caller-selected destination 或 cleanup policy 仍被禁用。Generated output 仍位于既有 trusted target output 下。Selection 只能由成功且已批准的 selective Apply 写入；Prepare 不写入 state，full Prepare/Apply 与 full CLI generation 保持既有语义。
