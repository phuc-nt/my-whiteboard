import type { SerializedRecord } from '@mywb/core/format'
import { join } from 'path'

// Pure helpers for the Save dialog defaults (dogfood P6): suggest a file name
// from the board's content and resolve the default directory. No Electron here
// so they are unit-testable.

const MAX_NAME_LEN = 40

/** Make a string safe as a file name; empty/blank → "Untitled". */
export function sanitizeFileName(raw: string): string {
	// Drop path separators and characters illegal on common filesystems.
	const cleaned = raw.replace(/[/\\:*?"<>|]/g, '').trim()
	if (!cleaned) return 'Untitled'
	return cleaned.length > MAX_NAME_LEN ? cleaned.slice(0, MAX_NAME_LEN).trim() : cleaned
}

/** Flatten tldraw rich text (a ProseMirror-style doc) to plain text. */
function richTextToPlainText(richText: unknown): string {
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

/**
 * Suggest a file name from the first text shape that has content; falls back to
 * "Untitled". Reads serialized records (no editor needed).
 */
export function deriveSuggestedName(records: SerializedRecord[]): string {
	for (const record of records) {
		if (record.typeName !== 'shape') continue
		const parsed = JSON.parse(record.json) as { type?: string; props?: { richText?: unknown } }
		if (parsed.type !== 'text') continue
		const text = richTextToPlainText(parsed.props?.richText).trim()
		if (text) return sanitizeFileName(text)
	}
	return 'Untitled'
}

/** Default path for the Save dialog: <lastSaveDir | documentsDir>/<name>.mywb. */
export function resolveSaveDefaultPath(
	lastSaveDir: string | null,
	documentsDir: string,
	suggestedName: string
): string {
	const dir = lastSaveDir ?? documentsDir
	const fileName = suggestedName.endsWith('.mywb') ? suggestedName : `${suggestedName}.mywb`
	return join(dir, fileName)
}
