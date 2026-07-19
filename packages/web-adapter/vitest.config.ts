import { defineConfig } from 'vitest/config'

// sql.js runs under Node too, so the store + archive logic is testable without
// a browser. Cross-impl tests import @mywb/node-adapter (dev-only) to prove the
// web store reads what node:sqlite wrote and vice versa.
export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts']
	}
})
