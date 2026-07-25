# Skill: Diagram drift-check for My Whiteboard boards

You are checking whether an architecture diagram (a `.mywb` file) still matches
the codebase it describes. You get the diagram as structured data — never
screenshots.

## Getting the data

First look for a **model file** next to the board: same basename, `.model.json`
extension (`docs/architecture.mywb` → `docs/architecture.model.json`). It holds
the same architecture claims as a few dozen lines of JSON instead of a few
thousand records, so read it when it exists.

```bash
# A function, not a variable: `MYWB="node …/cli.js"` then `$MYWB` fails in zsh,
# which treats the whole string as one command name instead of splitting it.
# monorepo path below; a repo vendoring the built dist uses tools/mywb/dist/cli.js
mywb() { node apps/cli/dist/cli.js "$@"; }
BOARD=docs/architecture.mywb
MODEL="${BOARD%.mywb}.model.json"

if [ -f "$MODEL" ]; then
  # Model-first path. Also confirm the board still matches the model (below).
  cat "$MODEL"
else
  # Fallback: no model file (older repo) — read the board itself.
  mywb file read "$BOARD" --json > diagram.json
fi
```

**Model shape** (the claims source on the model-first path):

```json
{
  "title": "…", "documentId": "…",
  "components": [{ "name": "web app", "kind": "web", "repoUrl": "apps/web", "ownerTeam": "…" }],
  "edges": [{ "from": "web app", "to": "core", "relation": "imports" }],
  "groups": [{ "name": "packages", "members": ["core", "node-adapter"] }]
}
```

It maps one-to-one onto the shape semantics below: a `component` is a
`service-node`, an `edge` is an arrow, a `group` is a `frame`. `repoUrl` and
`ownerTeam` are absent rather than `''` when unset. Claim ids on this path are
`component:<name>`, `edge:<from>-><to>`, `group:<name>` — the model has no shape
ids, and ids must be stable across runs.

**Board JSON shape** (fallback path): `{ metadata, schemaJson, records: [{ id,
typeName, record }] }`. Records with `typeName: "shape"` are canvas shapes;
`record.type` tells you which kind. Claim ids are the shape ids.

### board-sync: verify the model still describes the board

On the model-first path, the model is only trustworthy if the board it stands
for still matches it. That check is mechanical — never reason about it:

