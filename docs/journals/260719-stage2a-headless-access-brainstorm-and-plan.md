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

## Trạng thái

Plan validated tại `plans/260719-1444-stage2a-headless-document-access/`, Failed=0, sẵn sàng cook.
