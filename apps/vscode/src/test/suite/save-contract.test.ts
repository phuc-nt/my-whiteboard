import * as assert from 'assert'
import { execFile } from 'child_process'
import { copyFileSync, mkdtempSync, statSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'
import { promisify } from 'util'
import * as vscode from 'vscode'
import type { MywbEditorProvider } from '../../mywb-editor-provider'

const run = promisify(execFile)

// Save-contract coverage on the real board: dirty signal, save (webview does
// the real serialize), revert re-init, backup file. The canvas-side edit path
// itself is covered by the web e2e (same editor-bridge); here the host
// contract around it is what's under test.

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..')
const REPO_BOARD = path.join(repoRoot, 'docs', 'architecture.mywb')
const CLI = path.join(repoRoot, 'apps', 'cli', 'dist', 'cli.js')

async function readDocumentId(file: string): Promise<{ documentId: string; shapes: number }> {
	const { stdout } = await run(process.execPath, [CLI, 'file', 'read', file, '--json'])
	const doc = JSON.parse(stdout) as {
		metadata: { documentId: string }
		records: Array<{ typeName: string }>
	}
	return {
		documentId: doc.metadata.documentId,
		shapes: doc.records.filter((r) => r.typeName === 'shape').length
	}
}

describe('custom editor save contract', () => {
	let provider: MywbEditorProvider
	let boardCopy: string
	let workDir: string

	before(async function () {
		this.timeout(120_000)
		workDir = mkdtempSync(path.join(tmpdir(), 'mywb-vscode-save-'))
		boardCopy = path.join(workDir, 'board.mywb')
		copyFileSync(REPO_BOARD, boardCopy)

		const extension = vscode.extensions.getExtension('phuc-nt.my-whiteboard-vscode')!
		provider = ((await extension.activate()) as { provider: MywbEditorProvider }).provider

		const rendered = new Promise<void>((resolve) => {
			provider.onRendered(() => resolve())
		})
		await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(boardCopy), 'mywb.board')
		await rendered
	})

	function activeTabDirty(): boolean {
		return vscode.window.tabGroups.activeTabGroup.activeTab?.isDirty ?? false
	}

	it('opening a board does not mark it dirty (hydration is not an edit)', async () => {
		// tldraw hydration flushes listener history on the next frame — give it
		// two frames' worth of time before asserting.
		await new Promise((r) => setTimeout(r, 500))
		assert.strictEqual(activeTabDirty(), false)
	})

	it('edited message marks the document dirty via onDidChangeCustomDocument', async () => {
		const dirty = new Promise<void>((resolve) => {
			provider.onDidChangeCustomDocument(() => resolve())
		})
		provider.simulateEditedForTest(vscode.Uri.file(boardCopy))
		await dirty
	})

	it('save writes bytes the headless CLI reads back with identical identity', async function () {
		this.timeout(60_000)
		const before = await readDocumentId(boardCopy)
		const beforeMtime = statSync(boardCopy).mtimeMs

		await provider.saveDocumentForTest(vscode.Uri.file(boardCopy))

		const after = await readDocumentId(boardCopy)
		assert.strictEqual(after.documentId, before.documentId)
		assert.strictEqual(after.shapes, before.shapes)
		assert.ok(statSync(boardCopy).mtimeMs >= beforeMtime)
	})

	it('backup writes a parseable board to the destination', async function () {
		this.timeout(60_000)
		const destination = vscode.Uri.file(path.join(workDir, 'backup.mywb'))
		const backup = await provider.backupDocumentForTest(vscode.Uri.file(boardCopy), destination)
		const parsed = await readDocumentId(destination.fsPath)
		assert.ok(parsed.shapes > 0)
		await backup.delete()
	})

	it('revert re-initializes the webview and clears dirty', async function () {
		this.timeout(60_000)
		provider.simulateEditedForTest(vscode.Uri.file(boardCopy))
		await new Promise((r) => setTimeout(r, 200))
		assert.strictEqual(activeTabDirty(), true, 'precondition: edit marks dirty')

		const rendered = new Promise<void>((resolve) => {
			provider.onRendered(() => resolve())
		})
		// Go through VS Code's own revert so the editor clears dirty the way it
		// does for a user — calling the provider method directly would skip that.
		await vscode.commands.executeCommand('workbench.action.files.revert')
		await rendered
		await new Promise((r) => setTimeout(r, 500))
		assert.strictEqual(activeTabDirty(), false, 'revert must clear dirty and not re-dirty')
	})
})
