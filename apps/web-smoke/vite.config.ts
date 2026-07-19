import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [react()],
	optimizeDeps: {
		// Same workaround as the desktop renderer: the dep optimizer rewrites
		// this package's `new URL(x, import.meta.url)` asset refs and breaks them.
		exclude: ['@tldraw/assets']
	}
})
