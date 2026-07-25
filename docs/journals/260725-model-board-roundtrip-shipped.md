# Model ⇄ Board Round-Trip: The Diagram Stops Being a Dead End

**Date**: 2026-07-25 08:12–11:27
**Severity**: N/A (feature stage) — but 3 real bugs and 12 real diagram omissions came out of it
**Component**: `@mywb/core` (model schema), `packages/node-adapter/src/headless-document/` (extract + update), `apps/cli` (`file model extract`, `file scaffold --update`), `examples/ci-drift-check/SKILL.md`
**Status**: Shipped — 5/5 phases, 219/219 unit tests, typecheck clean, 9 commits on `feat/model-board-roundtrip` (unpushed)

## What Shipped

Before this stage, `file scaffold` was a one-shot generator: model JSON in, board out, and the JSON was throwaway. The board became the only artifact — a binary zip nobody can review in a PR, and regenerating it destroyed every layout tweak a human had made. So the diagram drifted, exactly like the drift-check skill was built to detect but could not fix.

Now the model is the committed artifact (`docs/architecture.model.json`) and the loop closes:

- `file model extract <board> <model>` — board → model. Reads back through the same shape semantics the skill documents, so extract ∘ scaffold is the identity.
- `file scaffold <model> <board> --update` — model → an *existing* board, as a merge, not a rewrite.
- Drift-check v3 loads the model (2.4 KB) instead of full board JSON (39 KB of records), and gained a mechanical `board-sync` claim: `extract + normalized diff`, no LLM inference.

**The ownership contract is what makes `--update` safe.** The model owns service-nodes, frames named after a model group, the `shape:title-` text, and arrows connecting two declared components. Everything else on the canvas is the human's and is copied through verbatim, `parentId` included. Kept cards keep the position and size a human gave them.

`updateBoardFromModel` returns a `RecordChanges` set for `applyRecordChanges` rather than writing a new archive. That path validates against the app's own store schema, checks dangling `parentId` and binding endpoints, and preserves `assets/` + `script/` — all of which a fresh archive write loses (it also mints a new `createdAt`).

## The Brutal Truth

**Every single one of the three phase-2 bugs came from a real board. Not one came from the 23-test matrix I wrote for that phase.**

The reason is structural, not sloppiness: every fixture is *freshly scaffolded*, so it has prefixed ids and dagre-computed positions. A committed board is older and hand-arranged. Those two populations differ in exactly the ways the merge logic cares about.

1. **Duplicate arrows** — the real board's arrows predate the id-prefix convention, so the "is this arrow mine?" check missed them and added a second copy of every edge.
2. **Negative coordinates** — a card moving between groups got re-derived against the wrong frame origin and landed off-canvas.
3. **Overlap on new nodes** — adding `VS Code extension` placed it at `(80, 100)`, exactly on top of `@mywb/node-adapter`. Two cards drawn on top of each other read as one, so the new component looked like it was never added.

Bug 3 is the interesting one because it is not a coding error — it is a **consequence of the ownership contract**. Rules 1 and 2 make the board diverge from the layout dagre just computed: a hand-arranged card holds coordinates dagre knows nothing about and can be sitting exactly where a new node's slot is. The fix (`occupied` / `freeSlot` / `NUDGE_GAP`) slides a new node straight down its dagre column, preserving the column because that column is how dagre expressed the component's rank.

I wrote the test first and confirmed it failed (`["ui/cli"]`) before fixing. Then **the real board still showed the overlap** and I briefly read that as the fix not working. Real cause: the CLI runs `apps/cli/dist/cli.js`, a built bundle. Source edits in `packages/node-adapter` change nothing until `npm run build -w apps/cli`.

## What Dogfooding Measured

Three repos, drift-check v3 at scope `full`, 84 claims:

| Repo | ok | drifted | unverifiable |
|---|---|---|---|
| my-whiteboard | 21 | 1 | 0 |
| my-db-mate | 19 | 3 | 1 |
| my-crew | 27 | 8 | 4 |

**Zero declared claims were wrong.** Every component and edge that had been drawn verified against the code. All 12 findings were *omissions* — dependencies the code has and the hand-drawn diagram simply never showed:

