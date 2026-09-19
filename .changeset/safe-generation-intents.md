---
"@openapi-to/core": minor
---

Add deterministic Generation Intent, dynamic output-root validation, and atomic
intent transaction foundations. Generation now fails closed instead of
overwriting unmanaged desired paths or overwriting/deleting managed files that
have changed since their ownership manifest was written.
