import { describe, expect, it } from 'vitest'
import type { RecordStore } from './record-store'

// One behavioral spec, every implementation: the sqlite adapter (desktop) and
// the in-memory store (core) both run this suite, so the interface can't
// silently drift from what implementations actually do.

export function describeRecordStoreContract(name: string, factory: () => RecordStore): void {
	describe(`RecordStore contract: ${name}`, () => {
		it('round-trips records through applyDiff and loadAllRecords', () => {
			const store = factory()
			store.applyDiff(
				[
					{ id: 'a', typeName: 'shape', json: '{"n":1}' },
					{ id: 'b', typeName: 'page', json: '{"n":2}' }
				],
				[]
			)
			expect(store.loadAllRecords().sort((x, y) => x.id.localeCompare(y.id))).toEqual([
				{ id: 'a', typeName: 'shape', json: '{"n":1}' },
				{ id: 'b', typeName: 'page', json: '{"n":2}' }
			])
			store.close()
		})

		it('overwrites an existing record on re-put', () => {
			const store = factory()
			store.applyDiff([{ id: 'a', typeName: 'shape', json: '{"v":1}' }], [])
			store.applyDiff([{ id: 'a', typeName: 'shape', json: '{"v":2}' }], [])
			expect(store.loadAllRecords()).toEqual([{ id: 'a', typeName: 'shape', json: '{"v":2}' }])
			store.close()
		})

		it('deletes removed ids, and removal wins over a put in the same diff', () => {
			const store = factory()
			store.applyDiff([{ id: 'a', typeName: 'shape', json: '{}' }], [])
			store.applyDiff([{ id: 'b', typeName: 'shape', json: '{}' }], ['a', 'b'])
			expect(store.loadAllRecords()).toEqual([])
			store.close()
		})

		it('replaceAll swaps the whole record set and stores the schema', () => {
			const store = factory()
			store.applyDiff([{ id: 'old', typeName: 'shape', json: '{}' }], [])
			store.replaceAll([{ id: 'new', typeName: 'shape', json: '{}' }], '{"schemaVersion":2}')
			expect(store.loadAllRecords()).toEqual([{ id: 'new', typeName: 'shape', json: '{}' }])
			expect(store.getSchemaJson()).toBe('{"schemaVersion":2}')
			store.close()
		})

		it('schema is null until set, then round-trips', () => {
			const store = factory()
			expect(store.getSchemaJson()).toBeNull()
			store.setSchemaJson('{"schemaVersion":1}')
			expect(store.getSchemaJson()).toBe('{"schemaVersion":1}')
			store.setSchemaJson('{"schemaVersion":9}')
			expect(store.getSchemaJson()).toBe('{"schemaVersion":9}')
			store.close()
		})

		it('loadAllRecords results are safe to mutate (no shared references)', () => {
			const store = factory()
			store.applyDiff([{ id: 'a', typeName: 'shape', json: '{"v":1}' }], [])
			const first = store.loadAllRecords()
			first[0].json = 'tampered'
			expect(store.loadAllRecords()).toEqual([{ id: 'a', typeName: 'shape', json: '{"v":1}' }])
			store.close()
		})

		it('throws on use after close', () => {
			const store = factory()
			store.close()
			expect(() => store.applyDiff([], [])).toThrow()
			expect(() => store.loadAllRecords()).toThrow()
		})
	})
}
