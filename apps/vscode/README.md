# My Whiteboard for VS Code

Open and edit `.mywb` whiteboard files on a full tldraw canvas inside VS Code.
Same format, same custom shapes (service-node, code-ref, mermaid-block) as the
desktop app — the board in your repo is now editable next to the code it
describes.

## Install (local .vsix)

```bash
npm install && npm run build -w apps/vscode
npm run package:vsix -w apps/vscode
code --install-extension apps/vscode/my-whiteboard.vsix
```

Open any `.mywb` file — it loads in the board editor. Edit, then save with
Cmd+S like any file.

## Limitations (v0.1, by design)

- **Document scripts do not run.** A `script/` embedded in the file is
  carried through saves untouched but never executed in the webview — no
  consent surface here yet; use the desktop app for script behavior.
- **No agent API.** Agents already reach `.mywb` files headlessly via
  `mywb file read|apply|scaffold|mermaid` and the running desktop app via
  HTTP/MCP; the extension adds no new surface.
- **Don't edit the same file in VS Code and the desktop app at once** — no
  cross-app locking, last save wins (same caveat as any external editor).
- **VS Code-level undo on the tab is a no-op**; use the canvas's own
  undo/redo inside the board.

## Development

```bash
npm run build -w apps/vscode      # webview bundle (vite) + extension (tsc)
npm run e2e:vscode                # integration tests in a real downloaded VS Code
```
