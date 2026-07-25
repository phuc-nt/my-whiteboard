import type { BoardModel } from '@mywb/core/model'
import { groupMembershipOf, parseBoardModel } from '@mywb/core/model'
import { captureFullSnapshot } from '@mywb/core/sync'
import type { IndexKey } from 'tldraw'
import { getIndexAbove } from 'tldraw'
import { createHeadlessStore } from './create-headless-store'
import { layoutBoardGraph } from './dagre-board-layout'
import { makeServiceNodeRecord } from './fixture-builder'
import { makeEdgeRecords, makeFrameRecord, makeTitleRecord, NODE_H, NODE_W } from './scaffold-record-builders'
import { writeMywbArchiveFromRecords } from './write-mywb-archive'

// Builds a complete architecture board from a declarative model: positioned
// service nodes, a title, and relation arrows bound to both endpoints. Every
// record goes through the app's real store schema — whatever this accepts,
// the desktop canvas accepts. Grown out of the hand-written generator used to
// bootstrap the first two drift-check boards.
//
// The model's shape and invariants live in @mywb/core/model so the reverse
// direction (extract) validates against exactly the same contract.

export type {
	BoardModel,
	BoardModelComponent,
	BoardModelEdge,
	BoardModelGroup
} from '@mywb/core/model'

export async function buildBoardFromModel(targetPath: string, rawModel: BoardModel): Promise<void> {
	const model = parseBoardModel(rawModel)
	const groupOfMember = groupMembershipOf(model)

	const store = createHeadlessStore()
	const initialSnapshot = captureFullSnapshot(store)
	const pageId = initialSnapshot.records.find((r) => r.typeName === 'page')?.id
	if (!pageId) throw new Error('document has no page record')

	// Positions come from a real graph-layout engine: member nodes lay out
	// inside their frame from the group's internal edges (frame-relative
	// coords — tldraw composes the frame transform onto children), and the
	// page level lays out frames + ungrouped nodes from the collapsed edges.
	const layout = layoutBoardGraph(
		model.components.map((c) => ({ name: c.name, w: NODE_W, h: NODE_H })),
		model.edges,
		model.groups ?? []
	)

	const frameIdByName = new Map<string, string>()
	;(model.groups ?? []).forEach((g, gi) => {
		const rect = layout.frames.get(g.name)!
		const frameId = `shape:frame-${gi}`
		frameIdByName.set(g.name, frameId)
		store.put([
			makeFrameRecord({
				id: frameId,
				name: g.name,
				x: rect.x,
				y: rect.y,
				w: rect.w,
				h: rect.h,
				index: `a${gi + 1}` as IndexKey,
				pageId
			}) as never
		])
	})

	const idByName = new Map<string, string>()
	for (const c of model.components) {
		const snapshot = captureFullSnapshot(store)
		const record = makeServiceNodeRecord(
			{ name: c.name, kind: c.kind, repoUrl: c.repoUrl, ownerTeam: c.ownerTeam },
			snapshot.records
		) as { id: string; x: number; y: number; parentId: string }
		const groupName = groupOfMember.get(c.name)
		if (groupName) record.parentId = frameIdByName.get(groupName)!
		const pos = layout.nodes.get(c.name)!
		record.x = pos.x
		record.y = pos.y
		store.put([record as never])
		idByName.set(c.name, record.id)
	}

	const snapshot = captureFullSnapshot(store)
	let topIndex = snapshot.records
		.filter((r) => r.typeName === 'shape')
		.map((r) => (JSON.parse(r.json) as { index: IndexKey }).index)
		.sort()
		.at(-1)
	const nextIndex = (): IndexKey => {
		topIndex = topIndex ? getIndexAbove(topIndex) : ('a1' as IndexKey)
		return topIndex
	}

	if (model.title) {
		store.put([
			makeTitleRecord({
				documentId: model.documentId ?? 'board',
				title: model.title,
				index: nextIndex(),
				pageId
			}) as never
		])
	}

	model.edges.forEach((edge, i) => {
		store.put(
			makeEdgeRecords({
				index: i,
				edge,
				fromShapeId: idByName.get(edge.from)!,
				toShapeId: idByName.get(edge.to)!,
				shapeIndex: nextIndex(),
				pageId
			}) as never[]
		)
	})

	const { records, schemaJson } = captureFullSnapshot(store)
	await writeMywbArchiveFromRecords(records, schemaJson, targetPath, {
		documentId: model.documentId ?? 'scaffold-board',
		appVersion: '0.0.0-scaffold'
	})
}
