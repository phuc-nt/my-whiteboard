import { captureFullSnapshot } from '@mywb/core/sync'
import type { ServiceKind } from '@mywb/core/shapes'
import type { IndexKey } from 'tldraw'
import { getIndexAbove } from 'tldraw'
import { createHeadlessStore } from './create-headless-store'
import { layoutBoardGraph } from './dagre-board-layout'
import { makeServiceNodeRecord } from './fixture-builder'
import { writeMywbArchiveFromRecords } from './write-mywb-archive'

// Builds a complete architecture board from a declarative model: positioned
// service nodes, a title, and relation arrows bound to both endpoints. Every
// record goes through the app's real store schema — whatever this accepts,
// the desktop canvas accepts. Grown out of the hand-written generator used to
// bootstrap the first two drift-check boards.

export interface BoardModelComponent {
	name: string
	kind: ServiceKind
	repoUrl?: string
	ownerTeam?: string
}

export interface BoardModelEdge {
	from: string
	to: string
	/** Stored on the arrow as meta.relation (calls | depends-on | reads | ...). */
	relation: string
}

export interface BoardModelGroup {
	name: string
	/** Component names that live inside this subsystem frame. */
	members: string[]
}

export interface BoardModel {
	title?: string
	documentId?: string
	components: BoardModelComponent[]
	edges: BoardModelEdge[]
	/** Optional subsystem frames grouping components; each component in at most one. */
	groups?: BoardModelGroup[]
}

const SERVICE_KINDS: readonly ServiceKind[] = ['web', 'app', 'tool', 'api', 'lib', 'db', 'queue', 'cron']
// Default card footprint the layout engine plans around; matches the
// service-node shape's default props.
const NODE_W = 220
const NODE_H = 96
const TITLE_X = 80

export async function buildBoardFromModel(targetPath: string, model: BoardModel): Promise<void> {
	const names = new Set<string>()
	for (const c of model.components) {
		if (names.has(c.name)) throw new Error(`duplicate component name: "${c.name}"`)
		names.add(c.name)
		if (!SERVICE_KINDS.includes(c.kind)) {
			throw new Error(
				`component "${c.name}": unknown kind "${c.kind}" (expected one of ${SERVICE_KINDS.join(', ')})`
			)
		}
	}
	for (const e of model.edges) {
		for (const endpoint of [e.from, e.to]) {
			if (!names.has(endpoint)) {
				throw new Error(`edge ${e.from} -> ${e.to}: no component named "${endpoint}"`)
			}
		}
	}

	// Which frame each component belongs to (validated), so nodes get parented
	// into their subsystem instead of the page.
	const groupOfMember = new Map<string, string>()
	const groupNames = new Set<string>()
	for (const g of model.groups ?? []) {
		// Frames are keyed by name downstream (layout, frameIdByName); a repeat
		// would silently orphan one frame and mis-parent its members.
		if (groupNames.has(g.name)) throw new Error(`duplicate group name: "${g.name}"`)
		groupNames.add(g.name)
		if (g.members.length === 0) throw new Error(`group "${g.name}" is empty`)
		for (const member of g.members) {
			if (!names.has(member)) {
				throw new Error(`group "${g.name}": no component named "${member}"`)
			}
			if (groupOfMember.has(member)) {
				throw new Error(`component "${member}" belongs to more than one group`)
			}
			groupOfMember.set(member, g.name)
		}
	}

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
			{
				id: frameId,
				typeName: 'shape',
				type: 'frame',
				x: rect.x,
				y: rect.y,
				rotation: 0,
				index: `a${gi + 1}` as IndexKey,
				parentId: pageId,
				isLocked: false,
				opacity: 1,
				meta: {},
				props: { w: rect.w, h: rect.h, name: g.name, color: 'black' }
			} as never
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
	const emptyRichText = { type: 'doc', content: [{ type: 'paragraph' }] }

	if (model.title) {
		store.put([
			{
				id: `shape:title-${model.documentId ?? 'board'}`,
				typeName: 'shape',
				type: 'text',
				x: TITLE_X,
				y: 20,
				rotation: 0,
				index: nextIndex(),
				parentId: pageId,
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
					richText: {
						type: 'doc',
						content: [{ type: 'paragraph', content: [{ type: 'text', text: model.title }] }]
					}
				}
			} as never
		])
	}

	model.edges.forEach((edge, i) => {
		const arrowId = `shape:edge-${i}`
		store.put([
			{
				id: arrowId,
				typeName: 'shape',
				type: 'arrow',
				x: 0,
				y: 0,
				rotation: 0,
				index: nextIndex(),
				parentId: pageId,
				isLocked: false,
				opacity: 1,
				meta: { relation: edge.relation },
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
					richText: emptyRichText,
					labelPosition: 0.5,
					font: 'draw',
					scale: 1
				}
			} as never
		])
		for (const [terminal, componentName] of [
			['start', edge.from],
			['end', edge.to]
		] as const) {
			store.put([
				{
					id: `binding:edge-${i}-${terminal}`,
					typeName: 'binding',
					type: 'arrow',
					fromId: arrowId,
					toId: idByName.get(componentName)!,
					meta: {},
					props: {
						isPrecise: false,
						isExact: false,
						normalizedAnchor: { x: 0.5, y: 0.5 },
						snap: 'none',
						terminal
					}
				} as never
			])
		}
	})

	const { records, schemaJson } = captureFullSnapshot(store)
	await writeMywbArchiveFromRecords(records, schemaJson, targetPath, {
		documentId: model.documentId ?? 'scaffold-board',
		appVersion: '0.0.0-scaffold'
	})
}
