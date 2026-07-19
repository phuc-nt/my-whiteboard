import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { spawn } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
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

test('lists the five tools with schemas', async () => {
	const { client, close } = await connectMcp(serverJsonPath())
	try {
		const { tools } = await client.listTools()
		const names = tools.map((t) => t.name).sort()
		expect(names).toEqual(['exec', 'list_documents', 'read_bindings', 'read_shapes', 'screenshot'])
		const exec = tools.find((t) => t.name === 'exec')!
		expect(exec.inputSchema.properties).toHaveProperty('documentId')
		expect(exec.inputSchema.properties).toHaveProperty('code')
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
