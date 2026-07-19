import { defineConfig } from '@playwright/test'

// Config for the read-only Agent Gateway e2e. That spec builds the app with a
// relay URL/token baked in and serves it itself (env must be present at build
// time), so there is no shared webServer here — unlike the default config.
export default defineConfig({
	testDir: './e2e',
	testMatch: ['**/relay-gateway.spec.ts'],
	// Building + serving the app inside beforeAll needs headroom.
	timeout: 120_000,
	retries: 0,
	reporter: [['list']],
	use: {
		channel: 'chrome',
		headless: true
	}
})
