---
name: run-codegen-tests
description: Execute and interpret openapi-to code-generation regressions, including affected-package tests, fixtures, snapshots, generated file-set review, TypeScript validity, import checks, and a byte-stable second generation. Use after changes that can alter generated files or when deciding whether a fixture/snapshot update is correct; do not use as a substitute for implementing or diagnosing the generator change itself.
---

# 运行 codegen regression tests

Read root `AGENTS.md`, the deeper `AGENTS.md` for every affected package, and the affected package manifests before running commands. A zero exit code proves only that the command completed; generated output still requires semantic review.

## 必要输入（Required inputs）

Identify:

- Changed source/config/fixture paths and pre-existing working-tree changes.
- Affected generator packages and downstream plugins.
- Exact fixture and expected output/snapshot surfaces.
- The command that performs the focused generation or integration test.
- The generated root to inspect and a way to typecheck it when TypeScript is emitted.

If there is no reproducible generation command, no bounded output directory, or the command would overwrite unrelated user files, stop and create a safe temporary harness or ask for direction.

## Workflow（流程）

### 1. Protect the baseline

1. Run `git status --short` and save a path-scoped view of existing changes.
2. Do not call an existing user edit a regression. Compare test-created paths and the semantic diff caused by the current command.
3. Determine whether the integration test cleans `packages/<plugin>/test-output/`. Do not assume cleanup comments are implemented.
4. Never enable snapshot update mode until the existing diff is understood.

### 2. Map impact to tests

- Builder/template-only change: target package unit tests plus its integration test.
- Plugin lifecycle/output change: target plugin, declared dependencies, one realistic combination, generated output check.
- Core/OpenAPI change: core tests, every affected plugin test, focused fixtures, root typecheck/build when public types or output behavior change.
- CLI/config change: CLI tests plus the relevant `e2e/common` or `e2e/module` real generation after build.

Confirm every command in `package.json`. Typical focused commands in this revision are:

```sh
pnpm --filter <package-name> test
pnpm --filter <package-name> typecheck
pnpm --filter <package-name> build
```

The root has `test:vitest`, `typecheck`, and `build`; use them only when the impact justifies the repository-wide matrix.

### 3. Run the focused fixture generation

1. Use the smallest fixture reproducing the changed construct; broad Petstore generation is additional smoke coverage.
2. Capture the command, fixture path/hash or diff, output root, exit status, and relevant diagnostics.
3. Prefer the real compiler pipeline. For output written once, run `openapi-to generate --check --json`; for proposed output that must not touch disk, run `openapi-to generate --dry-run --json`.
4. Parse stdout with `JSON.parse` and assert `success`, `command`, `mode`, `diagnostics`, `summary`, and `servers`; each server carries its `manifest` with `entries`, `summary`, and `outdated`. Stderr may contain logs but must not pollute stdout.
5. A normal regression sequence is: real write, inspect `servers[].manifest`, run `--check --json`, and require success with no outdated entries.

Formal `generate --check` is generator-semantic evidence. The helper below is only a filesystem supplement for a harness that bypasses the build pipeline, an external fixture directory, explicit case-collision checks, or a legacy plugin test that cannot invoke the CLI. It cannot replace formal check. With a temporary manifest path:

```sh
node .agents/skills/run-codegen-tests/scripts/verify-generated-output.mjs \
  --root <generated-root> \
  --write-manifest <new-temporary-manifest.json>
```

The helper is read-only except for the explicitly supplied, non-existing manifest. It rejects output roots outside the repository, symlinks, duplicate/case-colliding paths, malformed manifests, empty output, unsafe Manifest locations, and configured resource-limit violations. Empty files fail by default; repeat a narrow `--allow-empty <relative-glob>` only for intentional empty artifacts. Broad all-file patterns are rejected. Default limits are centralized in `DEFAULT_LIMITS` and can be overridden with explicit `--max-*` arguments shown by `--help`.

When changing the helper itself, run its dependency-free syntax/runtime checks and, after workspace dependencies are installed, its JSDoc typecheck:

```sh
node --check .agents/skills/run-codegen-tests/scripts/verify-generated-output.mjs
pnpm exec tsc --allowJs --checkJs --noEmit --module NodeNext --moduleResolution NodeNext --target ES2020 --types node .agents/skills/run-codegen-tests/scripts/verify-generated-output.mjs
node --test .agents/skills/run-codegen-tests/scripts/verify-generated-output.test.mjs
```

The second command invokes the repository's TypeScript binary; it is not a package script.

