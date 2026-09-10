---
"@openapi-to/core": patch
"@openapi-to/cli": patch
---

Upgrade the Core process-execution and configuration-loading runtime dependencies while preserving the published Node.js 22 compatibility contract. The shared execa catalog update also keeps the CLI runtime dependency surface aligned; cosmiconfig remains on its maintained Node-22-compatible 9.x line because 10.x requires Node 22.18 or newer.
