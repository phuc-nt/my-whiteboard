import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { execFile } from 'child_process'
import { copyFile, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { promisify } from 'util'
import { connectAgentApi, launchApp, resetUserData, serverJsonPath, shutdownApp, type AgentApi } from './electron-app-fixture'

// Real-board smoke: the suite's other specs run on synthetic fixtures; this
// one opens the repo's own committed board (docs/architecture.mywb) in the
// real app via the same open-file event Finder sends, and asserts the app,
// the headless CLI and the MCP surface all agree on that real data.

const here = dirname(fileURLToPath(import.meta.url))
const REPO_BOARD = join(here, '..', '..', '..', 'docs', 'architecture.mywb')
const CLI = join(here, '..', '..', 'cli', 'dist', 'cli.js')
const run = promisify(execFile)

let app: ElectronApplication
let api: AgentApi
let workDir: string
let boardCopy: string

// Ground truth straight from the committed file, read headlessly — the test
// never hardcodes counts, so redrawing the board cannot silently stale it.
let expectedDocId: string
let expectedShapeCount: number
let expectedServiceNames: string[]

test.beforeAll(async () => {
	workDir = await mkdtemp(join(tmpdir(), 'mywb-real-board-'))
	// Copy so the app's working-copy/session machinery never touches the repo file.
	boardCopy = join(workDir, 'architecture.mywb')
	await copyFile(REPO_BOARD, boardCopy)

	const { stdout } = await run(process.execPath, [CLI, 'file', 'read', boardCopy, '--json'])
	const doc = JSON.parse(stdout) as {
		metadata: { documentId: string }
		records: Array<{ typeName: string; record: { type: string; props?: { name?: string } } }>
	}
	expectedDocId = doc.metadata.documentId
	const shapes = doc.records.filter((r) => r.typeName === 'shape')
	expectedShapeCount = shapes.length
	expectedServiceNames = shapes
		.filter((s) => s.record.type === 'service-node')
		.map((s) => s.record.props?.name ?? '')
		.sort()

	await resetUserData()
	// Production open-from-outside paths differ by platform: macOS delivers an
	// `open-file` event, everywhere else the path arrives in argv. Exercise the
	// one this OS actually uses.
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

async function waitForBoardDoc(): Promise<string> {
	for (let attempt = 0; attempt < 40; attempt++) {
		try {
			const docs = await api.search<Array<{ id: string }>>('return await api.getDocs()')
			const match = docs.find((d) => d.id === expectedDocId)
			if (match) return match.id
		} catch {
			// Renderer still booting ("No renderer handler for exec-code") —
			// the agent server is up before the first window registers.
		}
		await new Promise((r) => setTimeout(r, 250))
	}
	throw new Error(`board document ${expectedDocId} never opened`)
}

test('the real committed board opens and the app sees exactly what the headless CLI sees', async () => {
	expect(expectedShapeCount).toBeGreaterThan(0)
	expect(expectedServiceNames.length).toBeGreaterThan(0)

	const docId = await waitForBoardDoc()
	// The document registers before its renderer finishes hydrating: getShapes
	// briefly returns an EMPTY array, not an error. Poll until the store is
	// actually populated (or the count matches) — a truthy-but-empty page is
	// not "ready".
	let page: { shapes: Array<{ type: string; props?: { name?: string } }> } = { shapes: [] }
	for (let attempt = 0; attempt < 40 && page.shapes.length < expectedShapeCount; attempt++) {
		try {
			page = await api.search(`return await api.getShapes(${JSON.stringify(docId)})`)
		} catch {
			// renderer still booting
		}
		if (page.shapes.length < expectedShapeCount) await new Promise((r) => setTimeout(r, 250))
	}
	expect(page.shapes).toHaveLength(expectedShapeCount)
	const appServiceNames = page.shapes
		.filter((s) => s.type === 'service-node')
		.map((s) => s.props?.name ?? '')
		.sort()
	expect(appServiceNames).toEqual(expectedServiceNames)
})

test('an MCP client reads and screenshots the real board through the live app', async () => {
	const docId = await waitForBoardDoc()
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [CLI, 'mcp'],
		env: { ...process.env, MYWB_SERVER_JSON: serverJsonPath() } as Record<string, string>
	})
	const client = new Client({ name: 'mywb-real-board-e2e', version: '0.0.0' })
	await client.connect(transport)
	try {
		const summaryRes = (await client.callTool({
			name: 'read_shapes',
			arguments: { documentId: docId, detail: 'summary' }
		})) as { content: Array<{ type: string; text: string }>; isError?: boolean }
		expect(summaryRes.isError).toBeFalsy()
		const summary = JSON.parse(summaryRes.content[0].text) as {
			shapes: Array<{ name?: string }>
		}
		const names = summary.shapes.map((s) => s.name).filter(Boolean)
		for (const expected of expectedServiceNames) {
			expect(names).toContain(expected)
		}

		const shot = (await client.callTool({
			name: 'screenshot',
			arguments: { documentId: docId }
		})) as { content: Array<{ type: string; data?: string }>; isError?: boolean }
		expect(shot.isError).toBeFalsy()
		expect(shot.content[0].type).toBe('image')
		expect((shot.content[0].data ?? '').length).toBeGreaterThan(1000)
	} finally {
		await transport.close()
	}
})
