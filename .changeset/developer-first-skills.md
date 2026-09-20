---
"@openapi-to/cli": patch
"openapi-to": patch
---

将 Codex 的普通 `openapi setup --host codex --scope project` bootstrap 默认配置为
Developer MCP generation mode；Read-only 与 Hardened 保留为显式选择，并同步更新
Setup/Generate Skills、handoff 校验和 packed consumer smoke 的 capability 证据。
