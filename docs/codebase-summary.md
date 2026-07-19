# Codebase Summary

npm workspaces monorepo, TypeScript, zod, tldraw 5.2.5, React 19. Modules split
by concern with descriptive kebab-case names.

## Layout

```
packages/core/               # @mywb/core — environment-agnostic (no electron, no node:*)
└── src/
    ├── format/                # .mywb zod schemas, SerializedRecord, archive entry names
    ├── agent-protocol/        # Agent API wire contract: paths, parseCode, safeSerialize, ServerInfo
    ├── shapes/                # 3 custom shape utils + registry + TLGlobalShapePropsMap augmentation
    ├── sync/                  # document-sync (SyncTransport injected), document-serialization
    ├── exec/                  # runExecCode + script-helpers (agent exec semantics)
    ├── script-runtime/        # runDocumentScript / stopDocumentScript
    ├── storage/               # RecordStore interface + MemoryRecordStore (+ contract test suite)
    └── boundary.test.ts       # gate: forbids electron/node:*/window.desktop in core sources

apps/desktop/                # Electron adapter (electron-vite + React)
├── src/shared/ipc-contract.ts # IPC channel names + payload shapes
├── src/main/                  # window/document managers, archive (node:sqlite RecordsDatabase
│                              #   implements RecordStore), agent-api HTTP server, agent-skills,
│                              #   document-scripts (watcher/trust/workspace), app-protocols
├── src/preload/               # contextBridge: desktop.{loadDocument,onInvoke,…}
├── src/renderer/              # editor page: mounts core (shapes/sync/exec/script-runtime)
│                              #   over the IPC transport; document-assets
└── e2e/                       # Playwright + Electron suite (agent API, shapes, scripts)

apps/web-smoke/              # Proof consumer: core in a plain browser (vite + chrome test)
```

## Key contracts

- **Core boundary**: `packages/core` never imports `electron`, `node:*`, or
  `window.desktop` — enforced by `boundary.test.ts` (raw-source scan) and the
  package gate (no electron/@types/node deps). `tldraw`/`react` are
  peerDependencies (one instance repo-wide — check `npm ls tldraw`).
- **SyncTransport** (`@mywb/core/sync`): `document-sync` streams through an
  injected `{pushInitialSnapshot, pushDiff}`; desktop passes `window.desktop`
  IPC, web-smoke passes a `MemoryRecordStore`. Lifecycle (pagehide flush,
  dispose) is the adapter's job.
- **RecordStore** (`@mywb/core/storage`): mirror of the sqlite adapter's API
  minus `checkpoint()` (WAL-specific). One shared contract test suite runs
  against both implementations (`@mywb/core/storage/testing`).
- **IPC** goes through `apps/desktop/src/shared/ipc-contract.ts`; main→renderer
  uses one correlated request/reply pair (`renderer-invoke.ts`).
- **Custom shapes** (tldraw v5): static `props` validators carry the
  agent-readable schema; `TLGlobalShapePropsMap` augmentation ships with
  `@mywb/core/shapes` imports.

## Tests

- `npm test` — vitest in every workspace: core (plain Node env — this is the
  proof core is environment-agnostic) + desktop unit tests.
- `npm run e2e` — Playwright drives the built Electron app through the agent
  API (throwaway userData via `MYWB_TEST_USER_DATA`).
- `npm run e2e:web` — chrome-channel Playwright against `apps/web-smoke`
  (canvas mount, exec round-trip, sync into memory store).

## Conventions / gotchas

- Root scripts delegate via `npm run <s> -w <workspace>`; `test`/`typecheck`
  run `--workspaces --if-present`.
- `@mywb/core` ships TS source via `exports` (bundler-consumed);
  `externalizeDepsPlugin({ exclude: ['@mywb/core'] })` keeps it bundled into
  main/preload. `electronVersion` is pinned in `electron-builder.yml` because
  workspace hoisting hides the installed electron from builder.
- Store history reaches `store.listen` subscribers on the next animation frame
  in browsers — flush-then-read code must wait a frame (see web-smoke).
- `"type": "module"` — preload is forced to CJS; `@tldraw/assets` is excluded
  from dep optimizers in both vite configs.
- DMG output: `apps/desktop/release/`.
