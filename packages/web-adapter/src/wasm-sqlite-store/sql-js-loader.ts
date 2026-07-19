import initSqlJs from 'sql.js'
import type { SqlJsStatic } from 'sql.js'

// sql.js ships its engine as a .wasm loaded at runtime. Init once and cache the
// promise; every store shares one engine instance.
//
// The wasm URL differs by environment. sql.js's default locateFile fetches
// `sql-wasm.wasm` from the page root, which in a bundled app returns index.html
// (a 404 fallback) and fails to instantiate. Callers pass a resolver: the web
// app resolves the bundled asset with `new URL('.../sql-wasm.wasm', ...)`; Node
// tests pass nothing and sql.js finds the wasm beside its own package.

export type WasmLocator = (file: string) => string

let enginePromise: Promise<SqlJsStatic> | null = null

export function configureSqlJs(locateFile: WasmLocator): void {
	if (enginePromise) return
	enginePromise = initSqlJs({ locateFile })
}

export function loadSqlJs(): Promise<SqlJsStatic> {
	enginePromise ??= initSqlJs()
	return enginePromise
}
