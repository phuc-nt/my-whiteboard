import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractMywbArchive } from '../archive/mywb-archive-reader'
import { buildMywbFixture, makeServiceNodeRecord } from './fixture-builder'
import { applyRecordChanges, readMywbDocument } from './headless-document'

// Locks the headless read/apply contract before implementation: full read,
// record-level apply with schema validation, and no-touch-on-invalid.

const dirs: string[] = []
async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'mywb-headless-'))
	dirs.push(dir)
	return dir
}
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function sha256(path: string): Promise<string> {
	return createHash('sha256').update(await readFile(path)).digest('hex')
}

describe('readMywbDocument', () => {
	it('returns metadata, schema and every record of a fixture', async () => {
		const dir = await tempDir()
		const file = join(dir, 'board.mywb')
		await buildMywbFixture(file, {
			documentId: 'doc-read-test',
			serviceNodes: [
				{ name: 'checkout-api', kind: 'api' },
				{ name: 'orders-db', kind: 'db' }
			]
		})

		const doc = await readMywbDocument(file)
		expect(doc.metadata.documentId).toBe('doc-read-test')
		expect(doc.schemaJson).toBeTruthy()
		expect(JSON.parse(doc.schemaJson!)).toBeTruthy()
		const shapeRecords = doc.records.filter((r) => r.typeName === 'shape')
		expect(shapeRecords).toHaveLength(2)
		const names = shapeRecords.map((r) => JSON.parse(r.json).props.name).sort()
		expect(names).toEqual(['checkout-api', 'orders-db'])
	})
})

describe('applyRecordChanges', () => {
	it('puts a valid service-node and removes an existing record, round-tripping through the file', async () => {
		const dir = await tempDir()
		const file = join(dir, 'board.mywb')
		await buildMywbFixture(file, {
			serviceNodes: [{ name: 'legacy-svc', kind: 'api' }]
		})
		const before = await readMywbDocument(file)
		const legacy = before.records.find(
			(r) => r.typeName === 'shape' && JSON.parse(r.json).props.name === 'legacy-svc'
		)!

		const added = makeServiceNodeRecord({ name: 'new-svc', kind: 'web' }, before.records)
		const result = await applyRecordChanges(file, { put: [added], removed: [legacy.id] })
		expect(result.recordCount).toBeGreaterThan(0)

		const after = await readMywbDocument(file)
		const shapeNames = after.records
			.filter((r) => r.typeName === 'shape')
			.map((r) => JSON.parse(r.json).props.name)
		expect(shapeNames).toEqual(['new-svc'])
	})

	it('rejects invalid shape props before touching the file', async () => {
		const dir = await tempDir()
		const file = join(dir, 'board.mywb')
		await buildMywbFixture(file, { serviceNodes: [{ name: 'svc', kind: 'api' }] })
		const before = await readMywbDocument(file)
		const hashBefore = await sha256(file)

		const base = makeServiceNodeRecord({ name: 'x', kind: 'api' }, before.records)
		const bogus = {
			...base,
			props: { ...(base.props as Record<string, unknown>), kind: 'bogus' }
		}
		await expect(applyRecordChanges(file, { put: [bogus], removed: [] })).rejects.toThrow()
		expect(await sha256(file)).toBe(hashBefore)
	})

	it('rejects a malformed changes envelope', async () => {
		const dir = await tempDir()
		const file = join(dir, 'board.mywb')
		await buildMywbFixture(file, { serviceNodes: [] })
		await expect(
			applyRecordChanges(file, { put: [{ noId: true }], removed: [] })
		).rejects.toThrow()
	})

	it('preserves script dir and scriptDigest across an apply', async () => {
		const dir = await tempDir()
		const file = join(dir, 'board.mywb')
		const scriptSource = "export default function ({ editor }) { /* fixture script */ }\n"
		await buildMywbFixture(file, {
			serviceNodes: [{ name: 'svc', kind: 'api' }],
			script: { mainJs: scriptSource, digest: 'fixture-digest-abc' }
		})
		const before = await readMywbDocument(file)

		await applyRecordChanges(file, {
			put: [makeServiceNodeRecord({ name: 'added', kind: 'cron' }, before.records)],
			removed: []
		})

		const out = await tempDir()
		const metadata = await extractMywbArchive(file, out)
		expect(metadata.scriptDigest).toBe('fixture-digest-abc')
		expect(await readFile(join(out, 'script', 'main.js'), 'utf8')).toBe(scriptSource)
	})
})
