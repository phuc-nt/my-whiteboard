import { buildMywbFixture } from '@mywb/node-adapter/headless-document'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readMywbArchive } from './read-mywb-archive'
import { writeMywbArchive } from './write-mywb-archive'

// The browser archive reader/writer must agree with the Node yauzl/yazl one on
// the .mywb layout — so a file made by either opens in the other.

const dirs: string[] = []
async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'mywb-webarchive-'))
	dirs.push(dir)
	return dir
}
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

describe('readMywbArchive', () => {
	it('reads metadata, db bytes and script from a node-written .mywb', async () => {
		const dir = await tempDir()
		const file = join(dir, 'board.mywb')
		await buildMywbFixture(file, {
			documentId: 'web-read',
			serviceNodes: [{ name: 'svc', kind: 'api' }],
			script: { mainJs: 'export default () => {}\n', digest: 'digest-xyz' }
		})
		const bytes = new Uint8Array(await readFile(file))

		const archive = readMywbArchive(bytes)
		expect(archive.metadata.documentId).toBe('web-read')
		expect(archive.metadata.scriptDigest).toBe('digest-xyz')
		expect(archive.dbBytes.byteLength).toBeGreaterThan(0)
		expect(archive.scriptFiles?.get('main.js')).toContain('export default')
	})
})

describe('writeMywbArchive', () => {
	it('round-trips every entry including binary db and nested assets', () => {
		const dbBytes = new Uint8Array([1, 2, 3, 4, 5])
		const assets = new Map<string, Uint8Array>([['logo.png', new Uint8Array([9, 8, 7])]])
		const scriptFiles = new Map<string, string>([['main.js', 'export default () => {}\n']])
		const metadata = {
			formatVersion: 1,
			appVersion: '0.0.0-test',
			documentId: 'rt',
			createdAt: '2026-07-19T00:00:00.000Z',
			scriptDigest: 'd'
		}

		const bytes = writeMywbArchive({ metadata, dbBytes, assets, scriptFiles })
		const back = readMywbArchive(bytes)
		expect(back.metadata).toEqual(metadata)
		expect(Array.from(back.dbBytes)).toEqual([1, 2, 3, 4, 5])
		expect(Array.from(back.assets.get('logo.png')!)).toEqual([9, 8, 7])
		expect(back.scriptFiles?.get('main.js')).toContain('export default')
	})
})
