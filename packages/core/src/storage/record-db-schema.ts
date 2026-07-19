// The SQLite layout of a document's record store, shared by every engine that
// reads/writes a .mywb `db.sqlite` — node:sqlite on desktop, sql.js on web.
// One source of truth so the two implementations can never drift the schema
// and split the file format. Plain SQL strings, no engine dependency.

export const SCHEMA_META_KEY = 'tldraw_schema'

/** DDL run on open; both tables use IF NOT EXISTS so it is idempotent. */
export const RECORD_DB_INIT_SQL = `
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
`

export const UPSERT_RECORD_SQL =
	'INSERT INTO records (id, type, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET type = excluded.type, json = excluded.json'
export const DELETE_RECORD_SQL = 'DELETE FROM records WHERE id = ?'
export const DELETE_ALL_RECORDS_SQL = 'DELETE FROM records'
export const INSERT_RECORD_SQL = 'INSERT INTO records (id, type, json) VALUES (?, ?, ?)'
export const SELECT_ALL_RECORDS_SQL = 'SELECT id, type, json FROM records'
export const UPSERT_META_SQL =
	'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
export const SELECT_META_SQL = 'SELECT value FROM meta WHERE key = ?'
