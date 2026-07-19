import { defineConfig } from 'vitest/config'

// Core must run in plain Node — no Electron, no DOM environment. Tests that
// pass here are proof the code is environment-agnostic.
export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts']
	}
})
