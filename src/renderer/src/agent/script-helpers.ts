import type { Editor, TLShapeId } from 'tldraw'

// Editor-bound conveniences handed to exec/script code as `helpers`. Kept
// minimal — SDK primitives are imported from 'tldraw' directly, this bag only
// carries things that need the editor instance.

export interface ScriptHelpers {
	richTextToPlainText(richText: unknown): string
	createShapeIfMissing(partial: { id: TLShapeId } & Record<string, unknown>): boolean
	translateShapes(ids: TLShapeId[], dx: number, dy: number): void
}

function richTextToPlainText(richText: unknown): string {
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
		}
	}
}
