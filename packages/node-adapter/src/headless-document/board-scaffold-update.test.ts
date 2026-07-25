import type { BoardModel } from '@mywb/core/model'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IndexKey } from 'tldraw'
import { afterEach, describe, expect, it } from 'vitest'
import { extractBoardModel } from './board-model-extract'
import { buildBoardFromModel } from './board-scaffold'
import { updateBoardFromModel } from './board-scaffold-update'
import { applyRecordChanges, readMywbDocument } from './headless-document'

// The contract that makes the model worth maintaining: re-rendering a board from
// a changed model preserves what the human did to it. Every case here is a thing
// that must survive an update, or a thing that must actually change.

const dirs: string[] = []
async function tempFile(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'mywb-update-'))
	dirs.push(dir)
	return join(dir, 'board.mywb')
}
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

const base: BoardModel = {
	title: 'living board',
	documentId: 'update-doc',
	components: [
		{ name: 'ui', kind: 'web' },
		{ name: 'api', kind: 'api' },
		{ name: 'store', kind: 'db' }
	],
	edges: [
		{ from: 'ui', to: 'api', relation: 'calls' },
		{ from: 'api', to: 'store', relation: 'reads' }
	]
}

const grouped: BoardModel = {
	...base,
	groups: [{ name: 'backend', members: ['api', 'store'] }]
}

interface Shape {
	id: string
	type: string
	parentId: string
	x: number
	y: number
	props: Record<string, unknown>
	meta: Record<string, unknown>
}

async function shapesOf(file: string): Promise<Shape[]> {
	const doc = await readMywbDocument(file)
	return doc.records
		.filter((r) => r.typeName === 'shape')
		.map((r) => JSON.parse(r.json) as Shape)
}

async function bindingCount(file: string): Promise<number> {
	const doc = await readMywbDocument(file)
	return doc.records.filter((r) => r.typeName === 'binding').length
}

/** Scaffold `model`, then apply an update to `next`. Returns the board path. */
async function scaffoldThenUpdate(model: BoardModel, next: BoardModel): Promise<string> {
	const file = await tempFile()
	await buildBoardFromModel(file, model)
	await update(file, next)
	return file
}

async function update(file: string, model: BoardModel): Promise<void> {
	const doc = await readMywbDocument(file)
	await applyRecordChanges(file, updateBoardFromModel(doc.records, model))
}

/** A sticky note the human left on the board — the canonical foreign shape. */
function noteRecord(args: { id: string; parentId: string; x: number; y: number }): Record<string, unknown> {
	return {
		id: args.id,
		typeName: 'shape',
		type: 'note',
		x: args.x,
		y: args.y,
		rotation: 0,
		index: 'a0' as IndexKey,
		parentId: args.parentId,
		isLocked: false,
		opacity: 1,
		meta: { author: 'human' },
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
			richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'reviewed' }] }] }
		}
	}
}

describe('updateBoardFromModel — idempotence', () => {
	it('an unchanged model changes no record at all', async () => {
		const file = await tempFile()
		await buildBoardFromModel(file, grouped)
		const before = await readMywbDocument(file)

		await applyRecordChanges(file, updateBoardFromModel(before.records, grouped))

		const after = await readMywbDocument(file)
		const key = (records: typeof before.records) =>
			records
				.map((r) => `${r.id}\n${r.json}`)
				.sort()
				.join('\n')
		expect(key(after.records)).toBe(key(before.records))
	})

	it('is stable over repeated updates (the second changes nothing the first did not)', async () => {
		const file = await tempFile()
		await buildBoardFromModel(file, grouped)
		await update(file, grouped)
		const once = await readMywbDocument(file)
		await update(file, grouped)
		const twice = await readMywbDocument(file)
		expect(twice.records.map((r) => r.json).sort()).toEqual(once.records.map((r) => r.json).sort())
	})
})

