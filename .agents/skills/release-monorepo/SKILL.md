---
name: release-monorepo
description: Prepare and verify openapi-to Version Packages PRs, Changesets, RC or stable releases, npm publication and dist-tags, Git tags, GitHub Releases, and partial-publication recovery. Use for release planning, prerelease/stable readiness, or an exactly authorized manual publication workflow; default to preparation-only and never publish, push, tag, or create a release without explicit authority.
---

# Prepare a monorepo release

Read root `AGENTS.md`, `.github/AGENTS.md`, and [release-facts.md](references/release-facts.md), then re-verify every fact in current manifests and Git state. This Skill prepares evidence and a plan; it does not publish by default.

## Required inputs

Establish:

- Release target: one package, affected packages, or the full published set.
- Intended channel: stable, canary, alpha/beta/rc, or another explicitly configured prerelease.
- Comparison base/tag and included commits.
- Whether the user requests only a plan, local versioning, artifact packing, tagging, or actual publication.
- Registry/auth environment, only if publication was explicitly authorized.

If the base/tag is unknown, Changesets configuration is missing, the worktree includes unexplained release artifacts, or publication authority is absent, continue with read-only analysis but stop before versioning/tagging/publishing.

## Two-phase release state machine

This Skill defaults to preparation-only. Versioning and publication are
separate phases with separate authorization.

### Phase A: Version candidate

1. Ordinary, meaningful Changesets enter `main` with their implementation.
2. Changesets Action creates or updates the Version Packages PR.
3. Run Version Readiness, Quality, E2E, and cross-platform checks as required.
4. Inspect versions, changelogs, the fixed group, and prerelease state.
5. The user decides whether to merge the Version Packages PR.

This phase must not publish npm packages, change an npm dist-tag, create a Git
tag, or create a GitHub Release. The Version Packages PR is version and
changelog preparation, not publication.

### Phase B: Publication

Enter this phase only when the user explicitly specifies and authorizes the
exact expected `main` SHA, exact fixed-group version, and exact `rc` or
`latest` channel, plus triggering the manual publication Workflow.

The controlled Workflow must verify `main`, expected SHA, expected version, and
channel; run release readiness before registry authority; pass the
`npm-production` Environment; publish with npm Trusted Publishing/OIDC; verify
every expected package version and dist-tag in the registry; and only then
create the immutable version tag and GitHub Release. It must output complete
publication facts.

If only some packages are visible, enter explicit partial publication recovery:
record the published and missing package/version/channel facts, preserve a
nonzero failure, and rerun only the same authorized candidate through the
idempotent controlled Workflow. Never overwrite an existing package version,
silently skip the mismatch, or repair it by moving a dist-tag before the facts
are understood.

Without the exact Phase B authorization, do not trigger the Workflow, publish,
modify dist-tags, create tags, or create a GitHub Release.

## Preparation workflow

### 1. Establish a clean evidence boundary

1. Run `git status --short`, identify user changes, and do not clean or rewrite them.
2. Determine the comparison base with local Git evidence. Do not fetch, push, or contact a registry unless authorized.
3. List changed files by package and shared root configuration.
4. Re-read root/package `package.json`, `pnpm-workspace.yaml`, `turbo.json`, root `tsconfig.json`, package changelogs/READMEs, and `.changeset/` if it exists.
5. Record whether each command below is a package script or a package-manager/tool invocation.

### 2. Build the affected-package graph

For every changed package, record:

- Published/private status and package name.
- Runtime, peer, optional, and dev dependency edges to workspace packages.
- Direct dependents, including the `openapi-to` aggregate package.
- Changed public types, runtime exports, generated output, CLI behavior, or documentation.
- Whether a dependent needs a release because its manifest range, bundled output, types, or user-facing aggregate API changes.

Internal dependencies currently use `workspace:*` broadly. Let pnpm/Changesets update resolved release metadata; never hand-edit `pnpm-lock.yaml` to simulate dependency correctness.

### 3. Classify semver impact

- **Major:** removes/renames an export, changes incompatible config/context/accessor types or generated contracts, changes CLI behavior incompatibly, or drops supported runtime/dialect behavior.
- **Minor:** adds a backward-compatible plugin/config/export/command/output capability.
- **Patch:** fixes behavior without intentionally breaking the public contract, or corrects docs/metadata that requires a package release under project policy.

