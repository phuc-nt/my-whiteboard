import { describe, expect, it } from 'vitest'
import { getAgentApiLlmsTxt } from './agent-api-llms-txt'

// Locks the llmstxt.org shape and the surfaces an arriving agent must find.

describe('getAgentApiLlmsTxt', () => {
	const text = getAgentApiLlmsTxt('/tmp/server.json')

	it('follows the llms.txt convention: H1 then a one-line summary blockquote', () => {
		const lines = text.split('\n').filter((l) => l.trim() !== '')
		expect(lines[0]).toMatch(/^# /)
		expect(lines[1]).toMatch(/^> /)
	})

	it('names every agent surface: readme, search, exec, mcp, cli, format', () => {
		for (const needle of [
			'/readme',
			'/api/search',
			'/api/doc/:id/exec',
			'mywb mcp',
			'file read|apply|scaffold',
			'.mywb'
		]) {
			expect(text).toContain(needle)
		}
	})

	it('tells the agent where the bearer token lives', () => {
		expect(text).toContain('/tmp/server.json')
		expect(text).toMatch(/bearer/i)
	})
})
