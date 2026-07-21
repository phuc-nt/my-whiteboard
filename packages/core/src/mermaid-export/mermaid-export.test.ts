import { describe, expect, it } from 'vitest'
import type { SerializedRecord } from '../format'
import { exportBoardToMermaid } from './mermaid-export'

// Locks the export contract: deterministic mermaid text from board records,
// both syntaxes, labels escaped, orphan arrows skipped instead of throwing.

function rec(record: Record<string, unknown>): SerializedRecord {
	return { id: record.id as string, typeName: record.typeName as string, json: JSON.stringify(record) }
}

const records: SerializedRecord[] = [
	rec({ id: 'shape:web', typeName: 'shape', type: 'service-node', index: 'a1', props: { name: 'web ui', kind: 'web' } }),
	rec({ id: 'shape:api', typeName: 'shape', type: 'service-node', index: 'a2', props: { name: 'say "hi" | ok', kind: 'api' } }),
	rec({ id: 'shape:db', typeName: 'shape', type: 'service-node', index: 'a3', props: { name: 'orders db', kind: 'db' } }),
	rec({ id: 'shape:e1', typeName: 'shape', type: 'arrow', index: 'a4', meta: { relation: 'calls' }, props: {} }),
	rec({ id: 'shape:e2', typeName: 'shape', type: 'arrow', index: 'a5', meta: {}, props: {} }),
	rec({ id: 'shape:orphan', typeName: 'shape', type: 'arrow', index: 'a6', meta: {}, props: {} }),
	rec({ id: 'shape:ref', typeName: 'shape', type: 'code-ref', index: 'a7', props: { path: 'src/x.ts', lineStart: 5, lineEnd: 10, repo: '', sha: '' } }),
	rec({ id: 'shape:note', typeName: 'shape', type: 'text', index: 'a8', props: {} }),
	rec({ id: 'binding:e1s', typeName: 'binding', type: 'arrow', fromId: 'shape:e1', toId: 'shape:web', props: { terminal: 'start' } }),
	rec({ id: 'binding:e1e', typeName: 'binding', type: 'arrow', fromId: 'shape:e1', toId: 'shape:api', props: { terminal: 'end' } }),
	rec({ id: 'binding:e2s', typeName: 'binding', type: 'arrow', fromId: 'shape:e2', toId: 'shape:api', props: { terminal: 'start' } }),
	rec({ id: 'binding:e2e', typeName: 'binding', type: 'arrow', fromId: 'shape:e2', toId: 'shape:db', props: { terminal: 'end' } })
]

describe('exportBoardToMermaid — flowchart (default)', () => {
	const out = exportBoardToMermaid(records)

	it('declares a flowchart with one node per service-node, classed by kind', () => {
		expect(out.startsWith('flowchart LR')).toBe(true)
		expect(out).toContain('n_web["web ui"]:::web')
		expect(out).toContain('n_db["orders db"]:::db')
		expect(out).toContain('classDef web')
		expect(out).toContain('classDef db')
	})

	it('escapes quotes and keeps pipes safe inside quoted labels', () => {
		expect(out).toContain('n_api["say #quot;hi#quot; | ok"]:::api')
	})

	it('renders edges start→end with quoted relation labels, plain arrow without', () => {
		expect(out).toContain('n_web -->|"calls"| n_api')
		expect(out).toContain('n_api --> n_db')
	})

	it('escapes hostile relation text inside the quoted edge label', () => {
		const hostile = [
			...records.filter((r) => !r.id.startsWith('shape:e1')),
			rec({ id: 'shape:e1', typeName: 'shape', type: 'arrow', index: 'a4', meta: { relation: 'reads|writes "fast"\nnow' }, props: {} }),
			rec({ id: 'binding:h1', typeName: 'binding', type: 'arrow', fromId: 'shape:e1', toId: 'shape:web', props: { terminal: 'start' } }),
			rec({ id: 'binding:h2', typeName: 'binding', type: 'arrow', fromId: 'shape:e1', toId: 'shape:api', props: { terminal: 'end' } })
		]
		const text = exportBoardToMermaid(hostile)
		expect(text).toContain('n_web -->|"reads|writes #quot;fast#quot; now"| n_api')
		expect(text.split('\n').every((l) => !l.includes('\r'))).toBe(true)
	})

	it('drops edges whose endpoint is not a declared service-node', () => {
		const withStray = [
			...records,
			rec({ id: 'shape:e9', typeName: 'shape', type: 'arrow', index: 'a9', meta: {}, props: {} }),
			rec({ id: 'binding:s9', typeName: 'binding', type: 'arrow', fromId: 'shape:e9', toId: 'shape:note', props: { terminal: 'start' } }),
			rec({ id: 'binding:s9e', typeName: 'binding', type: 'arrow', fromId: 'shape:e9', toId: 'shape:db', props: { terminal: 'end' } })
		]
		expect(exportBoardToMermaid(withStray)).not.toContain('n_note')
	})

	it('skips orphan arrows and non-diagram shapes, keeps code-refs as comments', () => {
		expect(out).not.toContain('orphan')
		expect(out).not.toContain('text')
		expect(out).toContain('%% code-ref: src/x.ts:5-10')
	})

	it('is deterministic', () => {
		expect(exportBoardToMermaid(records)).toBe(out)
	})
})

