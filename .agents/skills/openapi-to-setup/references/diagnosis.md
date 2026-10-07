# Setup 诊断

提出写入建议前先运行 Inspector。其 JSON 是有界观察结果，不能证明 command 已启动、Host 已重新加载 configuration，或 MCP Tool Schema 兼容。

Configuration evidence 与 runtime capability evidence 属于不同层次：

- `CONFIG_MISSING` 表示未观察到受支持的 root config；这不等于 `MCP_ANALYSIS_ONLY`，也不能证明当前有三个 analysis Tools。
- `HOST_CONFIG_READY` 表示观察到一个有界 Codex config section；这不能确定任何 `MCP_*` runtime state。
- `codex.inferredMode` 描述推断的 configuration 结构/意图，不是观察到的 runtime capability。
- 用户报告的 Tool 数量只是症状，不是 Tool/Schema 核验结果。
- 只有基于新的 Host evidence：实际 Tool 名称、相关的当前 `inputSchema` 和可用 runtime evidence，才能确定 `MCP_*` state。缺少任一必要证据时，报告 `UNKNOWN / UNVERIFIED`；Tool 名称或数量本身不能证明 capability。
- 如果用户询问为什么数量是三个，但没有可用的 live Tool 列表/Schema，应明确说明本 session 中当前 Host 数量和 capability 尚未验证。将 `CONFIG_MISSING` 作为独立的 configuration finding 报告；绝不能声称当前 MCP 暴露了三个 Tools、处于 analysis-only，或缺失的 config 导致了所报告的数量。

## State model

| State | Evidence | Next decision |
| --- | --- | --- |
| `UNINSPECTED` | 没有当前 Inspector 结果 | 阅读规则和 Git state，然后运行 Inspector。 |
| `BLOCKED` | 缺少 manifest、package-manager evidence 冲突、存在多个 configs、不安全 symlink、metadata 过大/无效、版本冲突或 Codex section 重复 | 停止写入并报告精确的有界原因。 |
| `PACKAGE_MISSING` | manifest 有效、项目边界可信、没有 aggregate `openapi-to` 声明且无其他 blocker | 规划精确版本的 aggregate install，或询问版本选择。 |
| `PACKAGE_READY` | 本地已声明 aggregate package | 继续检查 generation config；不要推断 binaries 一定可解析。 |
| `CONFIG_MISSING` | 没有受支持的 root config | 规划执行现有的 `pnpm exec openapi init`。 |
| `CONFIG_READY` | 恰有一个受支持的 config | 只有在 validation 获准时，才将其视为可信的 executable project code。 |
| `HOST_CONFIG_MISSING` | 没有 project Codex server section | 规划创建缺失文件或精确 append。 |
| `HOST_CONFIG_READY` | 识别到一个保守范围内的 server section | 可能仍需新 session 或 Host restart；默认对既有 section 进行人工 review。 |
| `RESTART_REQUIRED` | project Host configuration 已改变 | 停止当前流程。runtime verification 前先启动新的 Codex chat/session；如果新 session 仍陈旧，或该界面没有明确的 session reload 行为，则完整重启 Codex Host 并再次验证。 |
| `MCP_ANALYSIS_ONLY` | 当前 analysis Tool 列表和 Schemas 兼容 | 仅执行 validation/inspection/diff。 |
| `MCP_DEVELOPER` | 已配置的 Tool 列表，加上支持 `write` 与 `dry-run` 的 `openapi_generate` Schema | 根据用户意图，将 discovery、preview 或直接持久化 generation 交给 `openapi-to-generate`。annotations/effects 可见时一并使用；不可见时报告缺失的 annotation evidence，不得编造。 |
| `MCP_READ_ONLY` | 已配置的 Tool 列表，加上只支持 `dry-run` 的 `openapi_generate` Schema | 将 discovery 和 preview 交给 `openapi-to-generate`；写入请求转回 Setup。annotations/effects 可见时可作为佐证。 |
| `MCP_HARDENED` | 兼容的 Prepare/Apply 列表与 Schemas，以及 prompt policy | 将受控 generation 交给 `openapi-to-generate`；Apply 仍需精确 approval。 |

