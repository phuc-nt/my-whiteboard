# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- First public release preparation: `LICENSE` (Apache-2.0), `NOTICE`,
  `CONTRIBUTING.md`, `SECURITY.md`, and this changelog.

## [0.1.0] — 2026-07-25

First public snapshot. A local-first, single-user whiteboard for engineers where
coding agents are first-class users.

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
