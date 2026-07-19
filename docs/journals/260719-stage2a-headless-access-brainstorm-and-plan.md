# Journal — 2026-07-19: Stage 2a — từ "Agent Gateway" thành headless access (CI-first)

## Quyết định chính

Đề bài vào là "brainstorm phạm vi Agent Gateway" (roadmap Stage 2). Problem-first inversion lật lại: gateway là transport fix cho "browser không host được localhost", nhưng use case cloud-agent giá trị nhất (CI drift-check — moat trong positioning) chỉ cần **tài liệu**, không cần canvas live. Gateway hiện tại là relay tới hư không (chưa có web app). User chốt: **Stage 2a = headless document access**, gateway defer sang 2b (khi có web canvas). Roadmap đã tách 2a/2b.

## Phạm vi chốt (brainstorm + validation)

- `packages/node-adapter`: move archive stack (verified: zero electron, importer duy nhất working-copy-manager).
- Headless API read/apply record-level, validate bằng chính TLStore + custom shapes của app; KHÔNG exec parity, KHÔNG patch API v1 (pattern read→merge→put ghi trong SKILL.md).
- `apps/cli` bin `mywb file read/apply` — bundle vite SSR (exports trỏ TS source nên tsc thuần không emit xuyên package).
- `examples/ci-drift-check/` (workflow + SKILL.md + make-fixture) — demo local, không dogfood CI repo này ở stage này.
- yauzl/yazl: **bundle vào out/main** (externalize-exclude), không dual-declaration — user đảo khuyến nghị, fallback khai báo kép nếu bundle CJS lỗi.

## Validate

14 claims checked, 12 verified, 0 failed (export names archive, createTLStore nhận custom utils qua `checkShapesAndAddCore`, writer skip state.json, node:sqlite ≥22.5). 2 unverified có gate runtime trong phase (electron-builder packing, vite SSR bundle tldraw).

## Thực thi (cùng ngày, /mk:cook)

4 phases xong trong 5 commits. Kết quả: `@mywb/node-adapter` (archive move + headless-document API), `apps/cli` (`mywb file read/apply` + `make-fixture`, dist tự chứa 5.3MB qua vite SSR, mermaid lazy chunk), `examples/ci-drift-check/`. 78 unit/integration tests + desktop e2e 10/10 + web e2e.

Vấp đáng ghi:
- **tldraw giữ event loop ngoài NODE_ENV=test** → CLI xong việc nhưng không exit (CI sẽ treo vô hạn); dưới vitest thì exit nên test không lộ — bắt được nhờ smoke tay. Fix: `process.exit()` tường minh + stdout write awaited (flush pipe).
- **Code review bắt critical thật**: `removed` không qua validate — xóa được record page/document, ghi file hỏng với exit 0, trái contract "accepted iff canvas accepts". Fix: heal-diff qua `ensureStoreIsUsable` + referential check (parentId, binding endpoints — healer tldraw KHÔNG chase references, phát hiện khi test dangling-parentId vẫn pass) + schema-equality guard + reject file thiếu schema.
- Exit-code contract: parseArgs error phải là usage error (2), không phải operation failure (1).
- make-fixture.mjs kế hoạch gốc bất khả thi (Node thuần không chạy TS source) → entry thứ hai trong dist CLI.

## Trạng thái

Stage 2a HOÀN THÀNH — roadmap ✅, moat "diagram không chết mốc" có đường chạy thật. Còn nợ manual: mở file CLI-sửa trong desktop app (GUI check). Kế tiếp: Stage 2b (web canvas + gateway) hoặc dogfood drift-check CI.