- **my-whiteboard** (1 claim, 2 things): the VS Code extension was missing as a component entirely, and `mywb CLI → desktop app` — a POST to `127.0.0.1:${port}` with the launch bearer token — was undrawn.
- **my-db-mate** (3): eight route handlers under `connections/[id]` import `db/client` and run Drizzle queries inline instead of going through the Services Layer; the accelerator refresh handler builds its own connection provider; and `db/[id]/layout.tsx` is an async Server Component that `await getConnection(...)` with no HTTP hop — bypassing the whole `Web UI → API Routes → Services Layer` chain the diagram draws.
- **my-crew** (8): the sharpest was `AgentRuntime Backends` having **no inbound edge at all**, reading as a floating component, when the worker resolves a backend for every step through `runtime_backends.protocol`. Also: 12 server modules import `my_crew.runtime` at top level, 6 route modules invoke agent-graph entry points on the request path, ops-chat constructs an `ActionGateway` itself, and the modelled `runtime → agent` edge is bidirectional in code.

This is the failure mode the whole moat argument rests on: **the diagrams were not wrong in shape, they were incomplete in a way a human reviewer's eye does not catch.** Nobody looks at a box and asks "does anything point *into* this?"

All 12 were re-verified by hand at multiple call sites before I touched a model — I did not take the agents' word for it. Then fixed **through the model**, never by drawing on the board, and `--update` left every card at its prior coordinates on all three repos. `board-sync` returned `ok` everywhere afterward.

## What the Runs Did to the Skill

Three real runs found five gaps in `examples/ci-drift-check/SKILL.md`. The runs were the test; review had not found these.

**1. The false-negative that reads as drift.** An unquoted `grep -r --include=*.ts` makes zsh fail the entire command with `no matches found`, so nothing pipes into `wc -l` and it prints `0`. That `0` is indistinguishable from "this dependency does not exist" — and it was about to become a `drifted` verdict. Step 2 now demands quoted globs, an exit-status check (or the Grep tool), and confirmation of any negative from a second angle before reporting it.

I hit this trap myself, twice. Once on `apps/vscode` with an unquoted `--include`, and once on my-db-mate searching for `from '@/db'` when that repo uses relative imports — returned 0 files, when the truth was 8.

**2. The reverse-edge check had no threshold**, so each run invented its own and the verdicts were not reproducible. Split into two ordered filters: *(a) runtime at all?* (excludes dev-only manifest entries, test/e2e-only, `import type` / `if TYPE_CHECKING:`, and comment/docstring/string matches — grep counts the last two happily) and *(b) structural?* (`drifted` when top-level, multi-site, or on a request/job path; `unverifiable` when it is a single lazy call site inside one function). Mirrors the existing frame rule's "when unsure, `unverifiable`".

**3. Exclusion examples were JS/TS-only**, missing `if TYPE_CHECKING:` and docstring matches — a real gap given my-crew is Python.

**4. A `repoUrl` pointing at a generated or gitignored path** flipped to `drifted` in CI and back to `ok` on a developer machine. That measures the checkout, not the architecture. Now: verify against the config default that declares it.

**5. `run.base` was undefined on a full-scope run**, and a group sharing its name with one of its own members had no ruling (it is redundant modelling, not drift — the code cannot contradict it).

## What Went Sideways

**`file read --json` cost me three wrong queries.** The shape is `{metadata, schemaJson, records}` where `records` is a **list** of `{id, typeName, record}` wrappers — the payload is nested under `.record`. I assumed a flat shape list, then a dict, before dumping one record's keys. A related miscount (30 "arrows") came from `type === 'arrow'` also matching bindings; counting arrows needs `typeName === 'shape' && type === 'arrow'`.

**I built my own false alarm.** My overlap check on the updated my-db-mate board reported three colliding pairs. Cause: nodes inside a frame use frame-relative coordinates while nodes on the page use absolute ones, and I was comparing across the two systems. My *before* check had filtered on `parentId`; my *after* check dropped that filter. Same class of error as the grep trap — a check that looks like it found something when it is actually broken.

