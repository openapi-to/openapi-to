# CLI Agent guide（CLI Agent 规则）

本文件为 `packages/cli/` 扩展 root `AGENTS.md`。

## Ownership and I/O

CLI 负责 argument parsing、调用 public Core APIs、human/JSON presentation 与 centralized
exit-code selection。它不得重新实现 loading、reference resolution、validation、diff
semantics、artifact comparison 或 filesystem writing。

JSON mode 必须向 stdout 写入恰好一个可直接 `JSON.parse` 的 document。Diagnostics text、
progress、debug output、logs 与 plugin `console` output 写入 stderr。绝不向 JSON stdout
增加 banners、colors、update notices、prose 或第二个 JSON value。保持 envelopes 与
array ordering deterministic，不暴露 stacks、credentials、URL queries 或 complete
documents。

使用 Core 的 `ExitCode` 与 diagnostic mapping。Library modules 永远不调用
`process.exit`；awaited CLI entrypoint 在 output flush 后设置 `process.exitCode`。

## Read and write boundaries

- `validate`、`inspect` 与 `diff` 是 read-only。
- `generate --dry-run` 会执行 compiler/plugins 并比较 artifacts，但不写入 generated
  files、ownership state 或 cleanup changes。
- `generate --check` 同样是 read-only；当 disk 不一致时返回 centralized outdated
  output status。
- Plain `generate` 是唯一写入的 generation command，并将 comparison、lock acquisition、
  transaction writing、clean ownership 与 recovery 委托给 Core。
- `init` 只在既有 collision policy 下写入 explicit selected root configuration file。

Published aggregate 必须通过 `packages/openapi/bin/openapi.js` 保留 `openapi` 与
`openapi-to` 两个 aliases。

## Validation

CLI changes 必须覆盖适用的：

- human-readable 与 JSON modes，包括 command 前后（适用时）的 global options；
- success、configuration、input/OpenAPI、plugin、outdated 与 breaking-change exit statuses；
- exact stdout/stderr separation 与 `JSON.parse(stdout)`；
- help、invalid input 与不得强制终止 process；
- generate write、dry-run、check-current、check-outdated，以及 added/modified/deleted
  manifest entries；
- path parsing 变化时的 Windows 与 POSIX path forms；
- 两个 built aggregate aliases 与适用的 CommonJS/ESM E2E project。

确认 manifests 中的 scripts 后，通常运行：

```sh
pnpm --filter @openapi-to/cli test
pnpm --filter @openapi-to/cli typecheck
pnpm --filter @openapi-to/cli build
```

当 binary surface 或 generation behavior 变化时，build aggregate 并运行适用的 real
E2E/built-bin smoke。Command work 使用 `.agents/skills/add-cli-command/SKILL.md`，changed
generation output 使用 `.agents/skills/run-codegen-tests/SKILL.md`。
