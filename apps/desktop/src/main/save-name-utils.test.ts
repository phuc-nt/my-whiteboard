import type { SerializedRecord } from '@mywb/core/format'
import { describe, expect, it } from 'vitest'
import { deriveSuggestedName, resolveSaveDefaultPath, sanitizeFileName } from './save-name-utils'

describe('sanitizeFileName', () => {
	it('strips path-illegal chars and trims length', () => {
		expect(sanitizeFileName('My Whiteboard — arch (2026)!')).toBe('My Whiteboard — arch (2026)!')
		expect(sanitizeFileName('a/b\\c:d*e?f')).toBe('abcdef')
		expect(sanitizeFileName('   ')).toBe('Untitled')
		expect(sanitizeFileName('')).toBe('Untitled')
		expect(sanitizeFileName('x'.repeat(80)).length).toBeLessThanOrEqual(40)
	})
})

function textRecord(id: string, text: string): SerializedRecord {
	return {
		id,
		typeName: 'shape',
		json: JSON.stringify({
			id,
			typeName: 'shape',
			type: 'text',
			props: { richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }
		})
	}
}

describe('deriveSuggestedName', () => {
	it('uses the first text shape with content', () => {
		const records = [
			textRecord('shape:a', 'architecture'),
			textRecord('shape:b', 'other')
		]
		expect(deriveSuggestedName(records)).toBe('architecture')
	})

	it('falls back to Untitled with no text shapes', () => {
		const records: SerializedRecord[] = [
			{ id: 'shape:s', typeName: 'shape', json: JSON.stringify({ type: 'service-node', props: {} }) }
		]
		expect(deriveSuggestedName(records)).toBe('Untitled')
	})

	it('ignores empty text shapes', () => {
		expect(deriveSuggestedName([textRecord('shape:a', '   ')])).toBe('Untitled')
	})
})

describe('resolveSaveDefaultPath', () => {
	it('joins the last save dir with the suggested name', () => {
		expect(resolveSaveDefaultPath('/repo/docs', '/home/Documents', 'architecture')).toBe(
			'/repo/docs/architecture.mywb'
		)
	})

	it('falls back to the documents dir when no last save dir', () => {
		expect(resolveSaveDefaultPath(null, '/home/Documents', 'board')).toBe('/home/Documents/board.mywb')
	})

	it('does not double the .mywb extension', () => {
		expect(resolveSaveDefaultPath('/d', '/docs', 'x.mywb')).toBe('/d/x.mywb')
	})
})
