# Journal — 2026-07-19: Stage 2b implementation (web canvas + persistence + relay)

## Kết quả

6 phases, 6 commits (`fd0621e..HEAD`). Web app thật: `apps/web` mở/lưu `.mywb` trên browser qua File System Access (fallback download/upload), canvas + custom shapes từ core. Persistence: `packages/web-adapter` (fflate archive + sql.js WasmSqliteStore) đọc/ghi CÙNG db.sqlite với desktop. Gateway read-only: `services/agent-relay` (WebSocket + token, chỉ /api/read, không exec). Tests: core 45, node-adapter 31, web-adapter 15, cli 8, relay 6, desktop unit + e2e 10/10 + web e2e + DMG.

## Điểm mấu chốt: format không chia đôi

Trích SQL schema (`record-db-schema.ts`) ra core, cả node:sqlite (`records-database.ts`) và sql.js (`wasm-sqlite-store.ts`) cùng import — một nguồn sự thật cho layout db.sqlite. Bằng chứng cứng: cross-impl test (db node ghi → sql.js đọc và ngược lại) + round-trip test (desktop→web→desktop CÙNG file, giữ assets + script + scriptDigest). Không có convert, không lệch format.

## Vấp đáng ghi

- **sql.js wasm không load trong Vite build** (research đã cảnh báo): default locateFile fetch `sql-wasm.wasm` từ page root → nhận index.html (magic word `3c 21 64 6f` = `<!do`) → CompileError. Fix: `configureSqlJs` nhận locator; app truyền `new URL('sql.js/.../sql-wasm.wasm?url')` để Vite resolve asset thật. Node test không cần (sql.js tự tìm wasm).
- **relay server.close() treo**: `httpServer.close()` chờ WS clients đóng. Fix: `terminate()` clients + `closeAllConnections()` trước close.
- **workspaces glob thiếu `services/*`** → relay không thành workspace; thêm vào root.
- FS Access `write(Uint8Array)` từ chối view SharedArrayBuffer-backed → `bytes.slice().buffer`.
- Phase 4 (desktop consume StoreBackend) OPTIONAL → **bỏ có chủ đích**: working-copy-manager dùng `checkpoint()` (sqlite-only) + đường sync, adapt sẽ không sạch. StoreBackend đã đủ justify bởi web. 0 diff desktop.

## Code review

DONE_WITH_CONCERNS, 0 blocking — mọi invariant giữ qua verify độc lập (reviewer chạy lại toàn bộ gate). 3 fix minor/medium: sql.js stmt free trong finally, comment zip-level, fallback Open cancel không treo.

## Trạng thái

Stage 2b HOÀN THÀNH. Web target có canvas mở/lưu thật + agent đọc read-only. Kế tiếp: Stage 2c (exec-remote + script sandbox — bài bảo mật RCE riêng). Còn nợ manual: GUI Chrome (Open/Save picker), Firefox fallback.
