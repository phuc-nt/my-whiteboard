# Codebase Summary

Electron + electron-vite + React 19 + tldraw 5.2.5, TypeScript, zod. Single
package `my-whiteboard`. Modules split by concern with descriptive kebab-case
names.

## Layout

```
src/
├── shared/                  # types shared across processes
│   ├── ipc-contract.ts        # channel names + payload shapes (source of truth)
│   └── mywb-format-types.ts   # archive/session zod schemas + constants
├── main/
│   ├── index.ts               # app lifecycle, IPC handlers, startup/quit, wiring
│   ├── window-manager.ts      # window-per-doc registry, dirty/save/close state
│   ├── document-actions.ts    # new/open/save/save-as/close-confirm
│   ├── renderer-invoke.ts     # main→renderer request/reply (id-correlated)
│   ├── menu-manager.ts        # native menu (rebuilt on recent-files change)
│   ├── app-protocols.ts       # mywb-app:// (renderer + scripts), mywb-asset://
│   ├── session-restore-manager.ts, recent-files-manager.ts
│   ├── working-copy-manager.ts# live on-disk doc form; save/recover/asset
│   ├── archive/               # records-database (node:sqlite), zip reader/writer
│   ├── agent-api/             # HTTP server, search vm, registry, readme, log
│   ├── agent-skills/          # SKILL.md + mywb helper templates, installer
│   └── document-scripts/      # coordinator (watcher/rerun), trust store, workspace
├── preload/index.ts           # contextBridge: desktop.{loadDocument,onInvoke,…}
└── renderer/src/
    ├── pages/editor.tsx        # <Tldraw> mount, IPC handler registration
    ├── document-sync.ts        # stream record diffs + snapshot capture
    ├── document-serialization.ts, document-assets.ts
    ├── agent/                  # exec-code-handler (new Function), script-helpers
    ├── document-scripts/script-runtime.ts  # import/abort/rerun
    └── shapes/                 # custom-shapes-registry + 3 shape dirs
```

## Key contracts

- **IPC** goes through `src/shared/ipc-contract.ts`. Renderer→main uses
  `ipcRenderer.invoke`; main→renderer uses one correlated request/reply pair
  (`renderer-invoke.ts`) because Electron has no built-in main→renderer invoke.
- **Document serialization** is contained in `working-copy-manager` (main) and
  `document-sync` / `document-serialization` (renderer). Swapping the storage
  format touches only these.
- **Custom shapes** (tldraw v5 API): each has `static type`, `static props`
  (`T` validators), `getDefaultProps`, `getGeometry`, `component`,
  `getIndicatorPath` (Path2D), plus a `TLGlobalShapePropsMap` module
  augmentation. Registered via `custom-shapes-registry`.

## Tests

- **Unit (vitest)**: `records-database`, `mywb-archive` (round-trip + path
  traversal), `skill-templates`. Run with `npm test`.
- **E2E (Playwright + Electron)**: `e2e/*.spec.ts` launch the built app with a
  throwaway userData dir and drive it through the agent API — agent read/mutate,
  custom shapes, document scripts. Run with `npm run e2e`.

## Conventions / gotchas

- `"type": "module"` — preload is forced to CJS in `electron.vite.config.mts`
  (sandbox requires it); `@tldraw/assets` is excluded from the dep optimizer
  (it rewrites `import.meta.url` asset refs and breaks them).
- Dev userData dir is named after the productName ("My Whiteboard").
- A single-instance lock is active in normal use; e2e sets `MYWB_TEST_USER_DATA`
  to bypass it and isolate state.
