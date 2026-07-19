import type { InitialSnapshotPayload, RecordsDiffPayload } from '../format/mywb-format-types'

// The environment-specific channel document-sync streams through: IPC on
// desktop, a WebSocket or in-memory store on other targets. Core never knows.

export interface SyncTransport {
	pushInitialSnapshot(payload: InitialSnapshotPayload): Promise<void>
	pushDiff(payload: RecordsDiffPayload): Promise<void>
}

/** Control surface returned by startDocumentSync. */
export interface DocumentSyncHandle {
	/** Push any pending changes now (e.g. the window is about to go away). */
	flush(): void
	/** Stop listening and drop pending changes. */
	dispose(): void
}
