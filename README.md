# My Whiteboard

Local-first whiteboard for engineers, built on the [tldraw SDK](https://tldraw.dev),
where coding agents are first-class users. Draw diagrams and wireframes, and let
Claude Code / Codex / Cursor / Gemini read and edit the canvas through a local API
— by structured data and code, not screenshots.

Desktop app (Electron), single-user, no server. Documents are portable `.mywb`
files. See [docs/product-positioning-abstract.md](docs/product-positioning-abstract.md).

## Develop

npm workspaces monorepo: `packages/core` (`@mywb/core`, environment-agnostic
core), `apps/desktop` (Electron adapter), `apps/web-smoke` (browser proof).

```bash
npm install
npm run dev        # launch the desktop app in dev
npm run typecheck  # tsc across all workspaces
npm test           # vitest: core (plain Node) + desktop
npm run e2e        # build + Playwright Electron e2e
npm run e2e:web    # web-smoke: core in a plain browser (chrome channel)
npm run build:mac  # unsigned universal macOS DMG → apps/desktop/release/
```

> On a shell that exports `ELECTRON_RUN_AS_NODE=1`, prefix run commands with
> `env -u ELECTRON_RUN_AS_NODE` or the app launches as plain Node.

## What's inside

- **`.mywb` files** — zip archive containing a SQLite record store, embedded
  media, and an optional embedded `script/`. Every edit streams into a working
  copy for crash recovery; sessions restore on relaunch.
- **Agent API** — localhost HTTP server (`127.0.0.1:7236`) with a per-launch
  bearer token in `server.json`. `POST /api/search` reads canvas state;
  `POST /api/doc/:id/exec` runs code against the live editor; `GET /readme`
  documents it for an agent. Install the skill for your agents from
  **Help → Install Agent Skills…**.
- **Custom shapes** — `service-node`, `code-ref`, `mermaid-block` carry
  structured, agent-readable data for architecture and code-reference diagrams.
- **Document scripts** — `script/main.js` inside a file runs on open (after
  sha256-digest consent), enabling durable interactive behavior.

## Architecture

See [docs/system-architecture.md](docs/system-architecture.md) and
[docs/codebase-summary.md](docs/codebase-summary.md). Roadmap (hybrid,
shared core): [docs/project-roadmap.md](docs/project-roadmap.md).

## Security note

The agent API and document scripts execute code by design (see the CSP note in
`src/renderer/index.html`). The boundaries are: the server binds loopback only
with a per-launch token, and embedded scripts run only after digest consent.
Only grant agent access and open `.mywb` files you trust.
