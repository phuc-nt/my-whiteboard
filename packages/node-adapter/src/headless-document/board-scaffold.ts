import { captureFullSnapshot } from '@mywb/core/sync'
import type { ServiceKind } from '@mywb/core/shapes'
import type { IndexKey } from 'tldraw'
import { getIndexAbove } from 'tldraw'
import { createHeadlessStore } from './create-headless-store'
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

export interface BoardModel {
	title?: string
	documentId?: string
	components: BoardModelComponent[]
	edges: BoardModelEdge[]
}

// Reading order of an architecture board: entry surfaces on top, gateways
// next, libraries below them, storage and background jobs at the bottom.
const ROW_BY_KIND: Record<ServiceKind, number> = {
	web: 0,
	app: 0,
	tool: 0,
	api: 1,
	lib: 2,
	db: 3,
	queue: 3,
	cron: 3
}
const COLUMN_STEP = 300
const ROW_STEP = 190
const ORIGIN = { x: 80, y: 100 }

export async function buildBoardFromModel(targetPath: string, model: BoardModel): Promise<void> {
	const names = new Set<string>()
	for (const c of model.components) {
		if (names.has(c.name)) throw new Error(`duplicate component name: "${c.name}"`)
		names.add(c.name)
		if (!(c.kind in ROW_BY_KIND)) {
			throw new Error(
				`component "${c.name}": unknown kind "${c.kind}" (expected one of ${Object.keys(ROW_BY_KIND).join(', ')})`
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

	const store = createHeadlessStore()

	// Service nodes, laid out row-by-kind, column per row.
	const idByName = new Map<string, string>()
	const columns = new Map<number, number>()
	for (const c of model.components) {
		const snapshot = captureFullSnapshot(store)
		const record = makeServiceNodeRecord(
			{ name: c.name, kind: c.kind, repoUrl: c.repoUrl, ownerTeam: c.ownerTeam },
			snapshot.records
		) as { id: string; x: number; y: number }
		const row = ROW_BY_KIND[c.kind]
		const column = columns.get(row) ?? 0
		columns.set(row, column + 1)
		record.x = ORIGIN.x + column * COLUMN_STEP
		record.y = ORIGIN.y + row * ROW_STEP
		store.put([record as never])
		idByName.set(c.name, record.id)
	}

	const snapshot = captureFullSnapshot(store)
	const pageId = snapshot.records.find((r) => r.typeName === 'page')?.id
	if (!pageId) throw new Error('document has no page record')
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
				x: ORIGIN.x,
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
