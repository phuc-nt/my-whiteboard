import { buildMywbFixture } from '@mywb/node-adapter/headless-document'
import { startRelayServer } from 'my-whiteboard-agent-relay'
import type { RelayServer } from 'my-whiteboard-agent-relay'
import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// End-to-end proof of the read-only Agent Gateway with a REAL browser tab and a
// REAL relay server: a Chrome tab loads a real .mywb, connects out to the relay
// over WebSocket, and an agent (this test, acting as the agent via plain fetch)
// reads the open canvas through the relay's HTTP side. No fakes — real tab,
// real WebSocket, real HTTP, real document. Uses its own preview server wired to
// the relay via env, so it runs separately from the default e2e config.

const RELAY_TOKEN = 'e2e-relay-token'
const PREVIEW_PORT = 4174
const APP_URL = `http://127.0.0.1:${PREVIEW_PORT}/`

let relay: RelayServer
let preview: ChildProcess
let dir: string

test.beforeAll(async () => {
	relay = await startRelayServer({ token: RELAY_TOKEN, port: 0 })
	dir = await mkdtemp(join(tmpdir(), 'mywb-relay-e2e-'))

	// Build the app with the relay wired in, then serve it.
	const env = {
		...process.env,
		VITE_RELAY_URL: `ws://127.0.0.1:${relay.port}`,
		VITE_RELAY_TOKEN: RELAY_TOKEN
	}
	// Playwright's cwd is apps/web, so run vite directly (no -w workspace flag,
	// which only resolves from the repo root).
	await run('npx', ['vite', 'build'], env)
	preview = spawn(
		'npx',
		['vite', 'preview', '--host', '127.0.0.1', '--port', String(PREVIEW_PORT), '--strictPort'],
		{ env, stdio: 'ignore' }
	)
	await waitForServer(APP_URL)
})

test.afterAll(async () => {
	preview?.kill()
	await relay?.close()
	await rm(dir, { recursive: true, force: true })
})

test('an agent reads the open canvas through the relay, and there is no exec route', async ({
	page
}) => {
	const file = join(dir, 'board.mywb')
	await buildMywbFixture(file, {
		documentId: 'relay-e2e',
		serviceNodes: [
			{ name: 'checkout-api', kind: 'api' },
			{ name: 'orders-db', kind: 'db' }
		]
	})
	const bytes = Array.from(new Uint8Array(await readFile(file)))

	await page.goto(APP_URL)
	await expect(page.locator('.tl-canvas')).toBeVisible()
	await page.evaluate(async (b) => {
		// @ts-expect-error test hook installed on mount
		await window.__mywbTest.load(new Uint8Array(b), 'board.mywb')
	}, bytes)
	await expect(page.locator('[data-shape-type="service-node"]')).toHaveCount(2)

	const relayBase = `http://127.0.0.1:${relay.port}`
	// The tab connects to the relay on load; give the WebSocket register a moment.
	await expect
		.poll(async () => (await agentRead(relayBase, { op: 'list' })).result?.length ?? 0, {
			timeout: 5000
		})
		.toBeGreaterThan(0)

	// Agent reads the shapes of the live canvas through the relay.
	const shapesReply = await agentRead(relayBase, { op: 'getShapes', documentId: 'relay-e2e' })
	expect(shapesReply.ok).toBe(true)
	const names = (shapesReply.result as Array<{ props?: { name?: string } }>)
		.filter((s) => s.props?.name)
		.map((s) => s.props!.name)
		.sort()
	expect(names).toEqual(['checkout-api', 'orders-db'])

	// The gateway is read-only: no exec route exists.
	const execRes = await fetch(`${relayBase}/api/exec`, {
		method: 'POST',
		headers: { authorization: `Bearer ${RELAY_TOKEN}`, 'content-type': 'application/json' },
		body: JSON.stringify({ code: 'x' })
	})
	expect(execRes.status).toBe(404)
})

interface ReadReply {
	ok: boolean
	result?: unknown[]
	error?: string
}
async function agentRead(base: string, body: unknown): Promise<ReadReply> {
	const res = await fetch(`${base}/api/read`, {
		method: 'POST',
		headers: { authorization: `Bearer ${RELAY_TOKEN}`, 'content-type': 'application/json' },
		body: JSON.stringify(body)
	})
	return res.json() as Promise<ReadReply>
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { env, stdio: 'ignore' })
		child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))))
	})
}

async function waitForServer(url: string): Promise<void> {
	for (let i = 0; i < 100; i++) {
		try {
			await fetch(url)
			return
		} catch {
			await new Promise((r) => setTimeout(r, 200))
		}
	}
	throw new Error(`preview server did not start at ${url}`)
}