describe('updateBoardFromModel — structure follows the model', () => {
	it('adds a new ungrouped component and its arrow', async () => {
		const next: BoardModel = {
			...base,
			components: [...base.components, { name: 'cli', kind: 'tool' }],
			edges: [...base.edges, { from: 'cli', to: 'api', relation: 'calls' }]
		}
		const file = await scaffoldThenUpdate(base, next)
		const shapes = await shapesOf(file)
		expect(shapes.filter((s) => s.type === 'service-node').map((s) => s.props.name).sort()).toEqual([
			'api',
			'cli',
			'store',
			'ui'
		])
		expect(shapes.filter((s) => s.type === 'arrow')).toHaveLength(3)
		expect(await bindingCount(file)).toBe(6)
	})

	it('adds a component into an existing group, parented to that frame', async () => {
		const next: BoardModel = {
			...grouped,
			components: [...grouped.components, { name: 'worker', kind: 'app' }],
			groups: [{ name: 'backend', members: ['api', 'store', 'worker'] }]
		}
		const file = await scaffoldThenUpdate(grouped, next)
		const shapes = await shapesOf(file)
		const frame = shapes.find((s) => s.type === 'frame')!
		const worker = shapes.find((s) => s.props.name === 'worker')!
		expect(worker.parentId).toBe(frame.id)
	})

	it('removes a component, its arrows and its bindings', async () => {
		const next: BoardModel = {
			...base,
			components: base.components.filter((c) => c.name !== 'store'),
			edges: base.edges.filter((e) => e.to !== 'store')
		}
		const file = await scaffoldThenUpdate(base, next)
		const shapes = await shapesOf(file)
		expect(shapes.map((s) => s.props.name)).not.toContain('store')
		expect(shapes.filter((s) => s.type === 'arrow')).toHaveLength(1)
		expect(await bindingCount(file)).toBe(2)
	})

	it('an edge-only change leaves every node position untouched', async () => {
		const file = await tempFile()
		await buildBoardFromModel(file, base)
		const before = await shapesOf(file)
		const positionsOf = (shapes: Shape[]) =>
			shapes
				.filter((s) => s.type === 'service-node')
				.map((s) => `${s.props.name}@${s.x},${s.y}`)
				.sort()

		await update(file, { ...base, edges: [{ from: 'ui', to: 'store', relation: 'writes' }] })

		const after = await shapesOf(file)
		expect(positionsOf(after)).toEqual(positionsOf(before))
		expect(after.filter((s) => s.type === 'arrow')).toHaveLength(1)
		expect(after.find((s) => s.type === 'arrow')!.meta.relation).toBe('writes')
	})

	it('applies a changed relation to the arrow label as well as its meta', async () => {
		const file = await scaffoldThenUpdate(base, {
			...base,
			edges: [
				{ from: 'ui', to: 'api', relation: 'queries' },
				...base.edges.slice(1)
			]
		})
		const arrows = (await shapesOf(file)).filter((s) => s.type === 'arrow')
		const changed = arrows.find((a) => a.meta.relation === 'queries')!
		expect(JSON.stringify(changed.props.richText)).toContain('queries')
	})
})

