# mywb-mcp Server Shipped: Stdio MCP Proxy to Live Canvas

**Date**: 2026-07-20 04:15  
**Severity**: Low (feature delivery, no prod regression)  
**Component**: apps/cli (new mcp subcommand), desktop e2e  
**Status**: Resolved

## What Happened

Shipped the stdio MCP server feature that exposes the running mywb desktop app's canvas over Model Context Protocol. Agent systems can now run `claude mcp add mywb` and connect directly to the live canvas without learning CLI/skill syntax. 3 commits (e7a3fc8, e97b61a, f34061d), TDD per phase. All type/lint/unit/e2e gates pass. Code review: DONE, no blockers, 2 LOW advisories (intentional design choices documented).

## The Brutal Truth

The brainstorm decision to ship mywb-mcp OVER Stage 2c (exec-remote + web sandbox) was correct, and validating it was satisfying — we landed the clearest user value first. But the implementation revealed a bundler gotcha that cost 45min to debug: Vite's SSR config doesn't handle MCP SDK subpath exports. The fix (externalize via rollupOptions.external, not ssr.external) is now locked in, but only because the e2e test caught the issue. Without that test, the subcommand would ship and fail silently on first agent tool invocation.

## Technical Details

**Implementation split (3 phases)**:
- e7a3fc8: MCP server skeleton (apps/cli/src/mcp/{mcp-server.ts, mcp-tools.ts}), cli route plumbing, @modelcontextprotocol/sdk dep, vite externalize
- e97b61a: e2e test + real Electron + real SDK Client; caught 2 runtime bugs (read_shapes returned shapes.shapes undefined, screenshot returned object not string)
- f34061d: docs, SKILL.md, architecture clarity

**5 tools exposed**:  
1. list_documents → returns document metadata
2. read_shapes → returns canvas shapes (unwrapped from {success,result,error} envelope)
3. read_bindings → returns variable bindings
4. screenshot → returns image as base64 string (unwrapped)
5. exec → runs JS in app context, returns full ExecResult envelope (NOT unwrapped — intentional parity with `mywb app exec`)

**Key architectural call**: The 4 read/search tools strip the app-server envelope; exec does NOT. This asymmetry was the one thing to get exactly right. Rationale: exec is an escape hatch for power users and agents that know app internals; they expect the same error shape as the CLI exec subcommand. The other tools are "gimmes" — agent doesn't need to parse. Caught by 2 initial e2e failures, fixed with shared unwrap() helper.

**Bundler gotcha**: MCP SDK exports via subpaths (`@modelcontextprotocol/sdk/client/index.js`) don't survive Vite SSR bundling → dead at runtime with "module not found" error. Solution: externalize the entire package via `rollupOptions.external: ['@modelcontextprotocol/sdk']`. **NOT** `ssr.external` (which is a Vite config type error for non-ssr contexts). Spent 45min trying the wrong config before e2e test isolated the root cause.

**Dependency shape**: @modelcontextprotocol/sdk is a runtime dependency in cli (used by mcp-server.ts), devDependency in desktop (only e2e test uses the SDK Client). Single tldraw version (1.13.2), no conflicts.

## What We Tried

1. First attempt: read_shapes, screenshot returned wrapped {success,result,error} to agent. **Failed**: agent couldn't find the shape array (shapes.shapes undefined). Fix: unwrap before returning.
2. Second attempt: screenshot base64 returned as object {success, result: "data:..."} to agent. **Failed**: agent expected string directly. Fix: extract result and return string.
3. Bundler debug: tried ssr.external in vite.config.ts for MCP SDK. **Failed**: TS type error (ssr.external doesn't take strings). Actually tried rollupOptions.external. **Success**: SDK now ships correctly to cli binary.
4. Considered NOT unwrapping exec (to force agent to parse). **Decided**: ship unwrapped read tools to lower cognitive load, but keep exec wrapped for parity with CLI. Asymmetric but documented.

## Root Cause Analysis

The envelope-unwrap bug was purely a contract mismatch: the app-server returns {success,result,error}, the MCP spec expects tool results to be primitive values or objects directly. We built the unwrap() helper, but it was brittle until the e2e test enforced the contract. Without that test, the subcommand would've shipped and failed on first real agent invocation.

The bundler issue was a knowledge gap: Vite's SSR config is sparsely documented, and the error message ("module not found") pointed at the wrong layer (runtime vs build). E2e test + stderr trace eventually led to the real fix.

## Lessons Learned

1. **MCP tool contract must strip middleware envelopes**: Agents expect tool results to be the domain object, not wrapped in error-handling metadata. Design the unwrap layer explicitly, test it with a real SDK Client.

2. **E2e tests are not optional for bundler changes**: When adding new external dependencies or fiddling with Vite config, a smoke e2e that actually instantiates the output is worth its weight. Static type checks won't catch "module not found at runtime."

3. **Asymmetric tool behavior is OK if documented**: Unwrapping read tools but NOT exec is counterintuitive until you know the reasoning (parity with `mywb app exec`). Document it in the SKILL.md. Agent maintainers will thank you.

4. **Subpath exports need Vite externalize, not ssr config**: If a package uses subpath exports (`pkg/subdir/file.js`), you must externalize at the rollup level, not the SSR config level. The Vite docs don't stress this enough.

## Next Steps

**Immediate** (before moving to Stage 2c):
- [ ] User must save redrawn docs/architecture.mywb board (correct lib/app/tool kinds) from ~/Documents/Untitled.mywb → Cmd+S into docs/architecture.mywb + commit. Currently dirty. This unblocks next stage's web-service design.

**Future**:
- Stage 2c (exec-remote + web sandbox) can now lean on existing localhost Agent API. No new attack surface, full Electron context available. Scope this after architecture board is saved.
- Monitor agent adoption of `claude mcp add mywb` in dogfood; gather feedback on tool selection and error messages.
- If agents request a 6th tool (e.g., update_bindings), add it in a follow-up commit with e2e coverage.

## Unresolved Questions

- None at implementation close. All decisions documented; all gates pass.

---

**Gates**: typecheck ✅ (0 errors), lint ✅ (0 errors), unit ✅ (cli 9, desktop 14, agent-relay 6 all pass), desktop e2e ✅ (19 suites, 4 new mcp specs). Code reviewer: DONE. Advisories: 2 LOW (exec error parity, unwrap dead code for HTTP) — both intentional, documented in code.
