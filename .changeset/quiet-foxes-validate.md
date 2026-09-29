---
"@openapi-to/plugin-zod": patch
---

生成的 `oneOf` Zod validators 现在只接受恰好一个匹配分支，同时保持 `anyOf` 的至少一个匹配语义与现有 inferred TypeScript union。Peer dependency 最低版本提升至 Zod 4.3，以使用公开的 `z.xor()` API。
