import type { Editor, TLRecord } from 'tldraw'
import { getSnapshot } from 'tldraw'
import type { SerializedRecord } from '@mywb/core/format'

// Streams document changes to the main process working copy so a crash never
// loses more than the debounce window. Also serves the full-snapshot capture
// used by Save.

const FLUSH_INTERVAL_MS = 500

function serializeRecord(record: TLRecord): SerializedRecord {
	return { id: record.id, typeName: record.typeName, json: JSON.stringify(record) }
}

/** Full document-scope snapshot: records + schema, ready for IPC. */
export function captureFullSnapshot(editor: Editor): {
	records: SerializedRecord[]
	schemaJson: string
} {
	const { document } = getSnapshot(editor.store)
	return {
		records: Object.values(document.store as Record<string, TLRecord>).map(serializeRecord),
		schemaJson: JSON.stringify(document.schema)
	}
}

/**
 * Start pushing changes: one initial full snapshot (baseline: default records
 * of a fresh document are not "user" changes and would otherwise never reach
 * the working copy), then debounced diffs of user document edits.
 */
export function startDocumentSync(editor: Editor): () => void {
	let disposed = false
	const pendingPut = new Map<string, TLRecord>()
	const pendingRemoved = new Set<string>()
	let flushTimer: ReturnType<typeof setTimeout> | null = null

	const snapshot = captureFullSnapshot(editor)
	void window.desktop
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
		void window.desktop.pushDiff(diff).catch((error) => console.error('Diff push failed:', error))
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

	const stopListening = editor.store.listen(
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

	// Best-effort final flush when the window is going away.
	const onPageHide = (): void => flush()
	window.addEventListener('pagehide', onPageHide)

	return () => {
		disposed = true
		if (flushTimer) clearTimeout(flushTimer)
		window.removeEventListener('pagehide', onPageHide)
		stopListening()
	}
}
