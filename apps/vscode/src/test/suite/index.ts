import { glob } from 'glob'
import Mocha from 'mocha'
import * as path from 'path'

// Standard @vscode/test-electron entry: collect *.test.js and run mocha.
export async function run(): Promise<void> {
	const mocha = new Mocha({ ui: 'bdd', timeout: 60_000, color: true })
	const testsRoot = __dirname
	const files = await glob('**/*.test.js', { cwd: testsRoot })
	for (const file of files) mocha.addFile(path.resolve(testsRoot, file))
	await new Promise<void>((resolve, reject) => {
		mocha.run((failures) => (failures > 0 ? reject(new Error(`${failures} tests failed`)) : resolve()))
	})
}
