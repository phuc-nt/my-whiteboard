import { createTLStore, defaultBindingUtils, defaultShapeUtils, PageRecordType } from 'tldraw'
import type { IndexKey } from 'tldraw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InitialSnapshotPayload, RecordsDiffPayload } from '../format/mywb-format-types'
import { captureFullSnapshot, startDocumentSync } from './document-sync'

// Locks the crash-recovery streaming policy before/after the move into core:
// one initial snapshot, leading+trailing debounce (500ms), add+remove collapse,
// manual flush, and dispose. Runs against a real TLStore in plain Node —
// no Editor, no DOM.

function makeStore() {
	const store = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils })
	// Create the default document/page records the way the editor does on
	// mount. Public at runtime but @internal in the d.ts, hence the cast.
	;(store as unknown as { ensureStoreIsUsable(): void }).ensureStoreIsUsable()
	return store
}

function makeTransport() {
	const initials: InitialSnapshotPayload[] = []
	const diffs: RecordsDiffPayload[] = []
	return {
		initials,
		diffs,
		transport: {
			pushInitialSnapshot: (p: InitialSnapshotPayload) => {
				initials.push(p)
				return Promise.resolve()
			},
			pushDiff: (p: RecordsDiffPayload) => {
				diffs.push(p)
				return Promise.resolve()
			}
		}
	}
}

// Pages are document-scope records with trivial props — enough to drive the
// store listener the same way user shape edits do.
let indexCounter = 1
function putShape(store: ReturnType<typeof makeStore>) {
	indexCounter += 1
	const page = PageRecordType.create({
		name: `page-${indexCounter}`,
		index: `a${indexCounter}` as IndexKey
	})
	store.put([page])
	return page.id
}

describe('startDocumentSync', () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	it('pushes exactly one initial full snapshot on start', () => {
		const store = makeStore()
		const { transport, initials } = makeTransport()
		startDocumentSync(store, transport)
		expect(initials).toHaveLength(1)
		expect(initials[0].records.length).toBeGreaterThan(0)
		expect(JSON.parse(initials[0].schemaJson)).toBeTruthy()
	})

	it('flushes the first change of a burst immediately, batches the rest at 500ms', () => {
		const store = makeStore()
		const { transport, diffs } = makeTransport()
		startDocumentSync(store, transport)

		const a = putShape(store)
		expect(diffs).toHaveLength(1)
		expect(diffs[0].put.map((r) => r.id)).toContain(a)

		const b = putShape(store)
		const c = putShape(store)
		expect(diffs).toHaveLength(1)

		vi.advanceTimersByTime(500)
		expect(diffs).toHaveLength(2)
		const batchedIds = diffs[1].put.map((r) => r.id)
		expect(batchedIds).toContain(b)
		expect(batchedIds).toContain(c)
	})

	it('collapses add followed by remove in the same batch into a removal', () => {
		const store = makeStore()
		const { transport, diffs } = makeTransport()
		startDocumentSync(store, transport)

		putShape(store) // leading flush consumes this one
		const b = putShape(store)
		store.remove([b])

		vi.advanceTimersByTime(500)
		const last = diffs.at(-1)!
		expect(last.put.map((r) => r.id)).not.toContain(b)
		expect(last.removed).toContain(b)
	})

	it('manual flush pushes pending changes without waiting for the timer', () => {
		const store = makeStore()
		const { transport, diffs } = makeTransport()
		const handle = startDocumentSync(store, transport)

		putShape(store)
		const b = putShape(store)
		expect(diffs).toHaveLength(1)

		handle.flush()
		expect(diffs).toHaveLength(2)
		expect(diffs[1].put.map((r) => r.id)).toContain(b)
	})

	it('dispose stops all further pushes', () => {
		const store = makeStore()
		const { transport, diffs } = makeTransport()
		const handle = startDocumentSync(store, transport)

		handle.dispose()
		putShape(store)
		vi.advanceTimersByTime(1000)
		expect(diffs).toHaveLength(0)
	})
})

describe('captureFullSnapshot', () => {
	it('serializes every document record plus the schema', () => {
		const store = makeStore()
		const snapshot = captureFullSnapshot(store)
		expect(snapshot.records.length).toBeGreaterThan(0)
		for (const record of snapshot.records) {
			expect(record).toEqual({
				id: expect.any(String),
				typeName: expect.any(String),
				json: expect.any(String)
			})
		}
		expect(JSON.parse(snapshot.schemaJson)).toBeTruthy()
	})
})
