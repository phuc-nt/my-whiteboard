import type { SerializedRecord } from '@mywb/core/format'
import type { BoardModel, BoardModelComponent, BoardModelEdge, BoardModelGroup } from '@mywb/core/model'
import { SERVICE_KINDS } from '@mywb/core/model'
import { SCAFFOLD_ID_PREFIX } from './scaffold-record-builders'

// The reverse of scaffold: read a board's records back into a board model. This
// is what makes the model canonical — a repo can extract the model from the
// board it already approved, commit it, and from then on edit the model and
// re-render the board.
//
// Fidelity contract: extract promises a faithful model for boards that scaffold
// produced (round-trip is a test invariant). Free-hand boards are best-effort —
// draw strokes, notes, geo shapes and code-refs carry no model meaning and are
// ignored rather than guessed at.

/** Relation recorded when an arrow connects two components but declares none. */
export const DEFAULT_RELATION = 'relates-to'

interface ParsedShape {
	id: string
	type: string
	index: string
	parentId: string
	props: Record<string, unknown>
	meta: Record<string, unknown>
}

function parseShapes(records: SerializedRecord[]): ParsedShape[] {
	return records
		.filter((r) => r.typeName === 'shape')
		.map((r) => {
			const record = JSON.parse(r.json) as {
				id: string
				type: string
				index?: string
				parentId?: string
				props?: Record<string, unknown>
				meta?: Record<string, unknown>
			}
			return {
				id: record.id,
				type: record.type,
				index: record.index ?? '',
				parentId: record.parentId ?? '',
				props: record.props ?? {},
				meta: record.meta ?? {}
			}
		})
		// Canvas order (fractional index, id as tiebreak) so the emitted model is
		// deterministic for the same board — the model file is committed and diffed.
		.sort((a, b) => (a.index === b.index ? a.id.localeCompare(b.id) : a.index < b.index ? -1 : 1))
}

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Rich text doc → plain text, joining paragraphs with a space. */
function richTextToPlain(richText: unknown): string {
	const paragraphs = (richText as { content?: Array<{ content?: Array<{ text?: unknown }> }> })?.content
	if (!Array.isArray(paragraphs)) return ''
	return paragraphs
		.flatMap((p) => (Array.isArray(p.content) ? p.content : []))
		.map((node) => (typeof node.text === 'string' ? node.text : ''))
		.join('')
		.trim()
}

/**
 * Component name per shape id, for every service-node on the board. Nodes with
 * a blank name cannot be referenced by an edge or a group, so they are skipped
 * entirely (an unnamed card is a draft, not a declared component).
 */
function componentNamesById(shapes: ParsedShape[]): Map<string, string> {
	const byId = new Map<string, string>()
	const seen = new Set<string>()
	for (const shape of shapes) {
		if (shape.type !== 'service-node') continue
		const name = optionalString(shape.props.name)
		// Two cards with the same name would make edges ambiguous and would fail
		// parseBoardModel anyway; keep the first in canvas order.
		if (!name || seen.has(name)) continue
		seen.add(name)
		byId.set(shape.id, name)
	}
	return byId
}

function extractEdges(
	records: SerializedRecord[],
	shapes: ParsedShape[],
	nameById: Map<string, string>
): BoardModelEdge[] {
	const terminals = new Map<string, { start?: string; end?: string; relation: string }>()
	for (const arrow of shapes) {
		if (arrow.type !== 'arrow') continue
		terminals.set(arrow.id, {
			relation: optionalString(arrow.meta.relation) ?? richTextToPlain(arrow.props.richText) ?? ''
		})
	}
	for (const r of records) {
		if (r.typeName !== 'binding') continue
		const binding = JSON.parse(r.json) as {
			type: string
			fromId: string
			toId: string
			props?: { terminal?: string }
		}
		if (binding.type !== 'arrow') continue
		const entry = terminals.get(binding.fromId)
		if (!entry) continue
		if (binding.props?.terminal === 'start') entry.start = binding.toId
		if (binding.props?.terminal === 'end') entry.end = binding.toId
	}

	const edges: BoardModelEdge[] = []
	for (const arrow of shapes) {
		if (arrow.type !== 'arrow') continue
		const entry = terminals.get(arrow.id)
		// An arrow bound to fewer than two shapes, or to something that is not a
		// declared component, states no relation between components — skip it
		// instead of inventing an endpoint.
		if (!entry?.start || !entry.end) continue
		const from = nameById.get(entry.start)
		const to = nameById.get(entry.end)
		if (!from || !to) continue
		edges.push({ from, to, relation: entry.relation || DEFAULT_RELATION })
	}
	return edges
}

function extractGroups(shapes: ParsedShape[], nameById: Map<string, string>): BoardModelGroup[] {
	const groups: BoardModelGroup[] = []
	for (const frame of shapes) {
		if (frame.type !== 'frame') continue
		const name = optionalString(frame.props.name)
		if (!name) continue
		const members = shapes
			.filter((s) => s.parentId === frame.id && nameById.has(s.id))
			.map((s) => nameById.get(s.id)!)
		// An empty frame is a layout container, not a subsystem — the model
		// schema rejects empty groups, so leave it out.
		if (members.length === 0) continue
		groups.push({ name, members })
	}
	return groups
}

/**
 * Read a board model out of a document's records. Pure — takes records, returns
 * data, so it works on a file read headlessly or on a live snapshot.
 */
export function extractBoardModel(records: SerializedRecord[]): BoardModel {
	const shapes = parseShapes(records)
	const nameById = componentNamesById(shapes)

	const components: BoardModelComponent[] = []
	for (const shape of shapes) {
		const name = nameById.get(shape.id)
		if (!name) continue
		const kind = shape.props.kind
		if (!SERVICE_KINDS.includes(kind as never)) {
			// Unreachable through a valid .mywb — the store schema validates
			// service-node.props.kind against the same union on write. Surfacing it
			// beats silently relabelling the node if a file is ever hand-edited.
			throw new Error(`service-node "${name}": board declares unknown kind ${JSON.stringify(kind)}`)
		}
		components.push({
			name,
			kind: kind as BoardModelComponent['kind'],
			...(optionalString(shape.props.repoUrl) ? { repoUrl: shape.props.repoUrl as string } : {}),
			...(optionalString(shape.props.ownerTeam) ? { ownerTeam: shape.props.ownerTeam as string } : {})
		})
	}

	const model: BoardModel = {
		components,
		edges: extractEdges(records, shapes, nameById)
	}

	const titleShape = shapes.find((s) => s.id.startsWith(SCAFFOLD_ID_PREFIX.title))
	const title = titleShape ? richTextToPlain(titleShape.props.richText) : ''
	if (title) model.title = title

	const groups = extractGroups(shapes, nameById)
	if (groups.length > 0) model.groups = groups

	return model
}
