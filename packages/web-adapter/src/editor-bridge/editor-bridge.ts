import type { MywbMetadata, SerializedRecord } from '@mywb/core/format'
import { captureFullSnapshot, deserializeDocument } from '@mywb/core/sync'
import type { Editor } from 'tldraw'
import { readMywbArchive, writeMywbArchive } from '../web-archive'
import { WasmSqliteStore } from '../wasm-sqlite-store'

// Glue between .mywb bytes and a live tldraw editor, shared by every
// browser-context surface (web app, VS Code webview). Open extracts the
// archive, reads records out of the WASM sqlite store, rebuilds the
// {store,schema} snapshot the way loadSnapshot expects, and hydrates the
// editor. Save captures the editor snapshot back into a fresh store and
// re-packs the archive. Assets are carried through unchanged so a round-trip
// is byte-faithful.

export interface LoadedMywb {
	name: string
	assets: Map<string, Uint8Array>
	scriptFiles?: Map<string, string>
	metadata: MywbMetadata
}

/** Hydrate `editor` from .mywb bytes; returns the non-record parts to carry on Save. */
export async function loadMywbIntoEditor(
	editor: Editor,
	bytes: Uint8Array,
	name: string
): Promise<LoadedMywb> {
	const archive = readMywbArchive(bytes)
	const store = await WasmSqliteStore.fromBytes(archive.dbBytes)
	try {
		const records = await store.loadAllRecords()
		const schemaJson = await store.getSchemaJson()
		if (schemaJson && records.length > 0) {
			const snapshot = {
				store: Object.fromEntries(records.map((r) => [r.id, JSON.parse(r.json)])),
				schema: JSON.parse(schemaJson)
			}
			deserializeDocument(editor.store, JSON.stringify(snapshot))
		}
		return {
			name,
			assets: archive.assets,
			metadata: archive.metadata,
			...(archive.scriptFiles ? { scriptFiles: archive.scriptFiles } : {})
		}
	} finally {
		await store.close()
	}
}

/** Serialize the editor's current document back into .mywb bytes. */
export async function saveEditorToMywb(editor: Editor, loaded: LoadedMywb): Promise<Uint8Array> {
	const snapshot = captureFullSnapshot(editor.store)
	const store = await WasmSqliteStore.fromBytes()
	try {
		await store.replaceAll(snapshot.records as SerializedRecord[], snapshot.schemaJson)
		const dbBytes = store.toBytes()
		return writeMywbArchive({
			metadata: loaded.metadata,
			dbBytes,
			assets: loaded.assets,
			...(loaded.scriptFiles ? { scriptFiles: loaded.scriptFiles } : {})
		})
	} finally {
		await store.close()
	}
}
