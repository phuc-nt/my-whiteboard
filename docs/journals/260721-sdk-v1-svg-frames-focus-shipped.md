# SDK v1: SVG Export, Frames/Subgraph, Focus Navigation Shipped

**Date**: 2026-07-21 09:00–10:50  
**Severity**: Low (feature delivery on time, no surprises)  
**Component**: SDK surface (exec/app-server/MCP/CLI), board model, rendering  
**Status**: Shipped — commits c6709d9, 250b62e pushed; CI verification run 29799562489 pending

## What Happened

Delivered three independent features (A: SVG export, B: groups/frames, C: focus navigation) that exploit unused tldraw SDK APIs without expanding the platform surface. Brainstorm filtered 9 candidate APIs down to 3 with evidence; 6 deferred to backlog with conditions to reopen. All three phases designed to be code-isolated and testable in parallel. Implementation was sequential (A→B→C) to gate and review each piece. Feature complete as of 10:50 UTC+7.

## The Approach

Started by asking a hard question: which tldraw APIs actually exist in 5.2.5 and can we use them without expanding our surface? Brainstorm document produced 9 candidates. Filtered ruthlessly: SVG export (`getSvgString`), frame utilities, zoom (`zoomToSelection`) had concrete evidence and fit the spec. The rest—pages, signals, custom shape overrides—landed in backlog marked "reopen if product demands, not because we discovered them." YAGNI kept scope tight.

No new surface. All three features ride existing infrastructure: app exec (already async-capable), app-server HTTP, MCP (stdlib tools), CLI. Same gate-and-test model as the rest of the codebase.

## Technical Decisions

**A — SVG Export**: The first risk was custom shapes. tldraw's `getSvgString` call shapes' `toSvg` method. Our service-node and code-ref shapes use HTMLContainer and were never overridden. Hypothesis: SVG export would render them blank. Instead of defending against an unknown, I probed. Launched the app, called `getSvgString`, got back 8.5K valid SVG with all node names rendered. The custom shapes worked. No `toSvg` override needed. **Lesson: probe cheap, defense expensive. Guessing about external APIs costs more time than querying them directly.**

Hooked `getSvgString` into exec (already supports async/await), wired MCP tool `export_svg` and CLI `mywb app svg`. Normalized React's internal `useId` prefix (`_r_N_` → `_r_`) to eliminate drift noise in tracked SVG artifact. Gated SVG write behind `MYWB_WRITE_SVG=1` so default `npm run e2e` stays assert-only and doesn't mutate the tracked tree.

Generated `docs/architecture.svg` from a real board via e2e spec (Playwright launch actual app, agent API call to seed board, SVG export). Not user-hand-drawn. README embeds SVG as primary image; mermaid flowchart moved to `<details>` as headless-verifiable backup. Both regenerate together on regen note.

**B — Groups/Frames**: Scaffold model gains optional `groups` array; each group becomes a frame shape (tldraw `type: 'frame'` with w/h/name/color props) with member nodes parented to it. Member coordinates are frame-relative. Ungrouped nodes keep current kind-row layout and sort after all groups. Deterministic layout: groups fill left side (one column per group, members stacked vertically within frame), orphans fill right.

Guards: member name doesn't exist → named error. Node appears in 2 groups → named error. Mermaid flowchart export: frame → `subgraph <name>...</end>`. Model with no groups → byte-identical output to today (backward-compat proven via diff). MCP `scaffold_board` zod schema updated; CLI `buildBoardFromModel` validates.

**C — Focus Navigation**: Exec snippet does three things: `editor.getShape(id)` check (id exists), `editor.select(id)`, `editor.zoomToSelection({animation})`. Wired into MCP tool `focus_shape` and CLI `mywb app focus`. Shape doesn't exist → clear error exit code 1. Verified by reading `editor.getCamera()` before/after (should change translation and zoom).

## Review Resolution

Implementation report flagged four concerns. All addressed:

- **H1 (frame-relative coords)**: Added coordinate assertion in `board-scaffold.test` verifying member x-offset equals frame padding plus stacked-y position. Frame positioning now explicitly tested.
- **M1+M2 (SVG drift, test mutation)**: Unified decision. SVG is a diffable artifact (correct purpose). React `useId` prefix normalized at export time (verified 0 churn on remaining IDs). Write gated behind `MYWB_WRITE_SVG=1` env var so e2e runs don't mutate tracked tree.
- **L1 (tool count docs)**: `codebase-summary.md` "6 tools" → "8 tools" (added `export_svg`, `focus_shape`; removed placeholder `list_boards`).
- Reviewer verified: no MCP index collisions, no subgraph double-declaration, backward-compat byte-identical diff-proven, error surfacing correct.

## Verification

- **Typecheck**: 0 errors across core/node-adapter/cli/app.
- **Unit tests**: core 64, node-adapter 41, cli 17 = **122 total**, all pass.
- **E2E**: 29/29 desktop tests on actual Electron app + actual agent API + actual MCP SDK client. Includes new specs for SVG export, focus navigation, group scaffold.
- **Backward-compat**: Model without groups produces identical mermaid/c4 output.
- **Real data**: SVG probed from live board, export validated on running app, focus verified by reading camera state before/after, groups tested with scaffold board of 5 nodes/2 groups yielding 11 shapes + 2 subgraphs + cross-group edges correct.

## Out of Scope (Backlog)

Pages, C4 boundary syntax verification, custom frame tools, UI overrides, rich text, tldraw sync, signals. Frame-membership drift-detection (gated decision: revisit if product feature demands, not because we discovered it).

## Next Steps

1. ✅ Code and commits done (c6709d9, 250b62e).
2. 🔄 CI verification run 29799562489 in progress — will confirm Linux/macOS parity on gates.
3. ⏳ Feature available once CI passes.

---

**Status**: DONE  
**Summary**: Delivered SDK v1 features (SVG export, frames/groups, focus navigation) by probing uncertain tldraw APIs before building defense, normalizing SVG artifacts, and testing with real data on actual runtime. All concerns resolved; backward-compat preserved; 122 unit + 29 e2e gates passing locally.
