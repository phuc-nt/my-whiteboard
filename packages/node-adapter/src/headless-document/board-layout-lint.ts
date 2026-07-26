import type { SerializedRecord } from '@mywb/core/format'

// Pure-geometry checks over a board's records — no model, no layout engine
// dependency, so it catches both dagre bugs and hand-drawn boards equally.
// Same layer as extract/update: reads records, returns data, never mutates.

export interface LayoutViolation {
	rule: 'card-overlap' | 'arrow-through-card' | 'card-outside-frame'
	severity: 'error' | 'warn'
	shapeIds: string[]
	message: string
}

interface ParsedShape {
	id: string
	type: string
	parentId: string
	x: number
	y: number
	w: number
	h: number
}

interface Rect {
	x: number
	y: number
	w: number
	h: number
}

function parseShapes(records: SerializedRecord[]): ParsedShape[] {
	return records
		.filter((r) => r.typeName === 'shape')
		.map((r) => {
			const record = JSON.parse(r.json) as {
				id: string
				type: string
				parentId?: string
				x?: number
				y?: number
				props?: { w?: number; h?: number }
			}
			return {
				id: record.id,
				type: record.type,
				parentId: record.parentId ?? '',
				x: typeof record.x === 'number' ? record.x : 0,
				y: typeof record.y === 'number' ? record.y : 0,
				w: typeof record.props?.w === 'number' ? record.props.w : 0,
				h: typeof record.props?.h === 'number' ? record.props.h : 0
			}
		})
}

// Same recursive parent-offset resolution as board-scaffold-update's
// absolutePosition: a shape's page-space origin is its parent's page-space
// origin plus its own local x/y (0,0 for a shape parented directly to the page).
function pageSpaceRect(shape: ParsedShape, byId: Map<string, ParsedShape>): Rect {
	const parent = byId.get(shape.parentId)
	if (!parent) return { x: shape.x, y: shape.y, w: shape.w, h: shape.h }
	const base = pageSpaceRect(parent, byId)
	return { x: base.x + shape.x, y: base.y + shape.y, w: shape.w, h: shape.h }
}

function rectsIntersect(a: Rect, b: Rect): boolean {
	return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function rectContains(outer: Rect, inner: Rect): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.w <= outer.x + outer.w &&
		inner.y + inner.h <= outer.y + outer.h
	)
}

function findCardOverlaps(cards: Array<{ shape: ParsedShape; rect: Rect }>): LayoutViolation[] {
	const violations: LayoutViolation[] = []
	for (let i = 0; i < cards.length; i++) {
		for (let j = i + 1; j < cards.length; j++) {
			const a = cards[i]
			const b = cards[j]
			if (a.shape.parentId !== b.shape.parentId) continue
			if (!rectsIntersect(a.rect, b.rect)) continue
			violations.push({
				rule: 'card-overlap',
				severity: 'error',
				shapeIds: [a.shape.id, b.shape.id],
				message: `service-node "${a.shape.id}" overlaps "${b.shape.id}"`
			})
		}
	}
	return violations
}

function findCardsOutsideFrame(
	cards: Array<{ shape: ParsedShape; rect: Rect }>,
	frames: Array<{ shape: ParsedShape; rect: Rect }>
): LayoutViolation[] {
	const frameById = new Map(frames.map((f) => [f.shape.id, f]))
	const violations: LayoutViolation[] = []
	for (const card of cards) {
		const frame = frameById.get(card.shape.parentId)
		if (!frame) continue
		if (rectContains(frame.rect, card.rect)) continue
		violations.push({
			rule: 'card-outside-frame',
			severity: 'error',
			shapeIds: [card.shape.id, frame.shape.id],
			message: `service-node "${card.shape.id}" is not fully inside frame "${frame.shape.id}"`
		})
	}
	return violations
}

