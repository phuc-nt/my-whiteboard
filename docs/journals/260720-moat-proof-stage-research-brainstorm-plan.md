# Moat Proof Stage: Research, Brainstorm, Plan — Diagram-as-Review Evidence Run

**Date**: 2026-07-20 04:38–05:00
**Severity**: Medium (strategy + architecture, no regression)
**Component**: roadmap, Stage "Moat Proof" (diagram-as-review CI)
**Status**: Resolved

## What Happened

Post-MCP-server delivery (260720-04:15), three 25min windows: research tldraw ecosystem, brainstorm next stage framing, plan Phase 1–5 with validation. User cut the Gordian knot: **7 stages shipped, claim moat unproven**. We are not building features. We are buying evidence that diagram-as-review (diagram stays in sync with code via agent + CI) is real, or we ship it broken into customers. Picked Frame A: run drift-check CI on two production repos (my-crew, my-db-mate), measure cost and false-positive rate, commit board `.mywb` into each, prove one true drift catch. User deferred license question (tldraw 4.0 $6k/yr) and Stage 2c (exec-remote). Validation sweep found static MCP SDK import at `apps/cli/src/cli-main.ts:8` will fail copy-in-place; chốt dynamic import.

## The Brutal Truth

This session was the clarity we needed but avoided for three days. We shipped 7 stages. Each one worked. TypeScript green, tests green, e2e green. But when you step back and ask "what does the customer actually buy?", the honest answer is: **unproven claim that a diagram in a repo never falls stale because an agent regenerates it on every PR**. 

The frustrating part: we built this on faith. One rehearsal, local, in our own repo, own board. Did not test against repos where code actually diverges, where PRs have real drift, where the agent has to work in a hostile CI environment with no Electron context and quota limits. The relief is that the user saw this and said: stop. Do the hardest thing first. Not the fanciest feature. Get *evidence*.

Running this stage means we might discover the claim is broken in ways we can fix cheaper now than in GA. Or we discover the cost is too high (tokens, false positives pile up). Both are victories. Both beat shipping with no proof.

## Technical Details

**Research findings** (tldraw ecosystem converging on agents-on-canvas):
- tldraw company ships **Agent Starter Kit** (`tldraw/agent-template`), dual-channel context (screenshot + structured shapes), official agent experiment Fairydraw (Dec 2025). They embed agent UI in-app.
- **SDK 4.0 licensing new risk**: production requires license key (~$6k/yr/team commercial, hobby forced watermark). Trigger: "HTTPS + non-localhost + NODE_ENV=production". Electron app in gray zone — must ask tldraw before scaling. We pin 1.13.2; nesting to 4.x locks us in. **User decision: defer.**
- **Stage 3 collab blueprint**: tldraw sync (self-hostable, handles migrations/skew) is the official answer. Don't build own sync.
- **Positioning sharpens**: tldraw = embedded agent in app. my-whiteboard = external coding agent (Claude Code/Codex) + files-in-git + CI. Non-overlapping.

**Brainstorm problem-first triage** (six candidates, three killed):
- Stage 2c (exec-remote + web sandbox) — no evidence it solves user pain yet.
- Stage 3 (collab) — no multi-user demand signal.
- Agent ops vocabulary (align/distribute/stack) — feature-first, violates our pattern (evidence first).
- License clarification — blocker, but user deferred.
- Wireframe kit + issue-card — killed outright.

**User chose Frame A: Moat-proof diagram-as-review**. Evidence repos: **my-crew** (`phuc-nt/my-crew` v0.4.0) and **my-db-mate** (`phuc-nt/my-db-mate` v0.9.0). Not my-dandori; user concrete choice.

**Plan 5-phase structure**:
1. Local rehearsal + CLI vendoring (dynamic import mcp subcommand)
2. Board my-db-mate (dogfood app + agent via MCP)
3. Board my-crew (dogfood app + agent via MCP)
4. CI wiring (drift-check workflow + paths filter to PR)
5. Measurement + report + backlog pains

**Validation sweep surfaced critical architecture decision**: `apps/cli/src/cli-main.ts:8` has STATIC import `./mcp/mcp-server`. Copy-in-place to CI repo will fail (subpath exports + bundler). **Chốt:** dynamic import. One line change in cli-main, unit test keeps behavior, `dist/cli.js` self-contained. Vendoring becomes: copy single `cli.js` file + SKILL.md. No package.json in target repo.

**Board path**: `docs/architecture.mywb` (unified across both repos).

**Proof mechanism**: drift-bait PR (intentional architecture code change) ⇒ CI catches it ⇒ agent fixes board via `mywb file apply` ⇒ merge. Then measure natural drift ≥5–10 runs (phase 5).

## What We Tried

**Considered alternatives (each failed criteria)**:
- Stage 2c first: "agent needs fancier ops". Counterexample: build proof first, feature list follows from pains discovered.
- Ops vocabulary (align/distribute/stack) as next stage: "tldraw agent-template shows this works". Counterexample: not evidence *for our claim*. Backlog output, not input.
- Collab (Stage 3) first: "users want sync". Counterexample: zero users outside author; no demand signal yet.
- License carve-out (prod sign Electron, hobby watermark): "engineering solves this". Counterexample: $6k/yr commercial is business decision, blocks distribution, user defers deliberately.

