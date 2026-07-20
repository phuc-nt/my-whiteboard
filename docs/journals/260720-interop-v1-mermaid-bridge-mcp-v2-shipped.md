# Interop v1 (Mermaid bridge) + MCP v2: Export-Only Determinism, Tool Payload Shape, Field-Presence Discipline

**Date**: 2026-07-20 10:49–12:10
**Severity**: Medium (interop, enables diagram-as-code workflows + MCP surface)
**Component**: Core mermaid-export, CLI, MCP tools (scaffold_board + read_shapes detail), README
**Status**: Completed, commits c16703c + a48835b pushed origin/main

## What Happened

Three phases delivered: core mermaid-export module (flowchart + c4 deterministic, escape handling, 11 unit tests), CLI `mywb file mermaid` + README embed with regen-from-board workflow, and MCP v2 scaffold_board + read_shapes summary detail parameter. Implementation done. Review caught 3 blocking concerns (H1 relation label injection, M2 dead summary.text field, M3 undeclared edge target nodes). All blocking fixed. Gates: typecheck 0, 138 unit tests (core 62, node-adapter 37, desktop 17, cli 16, relay 6), e2e mcp 6/6 (3 new cases), agent-api 6/6. README diagram byte-identical, tooling passes.

## The Honest Assessment

This delivery holds two good insights and one hard lesson about contracts.

The first insight is architectural: **mermaid IMPORT never needed a parser**. The task framing originally felt like "we need bidirectional mermaid sync," but the actual problem is "how do agents describe boards deterministically?" Incoming mermaid is just a teaching example—a recipe showing how an agent can read a diagram, translate it to our model JSON, then scaffold a board. No parser needed. Export is the real contract: records → string, deterministic, no random UUIDs, quoted labels, ordered fields. This is the opposite of import. Shipping export-only was the right call.

The second insight is practical: **core mermaid-export + boundary enforcement works**. By placing the export logic in `packages/core/src/mermaid-export/` and forcing the CLI to call it—not implementing export in CLI itself—we made one source of truth unchallengeable. The README diagram is regenerated from the same code path. This prevented a split implementation (one in core, one embedded in docs, one in scripts). Single path, deterministic, testable.

The hard lesson is about **field-presence discipline in tool contracts**. The review found that `read_shapes` summary was promising a `text?` field, but tldraw shapes don't have a flat `text` property—they use `richText`, which is structured. The summary payload had a dead field. This is worse than not having the field. A field that's always undefined or always ignored breaks the contract in a silent way: callers see it in the schema, expect to use it, and find it useless. The fix was to flatten richText to plaintext via a new `richTextToPlainText` export from core—making the field real. The lesson: **if a field is in the tool's output schema, it must have a reachable code path that populates it. Dead fields corrode trust in the contract**.

## Technical Details

