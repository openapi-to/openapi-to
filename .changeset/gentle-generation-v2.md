---
"@openapi-to/mcp": major
---

切换 MCP Generation v2 public Tool surface：移除 `--allow-write` 与 `openapi_generate_dry_run`，统一为 `openapi_generate`，并引入 developer、read-only、hardened capability mode、Core 绑定的 selection/output intent 与共享事务写入路径。
