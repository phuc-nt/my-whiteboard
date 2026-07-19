import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
	AppNotRunningError,
	loadServerInfo,
	resolveServerJsonPath,
	runExec,
	runSearch
} from '../app-server-client'

// The MCP tools mirror the `mywb app` verbs but as schema'd tools any MCP
// client can discover. Each resolves the running app's server.json fresh, calls
// the localhost Agent API, and returns a CallToolResult. App-not-running (and
// any other failure) becomes an isError result — never a thrown server crash.

type ToolResult = {
	content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
	isError?: boolean
}

function errorResult(error: unknown): ToolResult {
	const message =
		error instanceof AppNotRunningError
			? error.message
			: `mywb: ${error instanceof Error ? error.message : String(error)}`
	return { content: [{ type: 'text', text: message }], isError: true }
}

function jsonResult(value: unknown): ToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

async function withApp<T>(
	serverJson: string | undefined,
	use: (info: Awaited<ReturnType<typeof loadServerInfo>>) => Promise<T>
): Promise<T> {
	return use(await loadServerInfo(resolveServerJsonPath(serverJson)))
}

export function registerMywbTools(server: McpServer): void {
	// server.json path can be overridden for tests/multi-instance, matching the
	// `mywb app` commands.
	const serverJson = process.env.MYWB_SERVER_JSON

	server.registerTool(
		'list_documents',
		{
			description: 'List documents open in the running My Whiteboard app.',
			inputSchema: z.object({})
		},
		async () => {
			try {
				return jsonResult(await withApp(serverJson, (info) => runSearch(info, 'return await api.getDocs()')))
			} catch (error) {
				return errorResult(error)
			}
		}
	)

	server.registerTool(
		'read_shapes',
		{
			description: 'Read the shapes on the current page of an open document (raw tldraw records).',
			inputSchema: z.object({ documentId: z.string() })
		},
		async ({ documentId }) => {
			try {
				return jsonResult(
					await withApp(serverJson, (info) =>
						runSearch(info, `return await api.getShapes(${JSON.stringify(documentId)})`)
					)
				)
			} catch (error) {
				return errorResult(error)
			}
		}
	)

	server.registerTool(
		'read_bindings',
		{
			description: 'Read the arrow binding records on the current page of an open document.',
			inputSchema: z.object({ documentId: z.string() })
		},
		async ({ documentId }) => {
			try {
				return jsonResult(
					await withApp(serverJson, (info) =>
						runSearch(info, `return await api.getBindings(${JSON.stringify(documentId)})`)
					)
				)
			} catch (error) {
				return errorResult(error)
			}
		}
	)

	server.registerTool(
		'screenshot',
		{
			description: 'Capture a PNG screenshot of an open document window.',
			inputSchema: z.object({ documentId: z.string() })
		},
		async ({ documentId }) => {
			try {
				const dataUrl = (await withApp(serverJson, (info) =>
					runSearch(info, `return await api.getScreenshot(${JSON.stringify(documentId)})`)
				)) as string
				const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl
				return { content: [{ type: 'image', data: base64, mimeType: 'image/png' }] }
			} catch (error) {
				return errorResult(error)
			}
		}
	)

	server.registerTool(
		'exec',
		{
			description:
				'Run JavaScript against the live tldraw editor of an open document. `editor` and a `tldraw` binding are in scope; destructure SDK primitives from `tldraw` (do not use import). Return plain JSON.',
			inputSchema: z.object({ documentId: z.string(), code: z.string() })
		},
		async ({ documentId, code }) => {
			try {
				return jsonResult(await withApp(serverJson, (info) => runExec(info, documentId, code)))
			} catch (error) {
				return errorResult(error)
			}
		}
	)
}