### 4. Review the output, not only the snapshot

Inspect:

- Every added, removed, renamed, and changed generated file.
- Paths after case folding and normalized separators.
- Empty/truncated files and unexpectedly large output.
- Imports: relative depth, extension policy, public package specifiers, duplicate imports, and references to missing generated files.
- Stable ordering of files, declarations, union members where ordering is contractual, imports, exports, and barrel entries.
- Requested schema behavior across all affected outputs: types, Zod, request, and query/mock consumers as applicable.
- Diagnostic behavior for unsupported/invalid input and empty output.

If a snapshot changes, read its complete semantic diff. Accept it only when each change follows from the task and the source/fixture explains it. Do not update a snapshot solely because Vitest offers an update command.

### 5. Validate emitted code

1. Run the target package `typecheck` and `build`.
2. For generated TypeScript, compile a temporary consumer with the expected module resolution and required peer/runtime type dependencies. Reuse an existing e2e project only when its config matches the output contract.
3. Verify the plugin package's export map if generated imports reference package subpaths.
4. Format only the generated temporary/test output when formatting is part of the generator contract. Do not format unrelated repository files.

### 6. Prove idempotency

1. Without changing config, dependency versions, input, locale, or runtime, run the exact same generation command again.
2. Prefer `openapi-to generate --check --json`; require `success: true`, `mode: "check"`, every server manifest `outdated: false`, and no added/modified/deleted entries.
3. Require JSON stdout to parse without preprocessing and identical check runs to be byte-stable unless a documented field is intentionally nondeterministic.
4. Only for a harness outside the formal build pipeline, compare the second result with the helper manifest:

```sh
node .agents/skills/run-codegen-tests/scripts/verify-generated-output.mjs \
  --root <generated-root> \
  --manifest <first-run-manifest.json>
```

5. Require no added, deleted, content-changed, or renamed file. A test pass with a manifest mismatch is a failure.
6. Remove only temporary artifacts created by this validation and only when their ownership is certain.

## Stop conditions（停止条件）

Stop and investigate before accepting output when:

- The generated root resolves outside the repository or contains symlinks/path traversal.
- Many unrelated files change, output is empty, or file count/size changes unexpectedly.
- The generator changes pre-existing user files outside its declared output.
- A snapshot differs without a source/fixture explanation.
- The second run differs from the first.
- Imports point to missing files or generated TypeScript cannot be checked.
- A remote fixture or external `$ref` makes the result depend on mutable network state.

Do not automatically overwrite fixture or snapshot updates. Preserve the failing evidence until the cause is understood.

## Diagnostics and artifacts（诊断与 artifacts）

The repository has machine-readable diagnostics and typed artifacts. Assert stable diagnostic codes/severity/location/sorting, and inspect the manifest rather than parsing human logs. Never print full documents, artifact contents, tokens, headers, cookies, or URL queries. The ownership manifest governs clean deletion: a generated stale file may be deleted, while an unmanaged user file must survive.

## Validation matrix（验证矩阵）

At minimum, produce evidence for:

| Change | Required evidence |
| --- | --- |
| Fixture only | Parser/generator test that consumes it, snapshot decision, second-run stability |
| Plugin builder/template | Target unit + integration tests, typecheck, generated semantic diff |
| Plugin output paths/imports | Above plus build, file manifest, temporary consumer typecheck |
| Core/OpenAPI | Core tests/typecheck, affected plugin tests, minimal fixtures, root typecheck/build when shared API changes |
| CLI generation | CLI tests/build and a real applicable e2e generation with exit/stdout/stderr evidence |

## Completion standard（完成标准）

Confirm that:

- The impacted package/plugin list is justified.
- The fixture isolates the intended behavior.
- Snapshot/golden changes were reviewed, not blindly updated.
- Added/deleted/renamed files and imports were checked.
- Generated TypeScript was validated where applicable.
- A second identical generation matches the first manifest.
- Pre-existing working-tree changes are separated from test output.

## Final response（最终报告）

Report:

1. Impacted packages, fixture, generation command, and output root.
2. Exact tests/typechecks/builds run and results.
3. Generated file-set and semantic differences reviewed.
4. Snapshot decision and rationale.
5. Generated-code compile/format result.
6. Idempotency manifest result.
7. Skipped checks, risks, and unresolved failures.

Never equate “command succeeded” with “output is correct.”
Never report an unexecuted test as passing. Do not perform network writes, publish, tag, push, or overwrite unexplained user files as part of validation.