// Arrow endpoints come from the shapes its bindings resolve to, approximated
// as rect centers — arrows carry no real geometry of their own (x/y/start/end
// are placeholders scaffold never repositions; see makeEdgeRecords). Curved
// arrows (bend != 0) are out of scope: a straight-segment crossing test would
// misjudge them, so they are skipped rather than flagged wrong.
function findArrowsThroughCards(
	records: SerializedRecord[],
	shapes: ParsedShape[],
	cards: Array<{ shape: ParsedShape; rect: Rect }>
): LayoutViolation[] {
	const cardRectById = new Map(cards.map((c) => [c.shape.id, c.rect]))
	const cardCenterById = new Map(
		cards.map((c) => [c.shape.id, { x: c.rect.x + c.rect.w / 2, y: c.rect.y + c.rect.h / 2 }])
	)

	const arrowBend = new Map<string, number>()
	for (const shape of shapes) {
		if (shape.type !== 'arrow') continue
		const record = JSON.parse(records.find((r) => r.id === shape.id)!.json) as { props?: { bend?: number } }
		arrowBend.set(shape.id, typeof record.props?.bend === 'number' ? record.props.bend : 0)
	}

	const terminals = new Map<string, { start?: string; end?: string }>()
	for (const r of records) {
		if (r.typeName !== 'binding') continue
		const binding = JSON.parse(r.json) as { type: string; fromId: string; toId: string; props?: { terminal?: string } }
		if (binding.type !== 'arrow') continue
		const entry = terminals.get(binding.fromId) ?? {}
		if (binding.props?.terminal === 'start') entry.start = binding.toId
		if (binding.props?.terminal === 'end') entry.end = binding.toId
		terminals.set(binding.fromId, entry)
	}

	const violations: LayoutViolation[] = []
	for (const [arrowId, entry] of terminals) {
		if (!entry.start || !entry.end) continue
		if ((arrowBend.get(arrowId) ?? 0) !== 0) continue
		const start = cardCenterById.get(entry.start)
		const end = cardCenterById.get(entry.end)
		if (!start || !end) continue
		for (const card of cards) {
			if (card.shape.id === entry.start || card.shape.id === entry.end) continue
			const rect = cardRectById.get(card.shape.id)!
			if (!segmentCrossesRect(start, end, rect)) continue
			violations.push({
				rule: 'arrow-through-card',
				severity: 'warn',
				shapeIds: [arrowId, card.shape.id],
				message: `arrow "${arrowId}" passes through unrelated service-node "${card.shape.id}"`
			})
		}
	}
	return violations
}

function segmentCrossesRect(p1: { x: number; y: number }, p2: { x: number; y: number }, rect: Rect): boolean {
	// Liang-Barsky segment-vs-AABB clip test: the segment crosses the rect if
	// the clipped parametric range [tMin, tMax] is non-empty.
	const dx = p2.x - p1.x
	const dy = p2.y - p1.y
	let tMin = 0
	let tMax = 1
	const clip = (p: number, q: number): boolean => {
		if (p === 0) return q >= 0
		const r = q / p
		if (p < 0) {
			if (r > tMax) return false
			if (r > tMin) tMin = r
		} else {
			if (r < tMin) return false
			if (r < tMax) tMax = r
		}
		return true
	}
	if (!clip(-dx, p1.x - rect.x)) return false
	if (!clip(dx, rect.x + rect.w - p1.x)) return false
	if (!clip(-dy, p1.y - rect.y)) return false
	if (!clip(dy, rect.y + rect.h - p1.y)) return false
	return tMin < tMax
}

/** Lint a board's records for mechanical layout problems. Pure, no I/O. */
export function lintBoardLayout(records: SerializedRecord[]): LayoutViolation[] {
	const shapes = parseShapes(records)
	const byId = new Map(shapes.map((s) => [s.id, s]))

	const cards = shapes
		.filter((s) => s.type === 'service-node')
		.map((shape) => ({ shape, rect: pageSpaceRect(shape, byId) }))
	const frames = shapes
		.filter((s) => s.type === 'frame')
		.map((shape) => ({ shape, rect: pageSpaceRect(shape, byId) }))

	return [
		...findCardOverlaps(cards),
		...findCardsOutsideFrame(cards, frames),
		...findArrowsThroughCards(records, shapes, cards)
	]
}
