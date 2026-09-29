---
"@openapi-to/plugin-zod": patch
---

对未实现的标准 JSON Schema validation keywords 产生 error diagnostic，并将受影响的 Zod schema entrypoint fail closed，避免静默生成过宽 validator。
