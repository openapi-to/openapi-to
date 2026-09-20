# Safe setup writes

Every package install, initializer run, `.gitignore` change, and Codex config
change is a write. Diagnosis never implies authorization for one.

## Setup Plan schema

A plan is bounded JSON with at least:

```json
{
  "schemaVersion": 1,
  "mode": "developer",
  "observedStateHash": "<lowercase-sha256>",
  "packageManager": "pnpm",
  "actions": [],
  "verification": [],
  "restartRequired": true
}
```

Represent commands as program plus argv, not shell source:

```json
{
  "kind": "run-command",
  "command": "pnpm",
  "args": ["exec", "openapi", "init"],
  "network": false,
  "expectedWrites": ["openapi.config.ts", ".gitignore"]
}
```

Supported action kinds are `run-command`, `create-file`, `append-file`,
`update-gitignore`, and `manual-review`. Direct file actions name a relative
project target and carry or accompany the exact proposed diff. A plan must not
contain absolute/escaping target paths or sensitive fields named `token`,
`authorization`, `cookie`, `secret`, `password`, `headers`, or `env`.

Hash the complete plan with:

```sh
node scripts/hash-setup-plan.mjs < setup-plan.json
node scripts/hash-setup-plan.mjs --file setup-plan.json
```

The script validates the base Schema, recursively sorts object keys, preserves
array order, emits canonical JSON, and returns SHA-256 `setupPlanId`. Its
256-KiB input bound and maximum array sizes prevent an unbounded approval
record. It never executes a command, accesses the network, reads environment
variables, or writes a file.

## Exact approval and drift

Display the full plan, exact direct-edit diff, command argv, network flag,
package/version decision, expected package-manager/init writes, verification,
and `setupPlanId`. Accept only explicit approval naming that exact ID, such as:

```text
批准执行 Setup Plan <exact-setupPlanId>
```

“Continue”, “install”, “configure it”, “looks good”, and “use defaults” are not
approval. Before applying, re-run the inspector and require the same
`observedStateHash`. It binds raw-byte SHA-256 values for the manifest, every
lockfile, generation config, ignore file, and Codex file, plus the relevant
diagnostics and existence states. Re-read Git status separately because the
hash does not cover the whole worktree. Drift in any bound file or overlapping
worktree invalidates the plan. Re-plan, re-hash to a new `setupPlanId`,
re-display, and obtain new exact approval.

Missing `package.json` is `PACKAGE_JSON_MISSING` and blocks planning; never
create a Node project implicitly. `PACKAGE_MISSING` is reserved for a trusted
project with a valid manifest and no aggregate package declaration. Multiple
actual lockfiles conflict even when they map to one manager. Lockfiles are
streamed with a 32 MiB limit, and oversized, unreadable, symlinked, replaced, or
out-of-root files fail closed without returning their contents.

Inspector reads use `O_RDONLY | O_NOFOLLOW` where available. A platform without
`O_NOFOLLOW` uses a verified `O_RDONLY` fallback that retains `lstat`, real-root,
regular-file, opened-identity, and pre/post-read metadata checks. Contents are
read only through the same `FileHandle`; the fallback does not authorize
following symlinks or proceeding after identity uncertainty. These checks are
not an operating-system-level atomic snapshot, so every approved Setup Plan
still requires the fresh inspector hash and separate Git-state check above.

## Package install

Only pnpm is automatically supported in this phase. Use the exact package and
version shown in the plan:

```sh
pnpm add -D --save-exact openapi-to@<exact-version>
```

The plan marks `network: true` and expects `package.json` plus
`pnpm-lock.yaml`. Never use global install, a floating tag, a prerelease without
explicit selection, `@openapi-to/mcp` as an aggregate substitute, or an
implicit upgrade. Review the actual diff because package-manager changes are
not automatically attributable to the Skill.

## Initializer and ignore rule

Use only `pnpm exec openapi init`. It has no supported non-interactive override
or force option. It creates `.ts` for an ESM package or `.js` otherwise, refuses
all existing `.ts`/`.js`/`.cjs`/`.mjs` candidates, and then appends
`/.openapi-to/` if absent. It does not create `.openapi-to/`. Do not handwrite a
parallel generation template or use `.OpenAPI/openapi.config.ts`.

If a config already exists, do not run init. If several exist, stop. If the
config exists but the ignore rule alone is missing, an exact approved
`update-gitignore` action may append only the rule with a reasonable newline;
preserve all existing bytes.

## Codex config

Create a missing project file or append one exact absent section only after
approval. Preserve existing bytes and unknown sections; never reorder the
document. Existing `openapi_to` sections, duplicates, unusual TOML, or unsafe
mode policy require manual review. Never implement an incomplete TOML rewriter.

The config must use project-local package-manager resolution, relative paths,
no credentials or remote-policy relaxation, and no legacy `--allow-write` flag.
Ordinary configured mode omits `--generation-mode` and is Developer. Explicit
Read-only or Hardened mode requires the matching generation-mode argument;
Hardened additionally requires the Apply prompt section.

## Post-write review

Inspect the full worktree diff and classify every changed path as pre-existing,
approved direct edit, expected command output, or unexpected. Stop on overlap
or unexpected writes. Validate local commands, one config, ignore state, exact
Codex bytes, no duplicate/absolute/credential content, and Apply prompt when
applicable. Re-run the inspector. Never commit or push the consuming project.

Host configuration changes end at `RESTART_REQUIRED`. Only post-restart Tool
list, inputSchema, and returned capability evidence can finish setup.
