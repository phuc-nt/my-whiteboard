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

## Stage 1 — Tách core (next)

Trích phần logic không phụ thuộc môi trường ra **shared core** (npm package,
không import Electron/browser API): shape schemas + validation, `.mywb` format,
agent-exec semantics (protocol + serialize), document-script runtime,
document-sync (diff/snapshot). Desktop app trở thành **adapter** đầu tiên tiêu
thụ core. Refactor có kiểm soát — không viết lại, hành vi giữ nguyên, e2e hiện
có là lưới an toàn.

Phạm vi chi tiết, thứ tự tách, và cấu trúc package: chốt qua brainstorm + plan
của stage (xem `plans/`).

## Stage 2 — Web target (ứng viên, sau Stage 1)

Adapter web trên core đã tách: OPFS/File System Access + WASM sqlite (hoặc
backend store), script sandbox (iframe/worker), **Agent Gateway** cho agent
cloud-side (browser không host được localhost server). Phục vụ trục "agent chạy
ở đâu": local agent → desktop, cloud agent (CI drift-check, bot) → web.

## Stage 3 — Team / collab (ứng viên)

Multi-user sync, SSO, governance, tích hợp GitHub/CI (diagram-as-review — CI so
diagram với codebase, cảnh báo lệch). Web là nền của stage này.

## Deferred không gắn stage

Wireframe kit + issue-card shape, auto-update, Sentry, Windows/Linux builds,
signed builds, hook inject context vào agent settings — nhặt vào stage nào có
lý do sản phẩm rõ.
