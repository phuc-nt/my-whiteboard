# My Whiteboard — Định vị sản phẩm (Abstract)

**Tên:** My Whiteboard (`my-whiteboard`)
**Ngày:** 2026-07-19
**Trạng thái:** Draft — nền tảng cho plan MVP local-first

## Một câu

Whiteboard vẽ diagram/wireframe cho engineer, nơi **coding agent là first-class user**: agent đọc/ghi canvas qua data và code thay vì pixel, và có thể nhúng hành vi bền (script) vào chính tài liệu.

## Vấn đề

- Miro/FigJam/diagram tool hiện tại là GUI cho người — coding agent muốn thao tác phải đi đường screenshot + click tọa độ: chậm, đắt, không verify được.
- Diagram kiến trúc trong công ty phần mềm chết mốc rất nhanh vì tách rời code và tracker; cập nhật thủ công không ai làm.
- Engineer dùng coding agent (Claude Code, Codex, Cursor...) hằng ngày nhưng không có canvas nào tích hợp tự nhiên vào workflow đó.

## Giải pháp

App whiteboard xây trên **tldraw SDK** với lớp agent-integration theo mẫu đã kiểm chứng của tldraw offline:

1. **Canvas = structured data**: shape là record có schema; agent đọc shapes/bindings, ghi bằng JS chạy trên `Editor` thật, verify bằng dữ liệu — không phải bằng mắt.
2. **Hai tầng thao tác**: chỉnh sửa tức thời (`exec`) và hành vi bền — document script nhúng trong file, chạy lại khi mở, có consent theo sha256 digest.
3. **Zero-config cho agent**: local HTTP API + token file + auto-install skill/subagent/hook vào Claude Code, Codex, Cursor, Gemini; helper CLI gói sẵn auth.
4. **Custom shapes cho dev workflow**: service-node, code-ref, issue-card, wireframe kit, mermaid-block — arrow binding mang ngữ nghĩa (calls, depends-on).

## Đối tượng

Engineer và team phát triển phần mềm trong công ty, đặc biệt nơi coding agent được dùng nhiều. Người mua: engineering org muốn thay Miro cho use case kỹ thuật.

## Khác biệt then chốt (moat)

- Agent thao tác canvas **rẻ hơn và tin cậy hơn hàng chục lần** so với computer-use trên Miro.
- Tài liệu whiteboard là **mini-app tự chứa** (canvas + data + code) — dạng "malleable software" mà agent mở rộng được.
- Về sau: diagram-as-review — CI so diagram với codebase thật, cảnh báo lệch (diagram không bao giờ chết mốc).

## Phạm vi MVP (quyết định đã chốt)

- **Local-first, single-user**: app desktop (Electron), file `.mywb` local, KHÔNG có server cộng tác, KHÔNG multi-user.
- Lớp agent chạy localhost (HTTP + bearer token per-launch) như tldraw offline.
- Multi-user sync, SSO, governance, tích hợp GitHub/CI: để giai đoạn sau, kiến trúc phải chừa đường (shape schema và API tầng store không giả định local).

## Định hướng kiến trúc dài hạn (chốt 2026-07-19): Hybrid, tách core

Sản phẩm KHÔNG chọn dứt khoát desktop-only hay web-only. Đích là **hybrid**: một **core dùng chung** (npm package) chạy được cả hai target, với các **adapter** riêng cho từng môi trường.

- **Trục quyết định:** agent của engineer chạy ở đâu. Agent **local** (Claude Code/Codex/Cursor trên máy dev) → desktop fit nhất (localhost API zero-config). Agent **cloud-side** (CI drift-check, bot cập nhật diagram) → web + backend fit. Sản phẩm phục vụ cả hai, không hy sinh cái nào.
- **Core dùng chung** (không phụ thuộc Electron/browser): shape schemas + validation, `.mywb` format, ngữ nghĩa agent-exec (protocol + serialize), document-script runtime, document-sync (diff/snapshot). Phần lớn đã nằm renderer-side trong MVP → chi phí tách là refactor có kiểm soát, không viết lại.
- **Adapter Desktop** (đã có): file system + node:sqlite + localhost HTTP server + custom protocol + fs.watch.
- **Adapter Web** (giai đoạn sau): OPFS/File System Access + WASM sqlite (hoặc backend store) + WebSocket sync + Agent Gateway (relay agent↔canvas) + script sandbox iframe/worker.

**Nguyên tắc bảo toàn tùy chọn:** mọi thay đổi từ đây giữ ranh giới renderer↔main sạch, để khi cần web chỉ viết adapter chứ không viết lại core. Web là **đích của giai đoạn team/collab**, không thay thế desktop.

## Ràng buộc

- tldraw SDK cần license thương mại để bỏ watermark — chi phí phải xác nhận với tldraw trước khi ship rộng.
- `/exec` là code execution có chủ đích — chỉ bind 127.0.0.1, token per-launch, consent cho script trong file lạ.

## Tham chiếu

- Phân tích ngược tldraw offline v1.11.0 (Canvas API, script trust, skill installer) — session 2026-07-19.
- tldraw SDK: https://tldraw.dev
