import { expect, test } from '@playwright/test'

// The whole point of this app: core mounts and behaves in a plain browser.

test('canvas mounts, exec creates a service-node, sync lands in the memory store', async ({
	page
}) => {
	await page.goto('http://127.0.0.1:4173/')

	// tldraw canvas is up (core shapes registered without crashing the mount).
	await expect(page.locator('.tl-canvas')).toBeVisible()

	await page.getByTestId('run-exec').click()

	const output = page.getByTestId('exec-result')
	await expect(output).toContainText('"success": true')
	// Seeded shape + exec-created shape both flowed through document-sync
	// into the MemoryRecordStore.
	await expect(output).toContainText('"serviceNodesInStore": 2')
})
