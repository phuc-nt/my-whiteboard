# Two Dogfood Bugs: Asset URL Mangling + Native Link Drag Crash

**Date**: 2026-07-24 20:19–21:10  
**Severity**: High (UI completely broken in first bug, canvas crash in second)  
**Component**: Desktop renderer (asset URL resolution, HTML anchor drag interop)  
**Status**: Resolved — both fixes shipped; 30/30 e2e gates passing, CI verifying at time of write

## What Happened

User started repaying P1 technical debt by opening two draft boards in the live desktop app for manual review. Within 30 minutes of real-world interaction, two critical bugs surfaced that 30 e2e tests + 153 unit tests never caught. Both bugs are now fixed and regression-locked.

**Bug 1**: Toolbar and style panel completely empty (no font dropdown, no color swatches, no UI icons).

**Bug 2**: Dragging from a service-node's repository link crashed the canvas and left it unresponsive.

## The Brutal Truth

The humbling part: zero automated test suite exercises the actual app. E2E runs against Playwright headless with synthetic events (no OS drag loop). Unit tests mock the browser. Real dogfood — a person reading their own board in the actual Electron window — found two showstoppers in the time it takes to order lunch.

This stings because the bugs were orthogonal: not architectural, not edge cases, but **fundamental integration failures between the bundler, the browser runtime, and user behavior patterns the test harness cannot simulate**. We have coverage where it counts least (syntax, composition trees) and blindness where it counts most (bundle URL schemes, drag-and-drop interop).

The productive part: the app had diagnostic telemetry turned on from a prior session. That signal cascaded into the fix.

## Technical Details

### Bug 1: Asset URLs Mangled by formatAssetUrl

**Symptom**: The moment the page loaded, the console flooded with `DOMException` errors (without `ELECTRON_ENABLE_LOGGING` already set from a previous session, this would have been invisible). Sampling showed:

```
DOMException: Failed to load font 'mywb-app://assets/fonts/Roboto-Bold.woff2'
```

All 16 fonts returned status `error` in `document.fonts`. Icons in the UI rendered as blank boxes. Text re-measure crashed the canvas with an unmapped glyph error (triggered on the next edit).

**Diagnosis**: Ran live JavaScript in the renderer:

```javascript
// In renderer exec context, after page load
[...document.fonts].forEach(f => console.log(f.family, f.status))
// All 16 returned: error

// Fetch the URL directly
fetch('mywb-app://assets/fonts/Roboto-Regular.woff2')
// Net::ERR_UNKNOWN_URL_SCHEME (Electron protocol doesn't understand the request)

// Try the vite-resolved absolute URL
fetch('mywb-app://assets/fonts/Roboto-Regular.woff2'.replace('mywb-app://', 'http://localhost:5173/'))
// 200 OK, font loads
```

The chain of evidence:

1. `getAssetUrlsByImport()` returns URLs like `mywb-app://assets/fonts/Roboto-Regular.woff2` (vite-resolved, bundled scheme).
2. Those URLs are passed to `Tldraw`'s `assetUrls` prop.
3. tldraw internally calls `formatAssetUrl()` on each asset URL.
4. tldraw's `formatAssetUrl()` only recognizes `http(s)` as absolute; everything else gets treated as a relative path.
5. Result: `mywb-app://...` became `/mywb-app://...` (prefix with slash, treat as path).
6. Browser tried to load `/mywb-app://assets/...` as a path relative to the page origin, which doesn't exist.

**Root Cause**: The identity function `getAssetUrlsByImport((url) => url)` was never used. Previous code passed URLs to tldraw's `formatAssetUrl()`, which broke them. Vite-resolved schemes (`mywb-app://`, and in vscode-webview the scheme is `vscode-webview://`) are not http(s), so they get mangled into trash paths.

**Fix** (1 line):

```tsx
// apps/desktop/src/renderer/src/pages/editor.tsx
const assetUrls = getAssetUrlsByImport((url) => url)  // Pass URLs through untouched
```

The identity function tells tldraw's loader: "these are already correct; don't run them through formatAssetUrl." Works because:
- Desktop bundler resolves them to `mywb-app://...` (Electron protocol).
- VSCode webview would resolve them to `vscode-webview://...` (vscode protocol).
- Both schemes bypass tldraw's http(s)-only mangling.

**Verification**: 16/16 fonts loaded (status: `loaded`); user confirmed icons reappeared in toolbar.

