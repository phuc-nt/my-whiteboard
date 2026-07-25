import type { BoardModel } from '@mywb/core/model'
import { normalizeBoardModel } from '@mywb/core/model'
import { captureFullSnapshot } from '@mywb/core/sync'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IndexKey } from 'tldraw'
import { afterEach, describe, expect, it } from 'vitest'
import { extractBoardModel } from './board-model-extract'
import { buildBoardFromModel } from './board-scaffold'
import { createHeadlessStore } from './create-headless-store'
import { readMywbDocument } from './headless-document'

// Extract is the direction that makes the model canonical: a repo extracts the
// model from the board it already approved. The load-bearing assertion is the
// round-trip property — scaffold(model) → extract → the same model — because
// everything downstream (mywb file model extract, drift-check's board-sync
// claim, scaffold --update) trusts it.

const dirs: string[] = []
async function tempFile(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'mywb-extract-'))
	dirs.push(dir)
	return join(dir, 'board.mywb')
}
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

const ungrouped: BoardModel = {
	title: 'demo — architecture',
	components: [
		{ name: 'spa', kind: 'web' },
		{ name: 'server', kind: 'api', repoUrl: 'src/server' },
		{ name: 'state', kind: 'db', ownerTeam: 'platform' },
		{ name: 'cli', kind: 'tool' }
	],
	edges: [
		{ from: 'spa', to: 'server', relation: 'calls' },
		{ from: 'cli', to: 'server', relation: 'calls' },
		{ from: 'server', to: 'state', relation: 'reads' }
	]
}

const grouped: BoardModel = {
	title: 'grouped board',
	components: [
		{ name: 'web', kind: 'web' },
		{ name: 'api', kind: 'api' },
		{ name: 'worker', kind: 'app' },
		{ name: 'db', kind: 'db' },
		{ name: 'shared', kind: 'lib' }
	],
	edges: [
		{ from: 'web', to: 'api', relation: 'calls' },
		{ from: 'api', to: 'worker', relation: 'enqueues' },
		{ from: 'worker', to: 'db', relation: 'writes' },
		{ from: 'api', to: 'shared', relation: 'depends-on' }
	],
	groups: [
		{ name: 'frontend', members: ['web'] },
		{ name: 'backend', members: ['api', 'worker', 'db'] }
	]
}

/** Scaffold the model to a real .mywb, read it back, extract. */
async function roundTrip(model: BoardModel): Promise<BoardModel> {
	const file = await tempFile()
	await buildBoardFromModel(file, model)
	const doc = await readMywbDocument(file)
	return extractBoardModel(doc.records)
}

describe('extractBoardModel round-trip', () => {
	it('recovers an ungrouped model exactly', async () => {
		const extracted = await roundTrip(ungrouped)
		expect(normalizeBoardModel(extracted)).toEqual(normalizeBoardModel(ungrouped))
	})

	it('recovers a grouped model exactly, including frame membership', async () => {
		const extracted = await roundTrip(grouped)
		expect(normalizeBoardModel(extracted)).toEqual(normalizeBoardModel(grouped))
	})

	it('recovers a model with no title and no edges', async () => {
		const bare: BoardModel = { components: [{ name: 'lonely', kind: 'lib' }], edges: [] }
		const extracted = await roundTrip(bare)
		expect(normalizeBoardModel(extracted)).toEqual(normalizeBoardModel(bare))
		expect(extracted.title).toBeUndefined()
		expect(extracted.groups).toBeUndefined()
	})

	it('omits empty optional fields rather than emitting empty strings', async () => {
		const extracted = await roundTrip(ungrouped)
		const spa = extracted.components.find((c) => c.name === 'spa')!
		expect(Object.keys(spa)).toEqual(['name', 'kind'])
	})
})

// Record-level cases: build a store by hand so the board contains shapes
// scaffold would never emit.
async function extractFromRecords(build: (ctx: { pageId: string; put: (r: unknown) => void }) => void) {
	const store = createHeadlessStore()
	const pageId = captureFullSnapshot(store).records.find((r) => r.typeName === 'page')!.id
	build({ pageId, put: (r) => store.put([r as never]) })
	return extractBoardModel(captureFullSnapshot(store).records)
}

function serviceNode(args: {
	id: string
	name: string
	kind: string
	index: string
	parentId: string
}): Record<string, unknown> {
	return {
		id: args.id,
		typeName: 'shape',
		type: 'service-node',
		x: 0,
		y: 0,
		rotation: 0,
		index: args.index as IndexKey,
		parentId: args.parentId,
		isLocked: false,
		opacity: 1,
		meta: {},
		props: { w: 220, h: 96, name: args.name, kind: args.kind, repoUrl: '', ownerTeam: '' }
	}
}

