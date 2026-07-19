import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
	main: {
		// @mywb packages ship TS source resolved via package exports — they must
		// be bundled, not left as external requires the built app can't load.
		// yauzl/yazl ride along (deps of node-adapter, no longer declared here).
		plugins: [
			externalizeDepsPlugin({ exclude: ['@mywb/core', '@mywb/node-adapter', 'yauzl', 'yazl'] })
		]
	},
	preload: {
		// Preload must stay CJS so it can run with sandbox: true renderers —
		// with "type": "module" electron-vite would otherwise emit ESM.
		plugins: [externalizeDepsPlugin({ exclude: ['@mywb/core'] })],
		build: {
			rollupOptions: {
				output: { format: 'cjs' }
			}
		}
	},
	renderer: {
		plugins: [react()],
		optimizeDeps: {
			// The dep optimizer rewrites this package's `new URL(x, import.meta.url)`
			// asset references and breaks them at runtime (undefined.startsWith crash).
			exclude: ['@tldraw/assets']
		}
	}
})
