# Plugin touchpoints

Use this reference after reading the current files. It is a routing checklist, not a frozen API specification.

## Lifecycle and state

| Concern | Verify here | Decision |
| --- | --- | --- |
| Hook names and context | `packages/core/src/pluginManager/types.ts` | Select only declared Hooks and fields. |
| Actual scheduling | `packages/core/src/pluginManager/runPluginsByTags.ts` | Do not infer ordering from Hook names. |
| Dependency stages | `packages/core/src/pluginManager/graph.ts` | Declare every metadata producer dependency; check cycles/missing names. |
| Operation metadata | `packages/core/src/OpenAPIContext/OperationAccessor.ts` | Read/write only established metadata or explicitly scope a public API change. |
| Build-local state | closest official `src/plugin.ts` | Use per-configuration state; do not copy module-global registries. |
| Output representation | `packages/core/src/artifacts/`, `packages/core/src/pluginManager/types.ts`, and `build.ts` | Choose a typed `GeneratedArtifact`; legacy `SourceFile` registration is an adapter for existing TypeScript plugins. |

The current runner provides one shared `HookContext` for a `PluginManager.execute()` call. `buildStart` completes first, and component Hooks finish before the tag loop. Each `tagStart` is awaited, then that tag's operations are scheduled concurrently; `tagEnd` is invoked before those operation promises are awaited. A later tag can therefore start while earlier-tag operations are still active. After the loop the runner awaits all scheduled operations before `buildEnd`, so `buildEnd` is the current final aggregation barrier. Re-read the runner whenever it changes.

Do not keep shared `currentTag`/`currentOperation` variables or mutate an unpartitioned SourceFile, import collection, `Set`, or `Map` from operation Hooks. Partition by build/tag/operation or add explicit synchronization. Prefer `ctx.store`; use a module-level `WeakMap<OpenapiToSingleConfig, State>` only as a current-architecture compatibility adapter initialized in `buildStart`. Module-level strong-reference collections, registries, counters, and `Project` instances remain prohibited, and two consecutive builds must prove isolation.

## Package and public API

For a new official plugin, check each touchpoint and omit only with a recorded reason:

- `packages/plugin-<name>/package.json`
- `packages/plugin-<name>/tsconfig.json`
- `packages/plugin-<name>/tsdown.config.ts`
- `packages/plugin-<name>/src/index.ts`
- `packages/plugin-<name>/src/plugin.ts`
- `packages/plugin-<name>/src/types.ts`
- focused `*.test.ts`, `*.integration.test.ts`, `mock/`, and optional `src/__snapshots__/`
- root `tsconfig.json` project references when used by this repository
- `packages/openapi/package.json` workspace dependencies
- `packages/openapi/src/index.ts` aggregate named export

These registration touchpoints—including adding the official plugin name to the current enum/type—are normal plugin scope. Require separate core-design authorization only for `HookContext`, lifecycle scheduling, `OperationAccessor`'s public model, dependency-graph semantics, output representation/non-TypeScript artifacts, or changes to existing plugin stage definitions. Record the closed plugin-name union as a third-party extensibility limitation instead of redesigning it opportunistically.

Do not blindly copy manifest versions, dependency lists, or export conditions. Compare actual tsdown output names with `main`, `module`, `types`, `exports`, and `files`.

## Composition choices

- Type/schema producer: model after `plugin-ts-type` or `plugin-zod`; cover component Hooks and operation metadata.
- Request producer: model after `plugin-ts-request`; declare type/Zod dependencies based on consumed accessor metadata.
- Framework consumer: model after SWR/Vue Query/MSW only for relevant behavior; verify its request/type/schema dependency combination.
- Whole-build TypeScript index output: collect immutable facts during appropriate Hooks and emit one deterministically sorted file from `buildEnd`.
- JSON output: use a JSON artifact so serialization, hashing, comparison, and writing remain centralized.
- Markdown, YAML, or other text output: use a text artifact; do not treat it as TypeScript or write directly from a Hook.
- Binary output: use only for an explicit bounded byte artifact and assert exact bytes/hash/size.

For any combination, test plugin order through declared dependencies rather than relying on the user's array order.
