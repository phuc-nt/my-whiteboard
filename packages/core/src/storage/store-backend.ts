import type { SerializedRecord } from '../format/mywb-format-types'

// Async persistence contract for a document's records + schema. The async twin
// of RecordStore: web backends (WASM sqlite, OPFS) are inherently async, so
// this is the interface web code targets. RecordStore (sync) stays as-is for
// desktop; the two share behavior via parallel contract suites.

export interface StoreBackend {
	/** Upsert `put` then delete `removed`, atomically. Removal wins on overlap. */
	applyDiff(put: SerializedRecord[], removed: string[]): Promise<void>
	/** Replace the whole record set (used when saving a full snapshot). */
	replaceAll(records: SerializedRecord[], schemaJson: string): Promise<void>
	loadAllRecords(): Promise<SerializedRecord[]>
	getSchemaJson(): Promise<string | null>
	setSchemaJson(schemaJson: string): Promise<void>
	close(): Promise<void>
}
