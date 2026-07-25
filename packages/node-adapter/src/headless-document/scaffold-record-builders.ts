import type { BoardModelEdge } from '@mywb/core/model'
import type { IndexKey } from 'tldraw'

// The tldraw records a scaffolded board is made of, as pure builders. Shared by
// the fresh build (board-scaffold) and the merge path (board-scaffold-update)
// so both directions emit byte-identical shapes for the same model — the
// property the idempotence test rests on.
//
// Ids are deterministic and prefixed by role: `shape:frame-N`, `shape:edge-N`,
// `shape:title-<documentId>`. The prefixes are how the update path tells
// scaffold-owned shapes from ones a human added.

/** Id prefixes that mark a shape as owned (and therefore rebuilt) by scaffold. */
export const SCAFFOLD_ID_PREFIX = {
	frame: 'shape:frame-',
	edge: 'shape:edge-',
	title: 'shape:title-'
} as const

/** Default card footprint the layout engine plans around; matches service-node defaults. */
export const NODE_W = 220
export const NODE_H = 96
export const TITLE_X = 80
export const TITLE_Y = 20

function richTextDoc(text: string): Record<string, unknown> {
	return text
		? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
		: { type: 'doc', content: [{ type: 'paragraph' }] }
}

export function makeFrameRecord(args: {
	id: string
	name: string
	x: number
	y: number
	w: number
	h: number
	index: IndexKey
	pageId: string
}): Record<string, unknown> {
	return {
		id: args.id,
		typeName: 'shape',
		type: 'frame',
		x: args.x,
		y: args.y,
		rotation: 0,
		index: args.index,
		parentId: args.pageId,
		isLocked: false,
		opacity: 1,
		meta: {},
		props: { w: args.w, h: args.h, name: args.name, color: 'black' }
	}
}

export function makeTitleRecord(args: {
	documentId: string
	title: string
	index: IndexKey
	pageId: string
}): Record<string, unknown> {
	return {
		id: `${SCAFFOLD_ID_PREFIX.title}${args.documentId}`,
		typeName: 'shape',
		type: 'text',
		x: TITLE_X,
		y: TITLE_Y,
		rotation: 0,
		index: args.index,
		parentId: args.pageId,
		isLocked: false,
		opacity: 1,
		meta: {},
		props: {
			color: 'black',
			size: 'm',
			w: 8,
			font: 'draw',
			textAlign: 'start',
			autoSize: true,
			scale: 1,
			richText: richTextDoc(args.title)
		}
	}
}

/**
 * Relation arrow plus its two endpoint bindings. `meta.relation` stays the data
 * source of truth (mermaid export and drift-check read it); the same string is
 * mirrored into the arrow's label so the canvas reads like a diagram instead of
 * unlabelled spaghetti.
 */
export function makeEdgeRecords(args: {
	index: number
	edge: BoardModelEdge
	fromShapeId: string
	toShapeId: string
	shapeIndex: IndexKey
	pageId: string
}): Record<string, unknown>[] {
	const arrowId = `${SCAFFOLD_ID_PREFIX.edge}${args.index}`
	const arrow = {
		id: arrowId,
		typeName: 'shape',
		type: 'arrow',
		x: 0,
		y: 0,
		rotation: 0,
		index: args.shapeIndex,
		parentId: args.pageId,
		isLocked: false,
		opacity: 1,
		meta: { relation: args.edge.relation },
		props: {
			kind: 'arc',
			elbowMidPoint: 0.5,
			dash: 'draw',
			// Label text scales with size; 's' keeps relation verbs from
			// dominating the node cards they sit between.
			size: 's',
			fill: 'none',
			color: 'black',
			labelColor: 'black',
			bend: 0,
			start: { x: 0, y: 0 },
			end: { x: 2, y: 0 },
			arrowheadStart: 'none',
			arrowheadEnd: 'arrow',
			richText: richTextDoc(args.edge.relation),
			labelPosition: 0.5,
			font: 'draw',
			scale: 1
		}
	}
	const bindings = (
		[
			['start', args.fromShapeId],
			['end', args.toShapeId]
		] as const
	).map(([terminal, toId]) => ({
		id: `binding:edge-${args.index}-${terminal}`,
		typeName: 'binding',
		type: 'arrow',
		fromId: arrowId,
		toId,
		meta: {},
		props: {
			isPrecise: false,
			isExact: false,
			normalizedAnchor: { x: 0.5, y: 0.5 },
			snap: 'none',
			terminal
		}
	}))
	return [arrow, ...bindings]
}
