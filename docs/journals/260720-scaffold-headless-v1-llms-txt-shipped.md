# Scaffold headless v1 + llms.txt: Shipped, Quiet, On-Spec

**Date**: 2026-07-20 09:18–09:50
**Severity**: Low (feature delivery, no regression, no incidents)
**Component**: CLI (`mywb file scaffold`), node-adapter, agent API
**Status**: Completed

## What Happened

Three phases shipped on schedule. The `mywb file scaffold <model.json> <out.mywb>` command now exists, converts model JSON into a valid board file with nodes laid out by kind, bindings capturing 2-cardinality metadata, and arrows tracking relations. The board passes schema validation through the real store path, no mocks. Separately, `llms.txt` landed at repo root (llmstxt.org format) with a new agent API route `GET /llms.txt` returning the spec unauth in text/plain. Both text routes now declare `charset=utf-8` explicitly. Code review found zero blockers; two LOW items were applied (kind validation strengthening, charset fix). Two more LOW findings noted but not actioned: overwrite behavior matches the archive-writer contract; O(n²) in the snapshot loop is harmless at board scale.

## The Calm Truth

This was just work finishing. No surprises. No firefighting. The generator prototype (~100 lines, built by hand for the moat-proof research stage) translated directly into a clean `buildBoardFromModel` function in `packages/node-adapter/src/board-scaffold.ts`. Tests wrote themselves from the contract. The CLI subcommand wired up in `apps/cli` without friction. The llms.txt spec fitted into the existing doc and route patterns. Everything ran green on first try except charset, which was a hunt-and-replace across two files.

The absence of drama is itself notable. In this stage, we were not building what we guessed users needed. We were building what we had *just used* ourselves to get real work done (drafting boards for my-db-mate and my-crew). That alignment—dogfood matching the feature—meant fewer surprises.

## Technical Details

**buildBoardFromModel** extracts the generator logic into reusable form:
- Input: model JSON with `components[{name, kind, repoUrl?, ownerTeam?}]`, `edges[{from, to, relation}]`, optional title.
- Output: board file via `write-mywb-archive` (shared with fixture-builder, contract preserved).
- Nodes layout in four horizontal bands by kind (service, data, queue, other).
- Arrows bind each edge with cardinality 2 and `meta.relation` storing the model relation string.
- Errors are named (duplicate component, dangling endpoint, unknown kind).
- My-db-mate model (9 components, 9 edges) → 19 shapes, 18 bindings; matches the hand-drafted board from this morning.

**mywb file scaffold** (`apps/cli/src/commands/file-scaffold.ts`):
- Route registration, USAGE doc, 3 integration tests on vendored dist.
- Tests confirm it runs from the built CLI without node_modules.

**llms.txt**:
- Repo root follows spec at llmstxt.org.
- Agent API route at `GET /llms.txt`, unauth (same trust as `/readme`).
- Template drift-check documentation added "Bootstrap a board" section.
- Both text routes now declare `charset=utf-8` in Content-Type headers (fixed a Unicode edge case).

**DRY extraction**:
- `write-mywb-archive.ts` moved from fixture-builder into shared `packages/node-adapter/src/io/`, both paths import it.
- Fixture-builder contract unchanged; only import path shifted.

## Gates

- **Typecheck**: 0 errors, full workspace.
- **Unit tests**: core 52 pass, node-adapter 37, desktop 17, cli 13, relay 6.
- **E2E**: agent-api 6/6 (including new llms.txt case), mcp 4/4.
- **Code review**: 0 blockers; 2 LOW applied (kind validation + charset fix); 2 LOW noted without action (overwrite target mirrors archive behavior—consistency is intentional; O(n²) snapshot loop vã board size is OK, avoid false "optimization" that breaks index invariant).

## What We Tried

No failed attempts. The hand-written generator from the moat-proof research session contained the shape of the solution. Translation to code was straightforward. Charset fix found during integration testing (route returns text without declaration); fixed in `GET /readme` and `GET /llms.txt` in one sweep.

## Root Cause Analysis

No failure, so no root cause. The reason work flowed smoothly: **feature spec came from lived experience, not speculation**. We spent the moat-proof morning manually drafting boards for two real repos, hit the pattern, coded it up now. No guessing about what the JSON schema should be. No redesign cycles. The spec was the working prototype.

## Lessons Learned

1. **Dogfood surfaces the right abstraction.** When you use code you're about to build, the feature emerges from necessity, not imagination. The 100-line generator was rough but *correct* because it solved an actual problem we were solving in real-time. Rewriting it clean was fast and boring—exactly what you want.

2. **Pre-work becomes feature, not waste.** The moat-proof stage forced us to manually scaffold boards before coding the scaffolder. That manual work was not prep; it *was* the feature shape. Once we saw the pattern, the CLI emerged. This beats spec-first by a wide margin when the domain is unfamiliar.

3. **Quiet delivery is not boring.** Tests passing, gates clear, review 0 blocker, no incidents—this is the state you want to ship from, not the exception. When feature delivery feels like friction, something in the process is broken. This one didn't.

## Next Steps

- Commits b1c6d8d and 1e3cf03 pushed to main (signatures clean, tests locked in CI).
- Moat-proof Phase 1 (dynamic import for MCP CLI) can unblock on this delivery.
- `llms.txt` now available for agent-docs scanning (drift-check template references it).

---

**Status**: DONE
**Summary**: `mywb file scaffold` and `llms.txt` shipped on-spec. Feature came from dogfood, tests green, review clean. No incidents.
