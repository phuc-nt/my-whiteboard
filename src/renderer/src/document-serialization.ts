import type { Editor } from 'tldraw'
import { loadSnapshot } from 'tldraw'

// Hydrates an editor from the {store, schema} snapshot JSON served by main.
// The reverse direction (capture for save) lives in document-sync.ts.

export function deserializeDocument(editor: Editor, documentJson: string): void {
	loadSnapshot(editor.store, JSON.parse(documentJson))
}
