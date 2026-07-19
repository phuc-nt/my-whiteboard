import { defineConfig } from 'vite'

// node:sqlite emits an ExperimentalWarning at import time. The cli entry
// installs a warning filter, THEN dynamically imports the real logic (dynamic
// import is not hoisted, so node:sqlite loads after the filter is in place) —
// see src/cli.ts. No banner tricks needed.

// Bundles the CLI into a self-contained dist/cli.js (plus lazy chunks like
// mermaid): only node builtins stay external, so `node dist/cli.js` runs on a
// bare CI runner without relying on how tldraw's ESM resolves under raw Node.
export default defineConfig({
	build: {
		ssr: true,
		target: 'node22',
		outDir: 'dist',
		emptyOutDir: true,
		rollupOptions: {
			input: {
				cli: 'src/cli.ts',
				'make-fixture': 'src/make-fixture.ts'
			},
		}
	},
	ssr: {
		// Bundle every dependency (tldraw, @mywb TS sources, yauzl, zod, ...).
		noExternal: true
	}
})
