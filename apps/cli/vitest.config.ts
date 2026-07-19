import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		// dist/cli.js is built by the package's test script before vitest runs.
		testTimeout: 30_000
	}
})
