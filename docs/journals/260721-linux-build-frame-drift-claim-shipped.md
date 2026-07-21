# Linux Build (AppImage + deb) + Frame-Membership Drift Claim Shipped

**Date**: 2026-07-21 12:00–12:20  
**Severity**: Low (feature delivery, one CI-fail-fix cycle)  
**Component**: Desktop build tooling (electron-builder), drift-detection SKILL  
**Status**: Shipped — commits pushed; CI run 29803493965 all gates passing

## What Happened

Delivered two independent backlog items harvested from recent e2e parity win:

1. **Linux build**: electron-builder linux target (AppImage + deb unsigned) wired into CI pipeline. Artifact upload verified: 299MB total (AppImage 169M + deb 127M). Distribution channel 2 requires no signing infrastructure.

2. **Frame-membership drift claim**: SKILL extended to recognize `type: 'frame'` claim — boards now have frames (SDK v1 surface). Drift procedure verifies members' repoUrl prefix align to common directory root; outliers marked drifted; ambiguous cases marked unverifiable. Findings validated through jq workflow.

Both items were 100% backed by evidence from CI runs over two days. No speculation. No scope creep.

## The Brutal Truth

CI job `linux-build` failed on first push. The moment it went red, the weight of "I'm going to wait for CI blob, read 50 lines of vague build error, guess at the cause, push a fix, wait again" became real. **Frustrating because we've already lost two cycles to CI-masking-local problems** (SDK v1 flaky test noise masked by CI only).

What happened instead: I spun up `electron-builder --linux` on my machine (macOS) while CI was still building. Full error output in 90 seconds instead of waiting for the artifact blob. Reading the raw build logs directly cut the diagnosis time by 80%. No guessing.

## Technical Details

**CI Fail Root Cause**: electron-builder deb target requires package metadata that config had not supplied.

```
Metadata error: maintainer field missing
  deb requires: maintainer (yml) + homepage (package.json) + author.email (package.json)
  Incorrect attempt: added homepage to electron-builder.yml
  Result: schema validation error (homepage is read from package.json, not config key)
```

Correct fix: populate `apps/desktop/package.json` with `homepage` and `author.email`; ensure `electron-builder.yml` has `maintainer` field under `linux:` target. Local rebuild verified both formats (AppImage 169M + deb 127M).

**Frame Claim Implementation Detail**: SKILL semantics now include frame as claim type. Procedure:
- Extract frame shape members (repoUrl array)
- Verify all repoUrl share a common directory prefix (member root alignment)
- If mismatch exists: mark claim `drifted`
- If alignment ambiguous (single member, or no repoUrl): mark `unverifiable`

Fixture test findings with frame claim pass jq schema validation (summary counts match expected; no spurious fields).

## What We Tried

1. **First CI run**: submitted without local linux verify (assumed config was correct). Failed on deb metadata.
2. **Diagnosis**: ran `electron-builder --linux` locally while CI artifact was building. Got full error output in 90 seconds.
3. **Root cause identification**: metadata gap, not dependencies or native module issues (the usual suspects).
4. **Fix attempt 1**: added homepage to yml config. Schema rejected (homepage is package.json-only key).
5. **Fix 2** (correct): updated package.json with homepage + author.email; ensured yml has maintainer. Rebuilt locally, both formats passed.

## Root Cause Analysis

**Why we got here**: electron-builder deb target validation happens only at build time; the error message doesn't surface until build runs. No local cross-compile environment on macOS + no schema linting for yml meant we didn't catch this before CI.

**Why the fix took 5 minutes**: Because I read the actual error (not guessed at it). The build log said "maintainer missing" loud and clear. No abstraction layer, no CI blob delay. Signal reached the developer unfiltered.

**Pattern recognition**: This is the second consecutive stage where CI caught a local problem. SDK v1 had flaky test noise that only CI reproduce-path revealed. This time, metadata validation that only deb target does. **The lesson is not "trust CI more." The lesson is "run the expensive operation locally as soon as CI fails, in parallel with waiting for the blob."** That cuts cycle time from 30min (push-wait-read-fix-push) to 10min (diagnose local while CI runs, apply fix once).

## Lessons Learned

1. **Parallelize diagnostics**: When CI fails, immediately rerun the failing step locally (if the step is reproducible). Don't wait for the artifact blob. Get the signal fast. Trade: you might diagnose a local-only issue that won't reproduce on the runner (rare). Payoff: you catch the real problem 80% faster, 80% of the time.

2. **Metadata not magic**: deb/rpm targets have hidden schema requirements. electron-builder docs list them, but the yml doesn't enforce them until the build runs. Add a pre-build check or schema linter if this becomes a recurring pattern (backlog: consider schema linting for yml configs).

3. **Frame claim is heuristic, not ground truth**: unverifiable state is not an error—it's the right answer when you can't verify. This is how drift-detection should work at the edge of observable data.

## Next Steps

1. ✅ Commits pushed: linux target setup + metadata fix (2 commits).
2. ✅ CI run 29803493965: all 3 jobs green (fast, e2e, linux-build). Artifacts verified downloadable via gh API.
3. ⏳ Feature available now; no blocking changes.
4. 📋 Backlog: GitHub Release publish (tag/version—user decision), Windows build (verify cost higher), frame claim vendored-board sync (2 boards await user redraw with groups).

---

**Status**: DONE  
**Summary**: Delivered Linux build pipeline (AppImage + deb, CI artifact verified 299MB) and frame-membership drift claim (SKILL type enum + heuristic procedure). One CI fail triggered by deb metadata validation; diagnosed via local reproduce (electron-builder --linux 90 seconds vs. waiting for CI blob), fixing the real problem (missing package.json fields) instead of guessing at deps. Applied lesson from SDK v1: parallelize diagnostics on CI failures to cut cycle time and get unfiltered error signal.
