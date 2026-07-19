import type { SerializedRecord } from '../format/mywb-format-types'

// Persistence contract for a document's serialized records. Mirrors the
// desktop RecordsDatabase API; checkpoint() stays on the sqlite class because
// folding a WAL is a sqlite concern, not part of the storage contract.

export interface RecordStore {
	/** Upsert `put` then delete `removed`, atomically. Removal wins on overlap. */
	applyDiff(put: SerializedRecord[], removed: string[]): void
	/** Replace the whole record set (used when saving a full snapshot). */
	replaceAll(records: SerializedRecord[], schemaJson: string): void
	loadAllRecords(): SerializedRecord[]
	getSchemaJson(): string | null
	setSchemaJson(schemaJson: string): void
	close(): void
}
