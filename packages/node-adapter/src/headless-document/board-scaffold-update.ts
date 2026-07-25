import type { SerializedRecord } from '@mywb/core/format'
import type { BoardModel } from '@mywb/core/model'
import { groupMembershipOf, parseBoardModel } from '@mywb/core/model'
import type { IndexKey } from 'tldraw'
import { createShapeId, getIndexAbove } from 'tldraw'
import { layoutBoardGraph } from './dagre-board-layout'
import type { RecordChanges } from './headless-document'
import {
	makeEdgeRecords,
	makeFrameRecord,
	makeTitleRecord,
	NODE_H,
	NODE_W,
	SCAFFOLD_ID_PREFIX
} from './scaffold-record-builders'

// Re-render a board from a CHANGED model without destroying the human's work.
// A fresh scaffold overwrites everything, which makes the model useless as a
// living source of truth: nobody edits a model if re-rendering throws away the
// sticky note they left during review.
//
// Ownership rule, and the whole basis of the merge:
//   scaffold owns  — service-nodes, frames named after a model group, arrows
//                    with the `shape:edge-` prefix, the `shape:title-` text
//   the human owns — everything else, copied through untouched (including
//                    parentId, so a note inside a kept frame stays inside it)
//
// Within scaffold's own shapes, position is still the human's: a component
// matched BY NAME keeps the x/y it was dragged to. Only the model's structure
// (which components exist, which group they belong to, which edges connect
// them) overrides the board. Renaming a component in the model therefore reads
// as delete + add — a documented limitation, not a bug.

/** Room left around kept members when a frame has to grow to contain them. */
const FRAME_PAD = 24

interface ParsedShape {
	id: string
	type: string
	index: IndexKey
	parentId: string
	x: number
	y: number
	props: Record<string, unknown>
	record: Record<string, unknown>
}

function parseShapes(records: SerializedRecord[]): ParsedShape[] {
	return records
		.filter((r) => r.typeName === 'shape')
		.map((r) => {
			const record = JSON.parse(r.json) as Record<string, unknown>
			return {
				id: record.id as string,
				type: record.type as string,
				index: (record.index ?? 'a1') as IndexKey,
				parentId: (record.parentId ?? '') as string,
				x: typeof record.x === 'number' ? record.x : 0,
				y: typeof record.y === 'number' ? record.y : 0,
				props: (record.props ?? {}) as Record<string, unknown>,
				record
			}
		})
		.sort((a, b) => (a.index === b.index ? a.id.localeCompare(b.id) : a.index < b.index ? -1 : 1))
}

/** Absolute page-space position of a shape, resolving one level of frame nesting. */
function absolutePosition(shape: ParsedShape, byId: Map<string, ParsedShape>): { x: number; y: number } {
	const parent = byId.get(shape.parentId)
	// Frames are only ever page-level here (scaffold never nests them), so one
	// hop is enough; a deeper hand-made hierarchy resolves through the chain.
	if (!parent) return { x: shape.x, y: shape.y }
	const base = absolutePosition(parent, byId)
	return { x: base.x + shape.x, y: base.y + shape.y }
}

/**
 * Merge a model into an existing board's records. Returns the record-level
 * change set to hand to `applyRecordChanges`, which validates it against the
 * app's own store schema and writes atomically — the same path the CLI's
 * `file apply` uses, so an update can never leave a half-written board.
 */
