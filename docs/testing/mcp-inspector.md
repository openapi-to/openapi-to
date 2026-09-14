# MCP Inspector launcher（MCP Inspector 启动器）

手动 review MCP 时使用 repository launcher：

```sh
pnpm mcp:inspect
pnpm mcp:inspect -- --allow-write
```

默认是更安全的 read-only mode。`--allow-write` 是明确的 operator grant，会启动 synthetic ten-Tool fixture。Launcher 不接受 arbitrary Workspace、config、command、plugin、environment override 或 remote source。它会构建 package，创建 OS-temporary synthetic Workspace，选择未占用的高位 localhost port，只在临时目录中写入 trusted synthetic OpenAPI config，并在 foreground 启动 `@modelcontextprotocol/inspector` 0.22.0。Inspector Proxy authentication 保持启用。脚本永不设置 `DANGEROUSLY_OMIT_AUTH`，永不绑定 public interface，也永不使用 `nohup` 或脱离管理的 background process。

openapi-to runtime baseline 是 Node.js 22。Inspector 0.22.0 另要求 Node.js `>=22.7.5`；launcher 会在启动前检查这一 exact minimum，并输出可操作的提示，但不改变 package engines。Inspector command 应使用兼容的 Node executable；CI 与 published MCP Server 仍保持 Node 22。

在持久的 foreground PTY 中运行 launcher；使用 browser 时保持该 terminal 打开。关闭 PTY 会将 EOF/signal 传过 Inspector process tree，因此不等同于 request cancellation。收到 SIGINT、SIGTERM 或 Inspector 正常退出时，launcher 会转发 termination、等待 child、移除 temporary fixture/config，并释放 listener。

## 手动 checklist

在 read-only configured mode，确认恰好八个 Tool：三个 source analysis Tool、target listing、operation search、bounded operation contract reading、generation dry-run 和 check。在 write-enabled mode：

1. Confirm exactly ten Tools and the displayed Server name/version.
2. Review every Tool input/output schema and annotation.
3. Call selective Prepare with one exact operation key; review previous/requested/new/desired counts, projection, changes, hash, and token.
4. Confirm Prepare made no selection, generated-output, ownership, lock, stage, backup, or journal change.
5. Apply only the exact returned selective plan after explicit review.
6. Confirm generated artifacts, ownership, and selection appeared together and no transaction internals remain.
7. Replay the selective token and confirm `MCP_PLAN_ALREADY_USED`.
8. Prepare/apply a full plan and confirm the established full behavior is unchanged.
9. Confirm check reports `current` and a subsequent Prepare is unchanged.
10. Review managed deletion and confirm the unmanaged synthetic file is byte-identical afterward.
11. Observe coarse progress without ordinary stdout text.
12. Inspect structured selection/output/ownership/projection/artifact drift and tamper errors.

不要将 plan、Proxy 或 session token 复制到 validation document。只记录 sanitized input/result summary 和 normalized Workspace hash。

## Authentication 与 health

Launcher 会打印 Inspector 自身发出的 Inspector URL，但不持久化 credential。TCP listener 加上 unauthenticated HTTP `401` 表示 authenticated Proxy 健康，而不是 failure。`connection refused`、listener 消失，或任何 Tool call 前发生 reset，则是 lifecycle failure。

如果 browser 与 launcher 不共享同一个 localhost namespace，应停止操作。使用 same-host terminal、`tmux`/`screen` 或获批准的 private forwarding mechanism。绝不要通过公开暴露 Proxy 或禁用 authentication 来解决 namespace mismatch。

## Cleanup 与 residual process

在 launcher terminal 中按 Ctrl-C 退出。确认没有 Inspector 或 `openapi-to-mcp` child 残留，且打印出的 port 已释放。如果 terminal 被强制终止，先只检查该 invocation 启动的 process，再决定是否终止；不要杀掉无关的 Inspector session。

Inspector 不替代 `pnpm test:mcp:recovery`。关于 automated/manual 的 exact boundary，参见 [MCP test strategy](./mcp-testing.md)；关于 historical P3 acceptance record，参见 [controlled-write Inspector evidence](../validation/mcp-controlled-write-inspector.md)。
