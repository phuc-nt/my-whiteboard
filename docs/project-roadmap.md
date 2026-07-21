# Project Roadmap

**My Whiteboard** — cập nhật 2026-07-20. Định hướng dài hạn: **hybrid, tách core**
(xem [product-positioning-abstract.md](product-positioning-abstract.md) và
[system-architecture.md](system-architecture.md)).

## Stage 0 — MVP local-first ✅ (done 2026-07-19)

Desktop Electron + tldraw, `.mywb` (SQLite archive) + crash recovery + session
restore, Agent API localhost (search/exec/screenshot), skill installer + CLI
`mywb`, 3 custom shapes, document scripts (consent theo digest), e2e + DMG macOS.
Plan: [plans/260719-0904-my-whiteboard-mvp-local-first/](../plans/260719-0904-my-whiteboard-mvp-local-first/plan.md).

Còn nợ trong stage này (không chặn): manual GUI pass (save dialog / recovery /
consent-reopen), signing/notarization. Nợ license tldraw đã đóng 2026-07-20
bằng quyết định định vị phân phối OSS/self-install — xem
[product-positioning-abstract.md](product-positioning-abstract.md) mục "Định
vị phân phối & license tldraw": OSS creator không cần mua license, localhost
= dev không cần key, downstream tự xin (Hobby/commercial), ship không kèm key.

## Stage 1 — Tách core ✅ (done 2026-07-19)

Monorepo npm workspaces: `packages/core` (`@mywb/core` — format, agent-protocol,
shapes, sync sau `SyncTransport`, exec, script-runtime, `RecordStore` contract
+ in-memory impl), `apps/desktop` (adapter Electron, `RecordsDatabase
implements RecordStore`), `apps/web-smoke` (proof core chạy browser thuần, có
playwright test). Boundary cấm `electron`/`node:*`/`window.desktop` trong core
enforce bằng test gate. Behavior desktop không đổi — toàn bộ unit + e2e cũ pass.
Plan: [plans/260719-1302-stage1-core-extraction-monorepo/](../plans/260719-1302-stage1-core-extraction-monorepo/plan.md).

## Stage 2a — Headless document access, CI-first ✅ (done 2026-07-19)

Quyết định 2026-07-19 (problem-first, brainstorm
`plans/reports/brainstorm-260719-1444-stage2a-headless-document-access-report.md`):
cloud agent (CI drift-check, bot cập nhật diagram) cần **tài liệu**, không cần
canvas live — bước đầu Stage 2 KHÔNG phải gateway. Phạm vi: tách archive stack
thành `packages/node-adapter` (desktop thành consumer), CLI `mywb file
read/apply` (record-level, validate schema core, không hứa exec parity), GitHub
Action mẫu + skill drift-check — agent tự so diagram với code, ta chỉ cấp data
access. Không server, không auth infra.

## Stage 2b — Web canvas + persistence + gateway read-only ✅ (done 2026-07-19)

Quyết định 2026-07-19 (brainstorm
`plans/reports/brainstorm-260719-1602-stage2b-web-canvas-persistence-gateway-report.md`):
web-smoke đã chứng minh canvas render trên browser; 2b biến nó thành app web
thật **mở/lưu `.mywb`** + agent **đọc** canvas web. Phạm vi: `apps/web` (nâng
từ web-smoke), `StoreBackend` interface, `packages/web-adapter` (web-archive
bằng fflate + WASM sqlite + File System Access, Chromium-first fallback
download), Open/Save/Save As, relay server nhỏ (WebSocket + token) cho agent
**read-only** (list/search/get — KHÔNG exec). Format `.mywb` bất biến: round-trip
desktop↔web trên cùng file là acceptance cứng.

## `mywb mcp` — MCP server over the Agent API ✅ (done 2026-07-20)

