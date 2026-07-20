import type { Editor, TLShapeId } from 'tldraw'

// Editor-bound conveniences handed to exec/script code as `helpers`. Kept
// minimal — SDK primitives are imported from 'tldraw' directly, this bag only
// carries things that need the editor instance.

export interface GridLayoutOptions {
	/** Columns; defaults to ceil(sqrt(n)) for a roughly square grid. */
	cols?: number
	/** Gap between cells in px (default 40). */
	gap?: number
	/** Top-left origin of the grid (default the current shapes' top-left). */
	originX?: number
	originY?: number
}

export interface TreeLayoutOptions {
	/** Vertical gap between depth levels (default 80). */
	levelGap?: number
	/** Horizontal gap between siblings (default 40). */
	siblingGap?: number
	originX?: number
	originY?: number
}

export interface ScriptHelpers {
	richTextToPlainText(richText: unknown): string
	createShapeIfMissing(partial: { id: TLShapeId } & Record<string, unknown>): boolean
	translateShapes(ids: TLShapeId[], dx: number, dy: number): void
	/** Arrange shapes in a non-overlapping grid, using each shape's real size. */
	layoutGrid(ids: TLShapeId[], options?: GridLayoutOptions): void
	/** Arrange a dependency tree top-down: root above, children by depth. */
	layoutTree(rootId: TLShapeId, edges: [TLShapeId, TLShapeId][], options?: TreeLayoutOptions): void
}

export function richTextToPlainText(richText: unknown): string {
	// tldraw rich text is a ProseMirror-style doc; walk text nodes.
	const parts: string[] = []
	const walk = (node: unknown): void => {
		if (!node || typeof node !== 'object') return
		const n = node as { text?: string; content?: unknown[] }
		if (typeof n.text === 'string') parts.push(n.text)
		if (Array.isArray(n.content)) n.content.forEach(walk)
	}
	walk(richText)
	return parts.join('')
}

export function buildScriptHelpers(editor: Editor): ScriptHelpers {
	return {
		richTextToPlainText,
		createShapeIfMissing(partial) {
			if (editor.getShape(partial.id)) return false
			editor.createShape(partial as never)
			return true
		},
		translateShapes(ids, dx, dy) {
			// Script-owned moves shouldn't clutter the user's undo stack.
			editor.run(
				() => {
					for (const id of ids) {
						const shape = editor.getShape(id)
						if (shape) editor.updateShape({ id, type: shape.type, x: shape.x + dx, y: shape.y + dy })
					}
				},
				{ history: 'ignore' }
			)
		},

		layoutGrid(ids, options = {}) {
			const present = ids.filter((id) => editor.getShape(id))
			if (present.length === 0) return
			const gap = options.gap ?? 40
			const cols = Math.max(1, options.cols ?? Math.ceil(Math.sqrt(present.length)))
			const sizes = present.map((id) => editor.getShapePageBounds(id))
			const cellW = Math.max(...sizes.map((b) => b?.width ?? 0)) + gap
			const cellH = Math.max(...sizes.map((b) => b?.height ?? 0)) + gap
			const originX = options.originX ?? Math.min(...present.map((id) => editor.getShape(id)!.x))
			const originY = options.originY ?? Math.min(...present.map((id) => editor.getShape(id)!.y))
			editor.run(
				() => {
					present.forEach((id, i) => {
						const shape = editor.getShape(id)!
						const col = i % cols
						const row = Math.floor(i / cols)
						editor.updateShape({
							id,
							type: shape.type,
							x: originX + col * cellW,
							y: originY + row * cellH
						})
					})
				},
				{ history: 'ignore' }
			)
		},

		layoutTree(rootId, edges, options = {}) {
			if (!editor.getShape(rootId)) return
			const levelGap = options.levelGap ?? 80
			const siblingGap = options.siblingGap ?? 40
			// BFS from the root assigning a depth to each reachable node; a visited
			// set makes cycles terminate.
			const children = new Map<TLShapeId, TLShapeId[]>()
			for (const [from, to] of edges) {
				if (!children.has(from)) children.set(from, [])
				children.get(from)!.push(to)
			}
			const depth = new Map<TLShapeId, number>([[rootId, 0]])
			const queue: TLShapeId[] = [rootId]
			while (queue.length > 0) {
				const node = queue.shift()!
				for (const child of children.get(node) ?? []) {
					if (depth.has(child)) continue
					depth.set(child, depth.get(node)! + 1)
					queue.push(child)
				}
			}
			// Group by depth, then place each level in a centered-ish row.
			const byLevel = new Map<number, TLShapeId[]>()
			for (const [id, d] of depth) {
				if (!editor.getShape(id)) continue
				if (!byLevel.has(d)) byLevel.set(d, [])
				byLevel.get(d)!.push(id)
			}
			const originX = options.originX ?? editor.getShape(rootId)!.x
			const originY = options.originY ?? editor.getShape(rootId)!.y
			editor.run(
				() => {
					for (const [level, idsAtLevel] of byLevel) {
						const rowH = Math.max(...idsAtLevel.map((id) => editor.getShapePageBounds(id)?.height ?? 0))
						let x = originX
						for (const id of idsAtLevel) {
							const shape = editor.getShape(id)!
							const w = editor.getShapePageBounds(id)?.width ?? 0
							editor.updateShape({ id, type: shape.type, x, y: originY + level * (rowH + levelGap) })
							x += w + siblingGap
						}
					}
				},
				{ history: 'ignore' }
			)
		}
	}
}
