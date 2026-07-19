import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		// App tests only — .claude/ carries its own tooling tests that must not
		// run in this project's suite.
		include: ['src/**/*.test.ts']
	}
})
