# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`mywb` on npm** — the CLI and MCP server install without cloning the repo:
  `claude mcp add mywb -- npx -y mywb mcp`, or `npm i -g mywb`. The published
  bundle is self-contained, so the drift-check example and its CI template now
  use `npx -y mywb` instead of a monorepo path or a vendored `dist/`.
- **Release workflow** — pushing a `v*` tag builds the macOS DMG and the Linux
  AppImage + deb and attaches them to a draft GitHub Release, so a release no
  longer needs binaries uploaded by hand.

- **Model ⇄ board round-trip** — a board's architecture is also a small JSON model
  you can commit and review. `mywb file model extract <board> <model>` reads it
  out; `mywb file scaffold <model> <board> --update` merges an edited model back
  into an existing board, keeping the layout, sizes and sticky notes a human
  added. Arrows now carry their relation label on the canvas.
- **Drift-check skill v3** — reads the committed model instead of full board JSON
  and adds a mechanical `board-sync` claim (extract + diff, no inference).

### Fixed

- `scaffold --update` no longer places a new component on top of a card that was
  dragged into its slot, duplicates arrows on boards predating the id-prefix
  convention, or sends a card moving between groups to negative coordinates.

## [0.1.0] — 2026-07-25

First public release. A local-first, single-user whiteboard for engineers where
coding agents are first-class users. Published with `LICENSE` (Apache-2.0),
`NOTICE`, `CONTRIBUTING.md`, and `SECURITY.md`; a Linux desktop build (AppImage +
deb) is attached to the [release](https://github.com/phuc-nt/my-whiteboard/releases/tag/v0.1.0).

### Added

- **Desktop app (Electron + tldraw)** — single-window-per-document canvas with
  crash recovery and session restore.
- **`.mywb` file format** — a zip archive (SQLite record store + embedded media +
  optional embedded `script/`); a working-copy model streams edits for crash
  safety.
- **Agent API** — a loopback HTTP server (`127.0.0.1:7236`) with a per-launch
  bearer token: read canvas state (`/api/search`), run code against the live
  editor (`/api/…/exec`), and a self-documenting `/readme`.
- **`mywb` CLI** — headless `file read/apply`, live `app docs/search/exec` against
  the running app, and an **MCP server** (`mywb mcp`) exposing eight tools
  (`list_documents`, `read_shapes`, `read_bindings`, `screenshot`, `export_svg`,
  `exec`, `scaffold_board`, `focus_shape`).
- **Custom shapes** — `service-node`, `code-ref`, and `mermaid-block` carrying
  structured, agent-readable data.
- **Board scaffolding** — build a full architecture board from a declarative
  model, laid out by a real graph engine (dagre) with subsystem frames.
- **Mermaid bridge** — export a board to a Mermaid flowchart (renders in a README,
  headless-verifiable).
- **Document scripts** — an embedded `script/main.js` runs on open after sha256
  digest consent.
- **Web app** (`apps/web`) — open/save `.mywb` via the File System Access API with
  a download/upload fallback, plus a read-only Agent Gateway relay.
- **VS Code extension** — open and edit `.mywb` boards on a full canvas inside VS
  Code.
- **Shared, environment-agnostic core** (`@mywb/core`) with desktop, web, and node
  adapters; the core boundary (no `electron`/`node:*`) is enforced by a test gate.
- **Diagram-as-review (drift-check)** — an agent compares a board with the real
  codebase and reports drift. Runs locally (the engineer's own agent, zero setup)
  or in CI (opt-in, needs `ANTHROPIC_API_KEY`).
- **CI** — tiered `fast` + `e2e` workflows and a Linux build (AppImage + deb).

[Unreleased]: https://github.com/phuc-nt/my-whiteboard/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/phuc-nt/my-whiteboard/releases/tag/v0.1.0
