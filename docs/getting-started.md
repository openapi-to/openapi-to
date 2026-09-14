# 快速开始（Getting Started）

`openapi-to` 是推荐的统一安装入口：

- 安装 `openapi` 和 `openapi-to` CLI aliases。
- 导出 Core 和全部 official generator plugins。
- 提供 `openapi-to-mcp` stdio server command。

Repository development 和 test commands 要求 Node.js 22.13+；published packages 支持 Node.js 22+。本仓库固定使用 pnpm 11.26.0，pnpm 12 暂作为独立 major migration。

## CLI

安装 aggregate package：

```sh
pnpm add -D openapi-to
```

安装包还包含版本匹配的 `openapi-to-setup` 和 `openapi-to-generate` assets。Codex 用户可以先预览，再显式安装，安装过程不访问网络：

```sh
pnpm exec openapi skills install \
  --host codex \
  --dry-run

pnpm exec openapi skills install \
  --host codex
```

当前支持的 installer Host 只有 `codex`。安装器写入 `$CODEX_HOME/skills`；未设置 `CODEX_HOME` 时使用 `~/.codex/skills`，并拒绝覆盖已有 Skill directory。安装后请 Restart Codex（重启 Codex）。安装 `openapi-to` 不会自动安装 Skills，`openapi init` 仍只负责初始化 generation config 和 state ignore rule；Skill installer 也不会配置 MCP。

这些 binary names 是 aliases：

```sh
pnpm exec openapi --help
pnpm exec openapi-to --version
pnpm exec openapi validate ./openapi.yaml
pnpm exec openapi inspect ./openapi.yaml --json
pnpm exec openapi diff ./old.yaml ./new.yaml --json
pnpm exec openapi generate --dry-run --json
```

运行 `pnpm exec openapi init`，在 Workspace root 创建起始配置。Generation 会向上查找最近的 `openapi.config.ts`、`.js`、`.cjs` 或 `.mjs`；同一 candidate directory 存在多个候选文件时，会在执行配置代码前失败。`--config <path>` 可显式选择一个文件并绕过 discovery。`validate`、`inspect` 和 `diff` 不需要 generation config。`init` 向 `.gitignore` 添加 `/.openapi-to/`，root config 仍可提交。

选中的 configuration directory 会成为 generation Workspace。因此从 nested package 运行 `generate` 时，相对 input、managed state 和 Workspace output 仍以配置目录为基准。

对于 microservices，为每个 OpenAPI document 指定稳定的 `Target` name 和独立的 output root。`pnpm exec openapi generate` 生成全部 Target；重复 `--target <name>` 可选择一个或多个 Target。Local JSON/YAML/YML 和受策略约束的 HTTP(S) input 使用同一 Core loader。默认 managed output 位于 `.openapi-to` 下；`output.base: 'workspace'` 会把 generator-managed code 放在 project root 下。

支持 Workspace 内的 Windows absolute input path；drive-relative path（`C:openapi.yaml`）、UNC path 和配置中的 `file:` URL 会被拒绝。Output segments 也必须在 Linux、macOS 和 Windows 上可移植；Windows device names、reserved characters、control characters，以及结尾为 period/space 的 segments 会在 generation 前被拒绝。

完整的多文档示例和 ownership 规则见 [CLI generation guide](./cli.md)；选择 plugin 或 dialect 前请先查看 [Capability matrix](./capability-matrix.md)。

## MCP server

同一个 aggregate installation 已提供 MCP command，不需要额外安装 MCP package：

```sh
pnpm exec -- openapi-to-mcp --help
```

如果明确需要独立的 MCP package boundary，可以安装 `@openapi-to/mcp`；它提供独立的 `openapi-to-mcp` command，以及 `@openapi-to/mcp` 和 `@openapi-to/mcp/cli` programming interfaces。

Phase 1 的 `openapi-to-generate` consumer Skill 主要面向安装 aggregate `openapi-to` 的 business project。仅安装 MCP package 不会自动成为完整的 business code-generation environment；更广泛的 MCP-only consumer support 属于独立设计边界。

安全默认值是 local stdio 和 no writes：

```sh
pnpm exec -- openapi-to-mcp --workspace-root .
```

trusted project config 会增加 read-only catalog 和 generation preview/check Tools：

```sh
pnpm exec -- openapi-to-mcp --workspace-root . --config ./openapi.config.ts
```

`--allow-write` 还会注册现有 Prepare/Apply Tools，但不会绕过 Host approval：

```sh
pnpm exec -- openapi-to-mcp --workspace-root . --config ./openapi.config.ts --allow-write
```

按 Host 选择配置入口：

- [Codex](./codex-mcp.md)
- [Claude Code](./ai-hosts/claude-code.md)
- [Cursor](./ai-hosts/cursor.md)
- [Generic stdio Host](./ai-hosts/generic-stdio.md)

所有 Host 共用 [security boundary](./mcp-security.md) 和 [Troubleshooting](./troubleshooting.md)。

Phase 2 的 [`openapi-to-setup` consumer Skill](./setup-skill.md) 可以诊断并配置 aggregate-package project 和 Codex MCP。它默认 read-only，使用现有 `openapi init`，不升级已有版本；package、init、ignore 或 Host 写入都需要 exact Setup Plan approval。当前 automatic package mutation 仅支持 pnpm；npm、Yarn 和 Bun 仍是 diagnostic/manual 边界。Codex config write 会返回 `RESTART_REQUIRED`，直到重启并完成实际 Tool/inputSchema verification。Phase 2.1 的 state-hash binding 和 Phase 2.2 的 Windows portable verified reads 是 Setup hardening，不是额外 Skills。尽管有 phase numbering，consumer 仍应先运行 Setup，再运行 Generate。

Setup 完成后，兼容的 AI Host 可以使用 Phase 1 [`openapi-to-generate` consumer Skill](./skills.md) 发现 `Operation`、预览 operation-scoped output、保持 Prepare/Apply approval boundary 并集成生成代码。Skill 负责 orchestrate MCP，不替代 Server，也不执行初始 package、generation-config 或 Host setup。它会检查 consuming project 的实际 Tool list 和每个相关 Tool 的 inputSchema，因为不同 local version 中相同 Tool name 可能暴露不同的 argument capabilities。Selective Dry Run 要求一个 exact `Target`；不支持 selection 时不会回退到 full-target generation，只有当前 Schema 明确支持时才使用 `replace`。

`Target.input.remote` 是 trusted access configuration；MCP startup remote options 是 operator-owned upper bounds。Effective policy 只使用两层都允许的权限。Configured headers 仅在 initial request 和 same-Origin redirect 中保留，cross-Origin redirect 会删除 headers；Tool arguments 不能添加 headers。HTTPS-to-HTTP redirect 会被阻止。

## Repository development

维护者可以先安装并构建 source checkout，再启动 source bin。这是 development/debugging workflow，不是推荐的用户安装方式：

```sh
pnpm install
pnpm build
node packages/mcp/bin/openapi-to-mcp.js --workspace-root .
```

Repository-only health 和 Inspector launchers 不会发布到 npm package：

```sh
pnpm mcp:check
pnpm --silent mcp:check -- --json
pnpm mcp:inspect
pnpm mcp:inspect -- --allow-write
```

`mcp:inspect` 是 foreground、authenticated localhost 的人工审查入口，不是 CI gate，也不替代 automated stdio、controlled-write、recovery 或 performance tests。
