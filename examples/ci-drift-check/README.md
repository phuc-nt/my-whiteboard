# CI drift-check example

Keeps a `.mywb` architecture diagram honest: on each PR, an agent reads the
diagram as structured data and compares it with the code, commenting when they
disagree. The intelligence lives in [SKILL.md](SKILL.md); this repo only
provides data access (`mywb file read/apply`).

## Files

- `drift-check.yml` — sample GitHub Actions workflow (copy to `.github/workflows/`)
- `SKILL.md` — instructions for the agent: shape semantics, drift procedure, update pattern
- `sample-board.json` — seeds for a demo board (includes deliberate drift bait:
  services and repo URLs that won't match your codebase)

## Try it locally

```bash
npm ci
npm run build -w apps/cli
node apps/cli/dist/make-fixture.js /tmp/architecture.mywb examples/ci-drift-check/sample-board.json
node apps/cli/dist/cli.js file read /tmp/architecture.mywb --json > diagram.json
# hand diagram.json + SKILL.md to your agent, or eyeball it:
node apps/cli/dist/cli.js file read /tmp/architecture.mywb
```

## Vendoring the CLI into your repo

my-whiteboard is not published to npm, so a target repo ships the built CLI
itself. The bundle is a directory, not a single file — `cli.js` loads sibling
chunks from `assets/`. Copy the whole `dist/`:

```bash
# from a my-whiteboard checkout, after `npm ci && npm run build -w apps/cli`
mkdir -p <target-repo>/tools/mywb
cp -R apps/cli/dist <target-repo>/tools/mywb/dist
cp examples/ci-drift-check/SKILL.md <target-repo>/tools/mywb/drift-skill.md
```

No `npm install` needed in the target repo: `file read`/`file apply` are
self-contained (the MCP SDK is loaded lazily and only the `mcp` subcommand
touches it). Point the workflow at `node tools/mywb/dist/cli.js`. The `mcp`
subcommand is the exception — it still needs the SDK from `node_modules` (i.e.
the monorepo), so it is not available from a vendored copy; drift-check only
uses `file read`/`file apply`.

## Requirements & limits

- Node ≥ 22.5 (`node:sqlite`).
- Record-level access only — no editor semantics, no exec.
- No file locking: don't point `file apply` at a board that a desktop app is
  actively saving. CI reading a committed file is always safe.
