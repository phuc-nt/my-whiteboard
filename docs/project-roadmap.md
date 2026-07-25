# Project Roadmap

> **Internal roadmap & stage log (Vietnamese).** Maintainer's staged history and
> forward plan. For a user-facing summary of released changes, see the
> [changelog](../CHANGELOG.md).

**My Whiteboard** — cập nhật 2026-07-25. Định hướng dài hạn: **hybrid, tách core**
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

## Stage "Moat Proof" — diagram-as-review chạy thật ✅ (done 2026-07-25)

Phase 1 ✅ (CLI vendorable); pre-work ✅ (drift-check run #1, guard
false-positive vào SKILL). 24-25/07 đóng stage bằng 2 kênh:
- **Kênh CI**: 2 PR thật mở trên my-db-mate (#1) + my-crew (#3), board có
  frame + dagre layout, drift job pass, skip-graceful verified khi thiếu key.
- **Kênh local (chốt là kênh CHÍNH, xem positioning)**: agent local chạy
  drift-check scope full trên cả 2 repo, **bắt 2 drift thật** — my-db-mate:
  cạnh "Providers reads App DB" sai (providers nối DB ngoài, config do
  connection-service đọc); my-crew: cạnh "Agent Graphs calls Backends" ngược
  chiều (backends import agent, không có chiều ngược). Mắt người duyệt board
  không thấy 2 lỗi này. Zero-setup, không cần secret.

Phase 5 (đo metrics qua CI) hạ xuống opt-in — kênh CI là tính năng phụ, user
nào dùng tự cắm `ANTHROPIC_API_KEY`, không cần test thêm.
Plan: [plans/260720-0438-moat-proof-diagram-as-review-ci/](../plans/260720-0438-moat-proof-diagram-as-review-ci/plan.md).

## Model ⇄ board round-trip ✅ (done 2026-07-25)

Board thôi là output một lần; giờ có **model JSON commit cạnh board** làm
source of truth diff được. `file model extract` đọc board ra model,
`file scaffold --update` merge model đã sửa trở lại board mà **giữ layout, size
và note người vẽ** (model chỉ own service-node, frame trùng tên group, title, và
arrow nối 2 component đã khai báo). Arrow mang label quan hệ trên canvas.
Drift-skill v3 đọc model (2.4 KB thay vì 39 KB records) + claim `board-sync`
kiểm model↔board bằng `extract + jq diff`, không suy luận.

Dogfood 3 repo (my-whiteboard, my-db-mate, my-crew): cả 3 có model canonical,
board-sync ok cả 3, update giữ nguyên 100% vị trí tay. Dogfood bắt **3 bug thật**
mà unit test bỏ sót — arrow scaffold trước khi có id prefix bị nhân đôi, card đổi
group ra toạ độ âm, và component mới đè lên card người kéo vào đúng ô dagre.

Drift-check v3 scope full chạy trên cả 3 repo (84 claim): **0 claim khai báo nào
sai** — mọi component/edge đã vẽ đều verify được — nhưng **12 cạnh runtime bị bỏ
sót**: my-whiteboard 1 (`mywb CLI → desktop app` qua loopback HTTP, kèm component
VS Code extension còn thiếu), my-db-mate 3 (API route gọi DB và provider trực
tiếp, một Server Component gọi service không qua HTTP), my-crew 8
(`AgentRuntime Backends` không có cạnh vào nào — component trông như trôi nổi).
Diagram vẽ tay đúng hình nhưng thiếu, đúng loại lỗi mắt người duyệt không thấy.
Cả 12 đã tự verify lại tại nhiều call site rồi **sửa qua model** (không vẽ tay
lên board), `--update` giữ nguyên 100% vị trí card ở cả 3 repo, board-sync ok lại
sau khi sửa.

3 run cũng lộ 5 lỗ trong SKILL.md, sửa hết: bẫy false-drift `--include=*.ts`
không quote (zsh trả `0` giả đọc y như "không có dependency"), reverse-edge check
thiếu ngưỡng nên không reproducible, ví dụ loại-trừ chỉ có JS/TS (thiếu
`TYPE_CHECKING`/docstring), `repoUrl` trỏ path gitignored bị tính drift theo
trạng thái checkout, và `run.base` không định nghĩa khi scope `full`.
Plan: [plans/260725-0812-model-board-roundtrip/](../plans/260725-0812-model-board-roundtrip/plan.md).

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