describe('updateBoardFromModel — human positions survive', () => {
	it('a node dragged to a new position keeps it', async () => {
		const file = await tempFile()
		await buildBoardFromModel(file, base)
		const shapes = await shapesOf(file)
		const ui = shapes.find((s) => s.props.name === 'ui')!
		await applyRecordChanges(file, { put: [{ ...ui, x: 1234, y: 5678 }], removed: [] })

		await update(file, { ...base, components: [...base.components, { name: 'cli', kind: 'tool' }] })

		const moved = (await shapesOf(file)).find((s) => s.props.name === 'ui')!
		expect([moved.x, moved.y]).toEqual([1234, 5678])
	})

	it('a resized card keeps its dimensions', async () => {
		const file = await tempFile()
		await buildBoardFromModel(file, base)
		const api = (await shapesOf(file)).find((s) => s.props.name === 'api')!
		await applyRecordChanges(file, {
			put: [{ ...api, props: { ...api.props, w: 400, h: 200 } }],
			removed: []
		})

		await update(file, base)

		const resized = (await shapesOf(file)).find((s) => s.props.name === 'api')!
		expect([resized.props.w, resized.props.h]).toEqual([400, 200])
	})

	it('a component moved between groups follows the model but lands near where it was', async () => {
		const file = await tempFile()
		await buildBoardFromModel(file, {
			...base,
			groups: [
				{ name: 'frontend', members: ['ui'] },
				{ name: 'backend', members: ['api', 'store'] }
			]
		})
		const before = await shapesOf(file)
		const frames = before.filter((s) => s.type === 'frame')
		const frontend = frames.find((f) => f.props.name === 'frontend')!
		const uiBefore = before.find((s) => s.props.name === 'ui')!
		const uiAbsolute = { x: frontend.x + uiBefore.x, y: frontend.y + uiBefore.y }

		await update(file, {
			...base,
			groups: [{ name: 'backend', members: ['api', 'store', 'ui'] }]
		})

		const after = await shapesOf(file)
		const backend = after.filter((s) => s.type === 'frame').find((f) => f.props.name === 'backend')!
		const uiAfter = after.find((s) => s.props.name === 'ui')!
		// parentId follows the model...
		expect(uiAfter.parentId).toBe(backend.id)
		// ...and the card is inside the frame the model put it in. A frame only
		// grows right and down, so a card that used to sit above or left of its new
		// frame is clamped in rather than rendered outside its own subsystem.
		expect(uiAfter.x).toBeGreaterThan(0)
		expect(uiAfter.y).toBeGreaterThan(0)
		const absoluteAfter = { x: backend.x + uiAfter.x, y: backend.y + uiAfter.y }
		expect(absoluteAfter.x).toBeGreaterThanOrEqual(uiAbsolute.x)
		expect(absoluteAfter.y).toBeGreaterThanOrEqual(uiAbsolute.y)
		expect(after.filter((s) => s.type === 'frame').map((f) => f.props.name)).toEqual(['backend'])
	})

	it('keeps the absolute position exactly when the new frame is above and left of it', async () => {
		// The clamp only kicks in for negative offsets; a card moving into a frame
		// that already contains its position must not drift at all.
		const file = await tempFile()
		await buildBoardFromModel(file, {
			...base,
			groups: [{ name: 'backend', members: ['api', 'store'] }]
		})
		const before = await shapesOf(file)
		const frame = before.find((s) => s.type === 'frame')!
		const ui = before.find((s) => s.props.name === 'ui')!
		// Drag ui well inside the frame's box while it is still a page-level card.
		const target = { x: frame.x + 300, y: frame.y + 200 }
		await applyRecordChanges(file, { put: [{ ...ui, ...target }], removed: [] })

		await update(file, { ...base, groups: [{ name: 'backend', members: ['api', 'store', 'ui'] }] })

		const after = await shapesOf(file)
		const frameAfter = after.find((s) => s.type === 'frame')!
		const uiAfter = after.find((s) => s.props.name === 'ui')!
		expect(uiAfter.parentId).toBe(frameAfter.id)
		expect({ x: frameAfter.x + uiAfter.x, y: frameAfter.y + uiAfter.y }).toEqual(target)
	})

	it('a frame grows so a member dragged to its edge is not left outside', async () => {
		const file = await tempFile()
		await buildBoardFromModel(file, grouped)
		const api = (await shapesOf(file)).find((s) => s.props.name === 'api')!
		await applyRecordChanges(file, { put: [{ ...api, x: 900, y: 700 }], removed: [] })

		await update(file, grouped)

		const after = await shapesOf(file)
		const frame = after.find((s) => s.type === 'frame')!
		const moved = after.find((s) => s.props.name === 'api')!
		expect(frame.props.w as number).toBeGreaterThan(moved.x + (moved.props.w as number))
		expect(frame.props.h as number).toBeGreaterThan(moved.y + (moved.props.h as number))
	})

	it('a repositioned title keeps its position, its text follows the model', async () => {
		const file = await tempFile()
		await buildBoardFromModel(file, base)
		const title = (await shapesOf(file)).find((s) => s.type === 'text')!
		await applyRecordChanges(file, { put: [{ ...title, x: 42, y: 43 }], removed: [] })

		await update(file, { ...base, title: 'renamed board' })

		const after = (await shapesOf(file)).find((s) => s.type === 'text')!
		expect([after.x, after.y]).toEqual([42, 43])
		expect(JSON.stringify(after.props.richText)).toContain('renamed board')
	})
})