**Brainstorm framing pivots**:
- Opened with six candidates on roadmap.
- Triaged via: evidence status (weak/medium/strong), risk (high/low), user pain (proven/guess).
- Killed wireframe+issue-card without debate (no signal).
- Moved collab to future (no multi-user ask).
- Deferred ops vocab to backlog output (not input evidence).
- Kept license on roadmap with explicit "must chốt before distribution" flag.

## Root Cause Analysis

The root cause of shipping 7 stages without proof: **progress felt like velocity**. Each stage had clear acceptance (tests pass, no regressions, feature works locally). Each shipped real behavior. But we conflated "works" with "solves the claim". The moat claim is *specific*: "diagram-as-review in CI reduces drift cost to zero". That requires adversarial evidence (real repos, real drift, real CI budget numbers). We ran one rehearsal locally. One.

The why it took three brainstorm sessions: **solution-jumping**. Each roadmap candidate looked plausible. Collab, ops, web sandbox — they're all things the product needs eventually. But none of them *prove* the central claim. That cognitive bias (building next feature instead of testing current claim) is structural. You need a forcing function: user voice saying "stop, show me".

## Lessons Learned

1. **Ship claim-first, feature-list-second.** A roadmap full of plausible features is not a roadmap; it's procrastination. Identify the one claim that, if false, kills the product. Run that experiment first. Everything else is backlog output.

2. **"It works locally" is not evidence.** One rehearsal in your own repo with your own board is a proof-of-concept, not validation. Validation requires: different repos, different code structures, real CI constraints, real drift, real cost numbers. The jump from 1 to ≥5 reps is where reality lives.

3. **Validation sweep is not polish.** The static MCP import at `cli-main.ts:8` looked fine in tests. Dynamic import requirement only surfaced in "how will this be vendored into a cold CI environment?" thinking. Validation is architecture thinking, not QA thinking. Do it early.

4. **Defer decisions that block evidence gathering.** License ($6k/yr) will be expensive. Figure out the answer before GA. But the *question* does not block this stage — we're not scaling yet. Deferral is explicit, tracked, used to scope out distribution phases. That's not avoidance; that's rigor.

5. **Unproven claim + feature road => credibility risk.** If we ship Stage 2c (exec-remote) before proving diagram-as-review, and then diagram-as-review fails, the feature is baggage in the product. Evidence stage prevents technical debt becoming product debt.

## Next Steps

**Immediate (Phase 1, this week)**:
- [ ] Heuristic run of drift-check locally on my-whiteboard (do not commit; validation only).
- [ ] Change `apps/cli/src/cli-main.ts:8` to dynamic import `./mcp/mcp-server` (one-liner).
- [ ] Confirm `dist/cli.js` self-contained post-build, unit test mcp subcommand behavior intact.

**Phase 2–3 (concurrent, ~1–2 days each)**:
- [ ] Create board in app for my-db-mate architecture, save `.mywb` to local workspace, commit to repo.
- [ ] Create board in app for my-crew architecture, save `.mywb` to local workspace, commit to repo.

**Phase 4 (depends 1-3)**:
- [ ] Vendor `cli.js` + SKILL.md into each target repo.
- [ ] Wire CI workflow (`drift-check.yml` from template), add paths filter (source + board).
- [ ] Commit, open drift-bait PR to each repo (intentional architecture delta).

**Phase 5 (depends 4)**:
- [ ] Run CI ≥5 times naturally (or accelerate via label/manual trigger).
- [ ] Measure: catch count, false-positive count, token cost/run, latency.
- [ ] Report + backlog ≥3 pains (e.g., ops language, cost, model context size).

**Ownership**: user drives Phase 1 (local rehearsal + CLI change); can parallel delegate Phases 2–3 to agent once 1 passes; Phase 4–5 coordinate user + agent.

**Blockers**: none. ANTHROPIC_API_KEY for repo Actions is Phase 4 detail, user provides then.

## Unresolved Questions

- my-whiteboard GitHub remote (private?) for baseline drift-check? **User decides separately, does not block this stage.**
- tldraw 1.13.2 license standing (pre-4.0?)? **Deferred; must chốt before any distribution.**
- Fairydraw concrete results (retention, patterns)? **Monitoring tldraw blog; backlog input.**

---

**Gates**: plan written, user approved (Frame A chosen, validation sweep passed Q1–Q4, decisions locked). No code yet. Ready for Phase 1 handoff.

**Deferral tracker**: License ($6k/yr, Stage ∅), Stage 2c (exec-remote, evidence-first violation), collab (no demand), ops vocabulary (backlog input), Distribution signing/Win/Linux (license blocker).

---

Status: DONE
Summary: Research, brainstorm, and 5-phase plan for evidence-driven moat proof stage. User chose diagram-as-review on two production repos with CI validation. Static MCP import surfaced; dynamic import chốt. License and Stage 2c deferred deliberately.