**Core mermaid-export** (`packages/core/src/mermaid-export/`):
- `exportBoardToMermaid(records, {syntax: "flowchart" | "c4"})` → deterministic string
- Flowchart: 8 kinds mapped to `classDef` + per-node `class` directive; C4: db→SystemDb, queue→SystemQueue, others→System with kind in description
- Edges: arrows from bindings + relation labels; orphaned arrows and cross-boundary arrows (pointing to non-service-nodes) filtered without throw
- Escape: relation labels wrapped `-->|"..."|`, quotes become `#quot;`, newlines become spaces
- Code-ref annotations: `%% code-ref: path:line` comments preserved
- 11 unit tests covering happy path, special chars (`, ", newline, <, >, &, |), kind mapping, orphan filtering

**CLI** (`mywb file mermaid <board> [--syntax flowchart|c4]`):
- 3 integration tests (dist), bad syntax exit code 2
- README: `docs/architecture.mywb` exported as flowchart, regen via one-liner in docs, byte-identical verification in test

**MCP v2**:
- Tool 6 `scaffold_board`: {model, targetPath} → headless buildBoardFromModel (no app open, file-op pure) → {target, components, edges}; model validation yields friendly isError
- `read_shapes` added `detail?: "summary" | "full"` param (default full for backward compat, all 4 e2e old cases pass byte-identical)
- Summary item: {id, type, name?, text?, x, y, w?, h?} with text flattened from richText via new `richTextToPlainText` core export
- Docs updated in 5 spots (5-tools → 6-tools)

## What We Tried

Reviewer DONE_WITH_CONCERNS → 3 blocking:

1. **H1 — Relation label injection**: Mermaid flowchart relation label (e.g. `reads`, `writes`) not escaped; input `reads|writes "fast"\n now` would break flowchart syntax. Fix: label quoted in template `-->|"label"|` + escapeLabel helper (quotes → #quot;, newlines → space). Test case `reads|writes "fast"\n now` added.

2. **M2 — Dead summary.text field**: `read_shapes` summary schema promised `text?` field, but tldraw shape objects don't have flat text—only richText. Field would always be undefined or null, breaking caller expectations. Fix: exported `richTextToPlainText(richText)` from core (DRY, reuse in export module too), flatten summary text before returning. Field now reachable.

3. **M3 — Edge references undefined nodes**: Edges in summary could reference shape IDs that weren't included in the summary (e.g., edge crosses service-node boundary). Undeclared node refs break downstream tooling. Fix: filter edges against Set of declared shape IDs; test confirms.

Non-fixes (accepted by design):
- `--syntax` is global option (consistent with `--json` pattern in CLI)
- NodeId collision on `-` ↔ `_` escaping: low probability, acceptable
- C4 output render-verify deferred (C4 is intentional approximation per plan; flowchart verified on README push)

## Root Cause Analysis

The dead-field mistake happened because the schema was written before the implementation detail was pinned. We promised `text?` in summary output, but only after implementation realized tldraw doesn't expose flat text. Instead of either (a) removing the field or (b) committing to populate it with a helper, the code path left it unimplemented. This is the cardinal sin of tool contracts: **a promised output field that's never populated is worse than not promising it at all**, because callers waste time debugging a None/null value that's supposed to be there by the schema.

The relation label injection was textbook: user-supplied content (relation label, not controlled by board owner) went into mermaid syntax without escaping. The template `-->|${label}|` was naive. This is a standard injection vector (markdown/mermaid/sql all have it).

The edge-to-undefined-node issue reflected missing validation: we built the summary payload without cross-checking that every reference in the output was self-contained. A payload that references external IDs isn't portable.

## Lessons Learned

1. **Export is not import.** Mermaid IMPORT is a teaching recipe, not a parser contract. Agents can learn to translate mermaid → JSON; we don't need to automate it. Export, by contrast, is ours: deterministic, quoted, boundary-gated in core. Don't conflate the two.

2. **Boundary enforcement prevents drift.** By housing export in core and forcing CLI to call it, we made one source of truth unavoidable. The README diagram is regenerated from the same path as unit tests. This discipline prevents split implementations.

3. **Field-presence is a contract liability.** If a field appears in the tool schema output, it must have code that reaches and populates it. Dead fields (always None, always ignored) corrode trust faster than missing fields. Audit tool contracts: every promised field should have a test that asserts it's present and meaningful.

4. **User-supplied content in syntax languages needs escaping.** Relation labels, node names, descriptions—anything that comes from the board shape or relation metadata—is user input. Escape before embedding in mermaid/c4/markdown. Test with hostile input (pipes, quotes, newlines).

5. **Self-contained payloads matter.** A summary that references external IDs (e.g., edge→shapeId not in shape list) isn't portable. Validate that output is a closed graph: every reference should resolve within the payload itself.

## Next Steps

1. ✅ Commits pushed: c16703c (mermaid-export core) + a48835b (CLI + MCP). Origin/main updated.
2. ✅ Gates clear: typecheck, 138 unit (all suites), e2e mcp 6/6 agent-api 6/6, README byte-identical.
3. Backlog: D2/Structurizr export (out-of-scope v1), MCP resources, full mermaid parser if diagram-sync becomes real (not needed yet).
4. Unblock: Phase 5 (Moat proof diagram-as-review-ci) can assume deterministic export surface + MCP tool contract stable.

---

**Status**: DONE
**Summary**: Interop v1 shipped deterministic mermaid export (export-only, no import parser), core boundary-gated CLI + README embed, and MCP v2 scaffold_board + read_shapes summary detail. Review blocked on relation label injection, dead summary.text field, and undeclared edge targets—all fixed. Key lesson: tool contract fields must have reachable code paths; dead fields corrode trust.
