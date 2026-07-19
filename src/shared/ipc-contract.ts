// Single source of truth for IPC channel names and payload shapes.
// Imported by main, preload, and renderer so the contract can't drift silently.

/** Renderer → main request/response channels (ipcRenderer.invoke). */
export const RendererToMain = {
	/** Renderer asks for the document it should display. */
	docLoad: 'doc:load',
	/** Renderer reports whether the open document has unsaved changes. */
	docMarkDirty: 'doc:mark-dirty',
	/** Renderer failed to apply the loaded document (corrupt snapshot). */
	docLoadFailed: 'doc:load-failed'
} as const

/** Main → renderer request/response, tunneled over one pair of channels. */
export const MainToRenderer = {
	request: 'main-invoke:request',
	reply: 'main-invoke:reply'
} as const

/** Channels the renderer serves via desktop.onInvoke. */
export type RendererServedChannel = 'editor-get-snapshot' | 'editor-mark-saved'

export interface DocLoadResult {
	filePath: string | null
	/** Serialized document (Phase 1: JSON envelope) or null for a new document. */
	documentJson: string | null
}

/** Reply to editor-mark-saved: did the document change after the snapshot was taken? */
export interface MarkSavedResult {
	stillDirty: boolean
}

export interface MainInvokeRequest {
	id: number
	channel: RendererServedChannel
	payload: unknown
}

export interface MainInvokeReply {
	id: number
	ok: boolean
	result?: unknown
	error?: string
}

/** Phase 1 on-disk envelope. Replaced by the .mywb archive in Phase 2. */
export interface DocumentFileEnvelope {
	formatVersion: 0
	/** tldraw store snapshot as returned by getSnapshot(editor.store). */
	snapshot: unknown
}
