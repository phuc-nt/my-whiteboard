import type { SerializedRecord } from '../format/mywb-format-types'
import type { RecordStore } from './record-store'

// Map-backed RecordStore for tests and browser targets that have no durable
// storage yet. Matches the sqlite adapter's observable behavior, including
// throwing on use after close.

export class MemoryRecordStore implements RecordStore {
	#records = new Map<string, SerializedRecord>()
	#schemaJson: string | null = null
	#closed = false

	#assertOpen(): void {
		if (this.#closed) throw new Error('RecordStore is closed')
	}

	applyDiff(put: SerializedRecord[], removed: string[]): void {
		this.#assertOpen()
		for (const record of put) this.#records.set(record.id, record)
		for (const id of removed) this.#records.delete(id)
	}

	replaceAll(records: SerializedRecord[], schemaJson: string): void {
		this.#assertOpen()
		this.#records.clear()
		for (const record of records) this.#records.set(record.id, record)
		this.#schemaJson = schemaJson
	}

	loadAllRecords(): SerializedRecord[] {
		this.#assertOpen()
		return [...this.#records.values()]
	}

	getSchemaJson(): string | null {
		this.#assertOpen()
		return this.#schemaJson
	}

	setSchemaJson(schemaJson: string): void {
		this.#assertOpen()
		this.#schemaJson = schemaJson
	}

	close(): void {
		this.#closed = true
	}
}
