---
name: add-mcp-tool
description: Add or substantially change a read-only tool in the openapi-to stdio MCP server while preserving stable input/output schemas, structuredContent, bounded deterministic results, Workspace/config/remote security, protocol error separation, stdout integrity, official Client integration, Inspector/Codex smoke, and package release coverage. Use for changes under packages/mcp/src/tools or shared MCP result/security/server infrastructure; do not use to add write tools without separately explicit user authorization.
---

# 新增 MCP Tool

先读取 root `AGENTS.md`、`packages/mcp/AGENTS.md`、`packages/mcp/README.md` 和
[mcp-tool-checklist.md](references/mcp-tool-checklist.md)。遵守 MCP Agent guide
中关于 stdio、startup authority、Tool matrix、result、cancellation 和 controlled-write
的长期约束；重新核对已安装的 stable `@modelcontextprotocol/sdk` API，不照抄 beta example。

## Workflow

1. 确认请求的 Tool 是 read-only、synchronous、bounded，且属于现有 stdio-only server。若会写入、删除、修复、改 config、执行 arbitrary code，或新增 HTTP/auth/LLM feature，停止并要求独立 authorization 与 design review。
2. 找到 adapter 调用的 public Core API；若需要未获授权的新 compiler semantics，停止。
3. 定义 Tool name、title、limitation-aware description、Zod input/output schema、stable annotations、result bounds 和 expected-error mapping。
4. 按 checklist 跟踪每个 input/returned field 的 Workspace、remote-policy、sanitization、ordering、truncation、cancellation 和 no-mutation tests。
5. registration/schema 变化时更新 package-owned test layer、root route 和 Doctor；加入真实 official SDK `Client` + `StdioClientTransport` subprocess test，针对 built bin 运行。
6. 检查当前 Inspector help，进行 user-visible discovery/schema/result review。failpoint、SIGKILL、journal、lock 和 commit-critical evidence 必须留在 automated tests。
7. 只有 public package impact 确实需要时才更新 README/ADR/AGENTS/Changeset/release surface，然后按 checklist 和 MCP Agent guide 的 impact-selected matrix 验证。

Do not create Claude Code files or mirror this Skill outside `.agents/skills`.
