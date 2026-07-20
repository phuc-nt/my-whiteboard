import { runTests } from '@vscode/test-electron'
import * as path from 'path'

// Downloads a real VS Code (cached) and runs the integration suite inside it.
async function main(): Promise<void> {
	const extensionDevelopmentPath = path.resolve(__dirname, '..', '..')
	const extensionTestsPath = path.resolve(__dirname, 'suite')
	await runTests({
		extensionDevelopmentPath,
		extensionTestsPath,
		launchArgs: ['--disable-workspace-trust']
	})
}

main().catch((error) => {
	console.error('integration tests failed', error)
	process.exit(1)
})
