---
"@openapi-to/core": major
"@openapi-to/mcp": major
---

Use Node built-in fetch for remote OpenAPI loading and remove Core's Axios runtime dependency and custom DNS/IP/Agent layer.

Explicit HTTP(S) roots are caller-authorized, including internal networks. Same-origin references and redirects are allowed; derived cross-origin requests require allowedHosts, and configured headers stay within the original root origin. Retain bounded streaming response reads, timeout/cancellation, manual redirect limits, HTTPS downgrade protection and diagnostic redaction.

Remove allowPrivateNetwork and the MCP --allow-private-network option during the 4.0 RC cycle. allowedHosts now grants additional derived cross-origin hostname access rather than restricting explicit roots. Remote loading follows Node native fetch proxy semantics; Core no longer implements private-address or DNS rebinding protection.
