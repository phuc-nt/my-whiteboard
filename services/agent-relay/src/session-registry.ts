import type { ReadReply, ReadRequest } from '@mywb/core/agent-protocol'
import type { WebSocket } from 'ws'

// Tracks live tab sessions (one WebSocket per open web document) and correlates
// an agent's read request with the tab's reply. Holds no document content —
// only the live connections and in-flight request promises.

interface Session {
	documentId: string
	socket: WebSocket
}

interface Pending {
	resolve: (reply: ReadReply) => void
	timer: ReturnType<typeof setTimeout>
}

const REQUEST_TIMEOUT_MS = 15_000

export class SessionRegistry {
	#sessions = new Map<string, Session>()
	#pending = new Map<string, Pending>()
	#counter = 0

	register(sessionId: string, documentId: string, socket: WebSocket): void {
		this.#sessions.set(sessionId, { documentId, socket })
	}

	unregister(sessionId: string): void {
		this.#sessions.delete(sessionId)
	}

	list(): Array<{ sessionId: string; documentId: string }> {
		return [...this.#sessions.entries()].map(([sessionId, s]) => ({
			sessionId,
			documentId: s.documentId
		}))
	}

	/** Find the session serving a given document (first match). */
	findByDocument(documentId: string): { sessionId: string; session: Session } | undefined {
		for (const [sessionId, session] of this.#sessions) {
			if (session.documentId === documentId) return { sessionId, session }
		}
		return undefined
	}

	/** Deliver a reply the tab sent back for an in-flight request. */
	resolveReply(correlationId: string, reply: ReadReply): void {
		const pending = this.#pending.get(correlationId)
		if (!pending) return
		clearTimeout(pending.timer)
		this.#pending.delete(correlationId)
		pending.resolve(reply)
	}

	/** Forward a read request to a session's tab and await its reply. */
	request(session: Session, request: ReadRequest): Promise<ReadReply> {
		const correlationId = `req-${++this.#counter}`
		return new Promise<ReadReply>((resolve) => {
			const timer = setTimeout(() => {
				this.#pending.delete(correlationId)
				resolve({ ok: false, error: 'tab did not reply in time' })
			}, REQUEST_TIMEOUT_MS)
			this.#pending.set(correlationId, { resolve, timer })
			session.socket.send(JSON.stringify({ type: 'request', correlationId, request }))
		})
	}
}