Quyết định 2026-07-20 (brainstorm
`plans/reports/brainstorm-260720-0309-mywb-mcp-server-report.md`): sau khi
`mywb app` live-mode chạy, bước giá trị-user rõ nhất là để MỌI agent hiểu MCP
connect canvas qua chuẩn (`claude mcp add mywb`) — tools có schema tự động,
không cần học cú pháp CLI/skill. `mywb mcp` là subcommand stdio server trong
apps/cli, tái dùng app-server-client (server.json + token), SDK
`@modelcontextprotocol/sdk`. Tools v1: list_documents, read_shapes,
read_bindings, screenshot, exec. Chọn trước Stage 2c vì web chưa có usage thật
để justify cost exec-remote.

## Dogfood backlog fixes ✅ (done 2026-07-19)

6 pain từ phiên dogfood đầu, mỗi cái test đầy đủ (plan
`plans/260719-2058-dogfood-backlog-six-pain-fixes/`): service-node kind
lib/app/tool + card auto-height; layoutGrid/layoutTree helpers cho agent;
arrow meta.relation convention; save dialog nhớ thư mục + gợi ý tên từ board;
CLI im lặng sqlite warning.

## Dogfood + agent integration: `mywb app` live-mode ✅ (done 2026-07-19)

Quyết định 2026-07-19 (idea triage, brainstorm
`plans/reports/brainstorm-260719-1906-dogfood-and-mywb-live-mode-report.md`):
sau 4 stage build liên tục, thứ thiếu nhất là **bằng chứng usage** — không phải
feature. Track 1 (usage): vẽ board kiến trúc repo này bằng chính app qua agent,
commit `docs/architecture.mywb`, drift-check chạy local (CI khi có remote),
backlog pain thật. Track 2 (build): `mywb app docs/search/exec` — CLI live-mode
nói với app đang chạy (port từ helper script), một binary cho mọi agent có
shell + CI. **CLI trước, MCP sau**: `mywb mcp` là proxy stdio mỏng trên CLI,
build hay không do dogfood quyết.

Board `docs/architecture.mywb` đã sửa đúng kind (lib/app/tool cho core/adapters,
app cho desktop+web, tool cho CLI, api cho relay) sau khi 6 backlog fixes thêm
kind mới — patch record-level qua `mywb file apply`, render verify trong app.

## Scaffold headless v1 + llms.txt ✅ (done 2026-07-20)

Quyết định 2026-07-20 (stage-map session, sau autonomous pre-work Moat Proof):
evidence từ việc phải viết generator tay ~100 dòng để draft 2 board đầu →
productize thành `mywb file scaffold <model.json> <board.mywb>`
(`buildBoardFromModel` trong node-adapter: nodes layout theo kind, title,
arrows 2-binding + meta.relation, store schema thật). Kèm chuẩn hoá agent docs
llmstxt.org: `llms.txt` repo root + `GET /llms.txt` trên agent API. Onboarding
drift-check cho repo mới = 1 lệnh. Ops trong app live (align/distribute qua
exec) vẫn chờ evidence phase 5 Moat Proof.
Plan: [plans/260720-0918-scaffold-headless-llms-txt/](../plans/260720-0918-scaffold-headless-llms-txt/plan.md).

## Interop v1 (Mermaid bridge) + MCP v2 ✅ (done 2026-07-20)

Quyết định 2026-07-20 (research + brainstorm nhóm use case A): board sống
trong README qua `mywb file mermaid` (flowchart default + c4, export
deterministic từ core; import KHÔNG parser — recipe dạy agent dịch mermaid →
model → `file scaffold`); MCP v2 thêm `scaffold_board` + `read_shapes`
detail summary|full (pattern BlurryShape, default full giữ nguyên). README
repo giờ nhúng diagram regen 1 lệnh từ chính board.
Plan: [plans/260720-1049-interop-v1-mermaid-bridge-mcp-v2/](../plans/260720-1049-interop-v1-mermaid-bridge-mcp-v2/plan.md).

## Linux build + frame-drift claim ✅ (done 2026-07-21)

