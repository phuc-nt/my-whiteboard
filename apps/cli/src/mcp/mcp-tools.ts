import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { richTextToPlainText } from '@mywb/core/exec'
import type { BoardModel } from '@mywb/node-adapter/headless-document'
import { buildBoardFromModel } from '@mywb/node-adapter/headless-document'
import { z } from 'zod'
import { focusExec, SVG_EXEC } from '../app-commands'
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

// The search/exec endpoints wrap their payload in a { success, result, error }
// envelope. Unwrap it: surface the raw result, or turn a failure into a tool
// error the client sees as such.
function unwrap(envelope: unknown): unknown {
	const e = envelope as { success?: boolean; result?: unknown; error?: string }
	if (e && typeof e === 'object' && 'success' in e) {
		if (!e.success) throw new Error(e.error ?? 'operation failed')
		return e.result
	}
	return envelope
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
				return jsonResult(
					unwrap(await withApp(serverJson, (info) => runSearch(info, 'return await api.getDocs()')))
				)
			} catch (error) {
				return errorResult(error)
			}
		}
	)

	server.registerTool(
		'read_shapes',
		{
			description:
				'Read the shapes on the current page of an open document. detail "full" (default) returns raw tldraw records; "summary" returns just {id, type, name?, text?, x, y, w?, h?} per shape — much cheaper on large boards.',
			inputSchema: z.object({
				documentId: z.string(),
				detail: z.enum(['summary', 'full']).optional()
			})
		},
		async ({ documentId, detail }) => {
			try {
				const page = unwrap(
					await withApp(serverJson, (info) =>
						runSearch(info, `return await api.getShapes(${JSON.stringify(documentId)})`)
					)
				) as { shapes?: Array<Record<string, unknown>> }
				if (detail !== 'summary') return jsonResult(page)
				const shapes = (page.shapes ?? []).map((shape) => {
					const props = (shape.props ?? {}) as Record<string, unknown>
					// tldraw builtin shapes carry content as ProseMirror richText,
					// not a plain text prop — flatten it so summary items keep
					// their words.
					const text =
						typeof props.text === 'string' ? props.text : richTextToPlainText(props.richText)
					return {
						id: shape.id,
						type: shape.type,
						...(typeof props.name === 'string' ? { name: props.name } : {}),
						...(text ? { text } : {}),
						x: shape.x,
						y: shape.y,
						...(typeof props.w === 'number' ? { w: props.w } : {}),
						...(typeof props.h === 'number' ? { h: props.h } : {})
					}
				})
				return jsonResult({ shapes })
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
					unwrap(
						await withApp(serverJson, (info) =>
							runSearch(info, `return await api.getBindings(${JSON.stringify(documentId)})`)
						)
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
				const dataUrl = unwrap(
					await withApp(serverJson, (info) =>
						runSearch(info, `return await api.getScreenshot(${JSON.stringify(documentId)})`)
					)
				) as string
				const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl
				return { content: [{ type: 'image', data: base64, mimeType: 'image/png' }] }
			} catch (error) {
				return errorResult(error)
			}
		}
	)

	server.registerTool(
		'export_svg',
		{
			description:
				'Export an open document as an SVG string (vector, layout-faithful, diffable) — the pixel-true counterpart to screenshot.',
			inputSchema: z.object({ documentId: z.string() })
		},
		async ({ documentId }) => {
			try {
				return jsonResult(
					unwrap(await withApp(serverJson, (info) => runExec(info, documentId, SVG_EXEC)))
				)
			} catch (error) {
				return errorResult(error)
			}
		}
	)

	server.registerTool(
		'focus_shape',
		{
			description:
				'Pan and zoom the open document canvas to a shape and select it, so a human watching the app sees exactly what you mean (e.g. the shape a drift finding refers to). Changes the current selection.',
			inputSchema: z.object({ documentId: z.string(), shapeId: z.string() })
		},
		async ({ documentId, shapeId }) => {
			try {
				return jsonResult(
					unwrap(await withApp(serverJson, (info) => runExec(info, documentId, focusExec(shapeId))))
				)
			} catch (error) {
				return errorResult(error)
			}
		}
	)

	server.registerTool(
		'scaffold_board',
		{
			description:
				'Build a complete architecture board (.mywb file) from a declarative model, headlessly — the app does not need the document open. Writes to targetPath on this machine (same trust model as exec).',
			inputSchema: z.object({
				model: z.object({
					title: z.string().optional(),
					documentId: z.string().optional(),
					components: z.array(
						z.object({
							name: z.string(),
							kind: z.string(),
							repoUrl: z.string().optional(),
							ownerTeam: z.string().optional()
						})
					),
					edges: z.array(
						z.object({ from: z.string(), to: z.string(), relation: z.string() })
					),
					groups: z
						.array(z.object({ name: z.string(), members: z.array(z.string()) }))
						.optional()
				}),
				targetPath: z.string()
			})
		},
		async ({ model, targetPath }) => {
			try {
				await buildBoardFromModel(targetPath, model as BoardModel)
				return jsonResult({
					target: targetPath,
					components: model.components.length,
					edges: model.edges.length
				})
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
