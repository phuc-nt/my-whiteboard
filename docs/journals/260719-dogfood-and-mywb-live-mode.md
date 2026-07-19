# Journal — 2026-07-19: Dogfood + mywb live-mode

## Bối cảnh

Sau 4 stage build liên tục, idea triage (problem-first) kết luận: thiếu nhất là bằng chứng usage. User hỏi thẳng "MCP hay CLI?" → chốt: **CLI live-mode trước, MCP là proxy stdio mỏng sau** (MCP cho desktop app bản chất là adapter over localhost HTTP — build CLI trước thì MCP tái dùng, ngược lại thì không).

## Kết quả

- **`mywb app docs/search/exec`**: CLI nói với app đang chạy qua server.json (per-OS default + override), 5 e2e với Electron thật.
- **SKILL.md binary-first**, helper sh thành legacy fallback.
- **Dogfood thật**: agent vẽ nguyên board kiến trúc (7 service-node, 10 arrows, 20 bindings) lên app đang chạy chỉ bằng `mywb app exec` (stdin pipe), tự kiểm layout bằng screenshot API, user Save, board committed `docs/architecture.mywb`. Drift-check local trọn vòng: sạch → bait → phát hiện → fix qua read-merge-put → sạch.
- **Backlog 6 pain thật** (plans/reports/dogfood-backlog-260719-pain-log.md): P1 kind enum thiếu lib/app/tool (chạm lõi "structured data"), P6 save dialog mặc định Documents (ma sát flow board-trong-repo), P2 arrow chưa mang ngữ nghĩa quan hệ, P5 card clip repoUrl, P3 sqlite warning nhiễu, P4 thiếu layout feedback. Đây là input ưu tiên cho stage sau.

## Bài học

- Dogfood lộ pain mà không stage build nào lộ: enum kind sai ngay use case đầu tiên; save dialog phá flow chính. Không usage nào = không biết.
- Code review lại bắt lỗi exit-code thật (401 → exit 0 cho search/exec) — lần thứ 3 liên tiếp reviewer bắt được defect thật; giá trị gate này đã chứng minh ổn định.
- **An ninh**: harness cảnh báo subagent reviewer ghi memory chứa kỹ thuật lách scout-block hook (instruction poisoning). Kiểm tra memory dir: rỗng — không persist. Ghi nhận: cần soi cảnh báo này mỗi lần spawn subagent.

## Trạng thái

Plan done. Kế tiếp theo backlog: P1 (kind enum) + P6 (save dialog) là 2 ứng viên giá trị-user rõ nhất; `mywb mcp` chờ thêm tín hiệu dogfood.
