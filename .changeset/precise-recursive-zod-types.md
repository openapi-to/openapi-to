---
"@openapi-to/plugin-zod": patch
---

Preserve precise `z.infer` output types for supported direct, array, map, and
mutually recursive Zod component schemas while retaining cycle-safe runtime
validation through `z.lazy()`.
