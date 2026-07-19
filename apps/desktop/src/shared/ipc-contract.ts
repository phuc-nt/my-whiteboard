// Single source of truth for IPC channel names and payload shapes.
// Imported by main, preload, and renderer so the contract can't drift silently.

/** Renderer → main request/response channels (ipcRenderer.invoke). */
export const RendererToMain = {
	/** Renderer asks for the document it should display. */
	docLoad: 'doc:load',
	/** Renderer failed to apply the loaded document (corrupt snapshot). */
	docLoadFailed: 'doc:load-failed',
	/** One-time full snapshot right after mount (baseline for recovery). */
	docPushInitialSnapshot: 'doc:push-initial-snapshot',
	/** Debounced incremental record changes → working copy. */
	docPushDiff: 'doc:push-diff',
	/** Store a pasted/dropped media file; returns its mywb-asset:// URL. */
	docStoreAsset: 'doc:store-asset'
} as const

/** Main → renderer request/response, tunneled over one pair of channels. */
export const MainToRenderer = {
	request: 'main-invoke:request',
	reply: 'main-invoke:reply'
} as const

/** Channels the renderer serves via desktop.onInvoke. */
export type RendererServedChannel = 'editor-get-snapshot' | 'exec-code' | 'run-document-script'

export interface DocLoadResult {
	filePath: string | null
	/** Full store snapshot JSON ({store, schema}) or null for a new document. */
	documentJson: string | null
}

/** Reply from editor-get-snapshot: full record set + schema at capture time. */
export interface EditorSnapshotResult {
	records: Array<{ id: string; typeName: string; json: string }>
	schemaJson: string
}

export interface StoreAssetRequest {
	assetId: string
	bytes: ArrayBuffer
}

export interface StoreAssetResult {
	/** mywb-asset://doc/<documentId>/<assetId> */
	src: string
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
