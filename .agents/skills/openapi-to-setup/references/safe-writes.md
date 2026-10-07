# 安全的 Setup 写入

本参考说明的是：普通 bootstrap 完成后，针对诊断出的 degraded project 或 Host state，如何通过 Skill 执行 recovery writes。普通的首次 Codex project bootstrap 唯一使用已发布 CLI `openapi setup --host codex --scope project` 作为 deterministic writer；本参考不是另一条 bootstrap 路径。

每次 recovery package install、initializer 执行、`.gitignore` 修改和 Codex config 修改都属于写入。诊断结果本身不代表用户已授权写入。

## Setup Plan schema

Plan 是有界 JSON，至少包含：

```json
{
  "schemaVersion": 1,
  "mode": "developer",
  "observedStateHash": "<lowercase-sha256>",
  "packageManager": "pnpm",
  "actions": [],
  "verification": [],
  "restartRequired": true
}
```

Commands 应表示为 program 加 argv，而不是 shell source：

```json
{
  "kind": "run-command",
  "command": "pnpm",
  "args": ["exec", "openapi", "init"],
  "network": false,
  "expectedWrites": ["openapi.config.ts", ".gitignore"]
}
```

受支持的 action kinds 有 `run-command`、`create-file`、`append-file`、`update-gitignore` 和 `manual-review`。直接文件操作必须指定相对 project target，并携带或附带精确的拟议 diff。Plan 不得包含 absolute/escaping target paths，也不得包含名为 `token`、`authorization`、`cookie`、`secret`、`password`、`headers` 或 `env` 的敏感字段。

使用以下命令为完整 plan 计算 hash：

```sh
node scripts/hash-setup-plan.mjs < setup-plan.json
node scripts/hash-setup-plan.mjs --file setup-plan.json
```

脚本会验证基础 Schema、递归排序 object keys、保留 array 顺序、输出 canonical JSON，并返回 SHA-256 `setupPlanId`。输入最大为 256 KiB，且 arrays 有最大长度限制，以免 approval record 无界增长。它不会执行 commands、访问 network、读取 environment variables 或写入文件。

## 精确 approval 与 drift

展示完整 plan、精确的 direct-edit diff、command argv、network flag、package/version 决策、预期的 package-manager/init 写入、verification 和 `setupPlanId`。只接受明确写出该精确 ID 的 approval，例如：

```text
批准执行 Setup Plan <exact-setupPlanId>
```

“Continue”、“install”、“configure it”、“looks good” 和 “use defaults” 都不是 approval。应用前重新运行 Inspector，并要求 `observedStateHash` 保持一致。该 hash 绑定 manifest、每个 lockfile、generation config、ignore file 和 Codex file 的 raw-byte SHA-256，以及相关 diagnostics 和存在状态。它不覆盖整个 worktree，因此还要单独重新读取 Git status。任何绑定文件发生 drift 或 worktree 有重叠改动都会使 plan 失效。重新规划、计算新的 `setupPlanId`、再次展示，并重新取得精确 approval。

缺少 `package.json` 时为 `PACKAGE_JSON_MISSING`，会阻止规划；绝不可隐式创建 Node project。`PACKAGE_MISSING` 仅适用于可信项目中 manifest 有效且未声明 aggregate package 的情况。多个实际 lockfiles 即使对应同一 manager 也会冲突。Lockfiles 以 32 MiB 为上限流式读取；过大、不可读、为 symlink、被替换或位于 root 外的文件都必须 fail closed，且不得返回内容。

Inspector 在支持的平台上使用 `O_RDONLY | O_NOFOLLOW` 读取。平台不支持 `O_NOFOLLOW` 时，会采用经过验证的 `O_RDONLY` fallback，并保留 `lstat`、real-root、普通文件、opened-identity 以及读取前后的 metadata 检查。内容只能通过同一个 `FileHandle` 读取；fallback 不允许跟随 symlink，也不允许在 identity 不确定时继续。这些检查不是操作系统级 atomic snapshot，因此每个获批的 Setup Plan 仍必须使用新的 Inspector hash，并单独检查 Git state。

## 安装 package

本阶段只自动支持 pnpm。必须使用 plan 中显示的精确 package 与 version：

```sh
pnpm add -D --save-exact openapi-to@<exact-version>
```

Plan 将 `network: true` 标记为预期，并要求产生 `package.json` 与 `pnpm-lock.yaml`。绝不可使用 global install、浮动 tag、未经明确选择的 prerelease、以 `@openapi-to/mcp` 替代 aggregate package，或隐式升级。必须审查实际 diff，因为 package-manager 的变更不一定都是 Skill 导致的。

## Initializer 与 ignore rule

只能使用 `pnpm exec openapi init`。它没有受支持的 non-interactive override 或 force option。对于 ESM package，它创建 `.ts`；否则创建 `.js`。只要存在 `.ts`/`.js`/`.cjs`/`.mjs` 候选文件，它就会拒绝继续；随后仅当 `/.openapi-to/` 尚不存在时才 append 该规则。它不会创建 `.openapi-to/`。不要手写另一套 generation template，也不要使用 `.OpenAPI/openapi.config.ts`。

如果 config 已经存在，不要运行 init。若存在多个 config，停止。如果只有 config 存在但缺少 ignore rule，经精确 approval 的 `update-gitignore` action 可以只 append 该规则，并确保 newline 合理；保留全部原始 bytes。

## Codex config

只有在获批后，才创建缺失的 project file，或 append 一个精确且尚不存在的 section。保留原始 bytes 与未知 sections；不得重新排序文档。既有 `openapi_to` sections、重复 section、不寻常 TOML 或不安全的 mode policy 都需要人工 review。不要实现不完整的 TOML rewriter。

Config 必须使用 project-local package-manager resolution 和 relative paths，不含 credentials，不放宽 remote policy，也不使用旧版 `--allow-write` flag。普通 configured mode 省略 `--generation-mode`，即 Developer。显式 Read-only 或 Hardened mode 必须带对应的 generation-mode 参数；Hardened 还必须配置 Apply prompt section。

## 写后 review

检查完整 worktree diff，并将每个变更路径归类为 pre-existing、approved direct edit、expected command output 或 unexpected。发现重叠或意外写入时停止。验证 local commands、仅有一个 config、ignore state、精确 Codex bytes、不含重复/absolute/credential 内容，并核验适用的 Apply prompt。重新运行 Inspector。不得提交或 push consuming project。

Host configuration 修改以 `RESTART_REQUIRED` 结束当前流程。停止当前流程；只有在新的 Codex chat/session 中（若新 session 仍陈旧或 reload 行为不明确，则需完整 Host restart 后）观察到 Tool 列表、相关 `inputSchema` 和可用 runtime capability evidence，才能完成 setup。Annotations 仅在可见时作为佐证；Host 不暴露它们时，记录为 unavailable。

<!-- Repository contract anchors (keep exact text; the Chinese guidance above is authoritative):
Skill-mediated recovery writes
this reference is not an alternate bootstrap path
## Setup Plan schema
node scripts/hash-setup-plan.mjs
observedStateHash
setupPlanId
approval naming that exact ID
Re-plan, re-hash to a new
Never use global install
## Post-write review
`PACKAGE_JSON_MISSING`
`PACKAGE_MISSING` is reserved for a trusted project with a valid manifest
raw-byte SHA-256 values for the manifest, every lockfile
new `setupPlanId`
Multiple actual lockfiles conflict
hash does not cover the whole worktree
verified `O_RDONLY` fallback
same `FileHandle`
-->
