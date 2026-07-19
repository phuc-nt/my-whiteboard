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

## Thực thi (cùng ngày, /mk:cook)

Cả 6 phases hoàn thành trong 7 commits (da67a39..HEAD), mỗi phase xanh typecheck + unit + e2e trước khi sang phase sau. Kết quả: monorepo `packages/core` + `apps/desktop` + `apps/web-smoke`; core 35 unit tests (Node thuần), desktop 25 unit + 10 e2e Electron, web-smoke 1 playwright (chrome channel), DMG build OK, tldraw 1 bản.

Vấp đáng ghi:
- electron-builder không resolve version electron dạng range khi bị workspace hoisting → pin `electronVersion` trong electron-builder.yml.
- Boundary gate v1 KHÔNG bắt được `import 'node:fs'` (side-effect import, thiếu `from`) — phát hiện nhờ bước "chứng minh gate bắt lỗi thật" trong plan. Bài học: gate chưa từng thấy đỏ là gate chưa được kiểm chứng.
- tldraw store deliver history cho `store.listen` theo animation frame trong browser — web-smoke phải đợi 1 frame trước khi flush+đọc; unit test Node không lộ điều này (fallback sync). Đã ghi vào codebase-summary làm gotcha.
- `getSnapshot()` cấp editor đòi session state; đổi sang `store.getStoreSnapshot('document')` — tương đương phần document, chạy được headless (reviewer xác nhận qua source tldraw).

Code review (subagent): DONE, 0 chặn, 3 minor → fix 2 (defensive copy MemoryRecordStore + contract test; regex bracket-access), 1 documented (cần system Chrome cho e2e:web).

## Trạng thái

Stage 1 HOÀN THÀNH — plan completed, roadmap cập nhật, docs khớp layout mới. Stage 2 (web target) là ứng viên kế tiếp, bắt đầu bằng brainstorm phạm vi Agent Gateway.
