# @openapi-to/mcp

`@openapi-to/mcp` is the independently published internal/advanced package for the bounded `openapi-to` stdio MCP adapter. Its eight configured-mode tools are read-only. An operator may additionally enable a two-phase, transaction-backed generation writer; it cannot write without a prior in-memory Prepare plan.

Most users should install `openapi-to`, which includes this runtime and provides the same `openapi-to-mcp` command:

```sh
pnpm add -D openapi-to
pnpm exec -- openapi-to-mcp --workspace-root .
```

Advanced consumers may still install `@openapi-to/mcp` directly when they intentionally want the internal package boundary; its independent bin and JavaScript server API remain supported.

See [getting started](../../docs/getting-started.md) for package versus source execution and Host-specific configuration. All Hosts share the documented [MCP security boundary](../../docs/mcp-security.md) and [troubleshooting guide](../../docs/troubleshooting.md).

Without `--config`, the server exposes `openapi_validate`, `openapi_inspect`, and `openapi_diff`. Supplying a trusted Workspace-local project configuration adds `openapi_list_targets`, `openapi_search_operations`, `openapi_get_operation`, `openapi_generate_dry_run`, and `openapi_check_generation`:

```sh
openapi-to-mcp --workspace-root . --config ./openapi.config.ts
```

The configuration is executable trusted project code selected only by the server operator and cached for the server lifetime. Tool callers cannot replace it, change the Workspace, select plugins, or relax remote-network policy. Every local OpenAPI input and transitive local `$ref` is confined to the real Workspace. Dry-run/check execute plugins but never write generated files, ownership manifests, snapshots, plans, or caches.

The catalog Tools compile each trusted target once per Server process, build a lightweight operation index, then search and read one bounded contract by stable `operationKey`. Search returns at most eight candidates by default. Contract Schema summaries default to depth 2, 20 Schemas, 50 properties per Schema, no examples, and a 128 KiB Core budget beneath the MCP total-result budget. Restart the Server to observe trusted config or OpenAPI changes. See [Operation Catalog architecture](../../docs/architecture/operation-catalog.md).

Target listing follows trusted configuration order. Each Target binds one input, one independent output/ownership root, and its own catalog/selection/plan identity; identical `operationId` or Schema names in different services remain isolated. Outputs may use the default managed `.openapi-to/<dir>` base or an explicit generator-managed Workspace base. The shared Core preflight rejects unsafe or overlapping roots before generation, while selection state remains in `.openapi-to/selections`.

`openapi_generate_dry_run` also accepts `scope: { type: 'operations', operationKeys: [...] }` for exactly one trusted target. Core projects the cached compilation to the exact selected operations and their transitive named component closure, then runs the existing plugins. The response contains bounded selection, projection, and artifact summaries—not the projected OpenAPI document. Omit `scope` (or use `{ type: 'full' }`) for the unchanged full-target preview. Selective preview remains ephemeral. See [projected compilation architecture](../../docs/architecture/projected-compilation.md).

## Controlled generation writes

Writing is absent unless the operator supplies both trusted config and `--allow-write`:

```sh
openapi-to-mcp \
  --workspace-root . \
  --config ./openapi.config.ts \
  --allow-write
```

This registers `openapi_prepare_generation` and `openapi_apply_generation`, for ten tools total. Prepare executes generation and stores a short-lived complete plan binding config, sources and local `$ref` files, remote response hashes, Workspace/output identity, ownership manifest, planned files, artifact hashes, generator version, and one target. It does not create an output directory or write a file. Apply accepts only `planId`, `token`, and `approvedPlanHash`; it re-generates, revalidates every bound precondition, rejects drift, then commits through the shared Core lock/journal/rollback writer.

Prepare also accepts a persistent selection mutation. `selection: { type: 'add', operationKeys: [...] }` computes `desired = previous ∪ requested`; `selection: { type: 'replace', operationKeys: [...] }` computes `desired = requested` and may therefore report managed deletions. Add preserves its 500-key request batch limit; replace accepts the complete persisted-selection capacity of 5,000 keys so any legal desired selection can be expressed in one request. Every key is limited to 500 UTF-8 bytes and the serialized desired manifest remains limited to 1 MiB. Replace requires at least one exact key: an empty replace is not `clear`. Prepare reads the internally derived `.openapi-to/selections/<owner>.json`, fails closed on ambiguous bootstrap/history drift, and generates the complete desired projection. Mutation type, previous/requested/added/already-selected/retained/removed/desired keys, selection hashes and exact desired bytes, projection, artifacts, ownership bytes, target, and output identity enter the plan/token binding. A successful selective Prepare returns `applySupported: true` and a one-time token while writing no selection, generated file, ownership, lock, journal, or other disk state.