describe('updateBoardFromModel — foreign shapes are never touched', () => {
	it('a note on the page survives verbatim', async () => {
		const file = await tempFile()
		await buildBoardFromModel(file, base)
		const pageId = (await readMywbDocument(file)).records.find((r) => r.typeName === 'page')!.id
		const note = noteRecord({ id: 'shape:human-note', parentId: pageId, x: 10, y: 20 })
		await applyRecordChanges(file, { put: [note], removed: [] })
		const before = (await shapesOf(file)).find((s) => s.id === 'shape:human-note')!

		await update(file, { ...base, components: [...base.components, { name: 'cli', kind: 'tool' }] })

		const after = (await shapesOf(file)).find((s) => s.id === 'shape:human-note')
		expect(after).toEqual(before)
	})

	it('a note inside a kept frame stays inside it', async () => {
		const file = await tempFile()
		await buildBoardFromModel(file, grouped)
		const frame = (await shapesOf(file)).find((s) => s.type === 'frame')!
		await applyRecordChanges(file, {
			put: [noteRecord({ id: 'shape:framed-note', parentId: frame.id, x: 5, y: 5 })],
			removed: []
		})

		await update(file, grouped)

		const after = (await shapesOf(file)).find((s) => s.id === 'shape:framed-note')!
		expect(after.parentId).toBe(frame.id)
		expect([after.x, after.y]).toEqual([5, 5])
	})

	it('a note in a dropped frame is re-parented to the page at its absolute position', async () => {
		const file = await tempFile()
		await buildBoardFromModel(file, grouped)
		const frame = (await shapesOf(file)).find((s) => s.type === 'frame')!
		await applyRecordChanges(file, {
			put: [noteRecord({ id: 'shape:orphan-note', parentId: frame.id, x: 5, y: 7 })],
			removed: []
		})
		const pageId = (await readMywbDocument(file)).records.find((r) => r.typeName === 'page')!.id

		// The model drops the group; its members stay as ungrouped components.
		await update(file, base)

		const after = await shapesOf(file)
		const note = after.find((s) => s.id === 'shape:orphan-note')!
		expect(after.filter((s) => s.type === 'frame')).toHaveLength(0)
		expect(note.parentId).toBe(pageId)
		expect([note.x, note.y]).toEqual([frame.x + 5, frame.y + 7])
	})

	it('a frame the human drew (not a model group) is left alone', async () => {
		const file = await tempFile()
		await buildBoardFromModel(file, base)
		const pageId = (await readMywbDocument(file)).records.find((r) => r.typeName === 'page')!.id
		const handFrame = {
			id: 'shape:hand-frame',
			typeName: 'shape',
			type: 'frame',
			x: 900,
			y: 900,
			rotation: 0,
			index: 'a0' as IndexKey,
			parentId: pageId,
			isLocked: false,
			opacity: 1,
			meta: {},
			props: { w: 300, h: 200, name: 'scratch area', color: 'black' }
		}
		await applyRecordChanges(file, { put: [handFrame], removed: [] })

		await update(file, base)

		const after = (await shapesOf(file)).find((s) => s.id === 'shape:hand-frame')
		expect(after).toMatchObject({ x: 900, y: 900, props: { name: 'scratch area' } })
	})

	/** Bind an existing arrow shape's two ends to two shapes, with a given id. */
	function handArrowChanges(args: {
		arrow: Shape
		id: string
		relation: string
		pageId: string
		startId: string
		endId: string
	}): { put: Array<Record<string, unknown>>; removed: string[] } {
		return {
			put: [
				{ ...(args.arrow as unknown as Record<string, unknown>), id: args.id, parentId: args.pageId, meta: { relation: args.relation } },
				...(['start', 'end'] as const).map((terminal) => ({
					id: `binding:${args.id.replace('shape:', '')}-${terminal}`,
					typeName: 'binding',
					type: 'arrow',
					fromId: args.id,
					toId: terminal === 'start' ? args.startId : args.endId,
					meta: {},
					props: {
						isPrecise: false,
						isExact: false,
						normalizedAnchor: { x: 0.5, y: 0.5 },
						snap: 'none',
						terminal
					}
				}))
			],
			removed: []
		}
	}

	it('an arrow between two declared components is the model’s, so an update rebuilds it', async () => {
		// Not a foreign shape despite being hand-drawn: `extractBoardModel` reads it
		// back as an edge, so the model owns it. Leaving it in place duplicated
		// every relation on the first update of a board scaffolded before edge ids
		// were prefixed.
		const file = await tempFile()
		await buildBoardFromModel(file, base)
		const shapes = await shapesOf(file)
		const pageId = (await readMywbDocument(file)).records.find((r) => r.typeName === 'page')!.id
		await applyRecordChanges(
			file,
			handArrowChanges({
				arrow: shapes.find((s) => s.type === 'arrow')!,
				id: 'shape:hand-arrow',
				relation: 'human hunch',
				pageId,
				startId: shapes.find((s) => s.props.name === 'ui')!.id,
				endId: shapes.find((s) => s.props.name === 'store')!.id
			})
		)

		await update(file, base)

		const doc = await readMywbDocument(file)
		expect(doc.records.find((r) => r.id === 'shape:hand-arrow')).toBeUndefined()
		expect(doc.records.filter((r) => r.id.startsWith('binding:hand-arrow-'))).toHaveLength(0)
		// exactly the model's edges remain — no duplicate of ui→store
		const extracted = extractBoardModel(doc.records)
		expect(extracted.edges).toEqual(base.edges)
	})

	it('an arrow touching a note is not an architecture claim, so it survives', async () => {
		const file = await tempFile()
		await buildBoardFromModel(file, base)
		const shapes = await shapesOf(file)
		const pageId = (await readMywbDocument(file)).records.find((r) => r.typeName === 'page')!.id
		await applyRecordChanges(file, {
			put: [noteRecord({ id: 'shape:annotation', parentId: pageId, x: 600, y: 600 })],
			removed: []
		})
		await applyRecordChanges(
			file,
			handArrowChanges({
				arrow: shapes.find((s) => s.type === 'arrow')!,
				id: 'shape:pointer-arrow',
				relation: 'see note',
				pageId,
				startId: 'shape:annotation',
				endId: shapes.find((s) => s.props.name === 'store')!.id
			})
		)

		await update(file, base)

		const doc = await readMywbDocument(file)
		expect(doc.records.find((r) => r.id === 'shape:pointer-arrow')).toBeTruthy()
		expect(doc.records.filter((r) => r.id.startsWith('binding:pointer-arrow-'))).toHaveLength(2)
	})

	it('an arrow to a card the model no longer declares survives as annotation', async () => {
		// Dropping a component from the model removes its card, but an arrow that
		// pointed at it from a still-declared card is not one of the model's edges
		// while the card is gone — it must not be silently rebuilt as one.
		const file = await tempFile()
		await buildBoardFromModel(file, base)
		const shapes = await shapesOf(file)
		const pageId = (await readMywbDocument(file)).records.find((r) => r.typeName === 'page')!.id
		await applyRecordChanges(file, {
			put: [noteRecord({ id: 'shape:margin-note', parentId: pageId, x: 700, y: 100 })],
			removed: []
		})
		await applyRecordChanges(
			file,
			handArrowChanges({
				arrow: shapes.find((s) => s.type === 'arrow')!,
				id: 'shape:margin-arrow',
				relation: 'why?',
				pageId,
				startId: 'shape:margin-note',
				endId: shapes.find((s) => s.props.name === 'ui')!.id
			})
		)

		await update(file, base)

		const doc = await readMywbDocument(file)
		expect(doc.records.find((r) => r.id === 'shape:margin-arrow')).toBeTruthy()
		expect(extractBoardModel(doc.records).edges).toEqual(base.edges)
	})
})

