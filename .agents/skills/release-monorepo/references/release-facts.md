# Release facts to re-verify

These facts route an investigation. Re-read the files because release configuration changes frequently.

## Current repository surfaces

- Root `package.json` is private, declares pnpm as the package manager, pins `@changesets/cli`, and provides `build`, `typecheck`, `test:vitest`, Changesets version-state scripts, and tarball-first release readiness scripts. Changesets does not publish packages.
- Published/runtime packages are under `packages/`; `packages/config-ts` and `packages/config-tsup` are marked private at the authored revision.
- Published packages commonly declare ESM/CJS entrypoints and declarations under `dist`, built with tsup.
- The `openapi-to` aggregate package depends on CLI, core, and official plugins through workspace ranges, re-exports core/official factories, and exposes both `openapi` and `openapi-to` bin aliases through `bin/openapi.js`.
- P0 adds public compiler, diagnostic, artifact/manifest/result, diff/inspect, and exit-code exports. Treat `@openapi-to/core`, `@openapi-to/cli`, and the aggregate package as direct release candidates; inspect official plugin declarations/dependency edges before deciding whether they need coordinated bumps.
- Root development policy, CI, bins, and package manifests require Node >=22. A lower runtime must not be claimed unless it has its own maintained CI and pack-install smoke lane.
- Package manifests use `workspace:*` for internal edges; never replace those values or lockfile entries manually as a release workaround.
- Package `CHANGELOG.md` files exist. Root and some packages have README files, but plugin packages do not all have package-local READMEs at this revision.
- `.changeset/config.json` is tracked. It uses public access, `main` as the base branch, workspace-protocol-aware internal dependency bumps, and one fixed-version group for all ten public packages. Private config packages are excluded by `private: true`, not `ignore`.
- Changesets are committed with feature work and may remain pending on feature branches and `main`. `verify:changeset-state:development` accepts only valid, non-empty pending changesets; the default `verify:changeset-state` and `release:check` remain strict release-candidate gates.
- `.github/workflows/version-packages.yml` uses `changesets/action@v1` only on explicit manual dispatch against `main` to create or update one Version Packages PR through the root `version` script. It has no publish command or npm credential. The Version PR settles versions, changelogs, `.changeset/pre.json`, internal dependency metadata, and the lockfile without publishing, tagging, or creating a GitHub Release.
- `.github/workflows/publish.yml` is the maintained manual publication path. It validates the exact `main` SHA, fixed-group version, `rc`/`latest` channel, and dist-tag; runs strict prepack readiness; rejects tracked or non-ignored worktree drift; uses `pnpm pack` once per public package; validates the actual tarball manifests and checksums; installs those same tarballs in the smoke consumer; uploads only the bound artifact; and, after `npm-production` Environment approval, a fresh `main` SHA check, and an absent-or-exact remote tag/Release check, publishes only the verified `.tgz` paths through npm Trusted Publishing/OIDC. It verifies every registry integrity and dist-tag before creating or exactly revalidating the immutable version tag and non-draft prerelease/latest GitHub Release.
- `.github/workflows/version-readiness.yml` runs the strict Changesets state validator when version-state paths change in a PR. Ordinary Quality CI still runs build, typecheck, tests, changed-file lint, repository contracts, package-surface checks, and pack-install smoke while using the development Changesets gate.
- The tracked prerelease state remains in `rc` mode. Exiting prerelease mode, npm publication, dist-tag mutation, tags, and GitHub Releases require a separate explicitly authorized release operation.
- The current 4.0 RC branch/prerelease policy remains unchanged. A future `release/next` branch or stable migration is not implied by the publication workflow.
- `npm-production` Environment protection, npm Trusted Publisher bindings, main Branch Ruleset, and repository merge methods are external settings. Repository code cannot prove they are configured. Until they are configured and a controlled real publication succeeds, the workflow is `CODE READY`, not end-to-end release ready; no real npm publication smoke is implied.
- Root release quality uses the full tracked-file `lint:ci` gate alongside `test:release-scripts`, `verify:repository-contract`, and `verify:package-surface`; local change preparation also uses `lint:changed`. `release:check` runs the ordinary pack-install smoke before its strict Changesets release-candidate gate so an expected `NEXT_RC_REQUIRED` result still preserves smoke evidence. The publication workflow instead uses `release:check:prepack` to apply that strict gate before creating publication artifacts, then passes its one already-packed tarball set to the smoke script so it verifies ESM/CJS/types and both aggregate CLI aliases without repacking.
- CI on Node 22 builds, typechecks packages and root project references, runs Vitest, rejects changed-file lint warnings, verifies Changesets under the appropriate development or strict mode, and performs pack-install smoke. e2e generation runs on Linux, Windows, and macOS.

## Files to inspect

```text
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
turbo.json
tsconfig.json
packages/*/package.json
packages/*/tsup.config.ts
packages/*/CHANGELOG.md
packages/*/README.md (where present)
packages/openapi/src/index.ts
packages/openapi/bin/openapi.js
.changeset/config.json (only if it exists)
.changeset/*.md
.github/workflows/quality.yml
.github/workflows/e2e.yaml
scripts/lint-changed.mjs
scripts/release/verify-package-surface.mjs
scripts/release/pack-install-smoke.mjs
```

## Evidence table template

| Package | Published? | Change | Public impact | Dependents | Bump | Exports/build verified | Pack verified | Changeset |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `<name>` | yes/no | `<summary>` | `<contract>` | `<names>` | major/minor/patch/none | pass/fail | pass/fail | added/missing/not-needed |

## Authorization boundary

Read-only status, diff, local build/test/typecheck, and dry-run packing are preparation. Version-file mutation, lockfile mutation, changelog generation, tag creation, registry login, publication, and any push are separate state-changing steps. Perform only the subset the user explicitly authorized.
