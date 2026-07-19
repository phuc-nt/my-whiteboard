import type { TLStore } from 'tldraw'
import { loadSnapshot } from 'tldraw'

// Hydrates a store from the {store, schema} snapshot JSON produced at save.
// The reverse direction (capture for save) lives in document-sync.ts.

export function deserializeDocument(store: TLStore, documentJson: string): void {
	loadSnapshot(store, JSON.parse(documentJson))
}