describe('updateBoardFromModel — the extracted model matches the new model', () => {
	it('after an update, extract returns the model that was applied', async () => {
		const next: BoardModel = {
			...grouped,
			components: [...grouped.components, { name: 'cli', kind: 'tool' }],
			edges: [...grouped.edges, { from: 'cli', to: 'api', relation: 'calls' }]
		}
		const file = await scaffoldThenUpdate(grouped, next)
		const extracted = extractBoardModel((await readMywbDocument(file)).records)
		expect(extracted.components.map((c) => c.name).sort()).toEqual(['api', 'cli', 'store', 'ui'])
		expect(extracted.edges).toHaveLength(3)
		expect(extracted.groups).toEqual([{ name: 'backend', members: ['api', 'store'] }])
	})
})

describe('updateBoardFromModel — group id reuse', () => {
	// A new group must not silently inherit a dropped group's frame id: the
	// dropped frame's foreign children would be left parented to a frame that now
	// means something else, and the re-parent pass would never see it as removed.
	it('renaming one group and adding another keeps each frame distinct', async () => {
		const file = await tempFile()
		await buildBoardFromModel(file, {
			...base,
			groups: [
				{ name: 'alpha', members: ['ui'] },
				{ name: 'beta', members: ['api'] }
			]
		})
		const alpha = (await shapesOf(file)).find((s) => s.props.name === 'alpha')!
		await applyRecordChanges(file, {
			put: [noteRecord({ id: 'shape:alpha-note', parentId: alpha.id, x: 3, y: 4 })],
			removed: []
		})

		// alpha is gone, gamma is new — gamma must not land on alpha's frame id.
		await update(file, {
			...base,
			groups: [
				{ name: 'beta', members: ['api'] },
				{ name: 'gamma', members: ['store'] }
			]
		})

		const after = await shapesOf(file)
		const frames = after.filter((s) => s.type === 'frame')
		expect(frames.map((f) => f.props.name).sort()).toEqual(['beta', 'gamma'])
		expect(new Set(frames.map((f) => f.id)).size).toBe(2)
		expect(frames.map((f) => f.id)).not.toContain(alpha.id)
		// the note that lived in alpha survives, re-parented to the page
		const pageId = (await readMywbDocument(file)).records.find((r) => r.typeName === 'page')!.id
		const note = after.find((s) => s.id === 'shape:alpha-note')!
		expect(note.parentId).toBe(pageId)
		expect([note.x, note.y]).toEqual([alpha.x + 3, alpha.y + 4])
	})
})
