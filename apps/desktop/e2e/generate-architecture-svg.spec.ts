import { expect, test, type ElectronApplication } from '@playwright/test'
import { execFile } from 'child_process'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { promisify } from 'util'
import { connectAgentApi, launchApp, resetUserData, shutdownApp, type AgentApi } from './electron-app-fixture'

// Checks that docs/architecture.svg can be regenerated from the committed
// board through the real app, and that the committed file still matches what
// the board exports today. Both halves matter: exporting successfully proves
// the app can render the board, but only comparing against the tracked file
// catches a stale docs/architecture.svg — which is what the README shows.
// Refresh with `MYWB_WRITE_SVG=1 npm run e2e`, then commit it.

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

/** Plain text of a shape's label, which tldraw stores as a ProseMirror doc. */
const richTextToPlain = (rich: RichText | undefined): string =>
	(rich?.content ?? [])
		.flatMap((block) => block.content ?? [])
		.map((leaf) => leaf.text ?? '')
		.join('')

type RichText = {
	content?: Array<{ content?: Array<{ text?: string }> }>
}

type BoardShape = {
	typeName: string
	record: {
		type: string
		props?: { name?: string; richText?: RichText }
		meta?: { relation?: string }
	}
}

test('exports docs/architecture.svg naming every service-node and relation', async () => {
	const { stdout } = await run(process.execPath, [CLI, 'file', 'read', REPO_BOARD, '--json'])
	const doc = JSON.parse(stdout) as { records: BoardShape[] }
	const shapes = doc.records.filter((r) => r.typeName === 'shape')
	const serviceNames = shapes
		.filter((r) => r.record.type === 'service-node')
		.map((r) => r.record.props?.name ?? '')
	expect(serviceNames.length).toBeGreaterThan(0)

	// meta.relation is the semantic edge label agents read; props.richText is
	// what a human sees on the canvas. Scaffold writes both, so a drift between
	// them means the board says one thing and shows another.
	const arrows = shapes.filter((r) => r.record.type === 'arrow')
	expect(arrows.length).toBeGreaterThan(0)
	const relations = new Set<string>()
	for (const arrow of arrows) {
		const relation = arrow.record.meta?.relation ?? ''
		expect(relation, 'every architecture arrow carries meta.relation').not.toBe('')
		expect(richTextToPlain(arrow.record.props?.richText)).toBe(relation)
		relations.add(relation)
	}

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
	for (const relation of relations) expect(svg, `arrow label "${relation}" rendered`).toContain(relation)

	// React's useId seeds clip-path ids with a render-order counter (`_r_27_`
	// etc.) that shifts if unrelated UI adds a useId before the export —
	// churning the committed file on every regen. Shape-derived ids stay
	// stable, so normalize only the useId prefix to keep the SVG diffable.
	const stable = svg.replace(/_r_[0-9a-z]+_/g, '_r_')

	// Default run only checks; set MYWB_WRITE_SVG=1 to refresh the committed
	// file, so a plain `npm run e2e` never mutates the tracked tree.
	if (process.env.MYWB_WRITE_SVG === '1') {
		await writeFile(OUT_SVG, stable, 'utf8')
		return
	}

	// Asserting only on the freshly exported string would pass with any stale
	// docs/architecture.svg, since that file is never read — the failure this
	// suite went green through. Compare the tracked file too, on the names and
	// labels rather than byte equality, so a font-metric or tldraw-version
	// change does not fail the build while a missing component still does.
	const committed = await readFile(OUT_SVG, 'utf8')
	const occurrences = (haystack: string, needle: string): number =>
		haystack.split(needle).length - 1

	// Counting rather than substring-testing catches drift in both directions:
	// a component added to the board and never re-exported, and one deleted from
	// the board whose card still sits in the committed file. A count is not a
	// card count — a name also matches inside its own repoUrl link, and one
	// relation labels many arrows — but comparing the same tally across both
	// strings is what makes it a drift signal.
	for (const name of serviceNames) {
		expect(occurrences(committed, name), `docs/architecture.svg is stale for "${name}"`).toBe(
			occurrences(svg, name)
		)
	}
	for (const relation of relations) {
		expect(
			occurrences(committed, relation),
			`docs/architecture.svg is stale for label "${relation}"`
		).toBe(occurrences(svg, relation))
	}
})
