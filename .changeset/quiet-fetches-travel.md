---
"@openapi-to/plugin-ts-request": patch
"@openapi-to/plugin-react-query": patch
"@openapi-to/plugin-vue-query": patch
"@openapi-to/plugin-swr": patch
"@openapi-to/core": patch
---

为 Request plugin 增加第一方 Fetch transport，并让 React Query、Vue Query 与 SWR hooks 读取 Request-owned Fetch config/error metadata。
