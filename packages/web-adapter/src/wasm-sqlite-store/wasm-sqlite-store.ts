import type { SerializedRecord } from '@mywb/core/format'
import type { StoreBackend } from '@mywb/core/storage'
import {
	DELETE_ALL_RECORDS_SQL,
	DELETE_RECORD_SQL,
	INSERT_RECORD_SQL,
	RECORD_DB_INIT_SQL,
	SCHEMA_META_KEY,
	SELECT_ALL_RECORDS_SQL,
	SELECT_META_SQL,
	UPSERT_META_SQL,
	UPSERT_RECORD_SQL
} from '@mywb/core/storage'
import type { Database } from 'sql.js'
import { loadSqlJs } from './sql-js-loader'

// StoreBackend backed by sql.js (WASM SQLite) over an in-memory database. Reads
// and writes the SAME table layout as the desktop node:sqlite store (SQL from
// @mywb/core), so a db.sqlite made by either opens in the other. Async only at
// construction (WASM init); operations are sync under the hood but the
// StoreBackend contract is async — that is the whole point of the interface.

export class WasmSqliteStore implements StoreBackend {
	#db: Database
	#closed = false

	private constructor(db: Database) {
		this.#db = db
	}

	/**
	 * Open a store over an existing db.sqlite (e.g. extracted from a .mywb), or
	 * an empty in-memory one when no bytes are given.
	 */
	static async fromBytes(dbBytes?: Uint8Array): Promise<WasmSqliteStore> {
		const SQL = await loadSqlJs()
		const db = dbBytes ? new SQL.Database(dbBytes) : new SQL.Database()
		// A file authored elsewhere may predate a table; init is idempotent.
		db.run(RECORD_DB_INIT_SQL)
		return new WasmSqliteStore(db)
	}

	#assertOpen(): void {
		if (this.#closed) throw new Error('WasmSqliteStore is closed')
	}

	async applyDiff(put: SerializedRecord[], removed: string[]): Promise<void> {
		this.#assertOpen()
		this.#db.run('BEGIN')
		try {
			const upsert = this.#db.prepare(UPSERT_RECORD_SQL)
			try {
				for (const r of put) upsert.run([r.id, r.typeName, r.json])
			} finally {
				upsert.free()
			}
			const del = this.#db.prepare(DELETE_RECORD_SQL)
			try {
				for (const id of removed) del.run([id])
			} finally {
				del.free()
			}
			this.#db.run('COMMIT')
		} catch (error) {
			this.#db.run('ROLLBACK')
			throw error
		}
	}

	async replaceAll(records: SerializedRecord[], schemaJson: string): Promise<void> {
		this.#assertOpen()
		this.#db.run('BEGIN')
		try {
			this.#db.run(DELETE_ALL_RECORDS_SQL)
			const insert = this.#db.prepare(INSERT_RECORD_SQL)
			try {
				for (const r of records) insert.run([r.id, r.typeName, r.json])
			} finally {
				insert.free()
			}
			this.#db.run(UPSERT_META_SQL, [SCHEMA_META_KEY, schemaJson])
			this.#db.run('COMMIT')
		} catch (error) {
			this.#db.run('ROLLBACK')
			throw error
		}
	}

	async loadAllRecords(): Promise<SerializedRecord[]> {
		this.#assertOpen()
		const stmt = this.#db.prepare(SELECT_ALL_RECORDS_SQL)
		const out: SerializedRecord[] = []
		while (stmt.step()) {
			const [id, type, json] = stmt.get() as [string, string, string]
			out.push({ id, typeName: type, json })
		}
		stmt.free()
		return out
	}

	async getSchemaJson(): Promise<string | null> {
		this.#assertOpen()
		const stmt = this.#db.prepare(SELECT_META_SQL)
		stmt.bind([SCHEMA_META_KEY])
		const value = stmt.step() ? (stmt.get()[0] as string) : null
		stmt.free()
		return value
	}

	async setSchemaJson(schemaJson: string): Promise<void> {
		this.#assertOpen()
		this.#db.run(UPSERT_META_SQL, [SCHEMA_META_KEY, schemaJson])
	}

	async close(): Promise<void> {
		if (this.#closed) return
		this.#closed = true
		this.#db.close()
	}

	/** Serialize the current database to bytes for re-packing into a .mywb. */
	toBytes(): Uint8Array {
		this.#assertOpen()
		return this.#db.export()
	}
}

/** Convenience for tests/new documents: an empty store with tables created. */
export function createEmptyWasmSqliteStore(): Promise<WasmSqliteStore> {
	return WasmSqliteStore.fromBytes()
}