CI 2 ngày trước đã chứng minh app chạy trên Linux (24/24 e2e, 2 bug Linux
đã sửa) → thu hoạch: electron-builder linux target (AppImage + deb, unsigned,
không cần account) + CI job `linux-build` upload artifact (299MB, verified).
Kênh distribution thứ 2. Kèm: drift-check SKILL thêm claim type `frame`
(subsystem membership ↔ directory root) sau khi SDK v1 cho boards có frames.
Plan: [plans/260721-1201-linux-build-frame-drift-claim/](../plans/260721-1201-linux-build-frame-drift-claim/plan.md).

## CI hardening + drift baseline ✅ (done 2026-07-20)

Repo public nhưng 0 CI — mọi claim "gates xanh" chỉ tồn tại trên máy local.
`.github/workflows/ci.yml` hai tầng: job `fast` (typecheck + unit 6 suite,
mọi push/PR) và job `e2e` (Electron dưới xvfb, web + relay, VS Code
extension) chạy sau. Kèm `diagram-drift-check.yml` cho chính repo: export
diagram luôn chạy, agent step **skip** (không đỏ) khi thiếu
`ANTHROPIC_API_KEY` hoặc PR từ fork. Verify bằng run thật trên GitHub, không
phải "cú pháp đúng". Script `test` của apps/vscode đổi thành
`test:integration` để `npm test` ở root không tải VS Code.
Plan: [plans/260720-1503-ci-hardening-tiered-drift-baseline/](../plans/260720-1503-ci-hardening-tiered-drift-baseline/plan.md).

## VS Code Extension MVP — edit + save `.mywb` in-editor ✅ (done 2026-07-20)

Quyết định 2026-07-20 (brainstorm ràng buộc "không phụ thuộc nợ manual"; user
chọn VS Code MVP thay CI hardening — CI hardening thành ưu tiên kế tiếp):
`apps/vscode` — CustomEditorProvider mở/sửa/lưu `.mywb` trên canvas tldraw
trong webview (CSP + wasm-unsafe-eval cho sql.js), bytes qua postMessage,
save/backup/revert chuẩn VS Code; `editor-bridge` extract từ apps/web về
`@mywb/web-adapter` dùng chung; `.vsix` 3.5MB build bằng vsce; 5 integration
tests trên VS Code thật (@vscode/test-electron) với board thật. KHÔNG chạy
document scripts trong webview, KHÔNG agent API mới. Marketplace publish =
việc tay (cần publisher account).
Plan: [plans/260720-1320-vscode-extension-mvp-edit-save/](../plans/260720-1320-vscode-extension-mvp-edit-save/plan.md).

## Stage "Moat Proof" — diagram-as-review chạy thật 🔶 (in-flight 2026-07-20)

Phase 1 ✅ (CLI vendorable qua dynamic-import mcp + recipe vendor cả dist/);
autonomous pre-work ✅ (drift-check run #1: 0 drift, 2 false-positive hụt →
guard vào SKILL; 2 board draft headless; branch `feat/diagram-drift-check`
sẵn trong my-db-mate + my-crew, chưa push). Chờ user: review board trong app,
thêm secret `ANTHROPIC_API_KEY`, push PR → phase 5 đo metrics.
Plan: [plans/260720-0438-moat-proof-diagram-as-review-ci/](../plans/260720-0438-moat-proof-diagram-as-review-ci/plan.md).

## Stage 2c — Exec-remote + script sandbox trên web (ứng viên, demote 2026-07-19)

Gateway exec (agent chạy code trên canvas web qua relay) + script sandbox
(iframe/worker). Demote vì web chưa có usage thật để justify cost bảo mật
RCE-remote; cân nhắc lại sau khi web có người dùng.

## Stage 3 — Team / collab (ứng viên)

Multi-user sync, SSO, governance, tích hợp GitHub/CI (diagram-as-review — CI so
diagram với codebase, cảnh báo lệch). Web là nền của stage này.

## Deferred không gắn stage

Wireframe kit + issue-card shape, auto-update, Sentry, Windows/Linux builds,
signed builds, hook inject context vào agent settings — nhặt vào stage nào có
lý do sản phẩm rõ.
