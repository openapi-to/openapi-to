---
"@openapi-to/plugin-zod": patch
---

date-time validators now accept RFC3339 positive leap-second insertion positions, including numeric-offset representations, while rejecting arbitrary `:60` values. The bounded position profile does not use an IERS occurrence database.