export function updateBoardFromModel(existingRecords: SerializedRecord[], rawModel: BoardModel): RecordChanges {
	const model = parseBoardModel(rawModel)
	const groupOfMember = groupMembershipOf(model)
	const modelGroups = model.groups ?? []
	const groupNames = new Set(modelGroups.map((g) => g.name))

	const pageId = existingRecords.find((r) => r.typeName === 'page')?.id
	if (!pageId) throw new Error('document has no page record')

	const shapes = parseShapes(existingRecords)
	const shapeById = new Map(shapes.map((s) => [s.id, s]))

	// --- classify -----------------------------------------------------------
	// Scaffold-owned shapes are the ones this function may move, resize or
	// delete. A hand-added service-node is adopted (its name may well be in the
	// model); a frame is only owned if the model still declares a group by that
	// name, so a frame the human drew to annotate the board survives.
	const oldNodeByName = new Map<string, ParsedShape>()
	for (const shape of shapes) {
		if (shape.type !== 'service-node') continue
		const name = typeof shape.props.name === 'string' ? shape.props.name : ''
		if (name && !oldNodeByName.has(name)) oldNodeByName.set(name, shape)
	}
	// A frame is scaffold's if a past scaffold minted it (id prefix) or if the
	// model claims a group by that name. The prefix is what makes a dropped group
	// deletable: once the model stops declaring it, its name no longer matches, so
	// name alone would silently strand the frame on the board forever. A frame the
	// human drew has neither, and survives.
	const oldFrames = shapes.filter(
		(s) =>
			s.type === 'frame' &&
			(s.id.startsWith(SCAFFOLD_ID_PREFIX.frame) ||
				(typeof s.props.name === 'string' && groupNames.has(s.props.name)))
	)
	const oldFrameByName = new Map<string, ParsedShape>()
	for (const shape of oldFrames) {
		const name = typeof shape.props.name === 'string' ? shape.props.name : ''
		if (name && groupNames.has(name) && !oldFrameByName.has(name)) oldFrameByName.set(name, shape)
	}

	// An arrow is the model's if it connects two components the model declares —
	// exactly what `extractBoardModel` reads back as an edge. Owning arrows by id
	// prefix alone is not enough: boards scaffolded before the prefix existed, and
	// arrows a human drew between two cards, are architecture claims the model is
	// the source of truth for. Leaving them alone duplicated every relation on the
	// first update. An arrow touching anything else (a note, one endpoint only)
	// states nothing about the model and is left alone.
	const modelNames = new Set(model.components.map((c) => c.name))
	const componentIds = new Set(
		[...oldNodeByName.entries()].filter(([name]) => modelNames.has(name)).map(([, s]) => s.id)
	)
	const arrowTerminals = new Map<string, Set<string>>()
	for (const record of existingRecords) {
		if (record.typeName !== 'binding') continue
		const binding = JSON.parse(record.json) as { type?: string; fromId?: string; toId?: string }
		if (binding.type !== 'arrow' || typeof binding.fromId !== 'string') continue
		const terminals = arrowTerminals.get(binding.fromId) ?? new Set<string>()
		if (typeof binding.toId === 'string') terminals.add(binding.toId)
		arrowTerminals.set(binding.fromId, terminals)
	}
	const ownedArrowIds = new Set(
		shapes
			.filter((s) => {
				if (s.type !== 'arrow') return false
				if (s.id.startsWith(SCAFFOLD_ID_PREFIX.edge)) return true
				const terminals = arrowTerminals.get(s.id)
				if (!terminals || terminals.size !== 2) return false
				return [...terminals].every((id) => componentIds.has(id))
			})
			.map((s) => s.id)
	)

	const ownedIds = new Set<string>([
		...[...oldNodeByName.values()].map((s) => s.id),
		...oldFrames.map((s) => s.id),
		...ownedArrowIds,
		...shapes.filter((s) => s.id.startsWith(SCAFFOLD_ID_PREFIX.title)).map((s) => s.id)
	])

	// --- plan positions ------------------------------------------------------
	// Dagre lays out the NEW model; matched shapes then override it with the
	// position the human gave them, so only genuinely new nodes move.
	const layout = layoutBoardGraph(
		model.components.map((c) => ({ name: c.name, w: NODE_W, h: NODE_H })),
		model.edges,
		modelGroups
	)

	const put: Array<Record<string, unknown>> = []
	const removed: string[] = []

	let topIndex = shapes.at(-1)?.index
	const nextIndex = (): IndexKey => {
		topIndex = topIndex ? getIndexAbove(topIndex) : ('a1' as IndexKey)
		return topIndex
	}

	// --- frames --------------------------------------------------------------
	// Kept frames stay where they are; new ones take their dagre slot. Frame
	// ids are stable per group name so re-running the update is a no-op.
	const frameIdByName = new Map<string, string>()
	const frameOriginByName = new Map<string, { x: number; y: number }>()
	const framePlacements: Array<{ group: string; record: Record<string, unknown> }> = []
	// A new group cannot take `shape:frame-<its model index>`: that id may belong
	// to a frame this update keeps under a different name, or to one it removes
	// whose foreign children still have to be re-parented off it. Mint past every
	// id the board already uses instead.
	const usedShapeIds = new Set(shapes.map((s) => s.id))
	let frameSeq = 0
	const mintFrameId = (): string => {
		let id = `${SCAFFOLD_ID_PREFIX.frame}${frameSeq++}`
		while (usedShapeIds.has(id)) id = `${SCAFFOLD_ID_PREFIX.frame}${frameSeq++}`
		usedShapeIds.add(id)
		return id
	}
	modelGroups.forEach((group) => {
		const rect = layout.frames.get(group.name)!
		const old = oldFrameByName.get(group.name)
		const frameId = old?.id ?? mintFrameId()
		const origin = old ? { x: old.x, y: old.y } : { x: rect.x, y: rect.y }
		frameIdByName.set(group.name, frameId)
		frameOriginByName.set(group.name, origin)
		framePlacements.push({
			group: group.name,
			record: makeFrameRecord({
				id: frameId,
				name: group.name,
				x: origin.x,
				y: origin.y,
				w: rect.w,
				h: rect.h,
				index: old?.index ?? nextIndex(),
				pageId
			})
		})
	})

	// --- components ----------------------------------------------------------
	// Position rules, in order:
	//   1. group unchanged  → keep the exact x/y (already frame-relative)
	//   2. group changed    → keep the absolute position, re-expressed relative
	//                         to the new parent, so the card lands where the
	//                         human last saw it but inside the group the model
	//                         now says it belongs to
	//   3. new component    → dagre
	const idByName = new Map<string, string>()
	const memberExtentByGroup = new Map<string, { w: number; h: number }>()
	for (const component of model.components) {
		const old = oldNodeByName.get(component.name)
		const groupName = groupOfMember.get(component.name)
		const parentId = groupName ? frameIdByName.get(groupName)! : pageId
		const layoutPos = layout.nodes.get(component.name)!

		let x = layoutPos.x
		let y = layoutPos.y
		if (old) {
			if (old.parentId === parentId) {
				x = old.x
				y = old.y
			} else {
				const absolute = absolutePosition(old, shapeById)
				const origin = groupName ? frameOriginByName.get(groupName)! : { x: 0, y: 0 }
				x = absolute.x - origin.x
				y = absolute.y - origin.y
				// A frame can only grow right and down, so a card that used to sit
				// above or left of its new frame would translate to a negative offset
				// and render outside the group the model just put it in. Clamp into
				// the frame: membership is the model's claim, and a card visibly
				// outside its own subsystem reads as a bug in the diagram.
				if (groupName) {
					x = Math.max(x, FRAME_PAD)
					y = Math.max(y, FRAME_PAD)
				}
			}
		}

		const id = old?.id ?? createShapeId()
		idByName.set(component.name, id)
		put.push({
			id,
			typeName: 'shape',
			type: 'service-node',
			x,
			y,
			rotation: 0,
			index: old?.index ?? nextIndex(),
			parentId,
			isLocked: false,
			opacity: 1,
			// A human may have tagged the card; scaffold has no meta of its own on
			// service-nodes, so preserving it costs nothing and losing it would.
			meta: (old?.record.meta as Record<string, unknown>) ?? {},
			props: {
				// Keep a resized card's dimensions: size is presentation, and the
				// model has no opinion about it.
				w: typeof old?.props.w === 'number' ? old.props.w : NODE_W,
				h: typeof old?.props.h === 'number' ? old.props.h : NODE_H,
				name: component.name,
				kind: component.kind,
				repoUrl: component.repoUrl ?? '',
				ownerTeam: component.ownerTeam ?? ''
			}
		})

		if (groupName) {
			const extent = memberExtentByGroup.get(groupName) ?? { w: 0, h: 0 }
			const w = typeof old?.props.w === 'number' ? old.props.w : NODE_W
			const h = typeof old?.props.h === 'number' ? old.props.h : NODE_H
			memberExtentByGroup.set(groupName, {
				w: Math.max(extent.w, x + w + FRAME_PAD),
				h: Math.max(extent.h, y + h + FRAME_PAD)
			})
		}
	}

	// Frames grow to contain the members kept at their old positions — a card
	// dragged to the frame's edge must not end up outside it after an update.
	for (const placement of framePlacements) {
		const extent = memberExtentByGroup.get(placement.group)
		const props = placement.record.props as { w: number; h: number }
		if (extent) {
			props.w = Math.max(props.w, extent.w)
			props.h = Math.max(props.h, extent.h)
		}
		put.push(placement.record)
	}

	// --- removals ------------------------------------------------------------
	// Scaffold-owned shapes the new model no longer accounts for. Foreign shapes
	// are never in ownedIds, so they are never removed.
	const keptIds = new Set(put.map((r) => r.id as string))
	for (const shape of shapes) {
		if (!ownedIds.has(shape.id) || keptIds.has(shape.id)) continue
		// Members of a dropped frame that are still in the model were re-parented
		// above (they are in keptIds); anything left is genuinely gone.
		removed.push(shape.id)
	}
	// Children of a removed frame that scaffold does NOT own (a note the human
	// left inside a subsystem) would be orphaned by the delete — re-parent them
	// to the page at their absolute position instead of dropping them.
	const removedIds = new Set(removed)
	for (const shape of shapes) {
		if (ownedIds.has(shape.id) || !removedIds.has(shape.parentId)) continue
		const absolute = absolutePosition(shape, shapeById)
		put.push({ ...shape.record, parentId: pageId, x: absolute.x, y: absolute.y })
	}

	// --- title ---------------------------------------------------------------
	const oldTitle = shapes.find((s) => s.id.startsWith(SCAFFOLD_ID_PREFIX.title))
	if (model.title) {
		const documentId = oldTitle
			? oldTitle.id.slice(SCAFFOLD_ID_PREFIX.title.length)
			: (model.documentId ?? 'board')
		const record = makeTitleRecord({
			documentId,
			title: model.title,
			index: oldTitle?.index ?? nextIndex(),
			pageId
		})
		// The title is text the human may have repositioned; only its content is
		// the model's business.
		if (oldTitle) {
			record.x = oldTitle.x
			record.y = oldTitle.y
		}
		put.push(record)
	} else if (oldTitle) {
		removed.push(oldTitle.id)
	}

	// --- arrows --------------------------------------------------------------
	// Fully derived from the model, so rebuild rather than merge: an arrow
	// carries no human decision worth preserving, and its ids are positional.
	// Owned edge shapes AND their bindings go; the bindings of an arrow that
	// touches something other than two declared components are untouched, because
	// that arrow is not the model's.
	for (const record of existingRecords) {
		if (record.typeName !== 'binding') continue
		const binding = JSON.parse(record.json) as { fromId?: string }
		if (typeof binding.fromId === 'string' && ownedArrowIds.has(binding.fromId)) {
			removed.push(record.id)
		}
	}
	model.edges.forEach((edge, i) => {
		const arrowId = `${SCAFFOLD_ID_PREFIX.edge}${i}`
		const old = shapeById.get(arrowId)
		put.push(
			...makeEdgeRecords({
				index: i,
				edge,
				fromShapeId: idByName.get(edge.from)!,
				toShapeId: idByName.get(edge.to)!,
				shapeIndex: old?.index ?? nextIndex(),
				pageId
			})
		)
	})

	// A rebuilt arrow is both removed (its old binding) and put (its new one);
	// keep only removals that no put revives, so applyRecordChanges sees a clean
	// change set instead of a delete racing an insert.
	const putIds = new Set(put.map((r) => r.id as string))
	return { put, removed: [...new Set(removed)].filter((id) => !putIds.has(id)) }
}