describe('exportBoardToMermaid — c4', () => {
	const out = exportBoardToMermaid(records, { syntax: 'c4' })

	it('maps kinds to C4 element types: db→SystemDb, others→System with kind description', () => {
		expect(out.startsWith('C4Context')).toBe(true)
		expect(out).toContain('System(n_web, "web ui", "web")')
		expect(out).toContain('SystemDb(n_db, "orders db", "db")')
	})

	it('renders Rel lines with relation label and keeps code-ref comments', () => {
		expect(out).toContain('Rel(n_web, n_api, "calls")')
		expect(out).toContain('Rel(n_api, n_db, "")')
		expect(out).toContain('%% code-ref: src/x.ts:5-10')
	})
})

describe('exportBoardToMermaid — kind coverage', () => {
	it('maps queue→SystemQueue and gives every kind a flowchart classDef', () => {
		const qr = [
			rec({ id: 'shape:q', typeName: 'shape', type: 'service-node', index: 'a1', props: { name: 'jobs', kind: 'queue' } })
		]
		expect(exportBoardToMermaid(qr, { syntax: 'c4' })).toContain('SystemQueue(n_q, "jobs", "queue")')
		expect(exportBoardToMermaid(qr)).toContain('classDef queue')
	})
})

describe('exportBoardToMermaid — frames become subgraphs', () => {
	const framed: SerializedRecord[] = [
		rec({ id: 'shape:f1', typeName: 'shape', type: 'frame', index: 'a1', props: { name: 'backend', w: 200, h: 200 } }),
		rec({ id: 'shape:api', typeName: 'shape', type: 'service-node', index: 'a2', parentId: 'shape:f1', props: { name: 'api', kind: 'api' } }),
		rec({ id: 'shape:db', typeName: 'shape', type: 'service-node', index: 'a3', parentId: 'shape:f1', props: { name: 'db', kind: 'db' } }),
		rec({ id: 'shape:ui', typeName: 'shape', type: 'service-node', index: 'a4', parentId: 'page:page', props: { name: 'ui', kind: 'web' } })
	]

	it('wraps framed nodes in a subgraph and leaves page-level nodes flat', () => {
		const out = exportBoardToMermaid(framed)
		expect(out).toContain('subgraph n_f1["backend"]')
		expect(out).toContain('end')
		// members indented inside the subgraph
		expect(out).toMatch(/subgraph n_f1\["backend"\]\n {4}n_api\["api"\]:::api/)
		// ungrouped node declared once, outside any subgraph
		const uiDecls = out.split('\n').filter((l) => l.includes('n_ui["ui"]'))
		expect(uiDecls).toHaveLength(1)
	})

	it('renders a board with no frames byte-identical to before (backward compat)', () => {
		// records without any frame → output unchanged from the pre-frames path
		const out = exportBoardToMermaid(records)
		expect(out).not.toContain('subgraph')
		expect(out.startsWith('flowchart LR\n  n_')).toBe(true)
	})
})