## Host runtime 诊断（独立于 Inspector）

Inspector 无法观察 Codex Desktop child process、session reload 或 restart state、exit code、stderr、有效 cwd 或 initialize wire exchange。不要把这些信息放入 deterministic Inspector states；只能依据有界的 Host 和 control evidence 对其分类：

| Outcome | 必须表达的含义 |
| --- | --- |
| `MCP_SERVER_UNAVAILABLE` | Host 未发现已配置的 Server、无法解析 command，或没有足够证据表明进程已启动。 |
| `MCP_STARTUP_FAILED` | Host 报告 process/startup/initialize failure，但 control evidence 无法将问题归因于 Host-specific compatibility。 |
| `MCP_HOST_COMPATIBILITY_SUSPECTED` | project config 存在；已启动新的 session 或执行要求的完整 Host restart；同一 local command 已通过 official SDK 和/或 Codex CLI；但目标 Host 仍在 startup/initialize 阶段失败。 |

最终 outcome 是 compatibility 分类，不代表已经证明上游 root cause。记录 evidence source 和 phase；不能用 Tool 数量替代当前 Tool 名称与 `inputSchema`。Desktop UI/lifecycle acceptance 仍需监督/人工验证。canonical project configuration 使用 consuming project 的绝对 root 作为 `cwd`；`--workspace-root "."` 与 `--config <project-relative-path>` 仍相对于 child process 的 cwd。项目移动时，重新运行 Setup 只会执行有界迁移。

Decision sequence:

```text
Inspector -> package/config/Host config -> fresh-session / Host restart boundary
  -> actual Server/Tool/schema evidence
  -> bounded local control -> SDK/CLI control
  -> Desktop failure with controls passing => MCP_HOST_COMPATIBILITY_SUSPECTED
```

## Inspector envelope

- `schemaVersion` 标识 JSON contract。
- `observedStateHash` 是排除 hash 字段后的 canonical observation 的 SHA-256。它绑定 manifest raw-byte hash；每个检测到的 lockfile 名称、大小和 raw-byte hash；generation config、`.gitignore` 与 Codex config 的 raw-byte hashes；相关存在状态；package-manager 与 dependency diagnostics；保守的 Codex diagnostics；以及 blocking reasons。Setup Plan 必须绑定此精确值。它不绑定整个 worktree。
- `blockingReasons` 已排序且取值封闭；不得猜测并绕过其中原因。
- `workspace` 只报告有界 booleans、相对 root marker 和当前 Node >=22 支持判定。即使 JSON 无效，`workspace.packageJson.sha256` 也对原始 bytes 计算；文件缺失时为 `null`，且不会暴露 manifest。绝不打印绝对 Workspace 路径。
- `packageManager` 优先使用 `package.json#packageManager`；仅当实际 lockfile 恰好一个时，才以该唯一 lockfile 作为后备。任何多个实际 lockfiles（包括同一 manager 对应多个文件名）都视为 `conflict`；本阶段只有 pnpm 可走自动写入路径。每个 lockfile record 都包含相对名称、manager、大小和流式读取的 raw-byte SHA-256。
- `dependencies` 只列出 manifest 中 `openapi-to` 与 `@openapi-to/*` 的声明、所属 dependency section 和 version range。它不检查 global installation，也不声称已声明 package 一定能解析。
- `generationConfig` 只检查 root 下的 `openapi.config.ts`、`.js`、`.cjs` 和 `.mjs`。只计算 bytes 的 hash，不导入或执行文件。
- `runtimeState` 检查 `.openapi-to/` 是否存在，以及保守识别的显式 root ignore rule。`gitignoreSha256` 绑定 `.gitignore` 全部原始 bytes，但不会返回文件正文。它不读取 state 内容。
- `codex` 对 `.codex/config.toml` 计算 hash，并以保守方式检查 section/text。不会返回 TOML 内容、credentials、command bodies 或 environment data。`parser: conservative-text-inspection` 明确不代表完整 TOML parsing。`cwdKind`、`cwdMatchesProjectRoot`、`legacyRelativeCwdDetected` 和 `unexpectedAbsolutePathDetected` 用于区分预期的绝对 project root、legacy、路径不匹配或不安全路径。绝对 cwd 与当前机器绑定这一点本身不会触发阻断；`configurationBlocked` 仍会标记自定义或不安全的 Host configuration。

