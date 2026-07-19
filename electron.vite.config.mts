import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()]
	},
	preload: {
		// Preload must stay CJS so it can run with sandbox: true renderers —
		// with "type": "module" electron-vite would otherwise emit ESM.
		plugins: [externalizeDepsPlugin()],
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
