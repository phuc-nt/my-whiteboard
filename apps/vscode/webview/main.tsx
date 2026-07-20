import { configureSqlJs } from '@mywb/web-adapter/wasm-sqlite-store'
import { createRoot } from 'react-dom/client'
// Vite resolves the bundled sql.js wasm to a URL relative to the bundle; the
// extension host rewrites it to a webview URI along with every other asset.
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { BoardApp } from './board-app'

configureSqlJs(() => sqlWasmUrl)

createRoot(document.getElementById('root')!).render(<BoardApp />)
