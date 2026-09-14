---
name: fix-github-actions
description: Investigate and fix failing openapi-to GitHub Actions checks, workflow runs, Job logs, and CI regressions through evidence collection, minimal local reproduction, failure classification, scoped repair, and CI-equivalent validation. Use for an existing failed check or suspected workflow regression; do not use to design large new workflow architectures, perform releases, rerun remote jobs without authorization, or hide failures.
---

# 修复 openapi-to GitHub Actions

Read the root `AGENTS.md`, `.github/AGENTS.md`, the failing workflow, its local
or reusable Actions, and the package manifests that define its commands. Current
logs and code are authoritative.

## 建立 failed run 事实

Record before editing:

- repository, branch, commit SHA, pull request if any, workflow name/file, run
  ID, run attempt, event, and failed Job/matrix cell;
- whether the run tested the same commit currently checked out;
- initial `git status --short` and all pre-existing local changes;
- required permissions, secrets, caches, artifacts, and runner platform visible
  to the Job.

When a GitHub connector is available, prefer it for structured repository,
pull-request, check, and Job metadata. Use `gh` when detailed Actions logs,
artifacts, attempts, or check annotations are needed. Do not claim that a
generic repository connector supplied complete Actions logs unless it actually
did.

Do not rerun or cancel a workflow, push, commit, merge, or change remote
settings unless the user explicitly authorizes that action.

## 修改代码前调查

1. Read the complete failing Job log and relevant uploaded artifacts. For a
   matrix failure, compare the same Job across platforms/versions.
2. Identify the first meaningful error, including its step and preceding
   context. The final nonzero exit line is not normally the root cause.
3. Separate primary failure from cleanup/upload failures and downstream
   cancellations.
4. Classify the evidence as one of:
   - source regression;
   - test regression or invalid expectation;
   - workflow/configuration defect;
   - missing build/setup prerequisite;
   - platform-specific path, shell, filesystem, or runtime behavior;
   - dependency, registry, runner, or network transient;
   - permissions or secrets failure;
   - timeout or resource exhaustion;
   - cache contamination;
   - pre-existing failure unrelated to the candidate diff.
5. Map the exact failing step to a current root/package script or underlying
   tool invocation. Confirm that command exists in `package.json`; distinguish
   `pnpm <script>` from `pnpm exec <binary>`.
6. Reproduce the smallest stable failure locally when the environment permits.
   Capture the command, platform differences, input/fixture, exit code, and the
   first meaningful error before editing.

If a registry, network, or hosted-runner failure appears transient, do not
change product code merely to make the log disappear. Preserve bounded evidence
and state whether a rerun is appropriate. A successful rerun alone is not code
fix evidence.

## 选择 semantic owner

Trace the failing command to the smallest owner:

- product compiler/plugin/CLI/MCP source;
- a test or fixture;
- root script or repository contract;
- workflow event, permission, matrix, timeout, environment, cache, or artifact
  configuration;
- `.github/setup/action.yml` or another local/reusable Action.

Check all callers before changing a shared Action. Keep cross-platform shells
and fork/secret boundaries intact. Do not repair an owning source defect with a
workflow workaround or patch every consumer independently.

## 实现最小修复

- Change only the owner and the focused tests/evidence it requires.
- Keep failed assertions and gate status meaningful.
- Preserve least-privilege permissions, required checks, failure exit codes,
  diagnostic artifacts, and deterministic inputs.
- Increase a timeout only after measuring valid runtime and checking whether a
  hang, missing prerequisite, or resource regression is the real issue.
- Scope `HUSKY=0` only to an automation commit step that genuinely needs it;
  never weaken developer commits.
- Do not add `continue-on-error`, delete tests, skip assertions, catch an error
  and return zero, remove triggers, downgrade required Jobs, or accept new lint
  warnings.
- Do not modify unrelated dependencies or lockfiles.

## 分层验证

1. Run the focused reproducer and require the original failure to be resolved
   for the expected reason.
2. Run the affected package test/typecheck/build or script.
3. Run the exact local equivalent of the failed CI step.
4. For a workflow matrix, determine whether the defect is shared or confined
   to one platform/runtime and validate the affected cells as far as the local
   environment allows.
5. Inspect stdout/stderr, exit status, reports, and failure artifacts—not only
   the command's final status.
6. Run `git diff --check` and the repository contract when Agent/workflow/script
   contracts changed.

Do not claim a remote check is fixed until a run on the repaired commit exists.
Before that evidence, report local validation as local validation and state
whether an authorized rerun is still needed.

## Stop conditions（停止条件）

Stop and report instead of guessing when:

- the failed run/commit/attempt or complete failing log cannot be identified;
- the first meaningful error is unavailable and multiple incompatible causes
  remain;
- reproduction requires a secret or production permission not provided;
- the proposed change would hide a failure or broaden remote authority;
- the issue is an external transient with no repository defect;
- the requested action is a release, large workflow redesign, remote rerun, or
  other external mutation outside the user's authorization.

## Final report（最终报告）

Report:

1. Failing run, attempt, commit, Job, and matrix cell.
2. First meaningful error and evidence source.
3. Failure classification and root cause.
4. Minimal local reproduction.
5. Owning files and implemented change.
6. Exact focused and CI-equivalent validation results.
7. Matrix/platform conclusion.
8. Pre-existing failures and checks not run.
9. Whether a remote rerun is still needed and whether it was authorized.

Never state that CI passed based only on a local command or speculative rerun.
