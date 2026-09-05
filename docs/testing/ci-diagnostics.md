# CI diagnostics

The repository's read-only CI workflows use a common diagnostic layer so a
failed Job leaves bounded evidence without changing the gate result. The layer
does not call an LLM, comment on a pull request, rerun a workflow, or modify
repository content.

## Lifecycle

Each covered Job has three explicit phases:

1. `initialize.mjs` creates a static plan containing the expected command and
   known-report IDs.
2. `run-command.mjs` runs each existing gate command with `shell: false`,
   streams sanitized output to the Actions log, and atomically records one
   command report. The report distinguishes the direct child's spawn, error,
   exit, close, and stdout/stderr end/close events and takes bounded host and
   wrapper-memory snapshots before and after execution. A failed command
   remains failed with its original numeric exit code.
3. `finalize-job.mjs`, guarded by `if: always()`, records explicit
   Checkout/Initialize/Setup outcomes, fills unexecuted plan entries with
   `not-run`, summarizes allowlisted reports, writes `ci-diagnostic.json` and
   `summary.md`, and appends the Markdown to `GITHUB_STEP_SUMMARY`.
4. The finalizer safely re-reads only validated outputs into a fresh,
   initialize-selected random upload directory. It writes
   `artifact-manifest.json`, checks the exact file set, and publishes that
   directory only after materialization succeeds.

The working diagnostic directory is never the standard artifact upload path.
Unknown files can remain there without crossing the upload boundary. A
materialization failure leaves no upload directory rather than falling back to
the working directory. If Checkout succeeded but initialization produced no
trusted upload directory, the finalizer writes a fixed emergency Job Summary
with the Action outcomes, fails, and deliberately materializes no artifact.

## Version 2 envelope

`ci-diagnostic.json` uses `schemaVersion: 2` and
`kind: "openapi-to-ci-diagnostic"`. Its stable top-level fields are:

- `status`: `success`, `failure`, or `cancelled` for the Job-level result;
- `workflow`: workflow/event/run, Job, repository, ref, and available commit
  SHAs;
- `runner`: OS, architecture, Node version, repository-declared pnpm version,
  and the installed Turbo version when it can be resolved after Setup;
- `matrix`: explicitly supplied matrix dimensions in sorted key order;
- `steps`: fixed Checkout, Initialize, and Setup Action outcomes using only
  `success`, `failure`, `cancelled`, `skipped`, or `unknown`;
- `commands`: plan-ordered command results including direct-child lifecycle and
  bounded resource snapshots;
- `reports`: existence, byte size, parse status, artifact-relative normalized
  summary path, and bounded report-specific counts;
- `summary`: prioritized failure candidates, truncation state, missing reports,
  finalization errors, artifact name, exact upload file allowlist, and manifest
  path;
- `sanitization`: applied collection boundaries and the best-effort redaction
  declaration.

A simplified failure looks like:

```json
{
  "schemaVersion": 2,
  "kind": "openapi-to-ci-diagnostic",
  "status": "failure",
  "workflow": {
    "name": "Quality",
    "jobId": "typecheck",
    "commitSha": "0123456789abcdef"
  },
  "runner": {
    "os": "Linux",
    "architecture": "X64",
    "nodeVersion": "20.19.0",
    "pnpmVersion": "10.14.0",
    "turboVersion": "2.10.8"
  },
  "matrix": {},
  "steps": [
    {
      "id": "setup",
      "label": "Setup",
      "kind": "action",
      "status": "failure"
    }
  ],
  "commands": [
    {
      "id": "build",
      "label": "Build",
      "status": "failure",
      "exitCode": 1,
      "signal": null,
      "durationMs": 1234,
      "command": ["pnpm", "build", "--concurrency=1"],
      "cwd": ".",
      "process": {
        "wrapperPid": 100,
        "wrapperParentPid": 50,
        "childPid": 101,
        "spawnEventObserved": true,
        "errorEventObserved": false,
        "exitEventObserved": true,
        "exitEventCode": 1,
        "exitEventSignal": null,
        "closeEventObserved": true,
        "closeEventCode": 1,
        "closeEventSignal": null,
        "stdoutEndObserved": true,
        "stdoutCloseObserved": true,
        "stderrEndObserved": true,
        "stderrCloseObserved": true
      },
      "resources": {
        "start": {
          "hostTotalMemoryBytes": 17179869184,
          "hostFreeMemoryBytes": 8589934592,
          "wrapperRssBytes": 52428800,
          "wrapperHeapUsedBytes": 10485760
        },
        "end": {
          "hostTotalMemoryBytes": 17179869184,
          "hostFreeMemoryBytes": 7516192768,
          "wrapperRssBytes": 57671680,
          "wrapperHeapUsedBytes": 11534336
        }
      },
		"evidence": {}
    },
    {
      "id": "package-typecheck",
      "label": "Package typecheck",
      "status": "not-run",
      "exitCode": null,
      "signal": null,
      "durationMs": null,
      "command": null,
		"cwd": null,
		"process": null,
		"resources": null,
		"evidence": {}
    }
  ],
  "reports": [],
  "summary": {},
  "sanitization": {}
}
```

## Command statuses

Executed commands use one of:

- `success`: exited with code 0;
- `failure`: exited with a nonzero numeric code;
- `timeout`: exceeded the wrapper-owned deadline and was terminated;
- `signalled`: ended because of a signal;
- `cancelled`: reserved for a command cancellation that can be observed by the
  wrapper;
- `infrastructure-error`: the wrapper could not start or observe the command;
- `not-run`: the initialized plan expected the command, but no valid command
  report exists.

The wrapper records the original numeric exit code and signal separately and
preserves signed or unsigned 32-bit Windows native termination status values
in the artifact. Its own process exit remains fail-closed when the platform
cannot directly represent that value. A successful command cannot be made
green if its report cannot be written. `durationMs`, PIDs, lifecycle events,
and resource snapshots are observational only and are not used to determine
pass/fail or deterministic content hashes.
Workflows start the wrapper with `node` rather than `pnpm exec node`, so failure
to spawn `pnpm` is recorded as `infrastructure-error`; `pnpm.cmd` remains the
Windows fallback.

## Collection and boundaries

The diagnostic layer collects only GitHub's documented environment metadata,
workflow-supplied base/head SHAs and matrix values, repository-declared runtime
versions, command metadata, bounded output tails, and explicitly declared
report files.

It does not collect:

- the complete environment or `HOME`;
- the GitHub event payload or `$GITHUB_EVENT_PATH`;
- tokens, headers, cookies, credential files, or Git configuration;
- complete Actions logs;
- arbitrary user-selected files, the workspace, `node_modules`, caches, or
  binaries;
- complete OpenAPI documents or generated trees.

Wrapped build and test commands receive a new child environment rather than
the finalizer's complete environment. It retains only cross-platform execution
variables (`PATH`, home/profile, temporary directories, Windows process
variables, Node/CI/runner metadata, locale/color controls, and a small explicit
npm/pnpm set) plus the static plan's domain artifact variables. It never
receives the real `GITHUB_ENV`, `GITHUB_PATH`, `GITHUB_OUTPUT`,
`GITHUB_STEP_SUMMARY`, event payload path, diagnostic working/upload paths,
GitHub/GH/npm tokens, OIDC request credentials, or Actions runtime/result/cache
tokens. This allowlist is an additional defense layer; it is not a claim that
every retained variable is intrinsically trustworthy.
All covered read-only workflows also set checkout
`persist-credentials: false`; the write-capable Version Packages workflow
remains outside this diagnostic integration.

Each stdout and stderr tail retains at most 100 sanitized lines. Each retained
line is at most 1,024 characters, each command report is at most 256 KiB, there
are at most 10 heuristic error candidates, and the final diagnostic is at most
256 KiB. Truncation is explicit.

