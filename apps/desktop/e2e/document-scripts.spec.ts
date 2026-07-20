import { expect, test, type ElectronApplication } from '@playwright/test'
import { writeFile } from 'fs/promises'
import { connectAgentApi, focusedDocId, launchApp, resetUserData, shutdownApp, type AgentApi } from './electron-app-fixture'

// Document scripts: workspace → write → watcher applies → effect visible; a
// throwing script surfaces an error without crashing the editor. Consent is
// auto-approved under test via MYWB_E2E_AUTO_CONSENT.

let app: ElectronApplication
let api: AgentApi

test.beforeAll(async () => {
	await resetUserData()
	app = await launchApp({ MYWB_E2E_AUTO_CONSENT: 'approve' })
	api = await connectAgentApi()
})

test.afterAll(async () => {
	await shutdownApp(app)
})

// The watcher → consent → run chain is fast locally but comfortably slower on
// a shared CI runner; give it more room there rather than making every local
// run wait out a padded timeout.
const STATE_TIMEOUT_MS = process.env.CI ? 40_000 : 8_000

async function waitForState(
	docId: string,
	expected: string,
	timeoutMs = STATE_TIMEOUT_MS
): Promise<string> {
	const deadline = Date.now() + timeoutMs
	let last = 'none'
	while (Date.now() < deadline) {
		const res = await api.get(`/api/doc/${docId}/script-status`)
		const data = await res.json()
		last = data.result?.state
		if (last === expected) return last
		await new Promise((r) => setTimeout(r, 250))
	}
	return last
}

test('a document script runs after being written and its effect is visible', async () => {
	const docId = await focusedDocId(api)
	const workspace = await api.post(`/api/doc/${docId}/script-workspace`).then((r) => r.json())
	expect(workspace.result.isDefaultScript).toBe(true)

	await writeFile(
		workspace.result.mainJsPath,
		`export default function ({ editor }) { editor.updateDocumentSettings({ meta: { scriptRan: true } }) }\n`
	)

	expect(await waitForState(docId, 'applied')).toBe('applied')

	const effect = await api.exec<{ scriptRan: boolean }>(
		docId,
		'return { scriptRan: editor.getDocumentSettings().meta?.scriptRan === true }'
	)
	expect(effect.result?.scriptRan).toBe(true)
})

test('a throwing script surfaces an error and does not crash the editor', async () => {
	const docId = await focusedDocId(api)
	const workspace = await api.post(`/api/doc/${docId}/script-workspace`).then((r) => r.json())
	await writeFile(
		workspace.result.mainJsPath,
		`export default function () { throw new Error('script boom') }\n`
	)

	expect(await waitForState(docId, 'error')).toBe('error')

	// Editor still responds to exec after the script error.
	const alive = await api.exec<number>(docId, 'return editor.getCurrentPageShapes().length')
	expect(alive.success).toBe(true)
})
