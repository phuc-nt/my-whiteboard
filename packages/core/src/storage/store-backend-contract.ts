import { describe, expect, it } from 'vitest'
import type { StoreBackend } from './store-backend'

// Async twin of the RecordStore contract: one behavioral spec every async
// StoreBackend implementation runs (WASM sqlite on web, the sync-store adapter
// in core/tests), so the interface can't drift from real behavior. `factory`
// may itself be async (WASM init).

export function describeStoreBackendContract(
	name: string,
	factory: () => StoreBackend | Promise<StoreBackend>
): void {
	describe(`StoreBackend contract: ${name}`, () => {
		it('round-trips records through applyDiff and loadAllRecords', async () => {
			const store = await factory()
			await store.applyDiff(
				[
					{ id: 'a', typeName: 'shape', json: '{"n":1}' },
					{ id: 'b', typeName: 'page', json: '{"n":2}' }
				],
				[]
			)
			const all = (await store.loadAllRecords()).sort((x, y) => x.id.localeCompare(y.id))
			expect(all).toEqual([
				{ id: 'a', typeName: 'shape', json: '{"n":1}' },
				{ id: 'b', typeName: 'page', json: '{"n":2}' }
			])
			await store.close()
		})

		it('overwrites an existing record on re-put', async () => {
			const store = await factory()
			await store.applyDiff([{ id: 'a', typeName: 'shape', json: '{"v":1}' }], [])
			await store.applyDiff([{ id: 'a', typeName: 'shape', json: '{"v":2}' }], [])
			expect(await store.loadAllRecords()).toEqual([{ id: 'a', typeName: 'shape', json: '{"v":2}' }])
			await store.close()
		})

		it('deletes removed ids, and removal wins over a put in the same diff', async () => {
			const store = await factory()
			await store.applyDiff([{ id: 'a', typeName: 'shape', json: '{}' }], [])
			await store.applyDiff([{ id: 'b', typeName: 'shape', json: '{}' }], ['a', 'b'])
			expect(await store.loadAllRecords()).toEqual([])
			await store.close()
		})

		it('replaceAll swaps the whole record set and stores the schema', async () => {
			const store = await factory()
			await store.applyDiff([{ id: 'old', typeName: 'shape', json: '{}' }], [])
			await store.replaceAll([{ id: 'new', typeName: 'shape', json: '{}' }], '{"schemaVersion":2}')
			expect(await store.loadAllRecords()).toEqual([{ id: 'new', typeName: 'shape', json: '{}' }])
			expect(await store.getSchemaJson()).toBe('{"schemaVersion":2}')
			await store.close()
		})

		it('schema is null until set, then round-trips', async () => {
			const store = await factory()
			expect(await store.getSchemaJson()).toBeNull()
			await store.setSchemaJson('{"schemaVersion":1}')
			expect(await store.getSchemaJson()).toBe('{"schemaVersion":1}')
			await store.setSchemaJson('{"schemaVersion":9}')
			expect(await store.getSchemaJson()).toBe('{"schemaVersion":9}')
			await store.close()
		})

		it('loadAllRecords results are safe to mutate (no shared references)', async () => {
			const store = await factory()
			await store.applyDiff([{ id: 'a', typeName: 'shape', json: '{"v":1}' }], [])
			const first = await store.loadAllRecords()
			first[0].json = 'tampered'
			expect(await store.loadAllRecords()).toEqual([{ id: 'a', typeName: 'shape', json: '{"v":1}' }])
			await store.close()
		})

		it('rejects on use after close', async () => {
			const store = await factory()
			await store.close()
			await expect(store.applyDiff([], [])).rejects.toThrow()
			await expect(store.loadAllRecords()).rejects.toThrow()
		})
	})
}
