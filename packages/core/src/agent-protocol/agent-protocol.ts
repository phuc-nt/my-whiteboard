import { z } from 'zod'

// Wire contract of the Agent API, shared by every server/gateway that speaks
// it. Behavior here is moved verbatim from the desktop HTTP server — the HTTP
// transport itself (sockets, auth, request logging) stays in the adapter.

/** Fixed endpoint paths. */
export const AGENT_API_SEARCH_PATH = '/api/search'
export const AGENT_API_README_PATH = '/readme'

/** Per-document endpoint path patterns; capture group 1 is the document id. */
export const DOC_EXEC_PATTERN = /^\/api\/doc\/([^/]+)\/exec$/
export const DOC_SCRIPT_WORKSPACE_PATTERN = /^\/api\/doc\/([^/]+)\/script-workspace$/
export const DOC_SCRIPT_STATUS_PATTERN = /^\/api\/doc\/([^/]+)\/script-status$/

/** server.json advertised by a running Agent API server. */
export const serverInfoSchema = z.object({
	port: z.number().int().positive(),
	token: z.string().min(1),
	pid: z.number().int(),
	startedAt: z.number(),
	requestLogPath: z.string()
})
export type ServerInfo = z.infer<typeof serverInfoSchema>

/** Result of running exec code against a live editor. */
export interface ExecResult {
	success: boolean
	result?: unknown
	error?: string
}

/** Envelope for search/script-workspace/script-status responses. */
export interface ApiResultEnvelope {
	success: boolean
	result?: unknown
	error?: string
}

/** Parse code from a text/plain body or a JSON {"code":"..."} body. */
export function parseCode(
	body: string,
	contentType: string | undefined
): { code: string } | { error: string } {
	if (contentType?.includes('application/json')) {
		try {
			const parsed = JSON.parse(body)
			if (typeof parsed?.code !== 'string') return { error: 'JSON body must have a string "code" field' }
			return { code: parsed.code }
		} catch {
			return { error: 'Invalid JSON body' }
		}
	}
	if (!body.trim()) return { error: 'Empty request body' }
	return { code: body }
}

/** Drop values that can't survive JSON (functions, cycles, bigint). */
export function safeSerialize(value: unknown): unknown {
	try {
		return JSON.parse(JSON.stringify(value ?? null))
	} catch {
		return String(value)
	}
}
