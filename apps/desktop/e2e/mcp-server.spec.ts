import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { execFile, spawn } from 'child_process'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { promisify } from 'util'
import { cleanupUserData, connectAgentApi, focusedDocId, launchApp, serverJsonPath, shutdownApp, type AgentApi } from './electron-app-fixture'

// End-to-end MCP: a real MCP SDK client spawns `mywb mcp` (child stdio process),
// which proxies to the REAL running desktop app over its agent API. No mocks —
// real client, real stdio transport, real app backend.

const here = dirname(fileURLToPath(import.meta.url))
const CLI = join(here, '..', '..', 'cli', 'dist', 'cli.js')

let app: ElectronApplication
let api: AgentApi
let docId: string

test.beforeAll(async () => {
	// Build the CLI dist the MCP server runs from.
	await new Promise<void>((resolve, reject) => {
		const child = spawn('npx', ['vite', 'build'], { cwd: join(here, '..', '..', 'cli'), stdio: 'ignore' })
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

/** A connected MCP client wired to the running app via MYWB_SERVER_JSON. */
async function connectMcp(serverJsonEnv: string): Promise<{ client: Client; close: () => Promise<void> }> {
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [CLI, 'mcp'],
		env: { ...process.env, MYWB_SERVER_JSON: serverJsonEnv } as Record<string, string>
	})
	const client = new Client({ name: 'mywb-e2e', version: '0.0.0' })
	await client.connect(transport)
	return { client, close: () => transport.close() }
}

test('lists the six tools with schemas', async () => {
	const { client, close } = await connectMcp(serverJsonPath())
	try {
		const { tools } = await client.listTools()
		const names = tools.map((t) => t.name).sort()
		expect(names).toEqual([
			'exec',
			'list_documents',
			'read_bindings',
			'read_shapes',
			'scaffold_board',
			'screenshot'
		])
		const exec = tools.find((t) => t.name === 'exec')!
		expect(exec.inputSchema.properties).toHaveProperty('documentId')
		expect(exec.inputSchema.properties).toHaveProperty('code')
		const readShapes = tools.find((t) => t.name === 'read_shapes')!
		expect(readShapes.inputSchema.properties).toHaveProperty('detail')
	} finally {
		await close()
	}
})

test('read_shapes detail=summary returns compact items; default stays full records', async () => {
	const { client, close } = await connectMcp(serverJsonPath())
	try {
		const seeded = (await client.callTool({
			name: 'exec',
			arguments: {
				documentId: docId,
				code: 'const id = tldraw.createShapeId(); editor.createShape({ id, type: "service-node", x: 10, y: 10, props: { name: "detail-probe", kind: "lib" } }); return true'
			}
		})) as { isError?: boolean }
		expect(seeded.isError).toBeFalsy()

		const summaryRes = (await client.callTool({
			name: 'read_shapes',
			arguments: { documentId: docId, detail: 'summary' }
		})) as { content: Array<{ type: string; text: string }>; isError?: boolean }
		expect(summaryRes.isError).toBeFalsy()
		const summary = JSON.parse(summaryRes.content[0].text) as {
			shapes: Array<Record<string, unknown>>
		}
		for (const item of summary.shapes) {
			expect(item).toHaveProperty('id')
			expect(item).toHaveProperty('type')
			expect(item).not.toHaveProperty('props')
			expect(item).not.toHaveProperty('rotation')
		}
		expect(summary.shapes.some((s) => s.name === 'detail-probe')).toBe(true)

		const fullRes = (await client.callTool({
			name: 'read_shapes',
			arguments: { documentId: docId }
		})) as { content: Array<{ type: string; text: string }> }
		const full = JSON.parse(fullRes.content[0].text) as { shapes: Array<Record<string, unknown>> }
		expect(full.shapes.some((s) => 'props' in s)).toBe(true)
	} finally {
		await close()
	}
})

test('scaffold_board builds a readable board file without the document being open', async () => {
	const { client, close } = await connectMcp(serverJsonPath())
	try {
		const target = join(tmpdir(), `mcp-scaffold-${Date.now()}.mywb`)
		const res = (await client.callTool({
			name: 'scaffold_board',
			arguments: {
				model: {
					components: [
						{ name: 'ui', kind: 'web' },
						{ name: 'db', kind: 'db' }
					],
					edges: [{ from: 'ui', to: 'db', relation: 'reads' }]
				},
				targetPath: target
			}
		})) as { content: Array<{ type: string; text: string }>; isError?: boolean }
		expect(res.isError).toBeFalsy()
		expect(JSON.parse(res.content[0].text)).toEqual({ target, components: 2, edges: 1 })

		const { stdout } = await promisify(execFile)(process.execPath, [CLI, 'file', 'read', target, '--json'])
		const doc = JSON.parse(stdout)
		const shapes = doc.records.filter((r: { typeName: string }) => r.typeName === 'shape')
		expect(shapes.filter((s: { record: { type: string } }) => s.record.type === 'service-node')).toHaveLength(2)
		await rm(target, { force: true })
	} finally {
		await close()
	}
})

test('exec creates a shape and read_shapes reads it back; list_documents sees the doc', async () => {
	const { client, close } = await connectMcp(serverJsonPath())
	try {
		const execRes = (await client.callTool({
			name: 'exec',
			arguments: {
				documentId: docId,
				code: 'const id = tldraw.createShapeId(); editor.createShape({ id, type: "service-node", x: 40, y: 40, props: { name: "mcp-made", kind: "tool" } }); return editor.getShape(id).props.name'
			}
		})) as { content: Array<{ type: string; text: string }>; isError?: boolean }
		expect(execRes.isError).toBeFalsy()
		expect(JSON.parse(execRes.content[0].text).result).toBe('mcp-made')

		const shapesRes = (await client.callTool({
			name: 'read_shapes',
			arguments: { documentId: docId }
		})) as { content: Array<{ type: string; text: string }> }
		const shapes = JSON.parse(shapesRes.content[0].text) as { shapes: Array<{ props?: { name?: string } }> }
		expect(shapes.shapes.some((s) => s.props?.name === 'mcp-made')).toBe(true)

		const docsRes = (await client.callTool({ name: 'list_documents', arguments: {} })) as {
			content: Array<{ type: string; text: string }>
		}
		const docs = JSON.parse(docsRes.content[0].text) as Array<{ id: string }>
		expect(docs.some((d) => d.id === docId)).toBe(true)
	} finally {
		await close()
	}
})

test('screenshot returns image content', async () => {
	const { client, close } = await connectMcp(serverJsonPath())
	try {
		const res = (await client.callTool({ name: 'screenshot', arguments: { documentId: docId } })) as {
			content: Array<{ type: string; data?: string; mimeType?: string }>
		}
		expect(res.content[0].type).toBe('image')
		expect(res.content[0].mimeType).toBe('image/png')
		expect((res.content[0].data ?? '').length).toBeGreaterThan(100)
	} finally {
		await close()
	}
})

test('a tool returns isError when the app is not running', async () => {
	const { client, close } = await connectMcp('/nonexistent/server.json')
	try {
		const res = (await client.callTool({ name: 'list_documents', arguments: {} })) as {
			content: Array<{ type: string; text: string }>
			isError?: boolean
		}
		expect(res.isError).toBe(true)
		expect(res.content[0].text).toContain('not running')
	} finally {
		await close()
	}
})
