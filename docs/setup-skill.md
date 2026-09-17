# openapi-to setup Skill（设置 Skill）

`openapi-to-setup` 是第二个 consumer Agent Skills phase。它在 consuming project 中诊断并配置 openapi-to，不替代 local MCP Server。第一阶段的 `openapi-to-generate` 只在 setup 后启动，负责 API Operation discovery、selective generation 和 business-code integration。

这些 phase labels 记录 delivery history。Phase 2.1 加强 Setup Plan state hashing，Phase 2.2 增加 Windows portable verified reads；二者都是 Setup hardening，不是 additional consumer Skills。该文档 does not upgrade existing versions；用户旅程仍从 Setup 开始，只有 restart 和 capability verification 后才进入 Generate。

package installation、既有 `openapi init` flow、`/.openapi-to/` ignore repair、Codex project MCP configuration、startup diagnosis 和 3/8/10 Tool-mode validation 使用 setup。模糊 setup request 默认 `read-only`；`write-enabled` 必须明确，并保留 `openapi_apply_generation` 的 prompt approval。

### Host runtime diagnosis

Inspector 只负责 deterministic project/package/config/Host-file evidence，不能假装观察 Codex Desktop child process。重启边界之后，Setup 将 runtime outcome 分为 `MCP_SERVER_UNAVAILABLE`、`MCP_STARTUP_FAILED` 与 `MCP_HOST_COMPATIBILITY_SUSPECTED`。最后一项必须同时有 project config、已完成 restart、相同 local command 的 official SDK/Codex CLI control PASS，以及目标 Host 在 startup/initialize 阶段 FAIL；Tool 不可见本身不足以断言 upstream bug。SDK、CLI 与 Desktop evidence 必须标明来源，Desktop acceptance 保留为 supervised/manual。

canonical configuration 仍为 project-relative `cwd = "."`。absolute cwd 仅可由用户选择作为 manual、machine-local、不要提交的 workaround experiment，不能自动写入 Setup Plan，也不能被描述为 root cause 或 portable fix。

## 在 Codex 中安装此 Skill

已安装的 `openapi-to` npm package 携带此 Skill 与
Skill and `openapi-to-generate`. Preview and then explicitly install those
offline assets:

```sh
pnpm exec openapi skills install \
  --host codex \
  --scope project \
  --dry-run

pnpm exec openapi skills install \
  --host codex \
  --scope project
```

command writes to the explicitly selected `.agents/skills` root:
`$CWD/.agents/skills` for `project`, or `$HOME/.agents/skills` for `user`.
Scope is required and `~/.codex/skills` is only a historical compatibility
location reported by a bounded warning. The installer refuses to overwrite
either existing Skill. Restart Codex after installation. This installer does not configure MCP or a project;
once Codex reloads the Skill, this setup workflow performs that diagnosis and
keeps every project/Host write behind its normal Setup Plan approval.
Installing the npm package and running `openapi init` do not install Skills;
`openapi init` remains generation-config initialization only.

## 修改前先诊断

Skill 的 standard-library inspector 只读取 bounded project metadata，不会
executing `openapi.config.*`, walking generated/state directories, inspecting
global packages, accessing the network, or returning configuration bodies and
credentials. Its state hash binds raw-byte SHA-256 values for `package.json`,
every detected lockfile, generation config, `.gitignore`, and Codex config,
along with relevant existence states and diagnostics; it does not bind the
whole worktree. Lockfiles are streamed and limited to 32 MiB. The workflow
keeps local package declaration, one supported config, local command
resolution, Host configuration, Host restart, Server connection, and verified
Tool capability as distinct evidence.

支持的 root configs 是 `openapi.config.ts`、`.js`、`.cjs` 和 `.mjs`。
Multiple candidates block setup. `.openapi-to/` is runtime state; the retired
`.OpenAPI` config location is not used.

缺失 manifest 产生 `PACKAGE_JSON_MISSING` 和 `BLOCKED`；setup 绝不
creates a Node project or plans an install in an unconfirmed directory.
`PACKAGE_MISSING` means a valid `package.json` in a trusted project lacks only
the aggregate package. Multiple actual lockfiles—including two filenames for
the same manager—are a package-manager conflict. Oversized, unreadable,
symlinked, replaced, or out-of-root lockfiles fail closed without returning
their contents.

支持 `O_NOFOLLOW` 的平台，verified reads 使用
`O_RDONLY | O_NOFOLLOW`. Windows and other platforms without that constant use
a verified `O_RDONLY` fallback; they do not drop the initial `lstat`, symlink,
regular-file, real-root, or opened-file identity checks. All bytes are read
through the same `FileHandle`, followed by another identity and metadata check.
Any uncertainty remains `BLOCKED`. This is not an operating-system-level atomic
snapshot, so Git status and `observedStateHash` are checked again before a Setup
Plan executes. The focused Inspector suite runs in the repository's real
Ubuntu, macOS, and Windows A1 CI matrix.

这些 focused tests 是 canonical setup state 与 safe-inspection
coverage. The packed release smoke adds one narrow continuity check in the
same repository-external consumer: the Inspector from the exact repository
checkout must infer read-only or write-enabled consistently with the named
Tools exposed by the MCP installed from that checkout's local tarballs. The
bridge also proves a bound-file drift changes `observedStateHash`; it does not
claim that the Inspector ships in the tarball or repeat MCP transaction tests.
See the
[consumer acceptance coverage matrix](./testing/consumer-acceptance-matrix.md).

## Approval-bound writes（绑定 approval 的写入）

每次 package install、initializer run、ignore change 和 Codex config change
requires a complete JSON Setup Plan bound to the current inspector state hash.
The plan shows exact argv, network use, expected writes, direct file diffs,
verification, and restart impact. Its canonical SHA-256 `setupPlanId` must be
named in explicit user approval. If the manifest, any lockfile, config, ignore
file, or Codex file changes, the Skill discards the approval, creates a new
Setup Plan and `setupPlanId`, and requires new exact approval. Git worktree
status is re-read separately immediately before execution.

Skill never uses a global install，也不 upgrade existing
openapi-to version. Installation requires an exact version: explicit user
choice first, then a consistent exact local `@openapi-to/*` version, otherwise a
new version decision. It uses the aggregate package, not `@openapi-to/mcp` as a
business-environment substitute.

Automatic package writes are currently pnpm-only:

```sh
pnpm add -D --save-exact openapi-to@<exact-version>
```

npm, Yarn, and Bun are diagnosed but their install/config mutation remains
manual in this phase. Host automation is Codex-first; Claude Code, Cursor, and
generic stdio Hosts continue to use their existing manual guides.

## Codex restart and verification（重启与验证）

The Skill may create a missing trusted project `.codex/config.toml` or append
one absent `openapi_to` section after exact approval. It preserves existing
bytes and unknown sections. An existing `openapi_to` section, duplicate section,
absolute path, or unrecognized TOML shape requires manual review; the Skill
does not implement a general TOML rewriter.

Codex config change 后 setup returns `RESTART_REQUIRED`。只有
user restarts Codex does the Skill inspect the actual Tool list, relevant Tool
inputSchema, and returned capability fields. Counts of 3, 8, and 10 are useful
orientation for analysis-only, read-only, and controlled-write modes, but a
matching count alone is not capability evidence.

requested state 验证后使用 `openapi-to-generate`：read-only setup
supports discovery and preview; write-enabled setup supports its separately
approved Prepare/Apply workflow. Setup never performs that business generation
workflow or bypasses Apply approval.
