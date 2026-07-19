import { describe, expect, it } from 'vitest'
import { renderMywbHelperScript, renderSkillMarkdown } from './skill-templates'

describe('skill templates', () => {
	const sj = '/Users/x/Library/Application Support/My Whiteboard/server.json'
	const mywb = '/Users/x/skills/my-whiteboard/mywb'

	it('bakes the server.json path into the skill and quotes it for the shell', () => {
		const md = renderSkillMarkdown(sj, mywb)
		expect(md).toContain(`'${sj}'`)
		expect(md).toContain(`sh '${mywb}'`)
		// Teaches the tldraw binding, not `import`.
		expect(md).toContain('const { createShapeId, toRichText } = tldraw')
		expect(md).not.toContain("await import('tldraw')")
	})

	it('documents the custom dev shapes', () => {
		const md = renderSkillMarkdown(sj, mywb)
		for (const shape of ['service-node', 'code-ref', 'mermaid-block']) {
			expect(md).toContain(shape)
		}
	})

	it('helper script re-reads server.json and picks JSON vs text bodies', () => {
		const script = renderMywbHelperScript(sj)
		expect(script).toContain('#!/bin/sh')
		expect(script).toContain(`SERVER_JSON='${sj}'`)
		expect(script).toContain('jq -r .port')
		expect(script).toContain('jq -r .token')
		// JSON detection branch.
		expect(script).toContain('application/json')
		expect(script).toContain('text/plain')
	})

	it("escapes single quotes in paths so the shell can't break out", () => {
		const weird = "/Users/o'brien/skills/mywb"
		const script = renderMywbHelperScript(weird)
		expect(script).toContain(`'/Users/o'\\''brien/skills/mywb'`)
	})
})
