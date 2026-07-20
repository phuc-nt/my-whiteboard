import type { SerializedRecord } from '../format'

// Deterministic board → Mermaid text. Pure data transform so every surface
// (CLI today, app/web later) renders the same diagram for the same records.
// Flowchart is the default because GitHub renders it natively in READMEs;
// C4Context is an approximation: only db/queue have dedicated element types,
// every other kind becomes System with the kind in the description.

export type MermaidSyntax = 'flowchart' | 'c4'

export interface MermaidExportOptions {
	syntax?: MermaidSyntax
}

interface ParsedShape {
	id: string
	type: string
	index: string
	props: Record<string, unknown>
	meta: Record<string, unknown>
}

interface Edge {
	from: string
	to: string
	relation: string
}

const KINDS = ['api', 'db', 'queue', 'cron', 'web', 'lib', 'app', 'tool'] as const

// Muted, readable on light and dark GitHub themes.
const KIND_STYLE: Record<string, string> = {
	api: 'fill:#dbeafe,stroke:#1d4ed8',
	db: 'fill:#dcfce7,stroke:#15803d',
	queue: 'fill:#fef9c3,stroke:#a16207',
	cron: 'fill:#fae8ff,stroke:#a21caf',
	web: 'fill:#ffe4e6,stroke:#be123c',
	lib: 'fill:#e2e8f0,stroke:#334155',
	app: 'fill:#ffedd5,stroke:#c2410c',
	tool: 'fill:#ccfbf1,stroke:#0f766e'
}

function parseShapes(records: SerializedRecord[]): ParsedShape[] {
	return records
		.filter((r) => r.typeName === 'shape')
		.map((r) => {
			const record = JSON.parse(r.json) as {
				id: string
				type: string
				index?: string
				props?: Record<string, unknown>
				meta?: Record<string, unknown>
			}
			return {
				id: record.id,
				type: record.type,
				index: record.index ?? '',
				props: record.props ?? {},
				meta: record.meta ?? {}
			}
		})
		.sort((a, b) => (a.index === b.index ? a.id.localeCompare(b.id) : a.index < b.index ? -1 : 1))
}

/** Stable mermaid-safe node id derived from the shape id. */
function nodeId(shapeId: string): string {
	return `n_${shapeId.replace(/^shape:/, '').replace(/[^A-Za-z0-9_]/g, '_')}`
}

/** Quoted-label escape: mermaid has no quote escape, #quot; is the entity. */
function escapeLabel(text: string): string {
	return text.replace(/"/g, '#quot;').replace(/\s*\n\s*/g, ' ')
}

function collectEdges(records: SerializedRecord[]): Edge[] {
	const terminals = new Map<string, { start?: string; end?: string; relation: string }>()
	const arrows = parseShapes(records).filter((s) => s.type === 'arrow')
	for (const arrow of arrows) {
		terminals.set(arrow.id, { relation: typeof arrow.meta.relation === 'string' ? arrow.meta.relation : '' })
	}
	for (const r of records) {
		if (r.typeName !== 'binding') continue
		const binding = JSON.parse(r.json) as {
			type: string
			fromId: string
			toId: string
			props?: { terminal?: string }
		}
		const entry = terminals.get(binding.fromId)
		if (!entry || binding.type !== 'arrow') continue
		if (binding.props?.terminal === 'start') entry.start = binding.toId
		if (binding.props?.terminal === 'end') entry.end = binding.toId
	}
	const edges: Edge[] = []
	for (const arrow of arrows) {
		const entry = terminals.get(arrow.id)
		// An arrow drawn by hand but bound to fewer than two shapes makes no
		// claim — skip it rather than fail the whole export.
		if (!entry?.start || !entry.end) continue
		edges.push({ from: nodeId(entry.start), to: nodeId(entry.end), relation: entry.relation })
	}
	return edges
}

export function exportBoardToMermaid(
	records: SerializedRecord[],
	options: MermaidExportOptions = {}
): string {
	const syntax = options.syntax ?? 'flowchart'
	const shapes = parseShapes(records)
	const nodes = shapes.filter((s) => s.type === 'service-node')
	const codeRefs = shapes.filter((s) => s.type === 'code-ref')
	// Only edges between declared service-nodes: an arrow bound to a text or
	// other shape would reference a node the diagram never declares.
	const declared = new Set(nodes.map((n) => nodeId(n.id)))
	const edges = collectEdges(records).filter((e) => declared.has(e.from) && declared.has(e.to))

	const lines: string[] = []
	if (syntax === 'flowchart') {
		lines.push('flowchart LR')
		for (const node of nodes) {
			const kind = String(node.props.kind ?? 'lib')
			lines.push(`  ${nodeId(node.id)}["${escapeLabel(String(node.props.name ?? ''))}"]:::${kind}`)
		}
		for (const edge of edges) {
			// Quoted edge label: keeps agent-supplied relation text (pipes,
			// quotes, newlines) from breaking the flowchart syntax.
			lines.push(
				edge.relation
					? `  ${edge.from} -->|"${escapeLabel(edge.relation)}"| ${edge.to}`
					: `  ${edge.from} --> ${edge.to}`
			)
		}
		for (const ref of codeRefs) {
			lines.push(`  %% code-ref: ${ref.props.path}:${ref.props.lineStart}-${ref.props.lineEnd}`)
		}
		const usedKinds = KINDS.filter((k) => nodes.some((n) => n.props.kind === k))
		for (const kind of usedKinds) {
			lines.push(`  classDef ${kind} ${KIND_STYLE[kind]}`)
		}
	} else {
		lines.push('C4Context')
		for (const node of nodes) {
			const kind = String(node.props.kind ?? 'lib')
			const element = kind === 'db' ? 'SystemDb' : kind === 'queue' ? 'SystemQueue' : 'System'
			lines.push(`  ${element}(${nodeId(node.id)}, "${escapeLabel(String(node.props.name ?? ''))}", "${kind}")`)
		}
		for (const edge of edges) {
			lines.push(`  Rel(${edge.from}, ${edge.to}, "${escapeLabel(edge.relation)}")`)
		}
		for (const ref of codeRefs) {
			lines.push(`  %% code-ref: ${ref.props.path}:${ref.props.lineStart}-${ref.props.lineEnd}`)
		}
	}
	return lines.join('\n') + '\n'
}
