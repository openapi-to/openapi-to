---
"@openapi-to/plugin-zod": patch
---

将 required 缺少安全 object context 的 Zod diagnostic 提升为 error，与既有 `z.never()` fail-closed 行为保持一致。
