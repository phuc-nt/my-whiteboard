import { defineConfig } from '@playwright/test'

// Electron e2e. Tests launch the built app and drive it through the agent API
// and the exposed editor; keep them serial (single app instance, shared port).
export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	workers: 1,
	timeout: 60_000,
	retries: 0,
	reporter: [['list']]
})
