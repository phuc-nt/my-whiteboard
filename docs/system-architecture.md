# System Architecture

**My Whiteboard** — local-first Electron + tldraw app, built as an npm
workspaces monorepo: a shared environment-agnostic core (`@mywb/core`) plus a
desktop adapter (`apps/desktop`: main/preload/renderer) and a browser proof
consumer (`apps/web-smoke`). The desktop app remains single process tree, no
network server.

## Process model

```
Main process (Node)                    Renderer (per document window)
├─ window-manager                      ├─ <Tldraw> editor + custom shapes
├─ document-actions (new/open/save)    ├─ document-sync (streams record diffs)
├─ working-copy-manager                ├─ agent/exec-code-handler
│   └─ archive/{reader,writer,db}       ├─ document-scripts/script-runtime
├─ session-restore / recent-files      └─ document-assets (asset store)
├─ agent-api/ (HTTP server)                         ▲
│   └─ agent-server-registry ──────────────┐        │ IPC (typed, correlated)
├─ document-scripts/ (coordinator,        │        │
│   watcher, trust store, workspace)      └────────┘
└─ app-protocols (mywb-app://, mywb-asset://)
```

One window = one document. IPC is a typed request/reply bridge
(`src/shared/ipc-contract.ts`) exposed narrowly via preload; the renderer has no
Node access (`contextIsolation` + `sandbox`).

## `.mywb` file format

A zip archive:

```
doc.mywb
├── metadata.json   # formatVersion, documentId, appVersion, scriptDigest
├── db.sqlite       # tldraw records (node:sqlite, WAL) — one row per record
├── assets/         # embedded media
└── script/         # optional document script (main.js)
```

Open = extract into a **working copy** at `userData/working-copies/<documentId>/`;
edits stream there as record diffs (debounced) so a crash loses ≤ the debounce
window. Save = capture a full snapshot from the renderer, rewrite the db,
checkpoint WAL, pack the working copy back into the archive atomically. Session
restore reopens the previous windows; a `cleanExit` marker (written at
`will-quit`) distinguishes a crash, which arms the recovery prompt.

## Agent API

HTTP server on `127.0.0.1:7236` (ephemeral fallback on conflict). A per-launch
32-byte token is written to `userData/server.json` (chmod 600) alongside the
port. Auth is a timing-safe bearer check; only `GET /` and `/readme` are
tokenless.

- `POST /api/search` — runs code in a main-process `vm` with an `api` object
  (list docs, read shapes/bindings, screenshot).
- `POST /api/doc/:id/exec` — forwards code to the target window's renderer,
  which runs it against the live `editor` inside a history stopping point.
- `POST /api/doc/:id/script-workspace`, `GET /api/doc/:id/script-status` —
  document-script editing surface.

The `agent-server-registry` is the only coupling between the server and window
state, so the server imports no window internals.

## Custom schemes

`file://` breaks `FontFace`, storage, and CSP `'self'` semantics, so the built
renderer is served over `mywb-app://renderer/...` (a real, secure origin).
`mywb-asset://` serves working-copy media. Document scripts are served on the
**same** `mywb-app://` origin (path `/__script__/...`) because Chromium only
allows cross-origin ES-module imports for http/https/data — a separate scheme
would be CORS-blocked.

## Document scripts

`script/main.js` (an ES module, default export `({editor, helpers, signal})`)
runs on open. Trust is keyed on the **sha256 digest of the whole `script/` dir**
(`script-trust.json`); a change re-prompts. A filesystem watcher on the working
copy recomputes the digest on edit, auto-trusts local edits made through the
workspace, and reruns via IPC (each run gets a fresh `AbortController`). The
digest is stamped into archive metadata at save; a mismatch on open means the
script was tampered with inside the zip and it is removed rather than run.

## Security posture

The agent API and scripts execute code intentionally — that is the product. The
boundaries: loopback-only bind + per-launch token for the API; digest consent
for embedded scripts; CSP `'unsafe-eval'` is scoped to a renderer that only ever
loads the app's own bundle (no remote scripts; navigation blocked), with
document *content* treated as data, never executed.

## Hybrid, shared core (decided 2026-07-19 — extracted in Stage 1)

The target is a **shared core** package that runs on both desktop and web, with
thin per-environment **adapters**. Stage 1 extracted it: `@mywb/core` now holds
shape schemas + validation, the `.mywb` format types, the agent-protocol wire
contract, agent-exec semantics, the document-script runtime, document-sync
behind an injected `SyncTransport`, and a `RecordStore` storage contract
(in-memory impl in core, sqlite impl in the desktop adapter). The boundary —
no `electron`, no `node:*`, no `window.desktop` in core — is enforced by an
automated test gate, and `apps/web-smoke` proves the core mounts, execs, and
syncs in a plain browser.

- **Desktop adapter** (`apps/desktop/src/main/*`): file system, `node:sqlite`
  (`RecordsDatabase implements RecordStore`), localhost HTTP server, custom
  protocols, `fs.watch`; the renderer wires core over the IPC transport.
- **Web adapter** (future, Stage 2): OPFS / File System Access, WASM sqlite or a
  backend store, WebSocket sync, an Agent Gateway relaying agent↔canvas
  (browsers can't host a localhost server), and a script sandbox (iframe/worker
  — running untrusted scripts in the app origin is a real XSS surface on the
  web).

Decision axis: **where the engineer's agent runs.** Local agent → desktop's
loopback API is the cheapest, zero-config path. Cloud-side agent → web + backend.
The product serves both; web is the team/collaboration stage, not a replacement.

## Deferred (post-MVP)

Multi-user sync, SSO, GitHub/CI integration, wireframe/issue-card shapes,
auto-update, code signing/notarization, Windows/Linux builds, agent context
hooks (SubagentStart injection).
