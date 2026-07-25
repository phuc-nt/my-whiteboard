import { expect, test, type ElectronApplication } from '@playwright/test'
import { execFile } from 'child_process'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { promisify } from 'util'
import { connectAgentApi, focusedDocId, launchApp, shutdownApp } from './electron-app-fixture'

// The very first launch — no previous session, no file to open — shows a real
// welcome board instead of a blank canvas. Everything else keeps the empty
// document it always had. The branches below are the whole contract.
//
// Each launch gets a fresh userData dir, so every launch here IS a first run;
// what varies is the opt-out flag and whether a file arrives with the launch.
// MYWB_NO_WELCOME='' turns the fixture's default opt-out back off.

const here = dirname(fileURLToPath(import.meta.url))
const CLI = join(here, '..', '..', 'cli', 'dist', 'cli.js')
const run = promisify(execFile)
const WELCOME = { MYWB_NO_WELCOME: '' }

/** Open-document names — the .mywb basename, or 'Untitled' when unsaved. */
async function docNames(): Promise<string[]> {
	const api = await connectAgentApi()
	await focusedDocId(api)
	const docs = await api.search<Array<{ name: string }>>('return await api.getDocs()')
	return docs.map((d) => d.name)
}

/**
 * Poll doc names until `done` accepts them. A window opened by an event after
 * startup (macOS open-file) is not there the instant the agent API answers.
 */
async function waitForDocNames(done: (names: string[]) => boolean): Promise<string[]> {
	let names: string[] = []
	for (let attempt = 0; attempt < 40; attempt++) {
		names = await docNames()
		if (done(names)) return names
		await new Promise((r) => setTimeout(r, 250))
	}
	return names
}

test('a first launch with nothing else to show opens the welcome board', async () => {
	const app = await launchApp(WELCOME)
	try {
		expect(await docNames()).toEqual(['welcome'])
	} finally {
		await shutdownApp(app)
	}
})

test('the welcome board is a real board, not a blank canvas', async () => {
	const app = await launchApp(WELCOME)
	try {
		const api = await connectAgentApi()
		const docId = await focusedDocId(api)
		// The window exists before the renderer has deserialized the board, so
		// poll until shapes land instead of reading an empty store.
		let types: string[] = []
		for (let attempt = 0; attempt < 40 && types.length === 0; attempt++) {
			const res = await api.exec<string[]>(
				docId,
				'return editor.getCurrentPageShapes().map((s) => s.type)'
			)
			if (res.success) types = res.result ?? []
			if (types.length === 0) await new Promise((r) => setTimeout(r, 250))
		}
		// Scaffolded cards plus the sticky notes explaining the app.
		expect(types.filter((t) => t === 'service-node').length).toBeGreaterThan(0)
		expect(types.filter((t) => t === 'note').length).toBeGreaterThan(0)
	} finally {
		await shutdownApp(app)
	}
})

test('the opt-out flag keeps the plain empty document', async () => {
	// This is also what every other spec in the suite launches with.
	const app = await launchApp()
	try {
		expect(await docNames()).toEqual(['Untitled'])
	} finally {
		await shutdownApp(app)
	}
})

test('opening a file on the first launch still opens that file', async () => {
	const workDir = await mkdtemp(join(tmpdir(), 'mywb-first-run-'))
	let app: ElectronApplication | null = null
	try {
		const model = join(workDir, 'model.json')
		const boardPath = join(workDir, 'from-argv.mywb')
		await writeFile(
			model,
			JSON.stringify({
				documentId: 'first-run-argv',
				components: [{ name: 'api', kind: 'api' }],
				edges: []
			})
		)
		await run(process.execPath, [CLI, 'file', 'scaffold', model, boardPath])

		const darwin = process.platform === 'darwin'
		// argv only carries the file on Linux/Windows. macOS delivers it through
		// an open-file event, so emit it the way Finder would.
		app = await launchApp(WELCOME, darwin ? [] : [boardPath])
		if (darwin) {
			await app.evaluate(({ app: electronApp }, filePath) => {
				electronApp.emit('open-file', { preventDefault() {} }, filePath)
			}, boardPath)
		}

		const names = await waitForDocNames((open) => open.includes('from-argv'))
		// The board the user asked for is what matters, and the welcome board must
		// never replace it. On Linux/Windows argv is known before the startup
		// decision, so the welcome board is skipped outright; on macOS the emit
		// races that decision, so the welcome board may or may not also be open.
		expect(names).toContain('from-argv')
		if (!darwin) expect(names).toEqual(['from-argv'])
	} finally {
		if (app) await shutdownApp(app)
		await rm(workDir, { recursive: true, force: true })
	}
})
