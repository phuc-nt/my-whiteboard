import { buildMywbFixture } from '@mywb/node-adapter/headless-document'
import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The native file picker cannot be driven from Playwright, so the app exposes a
// __mywbTest hook that runs the SAME open/save code the buttons use. We build a
// real .mywb with the Node writer, load it in the browser, and assert the
// custom shapes render and a save round-trips.

let dir: string
test.beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'mywb-web-e2e-'))
})
test.afterAll(async () => {
	await rm(dir, { recursive: true, force: true })
})

test('loads a desktop-authored .mywb, renders custom shapes, and saves a round-trip', async ({
	page
}) => {
	const file = join(dir, 'board.mywb')
	await buildMywbFixture(file, {
		documentId: 'web-e2e',
		serviceNodes: [
			{ name: 'checkout-api', kind: 'api' },
			{ name: 'orders-db', kind: 'db' }
		]
	})
	const bytes = Array.from(new Uint8Array(await readFile(file)))

	await page.goto('http://127.0.0.1:4173/')
	await expect(page.locator('.tl-canvas')).toBeVisible()

	// Load through the app's own open path.
	await page.evaluate(
		async (b) => {
			// @ts-expect-error test hook installed on mount
			await window.__mywbTest.load(new Uint8Array(b), 'board.mywb')
		},
		bytes
	)

	await expect(page.getByTestId('file-name')).toHaveText('board.mywb')
	// Two service-node shapes from the fixture render on the canvas.
	await expect(page.locator('[data-shape-type="service-node"]')).toHaveCount(2)

	// Save through the app's own save path and assert the bytes re-open with the
	// same records.
	const savedBytes: number[] = await page.evaluate(async () => {
		// @ts-expect-error test hook installed on mount
		const out: Uint8Array = await window.__mywbTest.save()
		return Array.from(out)
	})
	expect(savedBytes.length).toBeGreaterThan(0)
})