## Package 边界

aggregate `openapi-to` package 提供 `openapi`、`openapi-to` 和 `openapi-to-mcp` binaries，以及官方 generation plugins。单独安装 `@openapi-to/mcp` 是面向高级用途的 MCP-only 边界，不是完整的业务 code-generation 环境。报告 MCP-only state；不要静默替换它或在其上覆盖安装。

在此 workflow 中，已有版本不可变。用户选择的精确版本优先于本地 `@openapi-to/*` 中精确且一致的版本；若两者都没有，则询问版本选择。Ranges、tags、`latest`、prereleases 和 global commands 都不是安全的版本证据。

## 失败时必须封闭处理

- 存在多个受支持的 generation configs 时，state 为 `BLOCKED`；不要自行选择。
- 缺少 `package.json` 时为 `PACKAGE_JSON_MISSING` 且 `BLOCKED`；不要创建 Node project 或规划 install。`PACKAGE_MISSING` 仅适用于 manifest 有效、边界可信且没有其他 blocker 的情况。
- 多个实际 lockfiles 会导致 `PACKAGE_MANAGER_CONFLICT`，即使文件名映射到同一 manager 也一样。
- 必须通过已验证的 open file handle 计算 lockfiles 的 hash，并限制在 32 MiB 内。文件过大时返回 `LOCKFILE_TOO_LARGE`；文件不可读、被替换、为 symlink 或位于 root 外时，必须 fail closed 且不返回内容。
- Node 提供 `O_NOFOLLOW` 时，文件读取使用 `O_RDONLY | O_NOFOLLOW`。Windows 等不提供该选项的平台采用经过验证的 `O_RDONLY` fallback：拒绝初始 symlink 或非普通文件，将 real path 解析到真实 project root 以内，核对打开文件的 identity 与目录项一致，并在读取后再次校验 identity 和 metadata。Bytes 只能通过同一个 `FileHandle` 读取；校验失败时保持 `BLOCKED`，且绝不返回文件内容。
- package、config、ignore 或 Codex metadata 文件无效或过大时，均为 `BLOCKED`；不要截断文件后继续。
- 若 symlink 解析后位于真实 project root 之外，则为 `BLOCKED`，不得跟随。
- 保守 Inspector 无法理解某个 Codex section 时，标记 `manualReviewRequired`；不要改写任意 TOML。
- package 声明不等于 command 可解析；Host section 不等于已 restart；Tool 数量不等于 Schema 兼容。八个 Tools 可能属于 Developer 或 Read-only，必须依据 schema/annotation evidence 判断。
- 用户只要求诊断时，报告 state 后就停止；不得准备或应用写入。

这些检查可以缩小 symlink 和文件替换竞态，但不能提供操作系统级的 atomic snapshot。执行任何 Setup Plan 前，都要重新检查 Git state 和精确的 `observedStateHash`。

<!-- Repository contract anchors (keep exact text; the Chinese guidance above is authoritative):
Configuration evidence and runtime capability evidence are separate layers
UNKNOWN / UNVERIFIED
actual Tool names
relevant current `inputSchema`
user-reported Tool count is a symptom
never claim that the current MCP exposes three Tools
`PACKAGE_JSON_MISSING` and `BLOCKED`
`PACKAGE_MISSING` requires a valid manifest
manifest raw-byte hash
every detected lockfile name, size
`gitignoreSha256`
Codex config raw-byte hashes
Multiple actual lockfiles
`LOCKFILE_TOO_LARGE`
`O_NOFOLLOW`
verified `O_RDONLY` fallback
same `FileHandle`
-->
