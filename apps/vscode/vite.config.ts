import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Builds the webview bundle into media/. base './' keeps every asset URL
// relative so the extension host can rewrite them to webview URIs at runtime.
export default defineConfig({
	root: 'webview',
	base: './',
	plugins: [react()],
	optimizeDeps: {
		// Same as apps/web: keep tldraw asset URL rewriting and sql.js's own
		// runtime wasm loader out of the pre-bundle.
		exclude: ['@tldraw/assets', 'sql.js']
	},
	assetsInclude: ['**/*.wasm'],
	build: {
		outDir: '../media',
		emptyOutDir: true
	}
})
