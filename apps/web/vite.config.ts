import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [react()],
	optimizeDeps: {
		// @tldraw/assets: the dep optimizer rewrites its new URL(x, import.meta.url)
		// asset refs and breaks them. sql.js ships a wasm loaded at runtime via its
		// own loader — keep it out of the pre-bundle so that resolves.
		exclude: ['@tldraw/assets', 'sql.js']
	},
	assetsInclude: ['**/*.wasm']
})
