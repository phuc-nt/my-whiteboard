import {
	DOC_EXEC_PATTERN,
	DOC_SCRIPT_STATUS_PATTERN,
	DOC_SCRIPT_WORKSPACE_PATTERN,
	parseCode,
	safeSerialize
} from '@mywb/core/agent-protocol'
import { randomBytes, timingSafeEqual } from 'crypto'
import { app } from 'electron'
import { chmodSync, unlinkSync, writeFileSync } from 'fs'
import type { IncomingMessage, Server, ServerResponse } from 'http'
import { createServer } from 'http'
import { join } from 'path'
import {
	DocumentNotFoundError,
	execInDocument,
	getScriptStatusForDocument,
	openScriptWorkspaceForDocument
} from './agent-server-registry'
import { getAgentApiReadme } from './agent-api-readme'
import { appendRequestLog, getRequestLogPath } from './request-log-writer'
import { runSearchCode } from './search-api-context'

// Local HTTP server that lets a coding agent read and drive open canvases.
// Binds 127.0.0.1 only, authenticates every mutating request with a per-launch
// bearer token, and advertises its port+token via server.json (chmod 600).

const DEFAULT_PORT = 7236

function serverJsonPath(): string {
	return join(app.getPath('userData'), 'server.json')
}

class BodyTooLargeError extends Error {}

async function readBody(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = []
	let size = 0
	const MAX = 8 * 1024 * 1024
	for await (const chunk of req) {
		size += chunk.length
		if (size > MAX) throw new BodyTooLargeError('Request body too large')
		chunks.push(chunk as Buffer)
	}
	return Buffer.concat(chunks).toString('utf8')
}

export class AgentApiServer {
	#server: Server | null = null
	#token = randomBytes(32).toString('hex')

