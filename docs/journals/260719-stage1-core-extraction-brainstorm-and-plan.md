# Journal — 2026-07-19: Stage 1 tách core — docs, brainstorm, plan, validate

## Bối cảnh

MVP (Stage 0) hoàn tất hôm nay (7 phases, commits fca8d2c→f1ed6ff). Định hướng dài hạn "hybrid, tách core" đã chốt trong positioning + system-architecture (4853ef8). Session này chuẩn bị giai đoạn kế tiếp.

## Việc đã làm

1. **Docs sản phẩm**: thêm `docs/project-roadmap.md` (Stage 0 done → Stage 1 tách core → Stage 2 web → Stage 3 team/collab); positioning chuyển Draft → Chốt; README link roadmap.
2. **Brainstorm Stage 1** (report: `plans/reports/brainstorm-260719-1302-stage1-core-extraction-monorepo-report.md`). Scout xác nhận codebase ~4k LOC, phần lớn ứng viên core đã renderer-side, chỉ dính Electron qua `window.desktop`. Quyết định user: **npm workspaces monorepo** (packages/core + apps/desktop + apps/web-smoke); phạm vi **rộng** (format, shapes, sync, exec, script-runtime, agent-protocol, storage abstraction); proof gate **kèm web smoke stub** — 2 lựa chọn sau vượt khuyến nghị (rec bỏ storage abstraction, chỉ Node test gate), user chọn có ý thức.
3. **Plan 6 phases, TDD mode**: `plans/260719-1302-stage1-core-extraction-monorepo/` — scaffold workspaces → format+agent-protocol → shapes → sync/exec/script-runtime (SyncTransport injection) → RecordStore → web-smoke + boundary gates.
4. **Validate (Session 1)**: 18 claims checked, 15 verified, **1 failed** — interface RecordStore dự thảo lệch API thật của `RecordsDatabase` (thực tế `applyDiff/replaceAll/loadAllRecords/...`, không phải `upsertRecords/...`). 4 quyết định: interface bỏ `checkpoint()` (sqlite-only); move `document-serialization.ts` vào core/sync; DMG output `apps/desktop/release`; tên package `@mywb/core`. Propagation + consistency sweep sạch.

## Bài học

- Verification pass của validate bắt được đúng loại lỗi nguy hiểm: interface "nghe hợp lý" viết từ trí nhớ thay vì đọc file thật. Phase 5 giờ ghi API đã verify.
- Ranh giới core thực tế không phải "no-DOM" — shapes/sync cần DOM types qua tldraw/React; ranh giới cứng đúng là cấm `electron`/`node:*`. Ghi thẳng vào plan tránh tranh cãi lúc review.

## Trạng thái

Plan validated, Failed=0 sau sửa, active plan đã set. Sẵn sàng `/mk:cook` (khuyến nghị `/clear` trước để context sạch).
