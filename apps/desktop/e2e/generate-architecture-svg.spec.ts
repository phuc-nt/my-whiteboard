import { expect, test, type ElectronApplication } from '@playwright/test'
import { execFile } from 'child_process'
import { copyFile, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { promisify } from 'util'
import { connectAgentApi, launchApp, resetUserData, shutdownApp, type AgentApi } from './electron-app-fixture'

// Checks that docs/architecture.svg can be regenerated from the committed
// board through the real app: the exported SVG must name every service-node
// the headless CLI reports. Runs assert-only by default; refresh the committed
// file with `MYWB_WRITE_SVG=1 npm run e2e`, then commit it.

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const REPO_BOARD = join(repoRoot, 'docs', 'architecture.mywb')
const OUT_SVG = join(repoRoot, 'docs', 'architecture.svg')
const CLI = join(repoRoot, 'apps', 'cli', 'dist', 'cli.js')
const run = promisify(execFile)

let app: ElectronApplication
let api: AgentApi
let workDir: string

test.beforeAll(async () => {
	workDir = await mkdtemp(join(tmpdir(), 'mywb-svg-gen-'))
	const boardCopy = join(workDir, 'architecture.mywb')
	await copyFile(REPO_BOARD, boardCopy)
	await resetUserData()
	app = await launchApp({}, process.platform === 'darwin' ? [] : [boardCopy])
	api = await connectAgentApi()
	if (process.platform === 'darwin') {
		await app.evaluate(({ app: electronApp }, filePath) => {
			electronApp.emit('open-file', { preventDefault() {} }, filePath)
		}, boardCopy)
	}
})

test.afterAll(async () => {
	await shutdownApp(app)
	await rm(workDir, { recursive: true, force: true })
})

test('exports docs/architecture.svg naming every service-node', async () => {
	const { stdout } = await run(process.execPath, [CLI, 'file', 'read', REPO_BOARD, '--json'])
	const doc = JSON.parse(stdout) as {
		records: Array<{ typeName: string; record: { type: string; props?: { name?: string } } }>
	}
	const serviceNames = doc.records
		.filter((r) => r.typeName === 'shape' && r.record.type === 'service-node')
		.map((r) => r.record.props?.name ?? '')
	expect(serviceNames.length).toBeGreaterThan(0)

	let docId = ''
	for (let attempt = 0; attempt < 40 && !docId; attempt++) {
		try {
			const docs = await api.search<Array<{ id: string }>>('return await api.getDocs()')
			if (docs[0]) docId = docs[0].id
		} catch {
			// renderer still booting
		}
		if (!docId) await new Promise((r) => setTimeout(r, 250))
	}
	expect(docId).not.toBe('')

	let svg = ''
	for (let attempt = 0; attempt < 40 && !svg; attempt++) {
		const res = await api.exec<string>(
			docId,
			`const ids = [...editor.getCurrentPageShapeIds()]
			 const out = await editor.getSvgString(ids, { background: true })
			 return out?.svg ?? ''`
		)
		if (res.success && res.result) svg = res.result
		else await new Promise((r) => setTimeout(r, 250))
	}
	expect(svg.startsWith('<svg')).toBe(true)
	for (const name of serviceNames) expect(svg).toContain(name)

	// React's useId seeds clip-path ids with a render-order counter (`_r_27_`
	// etc.) that shifts if unrelated UI adds a useId before the export —
	// churning the committed file on every regen. Shape-derived ids stay
	// stable, so normalize only the useId prefix to keep the SVG diffable.
	const stable = svg.replace(/_r_[0-9a-z]+_/g, '_r_')

	// Default run only checks; set MYWB_WRITE_SVG=1 to refresh the committed
	// file, so a plain `npm run e2e` never mutates the tracked tree.
	if (process.env.MYWB_WRITE_SVG === '1') await writeFile(OUT_SVG, stable, 'utf8')
})
