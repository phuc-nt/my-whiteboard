import { DatabaseSync } from 'node:sqlite'
import type { SerializedRecord } from '@mywb/core/format'
import type { RecordStore } from '@mywb/core/storage'
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

// SQLite storage for tldraw records inside a working copy. One row per record;
// incremental upserts keep crash recovery cheap even for large boards.
// Implements the core RecordStore contract; checkpoint() is sqlite-only extra.
// Table layout + SQL come from @mywb/core so the web (sql.js) store shares them.

export class RecordsDatabase implements RecordStore {
	#db: DatabaseSync

	constructor(dbPath: string) {
		this.#db = new DatabaseSync(dbPath)
		try {
			this.#init()
		} catch (error) {
			// A corrupt file (NOTADB) must not leak the open handle.
			try {
				this.#db.close()
			} catch {
				// already closed
			}
			throw error
		}
	}

	#init(): void {
		this.#db.exec('PRAGMA journal_mode = WAL')
		this.#db.exec(RECORD_DB_INIT_SQL)
	}

	applyDiff(put: SerializedRecord[], removed: string[]): void {
		this.#db.exec('BEGIN')
		try {
			const upsert = this.#db.prepare(UPSERT_RECORD_SQL)
			for (const record of put) upsert.run(record.id, record.typeName, record.json)
			const del = this.#db.prepare(DELETE_RECORD_SQL)
			for (const id of removed) del.run(id)
			this.#db.exec('COMMIT')
		} catch (error) {
			this.#db.exec('ROLLBACK')
			throw error
		}
	}

	/** Replace the whole record set (used when saving a full snapshot). */
	replaceAll(records: SerializedRecord[], schemaJson: string): void {
		this.#db.exec('BEGIN')
		try {
			this.#db.exec(DELETE_ALL_RECORDS_SQL)
			const insert = this.#db.prepare(INSERT_RECORD_SQL)
			for (const record of records) insert.run(record.id, record.typeName, record.json)
			this.#db.prepare(UPSERT_META_SQL).run(SCHEMA_META_KEY, schemaJson)
			this.#db.exec('COMMIT')
		} catch (error) {
			this.#db.exec('ROLLBACK')
			throw error
		}
	}

	loadAllRecords(): SerializedRecord[] {
		const rows = this.#db.prepare(SELECT_ALL_RECORDS_SQL).all() as Array<{
			id: string
			type: string
			json: string
		}>
		return rows.map((row) => ({ id: row.id, typeName: row.type, json: row.json }))
	}

	getSchemaJson(): string | null {
		const row = this.#db.prepare(SELECT_META_SQL).get(SCHEMA_META_KEY) as
			| { value: string }
			| undefined
		return row?.value ?? null
	}

	setSchemaJson(schemaJson: string): void {
		this.#db.prepare(UPSERT_META_SQL).run(SCHEMA_META_KEY, schemaJson)
	}

	/** Fold the WAL into db.sqlite so the file can be copied/packed alone. */
	checkpoint(): void {
		this.#db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
	}

	close(): void {
		this.#db.close()
	}
}
