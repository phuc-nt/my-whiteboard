import { RecordsDatabase } from '@mywb/node-adapter/archive'
import { describeStoreBackendContract } from '@mywb/core/storage/testing'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createEmptyWasmSqliteStore, WasmSqliteStore } from './wasm-sqlite-store'

// The store must satisfy the shared async contract AND interop with the
// desktop's node:sqlite file both ways — that interop is what keeps the .mywb
// format single, not split.

describeStoreBackendContract('WasmSqliteStore', () => createEmptyWasmSqliteStore())

const tempDirs: string[] = []
function nodeDbBytes(build: (db: RecordsDatabase) => void): Uint8Array {
	const dir = mkdtempSync(join(tmpdir(), 'mywb-crossimpl-'))
	tempDirs.push(dir)
	const path = join(dir, 'db.sqlite')
	const db = new RecordsDatabase(path)
	build(db)
	db.checkpoint()
	db.close()
	return new Uint8Array(readFileSync(path))
}
afterAll(async () => {
	const { rm } = await import('node:fs/promises')
	await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })))
})

describe('cross-impl: node:sqlite ↔ sql.js', () => {
	it('reads records + schema written by node RecordsDatabase', async () => {
		const bytes = nodeDbBytes((db) => {
			db.replaceAll(
				[
					{ id: 'shape:a', typeName: 'shape', json: '{"n":1}' },
					{ id: 'page:p', typeName: 'page', json: '{"n":2}' }
				],
				'{"schemaVersion":1}'
			)
		})
		const store = await WasmSqliteStore.fromBytes(bytes)
		const records = (await store.loadAllRecords()).sort((a, b) => a.id.localeCompare(b.id))
		expect(records).toEqual([
			{ id: 'page:p', typeName: 'page', json: '{"n":2}' },
			{ id: 'shape:a', typeName: 'shape', json: '{"n":1}' }
		])
		expect(await store.getSchemaJson()).toBe('{"schemaVersion":1}')
		await store.close()
	})

	it('produces bytes that node RecordsDatabase reads back', async () => {
		const store = await createEmptyWasmSqliteStore()
		await store.replaceAll(
			[{ id: 'shape:x', typeName: 'shape', json: '{"web":true}' }],
			'{"schemaVersion":2}'
		)
		const bytes = store.toBytes()
		await store.close()

		const dir = mkdtempSync(join(tmpdir(), 'mywb-crossimpl-back-'))
		tempDirs.push(dir)
		const path = join(dir, 'db.sqlite')
		const { writeFileSync } = await import('node:fs')
		writeFileSync(path, bytes)
		const db = new RecordsDatabase(path)
		const records = db.loadAllRecords()
		const schema = db.getSchemaJson()
		db.close()
		expect(records).toEqual([{ id: 'shape:x', typeName: 'shape', json: '{"web":true}' }])
		expect(schema).toBe('{"schemaVersion":2}')
	})
})
