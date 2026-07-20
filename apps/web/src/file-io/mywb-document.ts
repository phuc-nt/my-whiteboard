// The bytes↔editor bridge moved to @mywb/web-adapter/editor-bridge so the
// VS Code webview shares it; this re-export keeps existing app imports stable.
export { loadMywbIntoEditor, saveEditorToMywb } from '@mywb/web-adapter/editor-bridge'
export type { LoadedMywb } from '@mywb/web-adapter/editor-bridge'
