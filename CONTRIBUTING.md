# Contributing to My Whiteboard

Thanks for your interest. This is a local-first, single-user Electron app built
on the [tldraw SDK](https://tldraw.dev), designed so coding agents are
first-class users. Contributions of all sizes are welcome.

## Prerequisites

- **Node.js ≥ 22.12** (the CLI uses the built-in `node:sqlite`, which needs 22.5+).
- npm (this repo is an npm workspaces monorepo; do not mix in yarn/pnpm).
- A Chromium-based browser for the web e2e suites.

## Getting started

```bash
git clone https://github.com/phuc-nt/my-whiteboard.git
cd my-whiteboard
npm install
npm run dev        # launch the desktop app in development
```

> If your shell exports `ELECTRON_RUN_AS_NODE=1`, prefix run commands with
> `env -u ELECTRON_RUN_AS_NODE`, or the app launches as plain Node.

## Checks before opening a PR

Run the checks that cover what you touched, then broaden if you changed shared
code or public contracts:

```bash
npm run typecheck  # tsc across all workspaces
npm test           # vitest: core (plain Node) + desktop unit tests
npm run e2e        # Playwright + Electron end-to-end (needs a built app)
```

Web / VS Code changes have their own suites:

```bash
npm run e2e:web    # apps/web open/save .mywb round-trip (chrome channel)
npm run e2e:relay  # browser tab ↔ relay ↔ agent read
npm run e2e:vscode # VS Code custom editor integration tests
```

CI runs the `fast` job (typecheck + unit) on every push/PR and the `e2e` job
after it. A PR that keeps CI green is a PR that is ready to review.

## Architecture at a glance

- `packages/core` (`@mywb/core`) — environment-agnostic core: shape schemas,
  `.mywb` format, agent-protocol, sync, exec, script runtime. **Never** imports
  `electron`, `node:*`, or `window.desktop` (enforced by `boundary.test.ts`).
- `packages/node-adapter` — the `.mywb` archive + sqlite stack and headless
  document access shared by the desktop app and the CLI.
- `packages/web-adapter` — browser `.mywb` read/write + WASM sqlite store.
- `apps/desktop` — the Electron adapter (main / preload / renderer).
- `apps/web` — the web app; `apps/vscode` — the `.mywb` custom editor.
- `apps/cli` — the headless `mywb` CLI (file mode, live app mode, MCP server).
- `services/agent-relay` — read-only Agent Gateway for the web canvas.

See [docs/system-architecture.md](docs/system-architecture.md) and
[docs/codebase-summary.md](docs/codebase-summary.md) for the full map.

## Code style

- TypeScript throughout; keep the core boundary clean (adapters own all
  environment-specific code).
- Descriptive **kebab-case** file names for new JS/TS/shell files.
- Prefer editing an existing module over adding a new abstraction; split a file
  only when it reduces real complexity.
- Match the surrounding code's conventions and comment density.

## Commits & pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`,
  `fix:`, `docs:`, `ci:`, `refactor:`, `test:`, `chore:` with an optional scope,
  e.g. `feat(scaffold): …`.
- Keep commits focused; explain the behavior or invariant, not the process.
- One logical change per PR. Describe what changed and how you verified it.

## Reporting bugs & security issues

- Functional bugs: open a [GitHub issue](https://github.com/phuc-nt/my-whiteboard/issues).
- Security vulnerabilities: **do not** open a public issue — see
  [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE), the same license that covers this project.
