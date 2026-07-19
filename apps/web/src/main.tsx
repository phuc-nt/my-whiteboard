import { configureSqlJs } from '@mywb/web-adapter/wasm-sqlite-store'
import { createRoot } from 'react-dom/client'
import { App } from './app'
// Vite resolves the bundled sql.js wasm to a real, servable URL — without this,
// sql.js fetches sql-wasm.wasm from the page root and gets index.html back.
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

configureSqlJs(() => sqlWasmUrl)

createRoot(document.getElementById('root')!).render(<App />)
