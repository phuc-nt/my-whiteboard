import { extractMywbArchive } from '@mywb/node-adapter/archive'
import { buildMywbFixture } from '@mywb/node-adapter/headless-document'
import { readMywbDocument } from '@mywb/node-adapter/headless-document'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readMywbArchive, writeMywbArchive } from './web-archive'
import { WasmSqliteStore } from './wasm-sqlite-store'

// The hard acceptance of Stage 2b: a .mywb survives desktop → web → desktop on
// the SAME file. Node writes it, the web adapter reads + edits + repacks it,
// and the Node reader sees the change — proof the format is single, not split.

const dirs: string[] = []
async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'mywb-roundtrip-'))
	dirs.push(dir)
	return dir
}
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

describe('desktop ↔ web round-trip on one file', () => {
	it('web reads a node-written board, edits it, and node reads the edit back (with assets + script preserved)', async () => {
		const dir = await tempDir()
		const file = join(dir, 'board.mywb')
		await buildMywbFixture(file, {
			documentId: 'roundtrip',
			serviceNodes: [{ name: 'keep-me', kind: 'api' }],
			script: { mainJs: 'export default () => {}\n', digest: 'digest-rt' }
		})

		// --- web side: read, add a record, repack ---
		const original = readMywbArchive(new Uint8Array(await readFile(file)))
		const store = await WasmSqliteStore.fromBytes(original.dbBytes)
		const before = await store.loadAllRecords()
		const page = before.find((r) => r.typeName === 'page')!
		await store.applyDiff(
			[
				{
					id: 'shape:web-added',
					typeName: 'shape',
					json: JSON.stringify({
						id: 'shape:web-added',
						typeName: 'shape',
						type: 'service-node',
						x: 400,
						y: 96,
						rotation: 0,
						index: 'a3',
						parentId: page.id,
						isLocked: false,
						opacity: 1,
						meta: {},
						props: { w: 220, h: 96, name: 'added-on-web', kind: 'web', repoUrl: '', ownerTeam: '' }
					})
				}
			],
			[]
		)
		const newDbBytes = store.toBytes()
		await store.close()

		const repacked = writeMywbArchive({
			metadata: original.metadata,
			dbBytes: newDbBytes,
			assets: original.assets,
			...(original.scriptFiles ? { scriptFiles: original.scriptFiles } : {})
		})
		await writeFile(file, repacked)

		// --- desktop side: node reads the web-written file ---
		const doc = await readMywbDocument(file)
		const names = doc.records
			.filter((r) => r.typeName === 'shape')
			.map((r) => JSON.parse(r.json).props.name)
			.sort()
		expect(names).toEqual(['added-on-web', 'keep-me'])

		// Script dir + digest survived the web repack.
		const out = await tempDir()
		const metadata = await extractMywbArchive(file, out)
		expect(metadata.scriptDigest).toBe('digest-rt')
		expect(await readFile(join(out, 'script', 'main.js'), 'utf8')).toContain('export default')
	})
})
