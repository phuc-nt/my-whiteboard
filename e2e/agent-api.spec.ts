import { expect, test, type ElectronApplication } from '@playwright/test'
import { connectAgentApi, focusedDocId, launchApp, resetUserData, shutdownApp, type AgentApi } from './electron-app-fixture'

// The agent API is the product's core surface: token auth, read, mutate, verify.

let app: ElectronApplication
let api: AgentApi

test.beforeAll(async () => {
	await resetUserData()
	app = await launchApp()
	api = await connectAgentApi()
})

test.afterAll(async () => {
	await shutdownApp(app)
})

test('readme is served without a token', async () => {
	const res = await fetch(`${api.base}/readme`)
	expect(res.status).toBe(200)
	expect(await res.text()).toContain('My Whiteboard Canvas API')
})

test('mutating requests without a token are rejected', async () => {
	const res = await fetch(`${api.base}/api/search`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ code: 'return 1' })
	})
	expect(res.status).toBe(401)
})

test('agent can create shapes and verify them via records', async () => {
	const docId = await focusedDocId(api)
	const created = await api.exec<{ count: number }>(
		docId,
		`const { createShapeId } = tldraw
		 for (let i = 0; i < 3; i++) {
		   editor.createShape({ id: createShapeId(), type: 'geo', x: 100 + i * 220, y: 100, props: { geo: 'rectangle', w: 200, h: 120 } })
		 }
		 return { count: editor.getCurrentPageShapes().length }`
	)
	expect(created.success).toBe(true)

	const page = await api.search<{ shapes: Array<{ type: string }> }>(
		`return await api.getShapes(${JSON.stringify(docId)})`
	)
	expect(page.shapes.filter((s) => s.type === 'geo').length).toBe(3)
})

test('exec errors are reported, not thrown', async () => {
	const docId = await focusedDocId(api)
	const result = await api.exec(docId, 'throw new Error("boom")')
	expect(result.success).toBe(false)
	expect(result.error).toContain('boom')
})

test('unknown document id returns 404', async () => {
	const res = await api.post('/api/doc/does-not-exist/exec', JSON.stringify({ code: 'return 1' }))
	expect(res.status).toBe(404)
})