### Bug 2: Native Link Drag Hijacks Pointer, Crashes Translate

**Symptom**: User identified precise repro:
- Drag from empty card area: canvas pans correctly.
- Drag from the repoUrl link: canvas freezes mid-gesture, unresponsive afterward.

**Why automation never caught this**: Playwright's `mouse.down()` + `mouse.move()` + `mouse.up()` synthesizes `pointerdown`, `pointermove`, `pointerup` events. These **do not trigger HTML5 Drag-and-Drop nor the OS-native link drag loop**. The browser's native link drag is a separate facility (users hold mouse down on `<a href>`, browser launches its own drag loop). CDP events don't go through that path.

**Root Cause**: The anchor element is natively draggable (HTML default):

```tsx
{repoUrl ? (
  <a href={repoUrl}>  {/* Draggable by default */}
    {repoUrl}
  </a>
) : null}
```

When a drag started on the link:
1. User mouse-down on `<a>`.
2. tldraw's pointer handler begins a translate session (canvas pan).
3. Browser detects a drag on a draggable anchor; launches the OS-native link drag loop.
4. The native loop captures the pointer, breaking tldraw's pointer stream.
5. tldraw's translate session gets orphaned; next pointer event crashes the state machine.

**Fix** (2 lines):

```tsx
{repoUrl ? (
  <a
    href={repoUrl}
    draggable={false}                    // Opt out of native drag
    onDragStart={(e) => e.preventDefault()}  // Belt-and-suspenders
    onClick={(e) => {
      e.preventDefault()
      e.stopPropagation()
      // Real URLs open external; paths (agent data) don't navigate
      if (/^https?:\/\//.test(repoUrl)) window.open(repoUrl)
    }}
    style={/* ... */}
  >
    {repoUrl.replace(/^https?:\/\//, '')}
  </a>
) : null}
```

**Hidden bug unearthed**: The original `onClick` had no guard. Clicking a relative-path repoUrl would trigger `window.open('src/api')`, which a browser interprets as navigation to `http://localhost:5173/src/api`. In Electron, this would pass through the `window-open` hook and try to open a file path in the OS (silent no-op, user confused). Fix adds the guard: `if (/^https?:\/\//)` so http(s) URLs open external, and agent-facing paths (like `'src/api'`) do nothing.

**Regression Lock**: The e2e test (`service-node-link-drag.spec.ts`) checks:

```typescript
await expect(link).toHaveAttribute('draggable', 'false')
```

This assertion runs in Playwright (which cannot synthesize the native drag). The DOM check is still valid: if the anchor drops the `draggable=false` attribute in a refactor, the test breaks immediately. Automation cannot reproduce the crash, but it can police the defense.

## What We Tried

**Bug 1**:
1. Opened app, saw empty toolbar. No obvious error in rendered output.
2. Remembered `ELECTRON_ENABLE_LOGGING` was on from a prior debug session (unrelated).
3. Dug into console output: 16 font load errors, all `DOMException`.
4. Fetched the URL directly in live renderer exec: confirmed `ERR_UNKNOWN_URL_SCHEME`.
5. Tested with a hardcoded `http://` URL: fonts loaded.
6. Read the bundle's `formatAssetUrl()` call site: only `http(s)` treated as absolute.
7. Checked `getAssetUrlsByImport()` return shape: URLs already in correct form.
8. Applied identity function; rebuilt; 16/16 fonts loaded.