describe('extractBoardModel on hand-drawn boards', () => {
	it('ignores shapes that carry no model meaning', async () => {
		const model = await extractFromRecords(({ pageId, put }) => {
			put(serviceNode({ id: 'shape:a', name: 'a', kind: 'api', index: 'a1', parentId: pageId }))
			put({
				id: 'shape:note',
				typeName: 'shape',
				type: 'note',
				x: 10,
				y: 10,
				rotation: 0,
				index: 'a2' as IndexKey,
				parentId: pageId,
				isLocked: false,
				opacity: 1,
				meta: {},
				props: {
					color: 'yellow',
					size: 'm',
					font: 'draw',
					align: 'middle',
					verticalAlign: 'middle',
					growY: 0,
					fontSizeAdjustment: 0,
					url: '',
					scale: 1,
					labelColor: 'black',
					textLastEditedBy: null,
					richText: { type: 'doc', content: [{ type: 'paragraph' }] }
				}
			})
		})
		expect(model.components.map((c) => c.name)).toEqual(['a'])
	})

	it('skips a service-node with a blank name (a draft card is not a component)', async () => {
		const model = await extractFromRecords(({ pageId, put }) => {
			put(serviceNode({ id: 'shape:named', name: 'named', kind: 'api', index: 'a1', parentId: pageId }))
			put(serviceNode({ id: 'shape:blank', name: '', kind: 'api', index: 'a2', parentId: pageId }))
		})
		expect(model.components.map((c) => c.name)).toEqual(['named'])
	})

	it('keeps only the first of two cards sharing a name (edges would be ambiguous)', async () => {
		const model = await extractFromRecords(({ pageId, put }) => {
			put(serviceNode({ id: 'shape:one', name: 'dup', kind: 'api', index: 'a1', parentId: pageId }))
			put(serviceNode({ id: 'shape:two', name: 'dup', kind: 'db', index: 'a2', parentId: pageId }))
		})
		expect(model.components).toEqual([{ name: 'dup', kind: 'api' }])
	})

	it('cannot see an unknown kind: the store schema rejects it before the file exists', async () => {
		// Guards the assumption extract's kind check documents — if tldraw ever
		// stopped validating this prop, extract would be the last line of defence.
		await expect(
			extractFromRecords(({ pageId, put }) => {
				put(serviceNode({ id: 'shape:x', name: 'x', kind: 'quantum', index: 'a1', parentId: pageId }))
			})
		).rejects.toThrow(/props\.kind/)
	})

	it('skips an arrow bound to only one endpoint', async () => {
		const model = await extractFromRecords(({ pageId, put }) => {
			put(serviceNode({ id: 'shape:a', name: 'a', kind: 'api', index: 'a1', parentId: pageId }))
			put({
				id: 'shape:arrow-half',
				typeName: 'shape',
				type: 'arrow',
				x: 0,
				y: 0,
				rotation: 0,
				index: 'a2' as IndexKey,
				parentId: pageId,
				isLocked: false,
				opacity: 1,
				meta: { relation: 'calls' },
				props: {
					kind: 'arc',
					elbowMidPoint: 0.5,
					dash: 'draw',
					size: 'm',
					fill: 'none',
					color: 'black',
					labelColor: 'black',
					bend: 0,
					start: { x: 0, y: 0 },
					end: { x: 2, y: 0 },
					arrowheadStart: 'none',
					arrowheadEnd: 'arrow',
					richText: { type: 'doc', content: [{ type: 'paragraph' }] },
					labelPosition: 0.5,
					font: 'draw',
					scale: 1
				}
			})
			put({
				id: 'binding:half-start',
				typeName: 'binding',
				type: 'arrow',
				fromId: 'shape:arrow-half',
				toId: 'shape:a',
				meta: {},
				props: {
					isPrecise: false,
					isExact: false,
					normalizedAnchor: { x: 0.5, y: 0.5 },
					snap: 'none',
					terminal: 'start'
				}
			})
		})
		expect(model.edges).toEqual([])
	})

	it('falls back to relates-to when a bound arrow declares no relation', async () => {
		const model = await extractFromRecords(({ pageId, put }) => {
			put(serviceNode({ id: 'shape:a', name: 'a', kind: 'api', index: 'a1', parentId: pageId }))
			put(serviceNode({ id: 'shape:b', name: 'b', kind: 'db', index: 'a2', parentId: pageId }))
			put({
				id: 'shape:arrow-bare',
				typeName: 'shape',
				type: 'arrow',
				x: 0,
				y: 0,
				rotation: 0,
				index: 'a3' as IndexKey,
				parentId: pageId,
				isLocked: false,
				opacity: 1,
				meta: {},
				props: {
					kind: 'arc',
					elbowMidPoint: 0.5,
					dash: 'draw',
					size: 'm',
					fill: 'none',
					color: 'black',
					labelColor: 'black',
					bend: 0,
					start: { x: 0, y: 0 },
					end: { x: 2, y: 0 },
					arrowheadStart: 'none',
					arrowheadEnd: 'arrow',
					richText: { type: 'doc', content: [{ type: 'paragraph' }] },
					labelPosition: 0.5,
					font: 'draw',
					scale: 1
				}
			})
			for (const [terminal, toId] of [
				['start', 'shape:a'],
				['end', 'shape:b']
			] as const) {
				put({
					id: `binding:bare-${terminal}`,
					typeName: 'binding',
					type: 'arrow',
					fromId: 'shape:arrow-bare',
					toId,
					meta: {},
					props: {
						isPrecise: false,
						isExact: false,
						normalizedAnchor: { x: 0.5, y: 0.5 },
						snap: 'none',
						terminal
					}
				})
			}
		})
		expect(model.edges).toEqual([{ from: 'a', to: 'b', relation: 'relates-to' }])
	})

	it('ignores an empty frame (a layout container is not a subsystem)', async () => {
		const model = await extractFromRecords(({ pageId, put }) => {
			put(serviceNode({ id: 'shape:a', name: 'a', kind: 'api', index: 'a1', parentId: pageId }))
			put({
				id: 'shape:frame-empty',
				typeName: 'shape',
				type: 'frame',
				x: 500,
				y: 0,
				rotation: 0,
				index: 'a2' as IndexKey,
				parentId: pageId,
				isLocked: false,
				opacity: 1,
				meta: {},
				props: { w: 300, h: 200, name: 'empty', color: 'black' }
			})
		})
		expect(model.groups).toBeUndefined()
	})
})
