# openapi-to setup Skill（设置 Skill）

`openapi-to-setup` 是第二个 consumer Agent Skills phase。它在 consuming project 中诊断并配置 openapi-to，不替代 local MCP Server。第一阶段的 `openapi-to-generate` 只在 setup 后启动，负责 API Operation discovery、selective generation 和 business-code integration。

这些 phase labels 记录 delivery history。Phase 2.1 加强 Setup Plan state hashing，Phase 2.2 增加 Windows portable verified reads；二者都是 Setup hardening，不是 additional consumer Skills。该文档 does not upgrade existing versions；用户旅程仍从 Setup 开始，只有 fresh Codex session（或必要的 Host restart）和 capability verification 后才进入 Generate。

普通首次 Codex project bootstrap 使用 CLI `openapi setup --host codex --scope project`，它负责 bounded package evidence、`openapi init` config/ignore semantics、packaged Skills 和 project MCP config。`openapi-to-setup` Skill 负责 package-broken/degraded diagnosis、recovery、session/Host reload guidance 和 3/8/8/10 Tool-mode validation；ordinary configured MCP 使用 Developer default，显式 `read-only`/Hardened 才通过安全配置流程表达，Hardened 保留 `openapi_apply_generation` 的 prompt approval。

### Host runtime diagnosis

Inspector 只负责 deterministic project/package/config/Host-file evidence，不能假装观察 Codex Desktop child process。fresh-session / Host reload 边界之后，Setup 将 runtime outcome 分为 `MCP_SERVER_UNAVAILABLE`、`MCP_STARTUP_FAILED` 与 `MCP_HOST_COMPATIBILITY_SUSPECTED`。最后一项必须同时有 project config、已完成 fresh session 或所需 Host restart、相同 local command 的 official SDK/Codex CLI control PASS，以及目标 Host 在 startup/initialize 阶段 FAIL；Tool 不可见本身不足以断言 upstream bug。SDK、CLI 与 Desktop evidence 必须标明来源，Desktop acceptance 保留为 supervised/manual。

canonical configuration 由 `openapi setup --host codex --scope project` 写入 consuming project 的绝对根目录 `cwd`。`--workspace-root "."` 与 `--config <project-relative-path>` 保持相对参数，并相对于该 child-process cwd 解析。移动项目、切换 worktree 或 clone 到另一台机器后，重新运行 Setup 会受限迁移 cwd。

## 在 Codex 中安装此 Skill

已安装的 `openapi-to` npm package 携带此 Skill 与
Skill and `openapi-to-generate`. Preview and then explicitly install those
offline assets:

普通首次 onboarding 不需要先单独执行 Skill installer：

```sh
pnpm exec openapi setup --host codex --scope project --dry-run
pnpm exec openapi setup --host codex --scope project
```

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
either existing Skill. Start a new Codex chat/session after installation; if
the Skill is still unavailable, fully restart Codex and check again. This
installer does not configure MCP or a project; once Codex loads the Skill, this setup workflow performs that diagnosis and
keeps Skill-mediated project/Host writes behind its normal Setup Plan approval.
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
checkout must infer Developer, Read-only, or Hardened consistently with the named
Tools and current Schemas exposed by the MCP installed from that checkout's local tarballs. The
bridge also proves a bound-file drift changes `observedStateHash`; it does not
claim that the Inspector ships in the tarball or repeat MCP transaction tests.
See the
[consumer acceptance coverage matrix](./testing/consumer-acceptance-matrix.md).

## Approval-bound writes（绑定 approval 的写入）

For Skill-mediated package install, initializer run, ignore change and Codex
config change, each write requires a complete JSON Setup Plan bound to the
current inspector state hash. Direct `openapi setup` is the explicit operator
execution of its bounded CLI command and performs its own fresh state re-check;
it does not require a second Skill approval ceremony.
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

## Codex fresh session / Host reload and verification（新会话与 Host 重载）

The Skill may create a missing trusted project `.codex/config.toml` or append
one absent `openapi_to` section, or migrate an exact legacy/stale canonical
section after exact approval. It preserves unrelated bytes and unknown
sections. A customized, duplicate, unsafe, or unrecognized section requires
manual review; the Skill does not implement a general TOML rewriter.

Codex config change 后 setup returns `RESTART_REQUIRED`。该 machine token 保持兼容，语义是
当前 session/runtime 不能用于验证变更后的 capability。停止当前流程后，优先新建 Codex
chat/session，并检查实际 Tool list、相关 `inputSchema` 和可获得的 runtime capability evidence。
若新 session 仍显示旧 Tools/Skills/Server，Host lifecycle 不明确，或实际证据仍不符合预期，
完整重启 Codex Host 后再验证。官方 plugin 文档规定插件安装后新建 chat，但没有据此声称所有
Codex surface 对 project `.codex/config.toml` 都遵循相同生命周期。OpenAI 官方
[Developers plugin 安装指引](https://developers.openai.com/learn/developers-codex-plugin)
在 Codex 安装步骤后要求新建 chat；这项说明针对 plugin onboarding。一次真实 Codex Desktop
检查观察到新 conversation 加载了项目 Skills、MCP Server 和实际 Tools/schema；这是
Host-dependent 观察，不是所有 Desktop、CLI、IDE 或未来版本的保证。

Counts of 3, 8, and 10 are useful orientation for analysis-only, Developer, Read-only, and
Hardened modes, but a matching count alone is not capability evidence. If the Host does not expose
annotations, report annotation evidence as unavailable; use only the actual Tool list, relevant
`inputSchema`, descriptions, and bounded runtime capability evidence that is visible. Do not
fabricate annotations or fail solely because they are hidden.

requested state 验证后使用 `openapi-to-generate`：Developer setup supports
discovery, preview, or direct generation according to user intent; Read-only
supports discovery and preview only; Hardened supports its separately approved
Prepare/Apply workflow. Setup never performs that business generation workflow
or bypasses Apply approval.