**The SVG was stale and the test suite was fine with it.** `apps/desktop/e2e/generate-architecture-svg.spec.ts` only writes `docs/architecture.svg` under `MYWB_WRITE_SVG=1`, and asserts only that service-node *names* appear. So `npm run e2e` went 30/30 green against a stale file. **Arrow relation labels are protected by no test at all** — worth fixing.

**Note validator quirk**: `props.textLastEditedBy` must be present as `null`, not omitted. `file apply` rejected the dogfood sticky note until I set it. The validator catching this is the intended behavior — that is the whole point of routing updates through `applyRecordChanges`.

## Lessons Learned

1. **Fixtures and real artifacts are different populations.** Freshly-scaffolded fixtures share properties (prefixed ids, dagre positions, no human edits) that committed boards do not. A merge feature tested only on fixtures is tested on the easy half of its input space. 3/3 bugs found this way is not a coincidence.

2. **A search that errors and a search that finds nothing look identical downstream.** `wc -l` prints `0` either way. Any negative result about to become a verdict needs an exit-status check or a second angle. I documented this in the skill and then tripped over it twice more in the same session — the guard is not paranoia.

3. **Verify a check before trusting what it says it found.** The overlap false alarm and the grep false negative are the same mistake pointed in opposite directions. A check comparing frame-relative to absolute coordinates reports collisions confidently and is meaningless.

4. **The build boundary bites when the CLI runs a bundle.** Source edits in a workspace package are invisible to `node apps/cli/dist/cli.js` until rebuild. I briefly concluded a working fix had failed.

5. **Omission is the drift humans cannot see.** 84 claims, 0 wrong, 12 missing. Reviewers check whether what is drawn is true; nobody audits what is absent. That asymmetry is the argument for the mechanical check.

6. **Treat agent process complaints as findings about the tooling.** The reverse-edge check being non-reproducible was the highest-value concern of all three runs, and it arrived as a complaint about the instructions, not as a drift result. One agent also misremembered a detail (claimed the skill's own examples used unquoted `--include`); I checked before acting. Both halves matter.

## Next Steps

1. ✅ Phases 1–5 complete; plan `plans/260725-0812-model-board-roundtrip/` marked completed.
2. ✅ 12/12 omitted edges fixed through models on all three repos; `board-sync` ok everywhere.
3. ✅ Docs: `system-architecture.md` (round-trip section + ownership contract), `codebase-summary.md`, `project-roadmap.md` stage entry.
4. ⏳ Push `feat/model-board-roundtrip` (9 commits, working tree clean).
5. 📋 External repos: model fixes sit on local `feat/architecture-model` branches (my-db-mate `3f9bc4d`, my-crew `01373ab`). Landing them is each repo owner's call (user decision).
6. 📋 Backlog: arrow relation labels have no test coverage — the SVG spec asserts node names only, and only writes under `MYWB_WRITE_SVG=1`.

## Unresolved

- **`API Routes → LLM Service` (my-db-mate)** — left `unverifiable`, not added. `llm-service.ts` lives inside the Services Layer that API Routes already legitimately depends on, so whether this is a distinct architecture edge or an instance of the existing one is a modelling judgement the code cannot settle.
- **Self-referencing group in my-db-mate** — a frame named `Services Layer` surrounds a card of the same name, so extract emits a group containing itself. Round-trip is exact and tldraw accepts frame-as-parent of a same-named card, so nothing is broken; changing the drawing is the board owner's call.

---

**Status**: DONE
**Summary**: Model ⇄ board round-trip shipped — the architecture model is now a committed, diffable artifact and `scaffold --update` merges an edited model into an existing board without losing human layout, sizes or notes. Drift-check v3 reads the model (2.4 KB vs 39 KB) and gained a mechanical `board-sync` claim. Dogfood on 3 real repos found 3 merge bugs unit tests structurally could not (fixtures are freshly scaffolded, real boards are hand-arranged) and 12 omitted runtime edges with 0 wrong declared claims — omission is the drift human review misses. Three runs also exposed 5 gaps in the skill, sharpest being an unquoted `--include=*.ts` whose zsh failure produces a `0` indistinguishable from "no such dependency". All 12 edges re-verified by hand and fixed through the models, never by drawing on boards.
