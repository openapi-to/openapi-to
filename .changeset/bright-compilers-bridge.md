---
"@openapi-to/core": patch
"@openapi-to/plugin-msw": patch
"@openapi-to/plugin-swr": patch
"@openapi-to/plugin-ts-request": patch
"@openapi-to/plugin-ts-type": patch
"@openapi-to/plugin-vue-query": patch
"@openapi-to/plugin-zod": patch
---

Refresh the compiler toolchain compatibility baseline to TypeScript 6,
ts-morph 28, and code-block-writer 13 while preserving the TypeScript 5.6
consumer contract. Public plugin declarations retain type-fest 4 until a
newer line is verified against legacy consumers.
