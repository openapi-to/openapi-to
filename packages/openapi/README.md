# openapi-to

`openapi-to` is the aggregate package for the OpenAPI compiler, CLI, official TypeScript generator plugins, and local stdio MCP server.

```sh
pnpm add -D openapi-to
pnpm exec openapi skills install --host codex --dry-run
pnpm exec openapi skills install --host codex
pnpm exec openapi --help
pnpm exec -- openapi-to-mcp --help
```

The package installs `openapi` and `openapi-to` as aliases of the same CLI entrypoint and installs the separate `openapi-to-mcp` stdio command. It exports Core plus:

- `pluginTSType`
- `pluginTSRequest`
- `pluginZod`
- `pluginSWR`
- `pluginVueQuery`
- `pluginMSW`

Faker, NestJS, and React Query generators are not included.

The explicit `skills install` command copies the two version-matched consumer
Skills from the installed npm package to `$CODEX_HOME/skills` (default
`~/.codex/skills`) without network access or overwrite. Restart Codex after
installation. Package installation and `openapi init` do not install Skills,
and the installer does not configure MCP.

The aggregate depends on `@openapi-to/mcp` at runtime only to provide the shared command. MCP server APIs remain available from `@openapi-to/mcp` and `@openapi-to/mcp/cli`; they are intentionally not re-exported from the `openapi-to` top-level JavaScript API.

See the repository [getting-started guide](../../docs/getting-started.md) and [capability matrix](../../docs/capability-matrix.md).