```bash
mywb file model extract "$BOARD" - > /tmp/board-model.json
# `// []` normalises an absent `groups` key against an empty one, and `sort_by`
# makes the comparison independent of the order either side happens to list in.
norm='{components: (.components | sort_by(.name)),
       edges: (.edges | sort_by(.from, .to, .relation)),
       groups: ((.groups // []) | sort_by(.name) | map(.members |= sort))}'
diff <(jq -S "$norm" "$MODEL") <(jq -S "$norm" /tmp/board-model.json)
```

Report the result as one extra claim with `type: "board-sync"` and id
`board-sync`: exit 0 → `ok`; a diff → `drifted`, with the diff summarised in
`note` (which components/edges differ) and both file paths in `evidence`. A
`drifted` board-sync means someone edited the board without re-extracting the
model, or edited the model without running
`file scaffold "$MODEL" "$BOARD" --update`. Say which side is ahead if the diff
makes it obvious; do not guess if it does not.

If `jq` is unavailable, diff the two JSON files directly and treat key-order
noise as `ok` — only differing components/edges/groups count. If `model
extract` fails, the board-sync claim is `unverifiable`, and the rest of the run
continues on the model.

## Shape semantics

- **`service-node`** — one service/system. `record.props`:
  - `name` — service name as the diagram claims it
  - `kind` — one of `api | db | queue | cron | web | lib | app | tool`
  - `repoUrl` — repository or module the service is supposed to live in ('' if unset)
  - `ownerTeam` — owning team ('' if unset)
- **`code-ref`** — a pointer into code. `record.props`: `repo`, `path`,
  `lineStart`, `lineEnd`, `sha`. Drift if the file/range no longer exists or
  the content moved substantially since `sha`.
- **`mermaid-block`** — embedded mermaid `source`; treat its nodes/edges as
  claims too when relevant.
- **Arrows/bindings** — plain tldraw arrow shapes and `typeName: "binding"`
  records connect shapes; an arrow from service A to service B reads as "A
  calls/depends on B". Match endpoints via the binding records' shape ids.
- **`frame`** — a subsystem grouping. `record.props.name` is the subsystem
  name; the service-nodes with `parentId` equal to the frame's id are its
  members. The claim is "subsystem &lt;name&gt; consists of {member names}".

## Scoping (step 0)

Decide which claims to actually evaluate before reading any code:

- If the environment provides `BASE_REF` (CI pull request): run
  `git fetch origin "$BASE_REF" --depth=1 && git diff --name-only "origin/$BASE_REF"...HEAD`.
  - **If the board file OR the model file is among the changed paths, escalate
    to `scope: "full"`** — someone edited the diagram, so every claim it makes
    must be re-checked. This overrides the per-claim rules below.
  - Otherwise a claim is **in scope** when the changed paths touch it: a
    `service-node`'s `repoUrl` directory (when `repoUrl` is not a
    repo-relative path — e.g. a URL — match by component name instead), a
    `code-ref`'s `path`, or either endpoint of an edge. Everything else gets
    `status: "skipped-out-of-scope"` — still listed in `claims` (so coverage
    is countable), never evaluated.
  - The reverse missing-edge check (step 3) is also diff-scoped: only look
    for omitted dependencies involving the changed paths, do not full-scan.
- No `BASE_REF` (local run): scope is `full` — evaluate every claim.
- Keep `claim` and `note` free of `|` and newlines — they render into a
  markdown table.

## Drift procedure

1. Collect claims.
   - Model-first path: every `component`, `edge` and `group` in the model, plus
     the one `board-sync` claim. The model has no `code-ref`s; if the board also
     carries `code-ref` shapes you want checked, read the board with
     `file read --json` in addition and add them as claims with their shape ids.
   - Fallback path: parse `diagram.json` and collect every `service-node`,
     `code-ref`, `frame`, and arrow-implied edge.
   Then apply scoping (step 0). The `board-sync` claim is never out of scope —
   it is cheap and it is what tells you the rest of the data is current.
2. For each in-scope claim, look for evidence in the repository
   (Grep/Glob/Read). **Never conclude "no evidence" from a single failed
   search.** A search that errors and a search that finds nothing look almost
   identical, and the difference decides between `ok` and a false `drifted`:
   - Quote glob arguments: `grep -r --include='*.ts'`, not `--include=*.ts`.
     Unquoted, zsh expands it against the current directory, fails with
     `no matches found`, and pipes nothing into `wc -l` — a `0` that reads
     exactly like "this dependency does not exist".
   - Check exit status, or use the Grep tool instead of shell `grep`, when a
     count of `0` is about to become a `drifted` verdict.
   - Confirm a negative from a second angle before reporting it: the manifest
     (`package.json`, `pyproject.toml`, `go.mod`) *and* an import search.
   Evidence to look for: service names in code/config/deploy files, `repoUrl`
   paths existing, `code-ref` files and line ranges (content moved
   substantially since `sha` counts as drift), called services actually
   referenced. A `repoUrl` naming a path that is generated or gitignored (a
   runtime data directory, a build output) is **not** drift just because a fresh
   checkout has not created it — verify it against the config default that
   declares it and say where in `note`. Otherwise the claim would flip to
   `drifted` in CI and back to `ok` on a developer machine, which measures the
   checkout, not the architecture. For a `frame` claim (a `group` on the model-first path — same
   semantics, `members` are component names), check that its members' `repoUrl` paths
   share a subsystem — i.e. sit under a common directory root. Members
   scattered under a shared root are `ok`; one member whose `repoUrl` sits in
   a clearly unrelated tree is `drifted` (it likely belongs to another
   subsystem); a member with no `repoUrl` is `unverifiable`. A subsystem may
   legitimately span a few directories, so only flag a member that is *clearly*
   an outlier — when unsure, `unverifiable`. A group that shares its name with
   one of its own members is redundant modelling, not drift: the code cannot
   contradict it, so judge it on member cohesion like any other and say so in
   `note`.
3. Classify each claim: `ok`, `drifted` (evidence contradicts), or
   `unverifiable` (no evidence either way — say so, do not guess).
   Also check the reverse direction — dependencies in the code that the
   diagram omits. Two filters, in order, so the check lands the same way twice:

   **(a) Is it a runtime dependency at all?** Not an architecture edge, never
   drift: dev-only manifest entries (`devDependencies` and their equivalent in
   other ecosystems), anything imported only from tests/e2e/fixtures, type-only
   imports (`import type`, `if TYPE_CHECKING:`), and names that appear only in
   comments, docstrings or strings. Grep matches the last two, so read every hit
   before counting it — a docstring naming a module sits right next to the real
   import of it.

   **(b) Is it structural?** A runtime dependency is only an architecture edge
   when it is load-bearing. Report as `drifted` when it is imported at module
   top level, or from several call sites, or on a request/job path — the shape
   of the system changes if you delete it. Record as `unverifiable`, with the
   evidence, when it rests on a single lazy call site inside one function: that
   reads as helper reuse or a layering smell, and whether it belongs on the
   diagram is a modelling judgement the code cannot settle. Do not guess —
   the same rule as the group check: when unsure, `unverifiable`.

   A dependency mediated by a loader or registry (A resolves B through a plugin
   registry rather than importing it) still counts: the seam is the intended
   mechanism, not an absence. Say so in `note`.

   Report an omitted runtime edge as an extra claim with a fresh id
   (`"missing-edge:<from>-><to>"`). Use the same `-> ` separator as the `edge:`
   ids: component names contain hyphens and spaces, so `missing-edge-a-b` cannot
   be split back into its two endpoints.
4. Write the result as `findings.json` (contract below). Do NOT post
   comments or talk to any API — rendering and publishing are the
   workflow's job, not yours. No findings → all claims `ok`; do not invent
   drift.

## Output contract — findings.json

Write a file named `findings.json` in the working directory containing ONLY
this JSON (no prose, no markdown fences):

```json
{
  "version": 1,
  "board": "docs/architecture.mywb",
  "run": { "scope": "diff", "base": "main", "head": "<git rev-parse HEAD>",
           "startedAt": "2026-07-20T03:00:00Z", "durationSeconds": 42 },
  "claims": [
    { "id": "board-sync", "type": "board-sync",
      "claim": "docs/architecture.mywb matches docs/architecture.model.json",
      "status": "ok", "evidence": ["docs/architecture.model.json", "docs/architecture.mywb"] },
    { "id": "component:web app", "type": "service-node", "claim": "web app lives in apps/web",
      "status": "ok", "evidence": ["apps/web/package.json"] },
    { "id": "edge:cli->core", "type": "edge", "claim": "cli calls core",
      "status": "drifted", "evidence": ["apps/cli/package.json:12"],
      "note": "dependency removed in this PR" },
    { "id": "shape:ghi", "type": "code-ref", "claim": "kind enum at util.tsx:8",
      "status": "unverifiable", "note": "file exists, sha unresolvable" },
    { "id": "shape:jkl", "type": "service-node", "claim": "relay in services/agent-relay",
      "status": "skipped-out-of-scope" },
    { "id": "shape:mno", "type": "frame", "claim": "subsystem 'backend' = api, db, worker",
      "status": "ok", "evidence": ["src/api", "src/db", "src/worker"] }
  ],
  "summary": { "ok": 2, "drifted": 1, "unverifiable": 1, "skipped": 1 }
}
```

Rules: `type` ∈ service-node | edge | code-ref | frame | mermaid | board-sync;
`status` ∈ ok | drifted | unverifiable | skipped-out-of-scope; `summary` counts
MUST match the `claims` array; `evidence` is repo-relative paths (`path` or
`path:line`); `run.scope` is `diff` or `full`, and `run.base` is the base ref on
a `diff` run or `null` on a `full` one — always present, so a consumer can read
it without checking for the key. On the model-first path add
`"model": "<path to the .model.json>"` next to `"board"`, and use the
`component:` / `edge:` / `group:` id form; on the fallback path omit `model` and
use shape ids. Include at most one `board-sync` claim, only on the model-first
path.

## Local pre-push

The same procedure works with a local agent and no CI or API key: read the model
(or the board, on the fallback path), run steps 0-4 with scope `full` (no
`BASE_REF`), and read `findings.json` yourself — anything `drifted` is worth
fixing before you push. Data access is just `cat <board>.model.json` plus the
`board-sync` diff, or `node <cli.js> file read <board> --json` when there is no
model file.

## Creating a board from scratch (when asked to bootstrap)

Prefer `file scaffold` over hand-building records: write a model JSON
(`components` with `name`/`kind`/`repoUrl`, optional `groups` with
`name`/`members` to frame a subsystem, `edges` with
`from`/`to`/`relation`) and run
`node <cli.js> file scaffold model.json <board.mywb>`.

**Commit the model next to the board** as `<board-basename>.model.json`. It is
the reviewable, diffable artifact — a board is a binary zip, a model is a diff
you can read in a PR — and it is what puts future runs of this skill on the
cheap model-first path.

**Importing an existing Mermaid diagram** (e.g. from a README): do NOT look
for a parser — read the mermaid text yourself, translate nodes to
`components` (pick the closest `kind`) and arrows to `edges` (edge label →
`relation`), then scaffold as above. The reverse direction is deterministic:
`node <cli.js> file mermaid <board.mywb>` prints the board back as Mermaid
for docs.

## Updating the diagram (optional, when asked to fix)

**When the change is architectural** — a component added or removed, an edge
changed, a subsystem regrouped — edit the model file and re-render, never patch
records by hand:

```bash
# edit docs/architecture.model.json, then:
node <cli.js> file scaffold docs/architecture.model.json docs/architecture.mywb --update
```

`--update` merges: components keep the position and size a human dragged them
to, and sticky notes or hand-drawn shapes are left untouched. Re-running it with
an unchanged model changes nothing at all, so it is safe to run twice. Never use
plain `file scaffold` on a board that already exists — it overwrites the file
and throws away every human edit. Commit the model and the board together.

If the board is ahead instead (someone moved things in the app and the model is
stale), sync the other way: `node <cli.js> file model extract <board.mywb>
<board>.model.json` and commit that.

**For a non-architectural prop** (a colour, a `code-ref` line range) there is no
patch API. Take the full `record` from `file read --json`, merge your change into
it, then:

```bash
# monorepo: node apps/cli/dist/cli.js  ·  vendored: node tools/mywb/dist/cli.js
node <cli.js> file apply <board.mywb> changes.json
# changes.json: { "put": [<full merged record>], "removed": [] }
```

Invalid records are rejected against the app's own shape schemas and the file
is left untouched — a non-zero exit with the reason on stderr.
