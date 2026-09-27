---
"@openapi-to/core": patch
"@openapi-to/plugin-ts-type": patch
"@openapi-to/plugin-ts-request": patch
"@openapi-to/plugin-react-query": patch
"@openapi-to/plugin-vue-query": patch
"@openapi-to/plugin-swr": patch
---

将有效 OpenAPI Cookie 参数加入 `RequestInput.cookies`，并让 requiredness 驱动输入类型。`pluginTSRequest` 新增默认关闭的 `cookieTransport: "header"` opt-in；关闭时提供或要求 Cookie 都会在 dispatch 前 fail closed。显式 Header transport 只支持有界、安全的参数子集，浏览器显式设置 Cookie Header 不受支持；此变更不包含 Fetch transport。
