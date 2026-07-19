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

## Requirements & limits

- Node ≥ 22.5 (`node:sqlite`).
- Record-level access only — no editor semantics, no exec.
- No file locking: don't point `file apply` at a board that a desktop app is
  actively saving. CI reading a committed file is always safe.