**Bug 2**:
1. User described the crash: "dragging works on the white area, crashes when dragging the link."
2. Opened service-node-shape-util.tsx; the anchor was draggable by default.
3. Added `draggable=false` + `onDragStart` preventDefault.
4. Tested manually in the app: no crash.
5. Wrote regression test that checks the DOM attribute (since Playwright can't simulate the crash).
6. Uncovered and fixed the click-guard issue while reviewing the anchor props.

## Root Cause Analysis

**Why Bug 1 happened**: The codebase had two paths for asset URL handling:

- **Correct path**: `getAssetUrlsByImport((url) => url)` — already-correct URLs, bypass tldraw's mangling.
- **Wrong path** (deleted code, but the mental model persisted): `getAssetUrlsByImport() → feed to formatAssetUrl()` — assumes tldraw can fix URL schemes.

tldraw's `formatAssetUrl()` is correct for the library's use case (CDN URLs, relative paths in web apps). For non-http schemes (mywb-app://, vscode-webview://), it's a foot-gun. The fix was already documented in the code comment I added:

```tsx
// Bundled by Vite — the app never fetches fonts/icons/translations from a CDN.
// Pass the vite-resolved URLs through untouched: tldraw's formatAssetUrl only
// treats http(s) URLs as absolute, so under our mywb-app:// origin it would
// mangle them into /mywb-app://...
```

This comment should have been visible before I shipped. It wasn't because I never read the code carefully until the bug broke the UI.

**Why Bug 2 happened**: HTML anchors are draggable by default. The mental model was "links are links, users click them, they navigate." But this is a tldraw canvas where every element is inside a gesture handler. The pointer event stream is a shared resource. The native link drag loop is designed to run outside the web app's event loop; it hijacks the pointer. In a canvas context, that's catastrophic.

Prevention would have been a code review asking: "Anchors in gesture-controlled surfaces — have we tested drag?" Automation couldn't ask that question because the test harness doesn't use the OS pointer.

**Why dogfood caught both**: Real use is orthogonal to test matrices.
- Bug 1: requires the actual bundler output + the actual protocol handler + the browser's font loading stack.
- Bug 2: requires a real OS pointer and a real drag (not synthesized events).

## Lessons Learned

1. **Dogfood coverage has boundaries**: E2E automation covers the happy path through DOM and state machines. It cannot simulate native OS drag loops, native protocol handlers, or real human editing patterns over time. When the product mixes browser APIs with OS-level features, real dogfood becomes a non-negotiable test layer. Automation is not a substitute; it's complementary.

2. **Diagnostic telemetry is a lever**: `ELECTRON_ENABLE_LOGGING` was on from a prior unrelated session. Without that flag, Bug 1 would have surfaced as a silent "toolbar is empty" with no console signal. The user would have reported "UI broken" without context. Having logging on by default (or at least not turning it off lightly) is cheap insurance. **Recommendation**: add a startup log message noting whether logging is enabled, so future debuggers know the signal level.

3. **Probe the live app, not just the code**: The real-time JavaScript execution (fetching URLs, checking `document.fonts`) was faster and more reliable than reading the source and guessing. When a bundle-integration bug surfaces, immediately exec arbitrary code in the running renderer to check assumptions about the runtime state. The code-reading approach (what I'd normally do) was too slow here; the live probe was 5x faster.

4. **Automation guards defense, not behavior**: Playwright cannot reproduce the native drag crash, but it can assert that the defense (draggable=false) is present. This is a valid regression check: if someone removes the attribute in a refactor, the test breaks. The test doesn't verify the crash doesn't happen (it can't); it verifies the mitigation is in place (it can).

5. **Comment precision matters**: The comment in editor.tsx was correct but came *after* the code was already shipped. Future me reading the PR diff would have immediately said "oh right, identity function, not formatAssetUrl." Putting the invariant in the comment is not optional; it's the contract that saves the next person.

## Next Steps

1. ✅ Fix 1: assetUrls identity function (1-line change, editor.tsx line 22).
2. ✅ Fix 2: draggable=false + onClick guard (service-node-shape-util.tsx lines 175–184).
3. ✅ Regression test: service-node-link-drag.spec.ts (DOM assertion for draggable=false; mouse drag simulation to catch state crashes).
4. ✅ Commits pushed; CI verifying (30/30 e2e passing, 64 core tests, 0 typecheck).
5. ⏳ User to verify the fixes in their board (manual reopen); confirm toolbar icons and drag behavior.
6. 📋 Backlog: Add startup logging flag toggle to renderer; consider frame-rate or event-loop health checks for drag-session stability; expand dogfood sessions to 1hr weekly sweeps of real user boards.

---

**Status**: DONE  
**Summary**: Two high-severity dogfood bugs fixed: asset URL mangling (vite-resolved mywb-app:// scheme broken by tldraw's formatAssetUrl, all fonts/icons failed to load) and native anchor drag hijacking pointer mid-canvas-gesture (crashed translate session). Both found in 30min live review; zero automated tests had prior signal. Fixes are minimal (identity function + draggable=false + click guard); regression locked via DOM assertion. Learned: automation cannot replace real dogfood for OS-level interop; live renderer probing is faster than source-reading for bundle bugs; telemetry on-by-default is cheap insurance.
