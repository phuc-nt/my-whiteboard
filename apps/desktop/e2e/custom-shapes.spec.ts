import { expect, test, type ElectronApplication } from '@playwright/test'
import { connectAgentApi, focusedDocId, launchApp, resetUserData, shutdownApp, type AgentApi } from './electron-app-fixture'

// Dev-workflow custom shapes must be registered on the editor, creatable by an
// agent, and validated (bad props rejected).

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

test('all three custom shape utils are registered', async () => {
	const docId = await focusedDocId(api)
	const result = await api.exec<Record<string, boolean>>(
		docId,
		`return {
		   service: !!editor.getShapeUtil('service-node'),
		   code: !!editor.getShapeUtil('code-ref'),
		   mermaid: !!editor.getShapeUtil('mermaid-block'),
		 }`
	)
	expect(result.result).toEqual({ service: true, code: true, mermaid: true })
})

test('agent creates each custom shape and they round-trip through records', async () => {
	const docId = await focusedDocId(api)
	await api.exec(
		docId,
		`const { createShapeId } = tldraw
		 editor.createShape({ id: createShapeId(), type: 'service-node', x: 100, y: 100, props: { name: 'auth-api', kind: 'api', ownerTeam: 'platform', repoUrl: '', w: 220, h: 96 } })
		 editor.createShape({ id: createShapeId(), type: 'code-ref', x: 100, y: 250, props: { repo: 'x/auth', path: 'src/login.ts', lineStart: 10, lineEnd: 22, sha: '', w: 260, h: 44 } })
		 editor.createShape({ id: createShapeId(), type: 'mermaid-block', x: 400, y: 100, props: { source: 'graph LR\\n A-->B', w: 320, h: 220 } })
		 return true`
	)
	const page = await api.search<{ shapes: Array<{ type: string }> }>(
		`return await api.getShapes(${JSON.stringify(docId)})`
	)
	const types = page.shapes.map((s) => s.type)
	expect(types).toContain('service-node')
	expect(types).toContain('code-ref')
	expect(types).toContain('mermaid-block')
})

test('invalid shape props are rejected by validation', async () => {
	const docId = await focusedDocId(api)
	const result = await api.exec<{ rejected: boolean }>(
		docId,
		`const { createShapeId } = tldraw
		 try {
		   editor.createShape({ id: createShapeId(), type: 'service-node', x: 0, y: 0, props: { name: 'x', kind: 'NOT_A_KIND', ownerTeam: '', repoUrl: '', w: 100, h: 50 } })
		   return { rejected: false }
		 } catch { return { rejected: true } }`
	)
	expect(result.result?.rejected).toBe(true)
})
