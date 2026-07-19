import { defineConfig } from '@playwright/test'

// Browser (not Electron) smoke test. Uses the system Chrome channel so no
// separate browser download is needed.
export default defineConfig({
	testDir: './e2e',
	timeout: 60_000,
	retries: 0,
	reporter: [['list']],
	use: {
		channel: 'chrome',
		headless: true
	},
	webServer: {
		command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
		url: 'http://127.0.0.1:4173/',
		reuseExistingServer: false
	}
})
