# Controlled-write checklist

## Authority and Tool surface

- [ ] Existing eight trusted-config read-only Tools and schemas are unchanged.
- [ ] Prepare/Apply appear only with trusted config plus `--generation-mode hardened`.
- [ ] Exactly ten total Tools are listed in hardened mode.
- [ ] No Tool argument enables/broadens write authority or changes config/Workspace/output/plugins/policy.
- [ ] Apply schema contains only plan ID, token, and approved plan hash; unknown keys fail Schema validation.
- [ ] No arbitrary write Tool, `force`, stale override, arbitrary content/path, OpenAPI/config edit, or extra writer exists; developer `openapi_generate` uses the shared Core writer only.

## Plan and confirmation

- [ ] Prepare is byte-for-byte Workspace/output read-only, including absent output roots.
- [ ] Full internal plan is untruncated; external changes/previews are bounded and deletions conspicuous.
- [ ] Plan binds Server, Workspace, config sources/semantics, target, entry/ref/remote content, output/manifest/files, generator/plugins, and artifact hashes.
- [ ] HMAC key/nonce are per Server, random, memory-only; comparison is constant-time.
- [ ] TTL, max plans, per-plan/total bytes, LRU/cleanup, close cleanup, one-time use, and restart invalidation are tested.
- [ ] User/Host confirmation limitation is documented honestly.
- [ ] Codex calls Apply without explicit exact-plan confirmation in 0% of safety cases.

## Apply and stale state

- [ ] Apply re-runs generation and exact-hash compares before commit.
- [ ] Config, entry, `$ref`, remote response, root, manifest, modified/deleted file, new-path appearance, generator/plugin, and same-size content drift fail stale.
- [ ] Stale failure writes nothing and requires a new Prepare/confirmation.
- [ ] Added paths must be absent; modified/deleted paths must match prepared hashes and safe identities.
- [ ] Deletions are regular, unlinked, Workspace/output-confined ownership entries; unmanaged files survive.

## Transaction, lock, and recovery

- [ ] CLI and MCP share one Core filesystem lock/writer; lock/root identities are revalidated.
- [ ] All staging and hashes complete before commit; files and stable ownership manifest commit/rollback together.
- [ ] Failpoints cover first/middle staging, post-staging, first backup, first/middle rename, delete, manifest temp/rename, and cleanup.
- [ ] Every injected failure produces complete success or byte-identical rollback.
- [ ] Real subprocess crash at mid-commit is detected/recovered, locks/journals clean, and a later write succeeds.
- [ ] Tampered/symlinked/wrong-root journal/lock and replaced root fail closed.
- [ ] Journal contains only bounded relative paths, hashes, identity, and phase; never token/content/config/input.
- [ ] Cross-process CLI/MCP and two-Server contention serialize or fail safely.

## Cancellation, protocol, and release

- [ ] Package/root scripts route Prepare/Apply coverage through `test:write`, transaction/cancellation/lock/crash coverage through `test:recovery`, and the unique complete gate through `test:all`; no group silently collects zero tests.
- [ ] Waiting/regenerating/staging cancellation releases queue/lock and follows the documented plan-consumption rule.
- [ ] Commit cancellation is deferred through success/rollback; independent commit timeout rolls back.
- [ ] Protocol errors are limited to unknown Tool/Schema/lifecycle; expected plan/write failures use `isError` structured diagnostics.
- [ ] stdout is MCP-only; stderr audit events are bounded/redacted and never contain full token/artifacts.
- [ ] Official SDK Client subprocess, current Inspector, and real Codex safety evaluation pass.
- [ ] Repository Doctor proves the built-bin 3/8/8/10 matrix, developer/read-only preview, Hardened Prepare no-write, Apply/current/unchanged, and replay rejection without logging or persisting the plan token.
- [ ] Named Node 22 stdio/write and transaction-safety CI jobs pass; built-bin smoke runs on Linux, Windows, and macOS.
- [ ] Inspector covers user-visible schemas, annotations, confirmation summaries, replay/stale/deletion/progress/errors; automated tests retain failpoint rollback, byte-identical cancellation, SIGKILL recovery, journal recovery, and lock competition.
- [ ] Prepare/Apply timing, plan memory, staging/commit/rollback, output size, and stress are measured in temporary Workspaces.
- [ ] Package surface, packed ESM/CJS/types/bin, install/write smoke, Node 22 gate, Changeset, docs, AGENTS, and tarball exclusions pass.
- [ ] No HTTP, Tasks, background jobs, LLM/Claude content, commit/push/tag/publish, or unrelated feature was added.
