import type { Editor } from 'tldraw'
import { getSnapshot, loadSnapshot } from 'tldraw'

// The only place that knows how an editor becomes a serialized document and
// back. Phase 2 keeps this interface and swaps the transport underneath.

export function serializeDocument(editor: Editor): string {
	return JSON.stringify(getSnapshot(editor.store))
}

export function deserializeDocument(editor: Editor, documentJson: string): void {
	loadSnapshot(editor.store, JSON.parse(documentJson))
}
