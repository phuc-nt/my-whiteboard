import { expect, test, type ElectronApplication } from '@playwright/test'
import { execFile } from 'child_process'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { promisify } from 'util'
import { connectAgentApi, launchApp, resetUserData, shutdownApp, type AgentApi } from './electron-app-fixture'

// Regression for a user-found crash: a drag that STARTED on the repoUrl link
// inside a service-node handed the pointer to the OS-native link drag and
// killed tldraw's translate session. Automation cannot trigger the native
// drag loop, so this locks in the defense instead: the anchor must opt out
// of dragging (draggable=false), and a mouse drag across the card must leave
// the canvas alive.

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const CLI = join(repoRoot, 'apps', 'cli', 'dist', 'cli.js')
const run = promisify(execFile)

let app: ElectronApplication
let api: AgentApi
let workDir: string
let boardPath: string

test.beforeAll(async () => {
	workDir = await mkdtemp(join(tmpdir(), 'mywb-link-drag-'))
	boardPath = join(workDir, 'board.mywb')
	// Self-contained board with a repoUrl so the card renders a link.
	const model = join(workDir, 'model.json')
	await writeFile(
		model,
		JSON.stringify({
			documentId: 'link-drag-regression',
			components: [
				{ name: 'web ui', kind: 'web', repoUrl: 'src/app' },
				{ name: 'api', kind: 'api', repoUrl: 'src/api' }
			],
			edges: [{ from: 'web ui', to: 'api', relation: 'calls' }]
		})
	)
	await run(process.execPath, [CLI, 'file', 'scaffold', model, boardPath])

	await resetUserData()
	app = await launchApp({}, process.platform === 'darwin' ? [] : [boardPath])
	api = await connectAgentApi()
	if (process.platform === 'darwin') {
		await app.evaluate(({ app: electronApp }, filePath) => {
			electronApp.emit('open-file', { preventDefault() {} }, filePath)
		}, boardPath)
	}
})

test.afterAll(async () => {
	await shutdownApp(app)
	await rm(workDir, { recursive: true, force: true })
})

test('mouse-dragging a bound service-node must not crash the canvas', async () => {
	test.setTimeout(120_000)
	// Wait for the board window.
	let docId = ''
	for (let attempt = 0; attempt < 40 && !docId; attempt++) {
		try {
			const docs = await api.search<Array<{ id: string }>>('return await api.getDocs()')
			const match = docs.find((d) => d.id === 'link-drag-regression')
			if (match) docId = match.id
		} catch {
			// booting
		}
		if (!docId) await new Promise((r) => setTimeout(r, 250))
	}
	expect(docId).not.toBe('')

	// Wait until the board hydrates.
	for (let attempt = 0; attempt < 40; attempt++) {
		const res = await api.exec<number>(docId, 'return editor.getCurrentPageShapes().length')
		if (res.success && (res.result ?? 0) > 0) break
		await new Promise((r) => setTimeout(r, 250))
	}

	const windows = app.windows()
	let page = windows[windows.length - 1]
	for (const w of windows) {
		if ((await w.title()).includes('board')) page = w
	}
	const errors: string[] = []
	for (const w of windows) {
		w.on('console', (msg) => {
			if (msg.type() === 'error') errors.push(msg.text())
		})
		w.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.stack ?? err.message}`))
	}

	// User-found repro: dragging that STARTS on the repoUrl link inside a card
	// crashes the canvas — anchors are natively draggable, and the browser's
	// HTML5 link-drag hijacks the pointer stream mid-translate.
	const link = page.locator('a', { hasText: 'src/app' }).first()
	await link.waitFor({ state: 'visible', timeout: 15_000 })
	// Automation cannot trigger the OS-native link drag that caused the crash,
	// but it CAN lock in the defense: the anchor must opt out of dragging.
	await expect(link).toHaveAttribute('draggable', 'false')
	const box = await link.boundingBox()
	expect(box).toBeTruthy()
	const x = box!.x + box!.width / 2
	const y = box!.y + box!.height / 2
	await page.mouse.move(x, y)
	await page.mouse.down()
	for (let i = 1; i <= 10; i++) {
		await page.mouse.move(x + i * 12, y + i * 6)
		await new Promise((r) => setTimeout(r, 30))
	}
	await page.mouse.up()
	await new Promise((r) => setTimeout(r, 1000))

	// eslint-disable-next-line no-console
	console.log('CONSOLE ERRORS:', JSON.stringify(errors, null, 2).slice(0, 6000))

	expect(errors.filter((e) => e.includes('PAGEERROR')).length).toBe(0)
})
