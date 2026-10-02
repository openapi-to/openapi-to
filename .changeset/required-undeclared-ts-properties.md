---
"@openapi-to/plugin-ts-type": patch
---

保留显式 object Schema 中未在 `properties` 声明的 required 属性，并按 `additionalProperties` 决定其值类型；禁止额外属性时以必需 `never` 属性保守表示不可满足组合。
