# @openapi-to/plugin-msw

## 4.0.0-rc.4

### Major Changes

- d71e14f: Raise the minimum supported Node.js runtime from Node 20 to Node 22.

### Patch Changes

- 6b87c66: Make the default initialized configuration directly generatable by selecting
  SWR as its single query plugin, and emit one structured JSON document for
  `init --json`.

  Keep inline enum declarations and references on one collision-safe symbol,
  remove the unused implicit-any SWR fetcher parameter, and narrow schema-less
  JSON response data only at MSW's `HttpResponse.json` boundary.

  Disambiguate distinct inline-enum schema paths that normalize to the same
  readable TypeScript identifier.

- c0dbf3b: Upgrade the compiler and official generator plugins to `oas` 38 while preserving
  operation discovery, OpenAPI 3.0/3.1/3.2 compatibility, referenced parameter and
  request-body semantics, response component identity, response media and composition
  semantics, selective generation, and deterministic generated output.
- Updated dependencies [c0dbf3b]
- Updated dependencies [d71e14f]
- Updated dependencies [b91f54a]
  - @openapi-to/core@4.0.0-rc.4

## 4.0.0-rc.3

### Patch Changes

- @openapi-to/core@4.0.0-rc.3

## 4.0.0-rc.2

### Patch Changes

- Updated dependencies [f5a38fd]
- Updated dependencies [7c87d42]
- Updated dependencies [f405e1a]
  - @openapi-to/core@4.0.0-rc.2

## 4.0.0-rc.1

### Major Changes

- ed854a9: Move automatic configuration discovery to root `openapi.config.ts`, `.js`,
  `.cjs`, or `.mjs` files and move tool-managed state and managed output to
  `.openapi-to`.

  The former `.OpenAPI` configuration location is no longer discovered, and Core
  replaces the removed `folderName` export with `stateDirectoryName`. No
  compatibility fallback or automatic migration is provided; move the
  configuration and any state that must be retained manually.

### Patch Changes

- Updated dependencies [ed854a9]
  - @openapi-to/core@4.0.0-rc.1

## 4.0.0-rc.0

### Major Changes

- e373f8c: Freeze the P0 compiler and P1 Codex governance baseline. This release adds the
  OpenAPI compiler pipeline, structured diagnostics, general generated artifacts,
  validation, inspection, contract diffing, deterministic dry-run/check modes,
  safe remote loading, and the expanded CLI surface.

  The major bump records compatibility-sensitive behavior changes: private-network
  remote sources are blocked by default, conflicting artifact paths fail instead of
  depending on write order, managed output cleanup is manifest-aware, and CLI
  failures now return classified non-zero exit codes.

### Patch Changes

- 642c834: Align published package metadata, documented capabilities, CLI aliases, MCP Host setup, and release verification with the shipped package surfaces.
- Updated dependencies [e373f8c]
- Updated dependencies [4f10867]
- Updated dependencies [642c834]
- Updated dependencies [3e1078b]
- Updated dependencies [ce3f9f2]
- Updated dependencies [862f0ae]
- Updated dependencies [b4130f7]
- Updated dependencies [f0a38b1]
- Updated dependencies [6aac98f]
- Updated dependencies [b4130f7]
- Updated dependencies [ca8f1cb]
- Updated dependencies [235162c]
  - @openapi-to/core@4.0.0-rc.0

## 3.2.2

### Patch Changes

- fix bug
- Updated dependencies
  - @openapi-to/core@3.2.2

## 3.2.1

### Patch Changes

- fix bug
- Updated dependencies
  - @openapi-to/core@3.2.1

## 3.2.0

### Minor Changes

- feat msw

### Patch Changes

- Updated dependencies
  - @openapi-to/core@3.2.0
