---
name: add-cli-command
description: Add or substantially change an openapi-to CLI command while preserving text and JSON contracts, structured diagnostics, centralized exit codes, safe stdout/stderr separation, binary aliases, and integration coverage. Use for commands or options in packages/cli; do not use for compiler-only or plugin-only changes.
---

# 新增 openapi-to CLI 命令

编辑前读取 root `AGENTS.md`、`packages/cli/AGENTS.md`、`packages/cli/src/index.ts`、其
integration tests、`packages/core/src/diagnostics.ts` 和
`packages/core/src/exitCodes.ts`。遵守 CLI Agent guide 中关于 ownership、stdout/stderr、
读写、exit code、binary alias 和 validation 的长期约束；本 Skill 只补充命令专属流程。

## 必要契约（Required contract）

编辑前先定义：

- command name、positional inputs、option defaults、aliases，以及是否需要 config；
- text mode 的受众和稳定 JSON envelope；
- owning compiler/library API 与新增 presentation adapter（如有）；
- diagnostics、exit-code case，以及多个 failure 同时发生时的 precedence；
- sensitive input、remote-source、output-write 和 path boundary。

## Workflow

1. 建立 `git status --short`，保留 unrelated changes。
2. 在 `packages/cli/src/index.ts` 注册 command/options；复用 Core API 和共享
   `CLIIO`/JSON helpers。
3. 先写 focused text/JSON assertions、可达的 diagnostic/exit precedence，以及
   command 前后 global-option placement，再扩大 integration coverage。
4. CLI build 影响 aggregate binary surface 时，检查 `packages/openapi/package.json`
   和 `bin/openapi.js`。

## Tests

为以下情形加入 integration evidence：

- `--help`、缺失/非法 input、有效 text mode；
- command 前后的 JSON；`JSON.parse(stdout)` 不得依赖 trim banner 或 color，且检查 stderr；
- success、每种可达 failure class 和 precedence；
- 相关 path parsing 的 Windows separator/drive-like path，以及 macOS/Linux case behavior；
- read-only command、dry-run 或 check 不得写文件；library 不得调用 `process.exit`；
- aggregate/CLI surface 变化时，两个 alias 都要有真实 built-bin smoke。

只运行 manifest 中存在的 command：

```sh
pnpm --filter @openapi-to/cli test
pnpm --filter @openapi-to/cli typecheck
pnpm --filter @openapi-to/cli build
pnpm --filter openapi-to build
```

随后针对代表性的 success/failure/JSON case 运行 built bin。若涉及 generate，使用 Codex `$run-codegen-tests` Skill；不可调用时直接读取 `.agents/skills/run-codegen-tests/SKILL.md` 并执行其适用流程。

## Stop conditions

- JSON stdout 含 logs、colors、banners、多个 documents、raw stacks 或 secrets；
- read-only/check command 写文件，或 clean operation 删除 unmanaged file；
- command 发明 centralized map 之外的新 exit code；
- library path 调用 `process.exit`，或 forced exit 可能截断 output；
- binary aliases 或 built declaration/export targets 不一致。

## Final report

报告 command/API 变化、exact text/JSON schema、exit-code behavior、安全决策、tests/built-bin 结果、binary alias 结果、compatibility risk 和每个 skipped check。不得把未执行的 scenario 报告为 PASS。
