import type { TLShapeId } from 'tldraw'
import { describe, expect, it } from 'vitest'
import { buildScriptHelpers } from './script-helpers'

// layoutGrid / layoutTree only touch a handful of editor methods (getShape,
// getShapePageBounds, updateShape, run). A minimal fake editor exercises the
// placement logic without a DOM-bound tldraw Editor, keeping this a fast unit
// test. The real editor is covered by the desktop e2e suite.

interface FakeShape {
	id: TLShapeId
	type: string
	x: number
	y: number
	w: number
	h: number
}

function makeFakeEditor(shapes: FakeShape[]) {
	const byId = new Map(shapes.map((s) => [s.id, s]))
	return {
		getShape: (id: TLShapeId) => byId.get(id),
		getShapePageBounds: (id: TLShapeId) => {
			const s = byId.get(id)
			if (!s) return undefined
			return { minX: s.x, minY: s.y, maxX: s.x + s.w, maxY: s.y + s.h, width: s.w, height: s.h }
		},
		updateShape: (partial: { id: TLShapeId; x?: number; y?: number }) => {
			const s = byId.get(partial.id)!
			if (partial.x !== undefined) s.x = partial.x
			if (partial.y !== undefined) s.y = partial.y
		},
		run: (fn: () => void) => fn()
	}
}

function boundsOf(shape: FakeShape) {
	return { minX: shape.x, minY: shape.y, maxX: shape.x + shape.w, maxY: shape.y + shape.h }
}
function overlaps(a: FakeShape, b: FakeShape): boolean {
	const A = boundsOf(a)
	const B = boundsOf(b)
	return A.minX < B.maxX && B.minX < A.maxX && A.minY < B.maxY && B.minY < A.maxY
}

function sid(n: string): TLShapeId {
	return `shape:${n}` as TLShapeId
}

describe('layoutGrid', () => {
	it('places n shapes in a non-overlapping grid with the requested columns', () => {
		const shapes: FakeShape[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => ({
			id: sid(n),
			type: 'service-node',
			x: 0,
			y: 0,
			w: 220,
			h: 96
		}))
		const helpers = buildScriptHelpers(makeFakeEditor(shapes) as never)

		helpers.layoutGrid(
			shapes.map((s) => s.id),
			{ cols: 2, gap: 40 }
		)

		for (let i = 0; i < shapes.length; i++) {
			for (let j = i + 1; j < shapes.length; j++) {
				expect(overlaps(shapes[i], shapes[j])).toBe(false)
			}
		}
		// 6 shapes / 2 cols → 3 distinct row y-positions.
		expect(new Set(shapes.map((s) => s.y)).size).toBe(3)
	})

	it('defaults to a roughly square grid when cols is omitted', () => {
		const shapes: FakeShape[] = Array.from({ length: 9 }, (_, i) => ({
			id: sid(`n${i}`),
			type: 'service-node',
			x: 0,
			y: 0,
			w: 100,
			h: 100
		}))
		const helpers = buildScriptHelpers(makeFakeEditor(shapes) as never)
		helpers.layoutGrid(shapes.map((s) => s.id))
		// sqrt(9) = 3 columns → 3 rows.
		expect(new Set(shapes.map((s) => s.y)).size).toBe(3)
	})
})

describe('layoutTree', () => {
	it('puts the root above its children by depth, children not overlapping', () => {
		const root: FakeShape = { id: sid('root'), type: 'service-node', x: 5, y: 5, w: 200, h: 90 }
		const c1: FakeShape = { id: sid('c1'), type: 'service-node', x: 0, y: 0, w: 200, h: 90 }
		const c2: FakeShape = { id: sid('c2'), type: 'service-node', x: 0, y: 0, w: 200, h: 90 }
		const helpers = buildScriptHelpers(makeFakeEditor([root, c1, c2]) as never)

		helpers.layoutTree(root.id, [
			[root.id, c1.id],
			[root.id, c2.id]
		])

		expect(c1.y).toBeGreaterThan(root.y)
		expect(c2.y).toBeGreaterThan(root.y)
		expect(overlaps(c1, c2)).toBe(false)
	})

	it('terminates on a cycle', () => {
		const a: FakeShape = { id: sid('a'), type: 'service-node', x: 0, y: 0, w: 100, h: 100 }
		const b: FakeShape = { id: sid('b'), type: 'service-node', x: 0, y: 0, w: 100, h: 100 }
		const helpers = buildScriptHelpers(makeFakeEditor([a, b]) as never)
		expect(() =>
			helpers.layoutTree(a.id, [
				[a.id, b.id],
				[b.id, a.id]
			])
		).not.toThrow()
		expect(b.y).toBeGreaterThan(a.y)
	})
})
