import type { RecordStore } from './record-store'
import type { SerializedRecord } from '../format/mywb-format-types'
import type { StoreBackend } from './store-backend'

// Adapts a sync RecordStore to the async StoreBackend contract. Lets any
// RecordStore (the in-memory one for tests, a sqlite one on desktop if wanted)
// satisfy code written against StoreBackend without duplicating logic.

export class RecordStoreBackend implements StoreBackend {
	#inner: RecordStore

	constructor(inner: RecordStore) {
		this.#inner = inner
	}

	async applyDiff(put: SerializedRecord[], removed: string[]): Promise<void> {
		this.#inner.applyDiff(put, removed)
	}

	async replaceAll(records: SerializedRecord[], schemaJson: string): Promise<void> {
		this.#inner.replaceAll(records, schemaJson)
	}

	async loadAllRecords(): Promise<SerializedRecord[]> {
		return this.#inner.loadAllRecords()
	}

	async getSchemaJson(): Promise<string | null> {
		return this.#inner.getSchemaJson()
	}

	async setSchemaJson(schemaJson: string): Promise<void> {
		this.#inner.setSchemaJson(schemaJson)
	}

	async close(): Promise<void> {
		this.#inner.close()
	}
}