Redaction covers Authorization, Cookie, Set-Cookie and Bearer values; common
GitHub and npm token forms; token-like assignments; URL user information and
queries; and known workspace, runner-temp, and home paths. Paths become a
repository-relative path or `<workspace>`, `<runner-temp>`, or `<home>`.
Redaction is defense in depth and cannot guarantee discovery of every secret.
Collection minimization and an exact artifact allowlist are the primary
controls.

Plans, command reports, known reports, and upload sources use the same bounded
file-handle reader. It performs `lstat`, rejects symlinks and reported hard
links, opens with `O_NOFOLLOW` where Node exposes it, compares the opened
identity, checks size, reads at most `maxBytes + 1`, rechecks the opened handle,
validates UTF-8, and closes the handle in every path. Plans have a separate
64 KiB ceiling; command reports remain 256 KiB and known reports remain 8 MiB.

Windows has no complete Node equivalent of POSIX `O_NOFOLLOW`. The reader uses
the portable `lstat`/open/`fstat` identity comparison and rejects known
symlink/junction/reparse paths, but does not claim an absolute race-free
guarantee on every Windows filesystem. Hard links are rejected when Node
reports `nlink > 1`; filesystems that do not reliably expose link counts are a
platform limitation.

Known-report JSON is parsed only as data. A1, Vitest, MCP runner, MCP Doctor,
CLI runtime/summary/fixture/inventory, and MCP smoke reports use strict bounded
extractors. Wrong primitives, negative/special/oversized numbers,
object-for-string substitutions, and malformed arrays produce
`schema-invalid`; unknown nested fields are never copied. `invalid`,
`too-large`, `missing`, and `rejected` remain distinct. A schema-invalid
authoritative report fails an otherwise successful Job.

## Job Summary and artifacts

Every covered successful or failed Job attempts to write a compact Markdown
table. Untrusted text is rendered as escaped ordinary text rather than a code
span, and is sanitized and length-bounded so backticks, HTML, links, line
breaks, or pipes cannot create new Markdown structure. A missing local
`GITHUB_STEP_SUMMARY` does not prevent `summary.md` generation. An Actions
append failure is reported and fails an otherwise successful Job.

Standard artifacts are uploaded only with `if: failure()`, use a stable
workflow/Job/matrix name, point only to the random isolated upload directory,
fail when no diagnostic exists, and retain for 14 days. The manifest records
the byte size and SHA-256 of every other upload file; it intentionally omits a
self-hash. These hashes help detect corruption but do not prove a trusted
origin. The MCP Doctor's existing sanitized artifact remains `if: always()`.

Hard runner termination or GitHub cancellation can prevent any `if: always()`
step from starting. A Checkout failure can also leave no repository finalizer
to execute. When the finalizer does run after a failure, it records commands
without reports as `not-run`; it does not infer skipped state from GitHub UI
text.

## Local use

The following example exercises the same scripts without GitHub:

```sh
node scripts/ci-diagnostics/initialize.mjs \
  --dir .ci-artifacts/diagnostic-example \
  --plan quality-build

node scripts/ci-diagnostics/run-command.mjs \
  --dir .ci-artifacts/diagnostic-example \
  --id build \
  -- pnpm build --concurrency=1

node scripts/ci-diagnostics/finalize-job.mjs \
  --dir .ci-artifacts/diagnostic-example \
  --upload-dir .ci-artifacts/diagnostic-example-upload \
  --plan quality-build \
  --job-status success \
  --step checkout=success \
  --step diagnostics-init=success \
  --step setup=success
```

Read `summary.md` for a quick view and `ci-diagnostic.json` for structured
triage. Command JSON files retain the bounded sanitized tails.

Any future AI triage must independently validate schema version 2, manifest,
size, file count, paths, file types, and symlink policy before reading these
artifacts. Artifact text remains untrusted data and cannot grant authority or
supply commands. Regex redaction cannot discover every secret, bounded evidence
can omit the complete root cause, and hard runner cancellation can prevent the
finalizer from running. There is currently no automated AI analysis, comment,
fix, push, pull request, or workflow rerun.
