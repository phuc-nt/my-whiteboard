# Journal — 2026-07-19: Stage 2b — web canvas + persistence + gateway (brainstorm→plan)

## Quyết định chính

Đề bài gộp 4 hệ con (web canvas, storage, sandbox, gateway). Brainstorm decompose: web-smoke đã chứng minh canvas render → ẩn số là persistence + agent access, không phải render. User ban đầu chọn "C — cả web+gateway 1 stage"; sau khi trình bày rủi ro (exec-remote web = RCE thật; gateway = hệ độc lập), chốt **C-thu gọn**: gateway **read-only phase cuối**, exec-remote + sandbox defer 2c. Roadmap tách 2b/2c.

## Research (2 subagent song song)

Trước khi plan các phase storage — 2 ẩn số kỹ thuật đắt nếu sai:
- **WASM sqlite**: chốt **sql.js v1.14+** — import Uint8Array, `db.export()`, đọc file node:sqlite đã checkpoint WAL (→ ROLLBACK single-file), format sqlite 3.x tương thích. wa-sqlite/official overbuilt cho use case load-modify-export.
- **Browser zip + FS Access**: chốt **fflate** (8kB sync in-memory) + native File System Access (Chromium) với fallback anchor-download (Firefox/Safari). Không cần lib file-access riêng.

## Plan (6 phases, TDD)

StoreBackend interface (async, RIÊNG khỏi RecordStore sync desktop) → web-adapter (fflate + sql.js, cross-impl round-trip test) → apps/web (nâng từ web-smoke, FS Access Open/Save/SaveAs) → desktop-adapt (OPTIONAL/P3, dự kiến bỏ vì checkpoint sqlite-only) → relay read-only (WS+token, no-exec test) → round-trip e2e + docs. Bất biến cứng: format .mywb round-trip desktop↔web cùng file.

## Validate

20 claims, 17 verified, 0 failed. Verification bắt: (1) db schema thật (records{id,type,json}+meta{key,value}, SCHEMA_META_KEY) web PHẢI match; (2) `deserializeDocument(store, json)` nhận snapshot `{store,schema}` KHÔNG phải records rời → phase 3 dựng lại snapshot. 3 quyết định: trích const schema sang core (DRY chống chia đôi), rename web-smoke→web, relay bind loopback mặc định.

## Trạng thái

Plan validated tại `plans/260719-1602-stage2b-web-canvas-persistence-gateway/`, Failed=0, sẵn sàng cook.
