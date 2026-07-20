import * as assert from 'assert'
import { execFile } from 'child_process'
import { copyFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'
import { promisify } from 'util'
import * as vscode from 'vscode'
import type { MywbEditorProvider } from '../../mywb-editor-provider'

const run = promisify(execFile)

// Spike acceptance: the repo's real committed board opens in the custom
// editor and the webview reports the same shape count the headless CLI sees.

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..')
const REPO_BOARD = path.join(repoRoot, 'docs', 'architecture.mywb')
const CLI = path.join(repoRoot, 'apps', 'cli', 'dist', 'cli.js')

describe('real board in the custom editor', () => {
	it('opens docs/architecture.mywb and renders the exact shape count', async function () {
		this.timeout(120_000)

		const { stdout } = await run(process.execPath, [CLI, 'file', 'read', REPO_BOARD, '--json'])
		const doc = JSON.parse(stdout) as { records: Array<{ typeName: string }> }
		const expectedShapeCount = doc.records.filter((r) => r.typeName === 'shape').length
		assert.ok(expectedShapeCount > 0, 'committed board must have shapes')

		const workDir = mkdtempSync(path.join(tmpdir(), 'mywb-vscode-test-'))
		const boardCopy = path.join(workDir, 'architecture.mywb')
		copyFileSync(REPO_BOARD, boardCopy)

		const extension = vscode.extensions.getExtension('phuc-nt.my-whiteboard-vscode')
		assert.ok(extension, 'extension not found')
		const { provider } = (await extension.activate()) as { provider: MywbEditorProvider }

		const rendered = new Promise<number>((resolve) => {
			provider.onRendered(({ shapeCount }) => resolve(shapeCount))
		})
		await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(boardCopy), 'mywb.board')

		const shapeCount = await Promise.race([
			rendered,
			new Promise<number>((_, reject) =>
				setTimeout(() => reject(new Error('webview never reported rendered')), 90_000)
			)
		])
		assert.strictEqual(shapeCount, expectedShapeCount)
	})
})
