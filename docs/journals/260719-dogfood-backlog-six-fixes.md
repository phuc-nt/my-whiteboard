# Journal — 2026-07-19: Dogfood backlog — 6 pain fixes

## Kết quả

Cả 6 pain từ phiên dogfood đầu, fix + test đầy đủ, 7 commits (`8281c29..HEAD`). Toàn suite 126 unit (6 workspace) + desktop e2e 15 + web e2e xanh, typecheck sạch, tldraw 1 bản.

- **P1** service-node kind + lib/app/tool (superset, board cũ mở được; round-trip case kind mới).
- **P5** card auto-height: `computeServiceNodeMinHeight` thuần, geometry/indicator/component cùng `max(props.h, computed)`.
- **P4** layoutGrid/layoutTree trong core script-helpers (test fake-editor vì tldraw Editor cần DOM).
- **P2** arrow meta.relation convention (SKILL.md, không đổi schema) + round-trip khóa meta.
- **P6** save dialog: nhớ lastSaveDir (userData best-effort) + suggestedName từ board; logic thuần test được.
- **P3** CLI im lặng sqlite ExperimentalWarning.

## Bài học kỹ thuật

- **ESM import hoisting** làm P3 khó bất ngờ: mọi cách đặt filter trong file bundle (top-level statement, rollup banner) đều thua vì `import` (kéo node:sqlite) evaluate TRƯỚC. Giải: entry shim KHÔNG import gì ở module level, cài filter rồi **dynamic import** cli-main (không hoisted, thành chunk riêng — verify dist 306 bytes). Đây là pattern đáng nhớ cho mọi "chạy code trước import".
- **layout helper test không cần Editor thật**: tldraw Editor đòi DOM (jsdom chưa cài). Fake editor 4 method (getShape/getShapePageBounds/updateShape/run) faithful hơn là kéo cả jsdom — unit test thuần logic layout.
- **Code review lần 4 liên tiếp bắt lỗi thật**: P5 card cao ra nhưng name vẫn truncate vì CSS thiếu `whiteSpace:normal` — height budget cho wrap bị phí. Đã fix CSS + heuristic char-width. Gate reviewer tiếp tục chứng minh giá trị.

## Trạng thái

Backlog sạch. Board `docs/architecture.mywb` giờ nên vẽ lại với kind lib/app đúng ngữ nghĩa (P1) — việc nhỏ, để phiên dogfood sau. Kế tiếp: `mywb mcp` hoặc Stage 2c tùy tín hiệu.