	async start(): Promise<void> {
		const server = createServer((req, res) => {
			this.#handleRequest(req, res).catch((error) => {
				this.#sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
			})
		})
		this.#server = server

		await new Promise<void>((resolve, reject) => {
			server.once('error', (err: NodeJS.ErrnoException) => {
				if (err.code === 'EADDRINUSE') {
					// Another instance (or app) holds 7236 — take any free port.
					server.listen(0, '127.0.0.1', () => resolve())
				} else {
					reject(err)
				}
			})
			server.listen(DEFAULT_PORT, '127.0.0.1', () => resolve())
		})

		this.#writeServerJson()
	}

	#writeServerJson(): void {
		const path = serverJsonPath()
		writeFileSync(
			path,
			JSON.stringify(
				{
					port: this.getPort(),
					token: this.#token,
					pid: process.pid,
					startedAt: Date.now(),
					requestLogPath: getRequestLogPath()
				},
				null,
				2
			)
		)
		try {
			chmodSync(path, 0o600)
		} catch {
			// Best effort — Windows has no equivalent.
		}
	}

	getPort(): number {
		const address = this.#server?.address()
		if (address && typeof address !== 'string') return address.port
		return DEFAULT_PORT
	}

	async dispose(): Promise<void> {
		const server = this.#server
		this.#server = null
		try {
			unlinkSync(serverJsonPath())
		} catch {
			// already gone
		}
		if (!server) return
		server.closeAllConnections?.()
		await new Promise<void>((resolve) => server.close(() => resolve()))
	}

	#isAuthorized(req: IncomingMessage): boolean {
		const header = req.headers['authorization']
		if (typeof header !== 'string') return false
		const provided = Buffer.from(header)
		const expected = Buffer.from(`Bearer ${this.#token}`)
		return provided.length === expected.length && timingSafeEqual(provided, expected)
	}

	#sendJson(res: ServerResponse, status: number, body: unknown): void {
		res.writeHead(status, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify(body))
	}

	async #handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
		const pathname = url.pathname

		if (req.method === 'OPTIONS') {
			res.writeHead(204)
			res.end()
			return
		}

		if (req.method === 'GET' && (pathname === '/' || pathname === '/readme')) {
			res.writeHead(200, { 'Content-Type': 'text/plain' })
			res.end(getAgentApiReadme(serverJsonPath()))
			return
		}

		if (!this.#isAuthorized(req)) {
			this.#sendJson(res, 401, {
				error: 'Unauthorized: send the token from server.json as "Authorization: Bearer <token>".'
			})
			return
		}

		if (req.method === 'POST' && pathname === '/api/search') {
			await this.#handleSearch(req, res)
			return
		}

		const execMatch = pathname.match(DOC_EXEC_PATTERN)
		if (req.method === 'POST' && execMatch) {
			await this.#handleExec(req, res, decodeURIComponent(execMatch[1]))
			return
		}

		const workspaceMatch = pathname.match(DOC_SCRIPT_WORKSPACE_PATTERN)
		if (req.method === 'POST' && workspaceMatch) {
			await this.#handleScriptWorkspace(res, decodeURIComponent(workspaceMatch[1]))
			return
		}

		const statusMatch = pathname.match(DOC_SCRIPT_STATUS_PATTERN)
		if (req.method === 'GET' && statusMatch) {
			this.#handleScriptStatus(res, decodeURIComponent(statusMatch[1]))
			return
		}

		this.#sendJson(res, 404, { error: 'Not found' })
	}

	async #handleSearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
		let body: string
		try {
			body = await readBody(req)
		} catch (error) {
			this.#sendJson(res, error instanceof BodyTooLargeError ? 413 : 400, {
				error: error instanceof Error ? error.message : String(error)
			})
			return
		}
		const parsed = parseCode(body, req.headers['content-type'])
		if ('error' in parsed) {
			this.#sendJson(res, 400, { error: parsed.error })
			return
		}
		void appendRequestLog({ endpoint: '/api/search', body: parsed.code })
		try {
			const result = await runSearchCode(parsed.code)
			this.#sendJson(res, 200, { success: true, result: safeSerialize(result) })
		} catch (error) {
			this.#sendJson(res, 500, {
				success: false,
				error: error instanceof Error ? error.message : String(error)
			})
		}
	}

	async #handleExec(req: IncomingMessage, res: ServerResponse, documentId: string): Promise<void> {
		let body: string
		try {
			body = await readBody(req)
		} catch (error) {
			this.#sendJson(res, error instanceof BodyTooLargeError ? 413 : 400, {
				error: error instanceof Error ? error.message : String(error)
			})
			return
		}
		const parsed = parseCode(body, req.headers['content-type'])
		if ('error' in parsed) {
			this.#sendJson(res, 400, { error: parsed.error })
			return
		}
		void appendRequestLog({ endpoint: `/api/doc/${documentId}/exec`, body: parsed.code })
		try {
			const result = await execInDocument(documentId, parsed.code)
			this.#sendJson(res, 200, result)
		} catch (error) {
			const status = error instanceof DocumentNotFoundError ? 404 : 500
			this.#sendJson(res, status, {
				success: false,
				error: error instanceof Error ? error.message : String(error)
			})
		}
	}

	async #handleScriptWorkspace(res: ServerResponse, documentId: string): Promise<void> {
		void appendRequestLog({ endpoint: `/api/doc/${documentId}/script-workspace` })
		try {
			const workspace = await openScriptWorkspaceForDocument(documentId)
			this.#sendJson(res, 200, { success: true, result: workspace })
		} catch (error) {
			const status = error instanceof DocumentNotFoundError ? 404 : 500
			this.#sendJson(res, status, {
				success: false,
				error: error instanceof Error ? error.message : String(error)
			})
		}
	}

	#handleScriptStatus(res: ServerResponse, documentId: string): void {
		try {
			this.#sendJson(res, 200, { success: true, result: getScriptStatusForDocument(documentId) })
		} catch (error) {
			const status = error instanceof DocumentNotFoundError ? 404 : 500
			this.#sendJson(res, status, {
				success: false,
				error: error instanceof Error ? error.message : String(error)
			})
		}
	}
}
