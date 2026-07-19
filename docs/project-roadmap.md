# Project Roadmap

**My Whiteboard** — cập nhật 2026-07-19. Định hướng dài hạn: **hybrid, tách core**
(xem [product-positioning-abstract.md](product-positioning-abstract.md) và
[system-architecture.md](system-architecture.md)).

## Stage 0 — MVP local-first ✅ (done 2026-07-19)

Desktop Electron + tldraw, `.mywb` (SQLite archive) + crash recovery + session
restore, Agent API localhost (search/exec/screenshot), skill installer + CLI
`mywb`, 3 custom shapes, document scripts (consent theo digest), e2e + DMG macOS.
Plan: [plans/260719-0904-my-whiteboard-mvp-local-first/](../plans/260719-0904-my-whiteboard-mvp-local-first/plan.md).

Còn nợ trong stage này (không chặn): manual GUI pass (save dialog / recovery /
consent-reopen), xác nhận license tldraw, signing/notarization.

## Stage 1 — Tách core ✅ (done 2026-07-19)

Monorepo npm workspaces: `packages/core` (`@mywb/core` — format, agent-protocol,
shapes, sync sau `SyncTransport`, exec, script-runtime, `RecordStore` contract
+ in-memory impl), `apps/desktop` (adapter Electron, `RecordsDatabase
implements RecordStore`), `apps/web-smoke` (proof core chạy browser thuần, có
playwright test). Boundary cấm `electron`/`node:*`/`window.desktop` trong core
enforce bằng test gate. Behavior desktop không đổi — toàn bộ unit + e2e cũ pass.
Plan: [plans/260719-1302-stage1-core-extraction-monorepo/](../plans/260719-1302-stage1-core-extraction-monorepo/plan.md).

## Stage 2a — Headless document access, CI-first (next)

Quyết định 2026-07-19 (problem-first, brainstorm
`plans/reports/brainstorm-260719-1444-stage2a-headless-document-access-report.md`):
cloud agent (CI drift-check, bot cập nhật diagram) cần **tài liệu**, không cần
canvas live — bước đầu Stage 2 KHÔNG phải gateway. Phạm vi: tách archive stack
thành `packages/node-adapter` (desktop thành consumer), CLI `mywb file
read/apply` (record-level, validate schema core, không hứa exec parity), GitHub
Action mẫu + skill drift-check — agent tự so diagram với code, ta chỉ cấp data
access. Không server, không auth infra.

## Stage 2b — Web canvas + Agent Gateway (ứng viên, sau 2a)

Adapter web trên core: OPFS/File System Access + WASM sqlite (hoặc backend
store), script sandbox (iframe/worker), **Agent Gateway** relay agent↔canvas
live (browser không host được localhost server; exec-remote cần capability
scoping — nặng hơn hẳn localhost). Gateway chỉ đáng làm khi đã có canvas web
để relay tới.

## Stage 3 — Team / collab (ứng viên)

Multi-user sync, SSO, governance, tích hợp GitHub/CI (diagram-as-review — CI so
diagram với codebase, cảnh báo lệch). Web là nền của stage này.

## Deferred không gắn stage

Wireframe kit + issue-card shape, auto-update, Sentry, Windows/Linux builds,
signed builds, hook inject context vào agent settings — nhặt vào stage nào có
lý do sản phẩm rõ.
