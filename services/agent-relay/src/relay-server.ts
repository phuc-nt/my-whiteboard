import { readRequestSchema } from '@mywb/core/agent-protocol'
import { timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import { SessionRegistry } from './session-registry'

// The web Agent Gateway relay. A browser tab connects out over WebSocket and
// registers (browsers can't host a localhost server); an agent calls the HTTP
// side with a bearer token. The ONLY agent route is POST /api/read, which
// forwards a fixed, structured read request to a tab and returns its reply.
// There is deliberately no exec route — running code on the canvas is a later
// stage with its own security model. The relay stores no document content.

export interface RelayServerOptions {
	token: string
	/** Port to bind; 0 picks a free port. */
	port?: number
	/** Bind address. Defaults to loopback — exposing it is a conscious choice. */
	host?: string
}

export interface RelayServer {
	port: number
	close(): Promise<void>
}

export async function startRelayServer(options: RelayServerOptions): Promise<RelayServer> {
	const registry = new SessionRegistry()
	const expectedAuth = Buffer.from(`Bearer ${options.token}`)
	let sessionCounter = 0

	function isAuthorized(req: IncomingMessage): boolean {
		const header = req.headers['authorization']
		if (typeof header !== 'string') return false
		const provided = Buffer.from(header)
		return provided.length === expectedAuth.length && timingSafeEqual(provided, expectedAuth)
	}

	function sendJson(res: ServerResponse, status: number, body: unknown): void {
		res.writeHead(status, { 'content-type': 'application/json' })
		res.end(JSON.stringify(body))
	}

	async function readBody(req: IncomingMessage): Promise<string> {
		const chunks: Buffer[] = []
		for await (const chunk of req) chunks.push(chunk as Buffer)
		return Buffer.concat(chunks).toString('utf8')
	}

	const httpServer: Server = createServer((req, res) => {
		void handleHttp(req, res).catch((error) =>
			sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
		)
	})

	async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
		// The single agent-facing route. Anything else — including any exec-shaped
		// path — is a plain 404; there is no code path that runs agent code.
		if (req.method !== 'POST' || req.url !== '/api/read') {
			sendJson(res, 404, { ok: false, error: 'Not found' })
			return
		}
		if (!isAuthorized(req)) {
			sendJson(res, 401, { ok: false, error: 'Unauthorized' })
			return
		}
		const parsed = readRequestSchema.safeParse(JSON.parse((await readBody(req)) || '{}'))
		if (!parsed.success) {
			sendJson(res, 400, { ok: false, error: 'Invalid read request' })
			return
		}
		const request = parsed.data

		if (request.op === 'list') {
			sendJson(res, 200, { ok: true, result: registry.list() })
			return
		}
		const match = registry.findByDocument(request.documentId)
		if (!match) {
			sendJson(res, 404, { ok: false, error: `No open tab for document ${request.documentId}` })
			return
		}
		const reply = await registry.request(match.session, request)
		sendJson(res, 200, reply)
	}

	const wss = new WebSocketServer({ server: httpServer })
	wss.on('connection', (socket: WebSocket) => {
		let sessionId: string | null = null
		socket.on('message', (data) => {
			let frame: { type?: string; token?: string; documentId?: string; correlationId?: string; reply?: unknown }
			try {
				frame = JSON.parse(String(data))
			} catch {
				return
			}
			if (frame.type === 'register') {
				// The tab authenticates with the same token; a bad token gets no session.
				if (frame.token !== options.token || typeof frame.documentId !== 'string') {
					socket.close()
					return
				}
				sessionId = `sess-${++sessionCounter}`
				registry.register(sessionId, frame.documentId, socket)
			} else if (frame.type === 'reply' && typeof frame.correlationId === 'string') {
				registry.resolveReply(frame.correlationId, frame.reply as { ok: boolean })
			}
		})
		socket.on('close', () => {
			if (sessionId) registry.unregister(sessionId)
		})
	})

	const host = options.host ?? '127.0.0.1'
	await new Promise<void>((resolve) => httpServer.listen(options.port ?? 0, host, () => resolve()))
	const address = httpServer.address()
	const port = address && typeof address !== 'string' ? address.port : (options.port ?? 0)

	return {
		port,
		close: () =>
			new Promise<void>((resolve) => {
				// Terminate live sockets first — otherwise httpServer.close() waits
				// for them and never returns.
				for (const client of wss.clients) client.terminate()
				wss.close(() => {
					httpServer.closeAllConnections?.()
					httpServer.close(() => resolve())
				})
			})
	}
}
