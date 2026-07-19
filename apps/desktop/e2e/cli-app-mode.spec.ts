import { expect, test, type ElectronApplication } from '@playwright/test'
import { execFile, spawn } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { promisify } from 'util'
import { connectAgentApi, focusedDocId, launchApp, serverJsonPath, shutdownApp, cleanupUserData, type AgentApi } from './electron-app-fixture'

// `mywb app` — the CLI live mode — against a REAL running app. One Electron
// launch serves every case (launches are the expensive part). The CLI finds the
// server via MYWB_SERVER_JSON pointing into the test userData dir.

const here = dirname(fileURLToPath(import.meta.url))
const CLI = join(here, '..', '..', 'cli', 'dist', 'cli.js')
const run = promisify(execFile)

let app: ElectronApplication
let api: AgentApi
let docId: string

test.beforeAll(async () => {
	// Build the CLI dist the spec drives.
	await new Promise<void>((resolve, reject) => {
		const child = spawn('npx', ['vite', 'build'], {
			cwd: join(here, '..', '..', 'cli'),
			stdio: 'ignore'
		})
		child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`cli build exited ${code}`))))
	})
	app = await launchApp()
	api = await connectAgentApi()
	docId = await focusedDocId(api)
})

test.afterAll(async () => {
	await shutdownApp(app)
	await cleanupUserData()
})

function cli(args: string[]) {
	return run(process.execPath, [CLI, ...args], {
		env: { ...process.env, MYWB_SERVER_JSON: serverJsonPath() }
	})
}

test('app docs lists the open document as JSON', async () => {
	const { stdout } = await cli(['app', 'docs'])
	const docs = JSON.parse(stdout) as Array<{ id: string }>
	expect(docs.length).toBeGreaterThanOrEqual(1)
	expect(docs.some((d) => d.id === docId)).toBe(true)
})

test('app exec creates a shape on the live canvas, app search reads it back', async () => {
	const execCode = `
		const id = tldraw.createShapeId()
		editor.createShape({ id, type: 'service-node', x: 80, y: 80, props: { name: 'cli-made', kind: 'api' } })
		return editor.getShape(id).props.name
	`
	const { stdout } = await cli(['app', 'exec', docId, execCode])
	const result = JSON.parse(stdout) as { success: boolean; result?: unknown }
	expect(result.success).toBe(true)
	expect(result.result).toBe('cli-made')

	const searchOut = await cli(['app', 'search', `return (await api.getShapes(${JSON.stringify(docId)})).shapes.map(s => s.props?.name)`])
	const names = JSON.parse(searchOut.stdout) as { success: boolean; result: unknown[] }
	expect(names.result).toContain('cli-made')
})

test('missing server.json → exit 1 with a not-running message', async () => {
	const error = (await run(process.execPath, [CLI, 'app', 'docs'], {
		env: { ...process.env, MYWB_SERVER_JSON: '/nonexistent/server.json' }
	}).then(
		() => {
			throw new Error('expected failure')
		},
		(e: { code: number; stderr: string }) => e
	)) as { code: number; stderr: string }
	expect(error.code).toBe(1)
	expect(error.stderr).toContain('not running')
})

test('unknown app subcommand → exit 2 with usage', async () => {
	const error = (await cli(['app', 'bogus']).then(
		() => {
			throw new Error('expected failure')
		},
		(e: { code: number; stderr: string }) => e
	)) as { code: number; stderr: string }
	expect(error.code).toBe(2)
	expect(error.stderr).toContain('Usage')
})
