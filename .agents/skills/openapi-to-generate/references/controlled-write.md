# Controlled Prepare and Apply

Use this reference only when the actual MCP Tool list contains both
`openapi_prepare_generation` and `openapi_apply_generation`, and inspect their
current inputSchema before choosing arguments. A matching Tool name does not
prove that a newer inputSchema capability exists. Hardened startup grants an
operator capability; it is not user approval. The legacy `--allow-write` flag
is rejected.

## Prepare

Call Prepare for exactly one trusted Target. For selective generation, provide
one explicit `selection` mutation with exact operationKeys. Do not supply or
infer source paths, config paths, plugins, output paths, file content, cleanup
policy, or remote permissions.

Use `replace` only when its whole-set meaning matches explicit user intent and
the current Prepare inputSchema explicitly supports
`selection.type = replace`. If the Schema supports only `add`, additive intent
may proceed, but a replace request must stop. If `selection` is absent, do not
invent selective Prepare. When inputSchema is not observable, fail closed for
`replace` unless that capability is verified by the resolved local version's
documentation or a current Tool call.

Tool input: `openapi_prepare_generation` — whole-set selective Prepare

```json
{
  "targets": ["<exact-target>"],
  "selection": {
    "type": "replace",
    "operationKeys": ["<exact-operation-key>"]
  }
}
```

Prepare must remain read-only. Present this review record before asking for
approval:

```text
Target:
Mutation: add | replace
Requested operationKeys:
Previous / new / already-selected counts and bounded keys:
Retained / removed / desired counts and bounded keys:
Projection counts and hash:
Added / modified / deleted counts and important paths:
Truncation or limiting diagnostics:
Apply supported:
Exact planHash:
Expiry or freshness information:
```

When arrays are truncated, show the exact total and returned count. Do not
claim unseen paths or keys were inspected. Highlight every managed deletion,
especially after `replace`.

If Prepare does not return `success`, `plan.applySupported = true`, an exact
plan ID, a one-time token, an exact plan hash, an unexpired plan, or a complete
enough result for informed approval, stop before approval and Apply. A Prepare
plan and one-time token are not filesystem changes and are not user approval.

## Exact approval

Require an explicit statement tied to the one current plan, such as:

```text
Approve plan <exact-plan-hash> for Apply.
```

Do not accept “generate”, “continue”, “update”, “execute the preview”, “looks
good”, or “same as before”. When multiple hashes exist, require the user to
name one. Never select a hash on the user's behalf.

Do not chain Prepare and Apply automatically. Host configuration must continue
to prompt for `openapi_apply_generation`; never advise blanket auto-approval.

## Apply

After exact approval, call Apply with only the plan ID, one-time token, and
approved plan hash returned by that Prepare. The Server re-generates and
revalidates the frozen plan. It must reject expired, replayed, tampered, or
stale state rather than adopting new content.

Tool input: `openapi_apply_generation` — approved current plan

```json
{
  "planId": "123e4567-e89b-42d3-a456-426614174000",
  "token": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "approvedPlanHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}
```

Apply cannot accept operation keys or dynamically override a Target, config,
source, plugin, output path, content, or cleanup policy. Do not invent a force
flag or stale override.

## Failure-closed responses

- **Plan expired:** Prepare again, show the new summary and hash, and request
  new exact approval.
- **Plan stale or input/config/`$ref` drift:** Prepare again only after
  explaining the changed binding; never reuse the previous approval.
- **Selection or ownership drift:** stop, re-read bounded state through a new
  Prepare, and require approval for the new hash.
- **Token consumed or replayed:** do not retry the old plan. Inspect actual
  output state read-only, then Prepare again if more work is required.
- **Apply transaction fails before commit:** report the bounded diagnostic and
  verify that no planned write was claimed successful.
- **Rollback completes:** report the failed Apply and rolled-back state; do not
  claim generation succeeded.
- **Rollback or recovery is required:** stop all writes and escalate to the
  consuming project's operator. Do not edit journals, locks, ownership, or
  generated files manually.
- **Managed deletions exist:** require them in the displayed approved plan and
  verify only generator-owned paths changed after Apply.

## Post-Apply integration

Compare the actual worktree with the approved added/modified/deleted plan.
Separate generator-owned files from handwritten integration and pre-existing
changes. If they do not match, stop before further business edits and report
the discrepancy.

Do not hand-edit generated output to make tests pass. Integrate through the
consumer's established import and API layers, then run its smallest sufficient
targeted tests, typecheck, lint, or build. Report exact commands and outcomes.