After explicit review and approval, Apply compiles the trusted target afresh, regenerates exactly the frozen complete desired key set, revalidates selection twice (including once under the output lock), compares projection/artifact/ownership/desired-selection identities, and calls Core's three-state transaction for generated artifacts, ownership, and selection. Replace internally enables ownership-constrained managed cleanup so it safely deletes unchanged managed artifacts absent from the desired set even when the trusted target normally preserves old generated files; unmanaged files survive. This policy is derived by the Server and cannot be supplied by the caller. Remove, clear, prune, historical full-output migration, and operation-rename migration remain unsupported. Full Prepare/Apply is unchanged, and callers cannot provide output paths or cleanup policies. See [persistent operation selection](../../docs/architecture/persistent-operation-selection.md) and [generation state transaction](../../docs/architecture/generation-state-transaction.md).

The default plan lifetime is five minutes, with at most 20 in-memory plans. Tokens use a per-process HMAC key, bind full versus selective kind plus trusted target/output/selection owner, are one-time, and become invalid on Server restart. Verification failures before lock/token consumption require a fresh Prepare only when the returned diagnostic says the plan is stale; cancellation while waiting for the lock leaves the token retryable. Once consumed, regeneration mismatch, transaction failure, rollback, or success makes replay fail. This release intentionally limits one plan to exactly one configured target/output root. There is no `force`, stale-plan override, dynamic config, caller-supplied path/content, or direct write tool.

The Server proves that Apply addresses the exact plan returned by Prepare. It cannot independently prove that a human performed confirmation; final approval depends on the MCP Host. Operators should require Host approval for `openapi_apply_generation`, especially when Prepare reports managed deletions.

Remote access is private-network-denied by default. Use repeatable `--allow-host` options to narrow allowed hosts. `--allow-private-network` is operator-only and lowers the security boundary. Target `input.remote` remains the trusted access requirement and is intersected with this operator policy: both layers must allow private access, host policies must overlap, and numeric limits use the smaller value. Target-configured headers are kept only for the initial request and same-Origin redirects; cross-Origin redirects clear all of them and HTTPS-to-HTTP redirects are blocked. Tool arguments cannot provide headers or relax the result.

The package intentionally does not provide HTTP transport, authentication, resources, prompts, sampling, elicitation, Tasks, Apps UI, LLM calls, background jobs, arbitrary writes, OpenAPI/config modification, or business API execution.

## Production controls

Every request has both Host-side and Server-side limits. The Server defaults are 30 seconds for validate/inspect, 45 seconds for diff, and 60 seconds for generation tools; an operator may set `--validate-timeout-ms`, `--inspect-timeout-ms`, `--diff-timeout-ms`, and `--generation-timeout-ms` from 100 through 600000 milliseconds. Tool arguments cannot extend them. These are separate from remote HTTP connection/response limits, the transaction commit deadline, and Codex `tool_timeout_sec`.

Controlled-write startup limits are `--plan-ttl-ms`, `--max-plans`, `--max-plan-bytes`, `--max-total-plan-bytes`, `--max-write-files`, `--max-write-bytes`, `--write-lock-wait-ms`, and `--commit-timeout-ms`. Plan metadata defaults to 16 MiB per plan and 64 MiB total, which keeps aggregate memory bounded while accommodating the complete derived sets and frozen bytes of a legal selection. Tool arguments cannot relax these startup-owned limits. Apply may be cancelled while waiting, regenerating, or staging. After commit starts, cancellation is deferred until the transaction finishes or rolls back; the independent commit deadline remains active.

MCP cancellation is propagated to remote fetch, reference loading, compiler checkpoints, plugin hooks through `ctx.signal`, artifact materialization/formatting/comparison, and the per-server generation queue. A cancelled or timed-out generation never calls the writer; queued cancellation does not strand the lock. Stable clients may request coarse progress for diff/dry-run/check. Progress is advisory, monotonic, content-free, and stops on cancellation.

Operational logs remain on stderr. `--log-format text|json` selects text or newline-delimited JSON and `--log-level debug|info|warn|error|silent` controls verbosity. Logs contain bounded counts and duration, never Tool arguments, documents, generated content, credentials, query strings, headers, environment variables, or config source.

## Repository verification

When developing this monorepo, run the maintained MCP entry points from the
repository root:

```sh
pnpm test:mcp:all
pnpm mcp:check
pnpm --silent mcp:check -- --json
pnpm mcp:inspect
pnpm mcp:inspect -- --allow-write
```

The package manifest owns the unit, integration, stdio, controlled-write,
recovery, E2E, and performance layers; root scripts only route to them. Doctor
uses a synthetic OS-temporary Workspace and the official SDK against the built
bin. Inspector is a repository-only authenticated localhost launcher, defaults
to read-only, and requires the operator to opt into its synthetic write fixture.
Use pnpm's `--silent` flag when consuming Doctor JSON from stdout so the package
manager does not add a lifecycle banner. `--json --output <path>` writes the same
sanitized report directly to a file for CI. Neither repository helper is
included in the published tarball.

See [controlled-write architecture](../../docs/architecture/mcp-controlled-write.md), [operations](../../docs/mcp-operations.md), [test strategy](../../docs/testing/mcp-testing.md), [Inspector guide](../../docs/testing/mcp-inspector.md), [recovery](../../docs/mcp-write-recovery.md), [threat model](../../docs/mcp-threat-model.md), and [limitations](../../docs/mcp-limitations.md).
