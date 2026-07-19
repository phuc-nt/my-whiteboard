# Codebase Summary

npm workspaces monorepo, TypeScript, zod, tldraw 5.2.5, React 19. Modules split
by concern with descriptive kebab-case names.

## Layout

```
packages/node-adapter/       # @mywb/node-adapter — Node-only shared code (no electron)
└── src/
    ├── archive/               # .mywb zip reader/writer + RecordsDatabase (node:sqlite,
    │                          #   implements core RecordStore) — used by desktop AND headless tools
    └── headless-document/     # read/applyRecordChanges/save on .mywb without the app;
                               #   validation = headless TLStore with the app's shape schemas;
                               #   fixture-builder for tests and examples

packages/web-adapter/        # @mywb/web-adapter — browser-only (no electron, no node:*)
└── src/
    ├── web-archive/           # .mywb read/write via fflate — same layout as the Node yauzl one
    └── wasm-sqlite-store/     # StoreBackend via sql.js reading/writing db.sqlite; shares the
                               #   table schema (SQL from @mywb/core) with node:sqlite → one format

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

apps/web/                    # My Whiteboard on the web (vite + React): open/save .mywb via File
                             #   System Access (Chromium) or download/upload fallback; canvas from core

services/agent-relay/        # my-whiteboard-agent-relay — read-only Agent Gateway: a web tab
                             #   connects out over WebSocket + token; agents POST /api/read (list/
                             #   getShapes/getBindings). NO exec route by design (that is Stage 2c)

apps/cli/                    # my-whiteboard-cli — bin `mywb` (self-contained dist via vite SSR)
                             #   file mode (headless): `mywb file read|apply ...`
                             #   app mode (live):      `mywb app docs|search|exec ...` — talks to the
                             #     RUNNING desktop app via server.json (per-OS userData; override
                             #     --server-json / MYWB_SERVER_JSON)
                             #   + dist/make-fixture.js for sample boards

examples/ci-drift-check/     # GitHub Action template + SKILL.md: agent reads the diagram via
                             #   the CLI and compares it with the code (drift-as-review)
```

## Key contracts

- **Core boundary**: `packages/core` never imports `electron`, `node:*`, or
  `window.desktop` — enforced by `boundary.test.ts` (raw-source scan) and the
  package gate (no electron/@types/node deps). `tldraw`/`react` are
  peerDependencies (one instance repo-wide — check `npm ls tldraw`).
- **SyncTransport** (`@mywb/core/sync`): `document-sync` streams through an
  injected `{pushInitialSnapshot, pushDiff}`; the desktop passes `window.desktop`
  IPC. Lifecycle (pagehide flush, dispose) is the adapter's job.
- **RecordStore** (sync) + **StoreBackend** (async) (`@mywb/core/storage`):
  parallel persistence contracts. `RecordsDatabase` (desktop, node:sqlite)
  implements RecordStore; `WasmSqliteStore` (web, sql.js) implements
  StoreBackend; both run shared contract suites (`@mywb/core/storage/testing`)
  and share the table SQL (`record-db-schema.ts`) so the `.mywb` format stays
  single. `checkpoint()` is sqlite-only and stays off both interfaces, so the
  desktop keeps using `RecordsDatabase` directly.
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
- `npm run e2e:web` — chrome-channel Playwright against `apps/web`: open a
  desktop-authored `.mywb`, render the custom shapes, save a round-trip through
  the WASM sqlite store.
- `npm run e2e:relay` — full Agent Gateway path with a real browser tab and a
  real relay: a Chrome tab loads a `.mywb`, connects out over WebSocket, and an
  agent reads the open canvas through `POST /api/read` (and `/api/exec` → 404).
  Self-manages its env-wired preview server, so it runs under
  `apps/web/playwright.relay.config.ts` (separate from `e2e:web`).

## Conventions / gotchas

- Root scripts delegate via `npm run <s> -w <workspace>`; `test`/`typecheck`
  run `--workspaces --if-present`.
- `@mywb/core` ships TS source via `exports` (bundler-consumed);
  `externalizeDepsPlugin({ exclude: ['@mywb/core'] })` keeps it bundled into
  main/preload. `electronVersion` is pinned in `electron-builder.yml` because
  workspace hoisting hides the installed electron from builder.
- Store history reaches `store.listen` subscribers on the next animation frame
  in browsers — flush-then-read code must wait a frame (see apps/web).
- `"type": "module"` — preload is forced to CJS; `@tldraw/assets` is excluded
  from dep optimizers in both vite configs.
- DMG output: `apps/desktop/release/`.
- Importing tldraw keeps a live timer in the Node event loop outside
  `NODE_ENV=test` — CLIs must `process.exit()` explicitly when done (with
  awaited stdout writes so pipes are flushed).
- `apps/cli` requires Node ≥ 22.5 (`node:sqlite`); its dist bundles everything
  except node builtins, so `node dist/cli.js` runs on a bare runner.