Account for `0.x` semantics only if a target package is actually `0.x`; do not assume all packages share the same consumer risk merely because current versions align. A prerelease identifier does not make an incompatible stable change safe, and a prerelease must not be presented as a stable release.

Record the reason for every bump and every affected published dependent that receives no bump.

### 4. Verify package surfaces

For each release candidate:

1. Inspect `main`, `module`, `types`, `bin`, `exports`, `files`, and `publishConfig` where present.
2. Run its build and confirm every declared ESM/CJS/type/bin target exists in `dist` or the packed package.
3. Inspect emitted `.d.ts` files for missing private workspace paths, source-only aliases, and unintended public types.
4. Check aggregate exports in `packages/openapi/src/index.ts` and dependency declarations in `packages/openapi/package.json`.
5. Check the CLI's package/version relationship and built bin behavior when CLI/openapi packages change.
6. Inspect README availability: update root/package documentation only where the user-facing API needs it; do not invent missing package READMEs as a release prerequisite unless project policy requires them.
7. Perform a pack using a command supported by the installed package manager (verify with local help first), and inspect the complete file list. No secrets, fixtures, test outputs, source maps outside policy, Agent files, or undeclared runtime files may leak.
8. Install the tarballs together in a clean OS-temporary consumer. Verify ESM, CJS when declared, TypeScript declarations, and all bins without resolving workspace source paths. A successful `pack` alone is not installation evidence.
9. For the aggregate, identity-test every official factory against its owning package. In particular, `pluginSWR` must equal the SWR package factory, `pluginMSW` must equal the MSW package factory, and they must differ from each other.
10. Execute both `openapi` and `openapi-to` aliases from the temporary install. Check help/version behavior and `JSON.parse(stdout)` for representative `validate`/`inspect` invocations.

For a P0 compiler release, explicitly verify:

- `@openapi-to/core` declarations/exports for `compileOpenAPI`, diagnostics, `GeneratedArtifact`/generation manifest/result, and `ExitCode`.
- `@openapi-to/cli` command behavior/declarations for validate, inspect, diff, generate, dry-run, check, JSON output, and exit-code mapping.
- The `openapi-to` aggregate re-export of core plus both `openapi` and `openapi-to` bin aliases.
- Whether additive `HookContext` fields require coordinated plugin releases even while legacy `setSourceFiles()` remains source-compatible.
- Runtime-engine consistency. The repository, CI, bins, and all package manifests require Node >=22. Never claim compatibility with another version based only on API inspection; add and pass a maintained CI/smoke lane first.

Do not edit built output by hand. Rebuild it from source.

### 5. Verify Changesets and release metadata

1. Check that `.changeset/config.json` is tracked before invoking Changesets; an ignored local configuration is not release evidence.
2. If configuration is missing, report release infrastructure as incomplete and stop before `pnpm changeset`, versioning, or publish. Do not silently initialize Changesets unless the user requests that scope.
3. Add or review a changeset that names only affected packages and describes user-visible behavior. Changesets travel with feature changes into `main`; a valid, non-empty pending changeset is legal development state and is checked by `pnpm verify:changeset-state:development`. Do not rewrite historical versions or add an empty changeset.
4. On explicit manual dispatch against `main`, the Changesets Action maintains one Version Packages PR. That PR runs the root `version` script so Changesets consumes pending files and updates versions, changelogs, prerelease state, internal dependencies, and the lockfile together. Merging the Version Packages PR settles version metadata; it does not publish npm packages, create tags, or create GitHub Releases.
5. Run strict `pnpm verify:changeset-state` for a Version Packages PR and before publication. `release:check` remains strict: pending changesets, fixed-group splits, prerelease splits, and malformed state block release readiness.
6. Run `pnpm exec changeset status` and inspect package bumps/dependent bumps when preparing a release. The current policy is a fixed-version group containing all ten public packages; private config packages rely on `private: true` rather than an `ignore` entry that would invalidate their public dev dependents.
7. Verify package changelogs and the intended local tag names against existing local tags/history.
8. Treat canary/alpha/beta/rc scripts as separate paths; inspect their exact command text and resulting dist-tag/version policy before use. The maintained prerelease channel is currently `rc`; do not exit prerelease mode as part of Version Packages automation.

