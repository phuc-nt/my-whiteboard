import type { TLRecord, TLStore } from 'tldraw'
import type { SerializedRecord } from '../format/mywb-format-types'
import type { DocumentSyncHandle, SyncTransport } from './sync-transport'

// Streams document changes through the injected transport so a crash never
// loses more than the debounce window. Also serves the full-snapshot capture
// used by Save. Environment lifecycle (pagehide, IPC) is the adapter's job.

const FLUSH_INTERVAL_MS = 500

function serializeRecord(record: TLRecord): SerializedRecord {
	return { id: record.id, typeName: record.typeName, json: JSON.stringify(record) }
}

/** Full document-scope snapshot: records + schema, ready for the transport. */
export function captureFullSnapshot(store: TLStore): {
	records: SerializedRecord[]
	schemaJson: string
} {
	// Store-level snapshot (not the editor-level getSnapshot wrapper): same
	// document-scope records + schema, but works without editor session state.
	const { store: records, schema } = store.getStoreSnapshot('document')
	return {
		records: Object.values(records as Record<string, TLRecord>).map(serializeRecord),
		schemaJson: JSON.stringify(schema)
	}
}

/**
 * Start pushing changes: one initial full snapshot (baseline: default records
 * of a fresh document are not "user" changes and would otherwise never reach
 * the working copy), then debounced diffs of user document edits.
 */
export function startDocumentSync(store: TLStore, transport: SyncTransport): DocumentSyncHandle {
	let disposed = false
	const pendingPut = new Map<string, TLRecord>()
	const pendingRemoved = new Set<string>()
	let flushTimer: ReturnType<typeof setTimeout> | null = null

	const snapshot = captureFullSnapshot(store)
	void transport
		.pushInitialSnapshot({ records: snapshot.records, schemaJson: snapshot.schemaJson })
		.catch((error) => console.error('Initial snapshot push failed:', error))

	function flush(): void {
		flushTimer = null
		if (disposed || (pendingPut.size === 0 && pendingRemoved.size === 0)) return
		const diff = {
			put: [...pendingPut.values()].map(serializeRecord),
			removed: [...pendingRemoved]
		}
		pendingPut.clear()
		pendingRemoved.clear()
		void transport.pushDiff(diff).catch((error) => console.error('Diff push failed:', error))
	}

	// Leading + trailing debounce: the FIRST change of a burst flushes
	// immediately (main learns "dirty" with no lag — a clean close inside the
	// debounce window must still prompt), the rest batches at the interval.
	function scheduleFlush(): void {
		if (flushTimer) return
		flush()
		flushTimer = setTimeout(() => {
			flushTimer = null
			if (pendingPut.size > 0 || pendingRemoved.size > 0) flush()
		}, FLUSH_INTERVAL_MS)
	}

	const stopListening = store.listen(
		(entry) => {
			for (const record of Object.values(entry.changes.added)) {
				pendingRemoved.delete(record.id)
				pendingPut.set(record.id, record)
			}
			for (const [, to] of Object.values(entry.changes.updated)) {
				pendingPut.set(to.id, to)
			}
			for (const record of Object.values(entry.changes.removed)) {
				pendingPut.delete(record.id)
				pendingRemoved.add(record.id)
			}
			scheduleFlush()
		},
		{ scope: 'document', source: 'user' }
	)

	return {
		flush,
		dispose() {
			disposed = true
			if (flushTimer) clearTimeout(flushTimer)
			stopListening()
		}
	}
}
