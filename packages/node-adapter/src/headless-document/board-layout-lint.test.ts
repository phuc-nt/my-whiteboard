import { captureFullSnapshot } from '@mywb/core/sync'
import type { IndexKey } from 'tldraw'
import { describe, expect, it } from 'vitest'
import { lintBoardLayout } from './board-layout-lint'
import { createHeadlessStore } from './create-headless-store'

// Hand-built stores, same pattern as board-model-extract.test.ts, so each case
// controls exact x/y/w/h — the two known dagre bugs (260724 overlap, 260725
// negative-coords-on-group-move) become regression fixtures here.

function buildRecords(build: (ctx: { pageId: string; put: (r: unknown) => void }) => void) {
	const store = createHeadlessStore()
	const pageId = captureFullSnapshot(store).records.find((r) => r.typeName === 'page')!.id
	build({ pageId, put: (r) => store.put([r as never]) })
	return captureFullSnapshot(store).records
}

function serviceNode(args: {
	id: string
	name: string
	x: number
	y: number
	index: string
	parentId: string
	w?: number
	h?: number
}): Record<string, unknown> {
	return {
		id: args.id,
		typeName: 'shape',
		type: 'service-node',
		x: args.x,
		y: args.y,
		rotation: 0,
		index: args.index as IndexKey,
		parentId: args.parentId,
		isLocked: false,
		opacity: 1,
		meta: {},
		props: { w: args.w ?? 220, h: args.h ?? 96, name: args.name, kind: 'api', repoUrl: '', ownerTeam: '' }
	}
}

function frame(args: { id: string; name: string; x: number; y: number; w: number; h: number; index: string; parentId: string }): Record<string, unknown> {
	return {
		id: args.id,
		typeName: 'shape',
		type: 'frame',
		x: args.x,
		y: args.y,
		rotation: 0,
		index: args.index as IndexKey,
		parentId: args.parentId,
		isLocked: false,
		opacity: 1,
		meta: {},
		props: { w: args.w, h: args.h, name: args.name, color: 'black' }
	}
}

function arrow(args: { id: string; index: string; parentId: string; bend?: number }): Record<string, unknown> {
	return {
		id: args.id,
		typeName: 'shape',
		type: 'arrow',
		x: 0,
		y: 0,
		rotation: 0,
		index: args.index as IndexKey,
		parentId: args.parentId,
		isLocked: false,
		opacity: 1,
		meta: { relation: 'calls' },
		props: {
			kind: 'arc',
			elbowMidPoint: 0.5,
			dash: 'draw',
			size: 's',
			fill: 'none',
			color: 'black',
			labelColor: 'black',
			bend: args.bend ?? 0,
			start: { x: 0, y: 0 },
			end: { x: 2, y: 0 },
			arrowheadStart: 'none',
			arrowheadEnd: 'arrow',
			richText: { type: 'doc', content: [{ type: 'paragraph' }] },
			labelPosition: 0.5,
			font: 'draw',
			scale: 1
		}
	}
}

function binding(args: { id: string; fromId: string; toId: string; terminal: 'start' | 'end' }): Record<string, unknown> {
	return {
		id: args.id,
		typeName: 'binding',
		type: 'arrow',
		fromId: args.fromId,
		toId: args.toId,
		meta: {},
		props: { isPrecise: false, isExact: false, normalizedAnchor: { x: 0.5, y: 0.5 }, snap: 'none', terminal: args.terminal }
	}
}

