---
"@openapi-to/cli": patch
"openapi-to": patch
---

Add explicit project and user scopes to the packaged Agent Skills installer. Project installs use the current `$CWD/.agents/skills` subtree, user installs use `$HOME/.agents/skills`, and historical `~/.codex/skills` installs are detected without automatic migration.
