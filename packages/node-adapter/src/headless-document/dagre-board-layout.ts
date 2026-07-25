import dagre from '@dagrejs/dagre'

// Graph-driven board layout: positions follow the edge flow (who calls whom),
// not a fixed kind-grid, so arrows run mostly downward with minimal crossing.
// Two passes:
//   1. each group lays out its members from the group's internal edges,
//      producing frame-relative member positions and the frame's size;
//   2. the page-level graph lays out frames (as single boxes) and ungrouped
//      nodes, with cross-frame edges collapsed onto the frame.

export interface LayoutNodeInput {
	name: string
	w: number
	h: number
}

export interface LayoutEdgeInput {
	from: string
	to: string
}

export interface LayoutGroupInput {
	name: string
	members: string[]
}

export interface BoardLayout {
	/** Frame-relative for grouped nodes, page-space for ungrouped. Top-left corner. */
	nodes: Map<string, { x: number; y: number }>
	/** Page-space top-left + computed size per group frame. */
	frames: Map<string, { x: number; y: number; w: number; h: number }>
}

// Breathing room inside a frame and between page-level boxes. Ranksep leaves
// space for arrowheads and labels between layers.
const FRAME_PAD = 24
const NODE_SEP = 50
const RANK_SEP = 90
const PAGE_ORIGIN = { x: 80, y: 100 }

function runDagre(
	nodes: Array<{ id: string; w: number; h: number }>,
	edges: Array<{ from: string; to: string }>,
	margin: number
): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
	const g = new dagre.graphlib.Graph()
	g.setGraph({ rankdir: 'TB', nodesep: NODE_SEP, ranksep: RANK_SEP, marginx: margin, marginy: margin })
	g.setDefaultEdgeLabel(() => ({}))
	for (const n of nodes) g.setNode(n.id, { width: n.w, height: n.h })
	// setEdge overwrites duplicates, which also dedupes parallel edges.
	for (const e of edges) if (e.from !== e.to) g.setEdge(e.from, e.to)
	dagre.layout(g)
	const positions = new Map<string, { x: number; y: number }>()
	for (const n of nodes) {
		const placed = g.node(n.id)
		// Dagre reports centers; the store wants top-left corners.
		positions.set(n.id, { x: placed.x - n.w / 2, y: placed.y - n.h / 2 })
	}
	const size = g.graph()
	return { positions, width: size.width ?? 0, height: size.height ?? 0 }
}

export function layoutBoardGraph(
	nodes: LayoutNodeInput[],
	edges: LayoutEdgeInput[],
	groups: LayoutGroupInput[]
): BoardLayout {
	const sizeByName = new Map(nodes.map((n) => [n.name, n]))
	const groupOfMember = new Map<string, string>()
	for (const g of groups) for (const m of g.members) groupOfMember.set(m, g.name)

	const nodePositions = new Map<string, { x: number; y: number }>()
	const frameSizes = new Map<string, { w: number; h: number }>()

	// Pass 1: members inside each frame, driven by the group's internal edges.
	for (const group of groups) {
		const memberSet = new Set(group.members)
		const inner = runDagre(
			group.members.map((m) => {
				const s = sizeByName.get(m)!
				return { id: m, w: s.w, h: s.h }
			}),
			edges.filter((e) => memberSet.has(e.from) && memberSet.has(e.to)),
			FRAME_PAD
		)
		for (const m of group.members) nodePositions.set(m, inner.positions.get(m)!)
		frameSizes.set(group.name, { w: inner.width, h: inner.height })
	}

	// Pass 2: the page graph. Frames become single boxes; an edge touching a
	// member re-targets its frame. Prefixed ids keep a group that shares its
	// name with a component from colliding.
	const pageId = (name: string) => (groupOfMember.has(name) ? `frame:${groupOfMember.get(name)}` : `node:${name}`)
	const pageNodes = [
		...groups.map((g) => {
			const s = frameSizes.get(g.name)!
			return { id: `frame:${g.name}`, w: s.w, h: s.h }
		}),
		...nodes.filter((n) => !groupOfMember.has(n.name)).map((n) => ({ id: `node:${n.name}`, w: n.w, h: n.h }))
	]
	const pageEdges = edges
		.map((e) => ({ from: pageId(e.from), to: pageId(e.to) }))
		.filter((e) => e.from !== e.to)
	const page = runDagre(pageNodes, pageEdges, 0)

	const frames = new Map<string, { x: number; y: number; w: number; h: number }>()
	for (const g of groups) {
		const pos = page.positions.get(`frame:${g.name}`)!
		const s = frameSizes.get(g.name)!
		frames.set(g.name, { x: PAGE_ORIGIN.x + pos.x, y: PAGE_ORIGIN.y + pos.y, w: s.w, h: s.h })
	}
	for (const n of nodes) {
		if (groupOfMember.has(n.name)) continue
		const pos = page.positions.get(`node:${n.name}`)!
		nodePositions.set(n.name, { x: PAGE_ORIGIN.x + pos.x, y: PAGE_ORIGIN.y + pos.y })
	}

	return { nodes: nodePositions, frames }
}
