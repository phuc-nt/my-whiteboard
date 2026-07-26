# CI drift-check example

Keeps a `.mywb` architecture diagram honest: on each PR, an agent reads the
diagram as structured data, evaluates only the claims the PR's diff touches,
and writes a machine-readable `findings.json` (contract in
[SKILL.md](SKILL.md)). The workflow renders the PR comment from that file and
uploads it as the `drift-findings` artifact — every run is measurable (drift
caught, false positives, coverage) without reading comments by hand. Drift is
comment-only; only a malformed findings.json fails the build. The
intelligence lives in SKILL.md; this repo only provides data access
(`mywb file read/apply/scaffold`).

The same procedure runs locally before a push — no CI or API key needed; see
"Local pre-push" in SKILL.md.

## Files

- `drift-check.yml` — sample GitHub Actions workflow (copy to `.github/workflows/`)
- `SKILL.md` — instructions for the agent: shape semantics, drift procedure, update pattern
- `sample-board.json` — seeds for a demo board (includes deliberate drift bait:
  services and repo URLs that won't match your codebase)

## Bootstrap a board from a model

Onboarding a repo no longer needs a drawing session. Describe the architecture
as JSON and scaffold the board headlessly:

```bash
npx -y @phuc-nt-prime/mywb file scaffold model.json docs/architecture.mywb
# model.json:
# { "title": "my-app — architecture", "documentId": "my-app-architecture",
#   "components": [{ "name": "web ui", "kind": "web", "repoUrl": "src/app" }, ...],
#   "edges": [{ "from": "web ui", "to": "api", "relation": "calls" }, ...],
#   "groups": [{ "name": "backend", "members": ["api", "db"] }, ...] }
```

Nodes are laid out by a graph engine (dagre: entry surfaces left, storage
right); arrows are bound to both endpoints and carry `meta.relation`. Optional
`groups` wrap their members in a named subsystem frame (each component in at
most one group) — the Mermaid export turns each frame into a `subgraph`. Open the
result in the app to fine-tune, then commit.

**Commit the model too**, next to the board with the same basename
(`docs/architecture.model.json` beside `docs/architecture.mywb`). It is the
diffable half of the pair — a reviewer reads the model in a PR, not a binary zip
— and the drift-check skill reads it instead of full board JSON, which is
cheaper and gives it fewer chances to misread the diagram.

## Keeping the pair in sync

The model and the board are two views of the same architecture, and either side
can move:

```bash
# model changed (a component added, an edge rewired) → re-render the board
npx -y @phuc-nt-prime/mywb file scaffold docs/architecture.model.json docs/architecture.mywb --update

# board changed (someone rearranged it in the app) → read the model back out
npx -y @phuc-nt-prime/mywb file model extract docs/architecture.mywb docs/architecture.model.json
```

`--update` merges instead of overwriting: components keep the position and size
a human gave them, notes and hand-drawn shapes survive, and re-running it with
an unchanged model changes nothing. Plain `file scaffold` on an existing board
overwrites it — use `--update` on any board a human has opened.

The skill reports the sync state of the pair as its own `board-sync` claim, so a
model committed without re-rendering the board shows up in CI instead of rotting
quietly.

## Try it locally

Nothing to clone — scaffold a board from a two-component model and read it back:

```bash
cat > /tmp/model.json <<'EOF'
{ "title": "demo — architecture", "documentId": "demo-architecture",
  "components": [{ "name": "web ui", "kind": "web" }, { "name": "api", "kind": "api" }],
  "edges": [{ "from": "web ui", "to": "api", "relation": "calls" }] }
EOF
npx -y @phuc-nt-prime/mywb file scaffold /tmp/model.json /tmp/architecture.mywb
npx -y @phuc-nt-prime/mywb file read /tmp/architecture.mywb --json > diagram.json
# hand diagram.json + SKILL.md to your agent, or eyeball it:
npx -y @phuc-nt-prime/mywb file read /tmp/architecture.mywb
```

`examples/ci-drift-check/sample-board.json` seeds a richer demo board (with
deliberate drift bait) through `node apps/cli/dist/make-fixture.js` from a
my-whiteboard checkout — it is a fixture builder, not a published command.

## Vendoring the CLI into your repo

Not needed in most cases: point the workflow at `npx -y @phuc-nt-prime/mywb`, which pins a
version in your lockfile like any other dependency. Vendor only when CI has no
npm registry access. The bundle is a directory, not a single file — `cli.js`
loads sibling chunks from `assets/` — so copy the whole `dist/`:

```bash
# from a my-whiteboard checkout, after `npm ci && npm run build -w apps/cli`
mkdir -p <target-repo>/tools/mywb
cp -R apps/cli/dist <target-repo>/tools/mywb/dist
cp examples/ci-drift-check/SKILL.md <target-repo>/tools/mywb/drift-skill.md
```

A vendored copy needs no `npm install`: `file read`/`file apply` are
self-contained (the MCP SDK is loaded lazily and only the `mcp` subcommand
touches it). Point the workflow at `node tools/mywb/dist/cli.js`. The `mcp`
subcommand is the exception — it needs the SDK from `node_modules`, so it is not
available from a vendored copy; drift-check only uses `file read`/`file apply`.

## Requirements & limits

- Node ≥ 22.5 (`node:sqlite`).
- Record-level access only — no editor semantics, no exec.
- No file locking: don't point `file apply` at a board that a desktop app is
  actively saving. CI reading a committed file is always safe.
