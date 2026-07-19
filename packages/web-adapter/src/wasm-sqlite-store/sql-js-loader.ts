import initSqlJs from 'sql.js'
import type { SqlJsStatic } from 'sql.js'

// sql.js ships its engine as a .wasm loaded at runtime. Init once and cache the
// promise; every store shares one engine instance. In a browser build the
// bundler must serve `sql-wasm.wasm` — the app configures locateFile there. In
// Node (tests) sql.js finds the wasm beside its own package with no config.

let enginePromise: Promise<SqlJsStatic> | null = null

export function loadSqlJs(): Promise<SqlJsStatic> {
	enginePromise ??= initSqlJs()
	return enginePromise
}