### 6. Validation matrix

Run focused commands first:

```sh
pnpm --filter <package-name> test
pnpm --filter <package-name> typecheck
pnpm --filter <package-name> build
```

For shared core/public API, aggregate package, or multi-package releases, run as impact requires:

```sh
pnpm test:vitest
pnpm typecheck
pnpm build
pnpm exec tsc -b
pnpm lint:ci
pnpm test:release-scripts
pnpm verify:repository-contract
pnpm verify:package-surface
pnpm release:smoke
pnpm verify:changeset-state
```

Also:

- Use `pnpm verify:changeset-state:development` for ordinary feature-branch and `main` quality checks where valid pending changesets are expected. This mode may suppress only `NEXT_RC_REQUIRED`; it must not suppress malformed, empty, unknown-package, fixed-group, or prerelease-state failures.
- For generator changes, use the Codex `$run-codegen-tests` Skill. If Skill invocation is unavailable, read `.agents/skills/run-codegen-tests/SKILL.md` and execute its applicable workflow directly.
- Run applicable CLI e2e smoke projects after a successful build when CLI/aggregate package behavior changes.
- Re-run pack-install smoke after the final build/version state. Inspect its file-count/size summary and retain a temporary workspace only when debugging.
- Run `pnpm lint:changed` during local change preparation and the full tracked-file `pnpm lint:ci` gate for release readiness; both treat warnings as failures. Do not use the historical full-lint backlog, `continue-on-error`, or a green wrapper job to hide new diagnostics.
- Ensure no uncommitted generated/test output was introduced.

A failing required test, typecheck, build, generated compile, idempotency check, export target, or pack inspection blocks a “ready to publish” conclusion.

### 7. Produce the plan, not the publication

Output an ordered plan containing:

- Package and bump table with reasons.
- Internal dependency/dependent updates expected from tooling.
- Changeset/changelog/README work.
- Validation commands and artifacts.
- Intended tag/dist-tag/channel and rollback notes.
- Exact operations requiring user authorization.

The automated Version Packages PR is versioning only. Unless Phase B has the
exact authorization above, do not trigger `.github/workflows/publish.yml`, run
root `release`, package `release`, `changeset publish`, `pnpm publish`, or
`npm publish`, modify an npm dist-tag, create/push a tag, or create a GitHub
Release. Ask again if the expected SHA, expected version, packages, or channel
differ from the approved plan.

## Stop conditions and prohibited actions

- Stop if Changesets configuration is absent or invalid, required outputs are missing, pack contents are unsafe, versions/ranges are inconsistent, or required validation fails.
- Do not publish from a dirty/unexplained worktree.
- Do not modify historical release tags or historical package versions.
- Do not hand-edit the lockfile to repair workspace dependency relationships.
- Do not treat a prerelease as stable or reuse a stable tag for a prerelease.
- Do not claim readiness when a required test was skipped or continued-on-error in CI.
- Do not infer registry authentication or publication permission from local config.

## Diagnostics compatibility

The P0 public surface includes unified diagnostics. Preserve stable codes, severity, locations, deterministic serialization, and exit-code mapping in release evidence. Redact sensitive values and never treat a human log string as the machine contract.

## Completion standard

Confirm that:

- Affected packages and dependents are fully mapped.
- Every bump has a semver rationale.
- Exports, declarations, bin targets, build output, and pack contents are verified.
- Changesets/changelog/tag readiness is explicit.
- Generator/CLI regressions are covered where applicable.
- No publish/tag/push occurred without explicit authorization.

## Final response

Report:

1. Comparison base and affected-package graph.
2. Proposed package bumps with reasons.
3. Changeset/changelog/README status.
4. Export/declaration/build/pack findings.
5. Exact validation commands/results.
6. Tag/channel plan and actions not performed.
7. Blockers, skipped checks, compatibility risks, and required user decisions.

Say “release plan prepared,” not “released,” unless publication actually completed.
Never report an unexecuted validation as passing, and never overwrite unexplained user files while preparing the plan.
