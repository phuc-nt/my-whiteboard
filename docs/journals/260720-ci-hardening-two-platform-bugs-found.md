# CI Hardening: Two Real Platform Bugs Caught (Linux Runner Detection)

**Date**: 2026-07-20 15:03–16:00  
**Severity**: High (shipped bugs, affects Linux/Windows users)  
**Component**: CI/CD (GitHub Actions, tiered jobs), apps/desktop (watcher + open-file handling), apps/cli  
**Status**: Resolved — commits 6bc369d, dc7cd55, c010bcf, 7ffea33, 9a04a83

## What Happened

Repo is public with 4 days of dense commits and **zero CI**. Every claim "gates pass" only ever existed on my local machine. This phase shipped GitHub Actions gates (typecheck, unit tests, and end-to-end suites across desktop/web/relay/vscode) plus drift-check baseline. The CI run on a Linux runner revealed two genuine product bugs that 24 e2e suites on macOS never caught. Both are platform-specific assumptions in the code that break silently on Linux/Windows.

## The Honest Assessment

This is why CI on a different OS matters. My machine is macOS; the runner is Linux. The bugs didn't manifest as red tests or loud errors—they were silent failures. Document scripts on Linux would watch a directory and never fire events. Opening a `.mywb` file with `mywb board.mywb` on Windows would show an empty window instead of loading the board. Neither broke in my test suite because the test setup (or the test machine) didn't exercise the exact platform mismatch.

The frustrating part is that I had flagged infrastructure work twice before. User chose VS Code integration priority. Today CI finally ran. Now we know exactly what was hiding. That's the entire point of moving gates from local to CI.

## Technical Details

### Bug 1: `fs.watch({recursive: true})` is macOS/Windows only

**Symptom**: On Linux, document scripts chased by the file watcher would never trigger re-export, even though the file changed.

**Root cause**: Node.js `fs.watch()` with `recursive: true` is only implemented on macOS and Windows. On Linux, the watcher is created but **never fires events**. The code in `apps/desktop/src/main.ts` trusted `recursive: true` without checking the platform.

**Evidence from logs**: First CI run waited 40 seconds for a state change that never came. Not a timeout issue—the state was genuinely stuck in `"none"`. The hypothesis "runner is slow" was wrong; the data showed "never happens."

**Fix**: 
- Watch the directory non-recursively (portable, works on all platforms)
- Add `watchFile` polling on `main.js` itself every 500ms as a backstop
- Consolidate duplicate watch logic into `startWatching()` helper
- Call `detach()` to clean up both watchers together

**Commit**: dc7cd55

### Bug 2: `app.on('open-file')` is macOS-only API

**Symptom**: Running `mywb board.mywb` on Linux or Windows opened an empty window instead of loading the board.

**Root cause**: Electron's `app.on('open-file')` event is a **macOS-only API**. On other platforms, the file path arrives via `process.argv` at startup, but the app only processes argv during `second-instance` event (subsequent app launches), not the first launch. So opening a file on first run goes unhandled.

**Evidence**: `real-board-smoke` e2e test (written yesterday) passed on macOS, but the test only used the macOS path (`app.on('open-file')`). It never tested the argv path that Linux/Windows rely on.

**Fix**:
- Detect `process.platform !== 'darwin'`
- On non-macOS platforms, extract `.mywb` arguments at startup and push them into the `pendingOpenFiles` queue
- Use the same queue mechanism for both paths

**Commit**: c010bcf

## What We Tried

### First iteration (incorrect approach)

I saw the timeout failure and assumed the runner was slow. Increased the state-change timeout from 8 seconds to 40 seconds. Wrong. The second run showed state staying `"none"` after 40s—not a latency problem, a never-happens problem.

**Lesson from this mistake**: When timeout doesn't fix a test, **re-examine the hypothesis, not the timeout**. The data (consistent state for 40s) contradicted the guess (runner latency). I should have read the log more carefully the first time instead of nesting deeper into the wrong problem.

### Second iteration (correct diagnosis)

Looked at the actual log output. State didn't progress, which meant the watch wasn't firing. Checked Node.js docs. Found `fs.watch` limitation. Tested `watchFile` locally with polling, confirmed it worked. Applied fix to both watcher issues in one pass.

## Root Cause Analysis

Two separate macOS assumptions leaked into shipped code:

1. **`fs.watch` behavior assumption**: Code assumed recursive watching worked everywhere. No guard, no fallback. This is a platform-specific limitation of Node.js, not a "missing feature"—the OS support varies.

2. **`app.on('open-file')` assumption**: Electron documents this as macOS-specific, but the code didn't account for argv handling on other platforms. The route existed (argv arrives at startup) but the handler wasn't connected.

Neither bug was caught because:
- Local test suite ran on macOS (matches the code's assumptions)
- E2E smoke test only tested the macOS event path
- No CI until today meant no Linux execution ever happened

## Lessons Learned

1. **Platform-specific APIs require guards or fallbacks**. If a library behavior differs by OS, the code must either (a) detect the platform and adapt, (b) use a portable alternative, or (c) document the limitation and skip the feature. Assuming one platform works everywhere is the definition of untested code.

2. **Data disproves guesses**. When a fix doesn't work, the problem isn't the fix—it's the diagnosis. Read the logs instead of nesting timeouts. A state that stays `"none"` for 40 seconds didn't fail because the runner was slow; it failed because the path never ran.

3. **E2E tests can hide platform bugs**. A smoke test that only uses one code path (macOS event) won't catch the other path (argv). Writing `real-board-smoke` was good, but it should have tested both the event path and the argv path. Test matrix: one suite per realistic startup method.

4. **CI on a different OS finds different bugs**. This is why running gates on the target platform matters. macOS-only assumptions are invisible when CI runs on macOS. Linux runner made them obvious in the first run.

## Next Steps

1. ✅ **Both bugs fixed**: Watcher works via `watchFile` polling on all platforms; open-file respects platform-specific APIs with proper argv fallback.
2. ✅ **Verified on Linux**: CI run 3 succeeded. Desktop e2e: **24/24 tests passed on Linux runner**. Local test still passes on macOS (no regression).
3. ✅ **CI gates now trustworthy**: Fast job (typecheck + unit): 61s. E2e job: 3m18 (desktop 1.2m xvfb, web 12.6s, relay 17.7s, vscode 25s). All suites green.
4. ✅ **Drift baseline baseline active**: `diagram-drift-check.yml` runs on PR; export succeeds, agent/comment steps skipped gracefully (no secret yet), workflow conclusion: success.
5. ✅ **README badge added**: CI status badge now links to latest run.

Backlog: Windows native run (only Linux on runner today). Script suite docs (future phase).

---

**Status**: DONE  
**Summary**: CI hardening revealed two real platform bugs: `fs.watch` recursive limitation on Linux, and `app.on('open-file')` missing argv fallback on non-macOS. Both fixed. CI gates now trustworthy across platforms; 24 desktop e2e pass on Linux. Key method lesson: data disproves guesses—when a fix doesn't work, re-examine the hypothesis before nesting deeper.