describe('lintBoardLayout', () => {
	it('reports no violations on a clean, non-overlapping board', () => {
		const records = buildRecords(({ pageId, put }) => {
			put(serviceNode({ id: 'shape:a', name: 'a', x: 0, y: 0, index: 'a1', parentId: pageId }))
			put(serviceNode({ id: 'shape:b', name: 'b', x: 400, y: 0, index: 'a2', parentId: pageId }))
		})
		expect(lintBoardLayout(records)).toEqual([])
	})

	it('flags card-overlap: the 260724 dagre bug (two cards placed on top of each other)', () => {
		const records = buildRecords(({ pageId, put }) => {
			put(serviceNode({ id: 'shape:a', name: 'a', x: 0, y: 0, index: 'a1', parentId: pageId }))
			put(serviceNode({ id: 'shape:b', name: 'b', x: 50, y: 0, index: 'a2', parentId: pageId }))
		})
		const violations = lintBoardLayout(records)
		expect(violations).toHaveLength(1)
		expect(violations[0]).toMatchObject({ rule: 'card-overlap', severity: 'error' })
		expect(violations[0].shapeIds.sort()).toEqual(['shape:a', 'shape:b'])
	})

	it('does not flag overlap across different parents (frame member vs page-level card)', () => {
		const records = buildRecords(({ pageId, put }) => {
			put(frame({ id: 'shape:frame-0', name: 'backend', x: 0, y: 0, w: 300, h: 200, index: 'a1', parentId: pageId }))
			put(serviceNode({ id: 'shape:a', name: 'a', x: 10, y: 10, index: 'a2', parentId: 'shape:frame-0' }))
			put(serviceNode({ id: 'shape:b', name: 'b', x: 10, y: 10, index: 'a3', parentId: pageId }))
		})
		expect(lintBoardLayout(records)).toEqual([])
	})

	it('flags card-outside-frame: the 260725 dagre bug (negative coords after a group move)', () => {
		const records = buildRecords(({ pageId, put }) => {
			put(frame({ id: 'shape:frame-0', name: 'backend', x: 500, y: 500, w: 300, h: 200, index: 'a1', parentId: pageId }))
			// Frame-relative negative offset pushes the member's page-space rect
			// outside its own frame — the exact class of bug seen 260725.
			put(serviceNode({ id: 'shape:a', name: 'a', x: -50, y: -50, index: 'a2', parentId: 'shape:frame-0' }))
		})
		const violations = lintBoardLayout(records)
		expect(violations).toHaveLength(1)
		expect(violations[0]).toMatchObject({
			rule: 'card-outside-frame',
			severity: 'error',
			shapeIds: ['shape:a', 'shape:frame-0']
		})
	})

	it('accepts a member fully inside its frame after resolving frame-relative offsets', () => {
		const records = buildRecords(({ pageId, put }) => {
			put(frame({ id: 'shape:frame-0', name: 'backend', x: 500, y: 500, w: 300, h: 200, index: 'a1', parentId: pageId }))
			put(serviceNode({ id: 'shape:a', name: 'a', x: 24, y: 24, index: 'a2', parentId: 'shape:frame-0' }))
		})
		expect(lintBoardLayout(records)).toEqual([])
	})

	it('flags arrow-through-card: a straight arrow crossing a third, unrelated card', () => {
		const records = buildRecords(({ pageId, put }) => {
			put(serviceNode({ id: 'shape:a', name: 'a', x: 0, y: 0, index: 'a1', parentId: pageId }))
			put(serviceNode({ id: 'shape:mid', name: 'mid', x: 300, y: 0, index: 'a2', parentId: pageId }))
			put(serviceNode({ id: 'shape:b', name: 'b', x: 600, y: 0, index: 'a3', parentId: pageId }))
			put(arrow({ id: 'shape:arrow-0', index: 'a4', parentId: pageId }))
			put(binding({ id: 'binding:0-start', fromId: 'shape:arrow-0', toId: 'shape:a', terminal: 'start' }))
			put(binding({ id: 'binding:0-end', fromId: 'shape:arrow-0', toId: 'shape:b', terminal: 'end' }))
		})
		const violations = lintBoardLayout(records)
		expect(violations).toHaveLength(1)
		expect(violations[0]).toMatchObject({
			rule: 'arrow-through-card',
			severity: 'warn',
			shapeIds: ['shape:arrow-0', 'shape:mid']
		})
	})

	it('does not flag a curved arrow (bend != 0) as passing through a card', () => {
		const records = buildRecords(({ pageId, put }) => {
			put(serviceNode({ id: 'shape:a', name: 'a', x: 0, y: 0, index: 'a1', parentId: pageId }))
			put(serviceNode({ id: 'shape:mid', name: 'mid', x: 300, y: 0, index: 'a2', parentId: pageId }))
			put(serviceNode({ id: 'shape:b', name: 'b', x: 600, y: 0, index: 'a3', parentId: pageId }))
			put(arrow({ id: 'shape:arrow-0', index: 'a4', parentId: pageId, bend: 40 }))
			put(binding({ id: 'binding:0-start', fromId: 'shape:arrow-0', toId: 'shape:a', terminal: 'start' }))
			put(binding({ id: 'binding:0-end', fromId: 'shape:arrow-0', toId: 'shape:b', terminal: 'end' }))
		})
		expect(lintBoardLayout(records)).toEqual([])
	})

	it('does not flag an arrow crossing only its own bound endpoints', () => {
		const records = buildRecords(({ pageId, put }) => {
			put(serviceNode({ id: 'shape:a', name: 'a', x: 0, y: 0, index: 'a1', parentId: pageId }))
			put(serviceNode({ id: 'shape:b', name: 'b', x: 260, y: 0, index: 'a2', parentId: pageId }))
			put(arrow({ id: 'shape:arrow-0', index: 'a3', parentId: pageId }))
			put(binding({ id: 'binding:0-start', fromId: 'shape:arrow-0', toId: 'shape:a', terminal: 'start' }))
			put(binding({ id: 'binding:0-end', fromId: 'shape:arrow-0', toId: 'shape:b', terminal: 'end' }))
		})
		expect(lintBoardLayout(records)).toEqual([])
	})
})
