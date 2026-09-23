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
ts-morph 28, and code-block-writer 13 while setting the minimum generated-
consumer TypeScript version to 5.9. Validate the same generated consumer with
TypeScript 5.9.3, 6.0.3, and 7.0.2 using strict mode and full declaration
checking.
