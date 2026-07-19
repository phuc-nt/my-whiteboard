import type { ReadRequest, RelayFrame } from '@mywb/core/agent-protocol'
import type { Editor } from 'tldraw'

// Tab side of the read-only Agent Gateway. Connects out to the relay, registers
// this document, and answers the relay's read requests by reading the live
// editor — never mutating it, never running agent code. Opt-in: the app only
// starts this when a relay URL + token are configured.

export interface RelayClientOptions {
	url: string
	token: string
	documentId: string
	editor: Editor
}

function runRead(editor: Editor, request: ReadRequest): unknown {
	switch (request.op) {
		case 'getShapes':
			// Read-only: snapshot the current shapes as plain records.
			return editor.getCurrentPageShapes().map((s) => ({ ...s }))
		case 'getBindings':
			return editor.store
				.allRecords()
				.filter((r) => r.typeName === 'binding')
				.map((r) => ({ ...r }))
		case 'list':
			// The relay answers `list` itself; a tab never sees it.
			return []
	}
}

export function startRelayClient(options: RelayClientOptions): () => void {
	const socket = new WebSocket(options.url)
	socket.addEventListener('open', () => {
		socket.send(
			JSON.stringify({ type: 'register', token: options.token, documentId: options.documentId })
		)
	})
	socket.addEventListener('message', (event) => {
		let frame: RelayFrame
		try {
			frame = JSON.parse(String(event.data))
		} catch {
			return
		}
		if (frame.type !== 'request') return
		let reply: { ok: boolean; result?: unknown; error?: string }
		try {
			reply = { ok: true, result: runRead(options.editor, frame.request) }
		} catch (error) {
			reply = { ok: false, error: error instanceof Error ? error.message : String(error) }
		}
		socket.send(JSON.stringify({ type: 'reply', correlationId: frame.correlationId, reply }))
	})
	return () => socket.close()
}
