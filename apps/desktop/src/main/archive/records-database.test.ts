import { describeRecordStoreContract } from '@mywb/core/storage/testing'
import { mkdtempSync } from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RecordsDatabase } from './records-database'

// The shared RecordStore contract runs against the real sqlite implementation;
// the same suite runs against MemoryRecordStore in @mywb/core.
const contractDirs: string[] = []
afterAll(async () => {
	await Promise.all(contractDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})
describeRecordStoreContract('RecordsDatabase (sqlite)', () => {
	const dir = mkdtempSync(join(tmpdir(), 'mywb-db-contract-'))
	contractDirs.push(dir)
	return new RecordsDatabase(join(dir, 'db.sqlite'))
})

describe('RecordsDatabase', () => {
	let dir: string
	let db: RecordsDatabase

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'mywb-db-test-'))
		db = new RecordsDatabase(join(dir, 'db.sqlite'))
	})

	afterEach(async () => {
		db.close()
		await rm(dir, { recursive: true, force: true })
	})

	const record = (id: string, value: string) => ({
		id,
		typeName: 'shape',
		json: JSON.stringify({ id, value })
	})

	it('applies diffs incrementally: upsert then delete', () => {
		db.applyDiff([record('shape:a', 'v1'), record('shape:b', 'v1')], [])
		db.applyDiff([record('shape:a', 'v2')], ['shape:b'])
		const all = db.loadAllRecords()
		expect(all).toHaveLength(1)
		expect(all[0].id).toBe('shape:a')
		expect(JSON.parse(all[0].json).value).toBe('v2')
	})

	it('replaceAll swaps the full record set and stores the schema', () => {
		db.applyDiff([record('shape:old', 'v1')], [])
		db.replaceAll([record('shape:new', 'v1')], '{"schemaVersion":2}')
		expect(db.loadAllRecords().map((r) => r.id)).toEqual(['shape:new'])
		expect(db.getSchemaJson()).toBe('{"schemaVersion":2}')
	})

	it('survives close/reopen (data actually persisted)', () => {
		db.applyDiff([record('shape:persist', 'v1')], [])
		db.setSchemaJson('{"v":1}')
		db.checkpoint()
		db.close()
		db = new RecordsDatabase(join(dir, 'db.sqlite'))
		expect(db.loadAllRecords()).toHaveLength(1)
		expect(db.getSchemaJson()).toBe('{"v":1}')
	})

	it('rolls back the whole diff when one record fails', () => {
		db.applyDiff([record('shape:x', 'v1')], [])
		expect(() =>
			db.applyDiff(
				[record('shape:y', 'v1'), { id: null as unknown as string, typeName: 't', json: '{}' }],
				[]
			)
		).toThrow()
		// shape:y from the failed transaction must not be visible.
		expect(db.loadAllRecords().map((r) => r.id)).toEqual(['shape:x'])
	})
})
