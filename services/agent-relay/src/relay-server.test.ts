import { WebSocket } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { startRelayServer } from './relay-server'
import type { RelayServer } from './relay-server'

// The relay's security contract: read-only, token-gated, no exec surface, and
// a session dies with its tab. A fake tab (WebSocket) stands in for a browser.

let server: RelayServer | undefined
afterEach(async () => {
	await server?.close()
	server = undefined
})

const TOKEN = 'test-relay-token'

async function startWithFakeTab(
	handle: (op: string, documentId?: string) => unknown
): Promise<{ base: string; documentId: string; tab: WebSocket }> {
	server = await startRelayServer({ token: TOKEN, port: 0 })
	const base = `http://127.0.0.1:${server.port}`
	const documentId = 'doc-1'
	const tab = new WebSocket(`ws://127.0.0.1:${server.port}`)
	await new Promise<void>((resolve) => tab.on('open', () => resolve()))
	tab.send(JSON.stringify({ type: 'register', token: TOKEN, documentId }))
	tab.on('message', (data) => {
		const frame = JSON.parse(String(data))
		if (frame.type === 'request') {
			const result = handle(frame.request.op, frame.request.documentId)
			tab.send(
				JSON.stringify({ type: 'reply', correlationId: frame.correlationId, reply: { ok: true, result } })
			)
		}
	})
	// Give the register frame a moment to land.
	await new Promise((r) => setTimeout(r, 50))
	return { base, documentId, tab }
}

function agentPost(base: string, path: string, token: string | null, body: unknown): Promise<Response> {
	return fetch(`${base}${path}`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(token ? { authorization: `Bearer ${token}` } : {})
		},
		body: JSON.stringify(body)
	})
}

describe('relay read flow', () => {
	it('forwards a read request to the tab and returns its result', async () => {
		const { base, documentId } = await startWithFakeTab((op, docId) => ({ op, docId }))
		const res = await agentPost(base, '/api/read', TOKEN, { op: 'getShapes', documentId })
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ ok: true, result: { op: 'getShapes', docId: documentId } })
	})

	it('lists registered sessions', async () => {
		const { base, documentId } = await startWithFakeTab(() => [])
		const res = await agentPost(base, '/api/read', TOKEN, { op: 'list' })
		const body = (await res.json()) as { ok: boolean; result: unknown[] }
		expect(body.ok).toBe(true)
		// The relay itself answers `list` from its session registry.
		expect(body.result).toContainEqual(expect.objectContaining({ documentId }))
	})
})

describe('relay security', () => {
	it('rejects a missing or wrong token with 401', async () => {
		await startWithFakeTab(() => null)
		const base = `http://127.0.0.1:${server!.port}`
		expect((await agentPost(base, '/api/read', null, { op: 'list' })).status).toBe(401)
		expect((await agentPost(base, '/api/read', 'nope', { op: 'list' })).status).toBe(401)
	})

	it('has no exec route — any non-read path is 404', async () => {
		await startWithFakeTab(() => null)
		const base = `http://127.0.0.1:${server!.port}`
		expect((await agentPost(base, '/api/exec', TOKEN, { code: 'x' })).status).toBe(404)
		expect((await agentPost(base, '/api/doc/doc-1/exec', TOKEN, { code: 'x' })).status).toBe(404)
	})

	it('rejects an unknown read op', async () => {
		const { base } = await startWithFakeTab(() => null)
		const res = await agentPost(base, '/api/read', TOKEN, { op: 'mutate' })
		expect(res.status).toBe(400)
	})

	it('a closed tab removes its session; the agent then gets 404', async () => {
		const { base, documentId, tab } = await startWithFakeTab(() => null)
		tab.close()
		await new Promise((r) => setTimeout(r, 50))
		const res = await agentPost(base, '/api/read', TOKEN, { op: 'getShapes', documentId })
		expect(res.status).toBe(404)
	})
})
