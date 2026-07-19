import { DatabaseSync } from 'node:sqlite'
import type { SerializedRecord } from '@mywb/core/format'

// SQLite storage for tldraw records inside a working copy. One row per record;
// incremental upserts keep crash recovery cheap even for large boards.

const SCHEMA_META_KEY = 'tldraw_schema'

export class RecordsDatabase {
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
		this.#db.exec(`
			CREATE TABLE IF NOT EXISTS records (
				-- SQLite quirk: PRIMARY KEY alone still allows NULL — be explicit.
				id TEXT PRIMARY KEY NOT NULL,
				type TEXT NOT NULL,
				json TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS meta (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);
		`)
	}

	applyDiff(put: SerializedRecord[], removed: string[]): void {
		this.#db.exec('BEGIN')
		try {
			const upsert = this.#db.prepare(
				'INSERT INTO records (id, type, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET type = excluded.type, json = excluded.json'
			)
			for (const record of put) upsert.run(record.id, record.typeName, record.json)
			const del = this.#db.prepare('DELETE FROM records WHERE id = ?')
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
			this.#db.exec('DELETE FROM records')
			const insert = this.#db.prepare('INSERT INTO records (id, type, json) VALUES (?, ?, ?)')
			for (const record of records) insert.run(record.id, record.typeName, record.json)
			this.#db
				.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
				.run(SCHEMA_META_KEY, schemaJson)
			this.#db.exec('COMMIT')
		} catch (error) {
			this.#db.exec('ROLLBACK')
			throw error
		}
	}

	loadAllRecords(): SerializedRecord[] {
		const rows = this.#db.prepare('SELECT id, type, json FROM records').all() as Array<{
			id: string
			type: string
			json: string
		}>
		return rows.map((row) => ({ id: row.id, typeName: row.type, json: row.json }))
	}

	getSchemaJson(): string | null {
		const row = this.#db.prepare('SELECT value FROM meta WHERE key = ?').get(SCHEMA_META_KEY) as
			| { value: string }
			| undefined
		return row?.value ?? null
	}

	setSchemaJson(schemaJson: string): void {
		this.#db
			.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
			.run(SCHEMA_META_KEY, schemaJson)
	}

	/** Fold the WAL into db.sqlite so the file can be copied/packed alone. */
	checkpoint(): void {
		this.#db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
	}

	close(): void {
		this.#db.close()
	}
}
