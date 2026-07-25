import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { BoardModel } from './board-scaffold'
import { buildBoardFromModel } from './board-scaffold'
import { readMywbDocument } from './headless-document'

// Locks the scaffold contract: a model of components + relation edges becomes
// a complete, schema-valid board — positioned nodes, title, arrows each bound
// to both endpoints, relation carried in arrow meta and shown as the label.

const dirs: string[] = []
async function tempFile(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'mywb-scaffold-'))
	dirs.push(dir)
	return join(dir, 'board.mywb')
}
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

const model: BoardModel = {
	title: 'demo — architecture',
	documentId: 'scaffold-demo',
	components: [
		{ name: 'spa', kind: 'web' },
		{ name: 'server', kind: 'api', repoUrl: 'src/server' },
		{ name: 'runtime', kind: 'app' },
		{ name: 'graphs', kind: 'lib' },
		{ name: 'backends', kind: 'lib' },
		{ name: 'gateway', kind: 'lib' },
		{ name: 'tools', kind: 'lib' },
		{ name: 'packs', kind: 'lib' },
		{ name: 'state', kind: 'db' },
		{ name: 'cli', kind: 'tool' }
	],
	edges: [
		{ from: 'spa', to: 'server', relation: 'calls' },
		{ from: 'cli', to: 'server', relation: 'calls' },
		{ from: 'cli', to: 'runtime', relation: 'calls' },
		{ from: 'server', to: 'state', relation: 'reads' },
		{ from: 'server', to: 'spa', relation: 'embeds' },
		{ from: 'runtime', to: 'state', relation: 'writes' },
		{ from: 'runtime', to: 'graphs', relation: 'calls' },
		{ from: 'graphs', to: 'backends', relation: 'calls' },
		{ from: 'graphs', to: 'gateway', relation: 'calls' },
		{ from: 'backends', to: 'gateway', relation: 'calls' },
		{ from: 'graphs', to: 'tools', relation: 'calls' },
		{ from: 'backends', to: 'tools', relation: 'calls' },
		{ from: 'graphs', to: 'packs', relation: 'depends-on' },
		{ from: 'gateway', to: 'state', relation: 'writes' },
		{ from: 'packs', to: 'gateway', relation: 'depends-on' }
	]
}

describe('buildBoardFromModel', () => {
	it('builds a full board: nodes, title, arrows with two bindings and a relation on both meta and label', async () => {
		const file = await tempFile()
		await buildBoardFromModel(file, model)

		const doc = await readMywbDocument(file)
		expect(doc.metadata.documentId).toBe('scaffold-demo')
		const shapes = doc.records
			.filter((r) => r.typeName === 'shape')
			.map((r) => JSON.parse(r.json) as { id: string; type: string; index: string })
		const byType = (t: string) => shapes.filter((s) => s.type === t)
		expect(byType('service-node')).toHaveLength(10)
		expect(byType('arrow')).toHaveLength(15)
		expect(byType('text')).toHaveLength(1)
		expect(new Set(shapes.map((s) => s.index)).size).toBe(shapes.length)

		const bindings = doc.records
			.filter((r) => r.typeName === 'binding')
			.map((r) => JSON.parse(r.json) as { fromId: string; toId: string; props: { terminal: string } })
		expect(bindings).toHaveLength(30)
		for (const arrow of byType('arrow')) {
			const terminals = bindings.filter((b) => b.fromId === arrow.id).map((b) => b.props.terminal)
			expect(terminals.sort()).toEqual(['end', 'start'])
		}

		const arrows = byType('arrow') as unknown as Array<{
			meta: { relation: string }
			props: { richText?: { content?: Array<{ content?: Array<{ text?: string }> }> } }
		}>
		expect(new Set(arrows.map((a) => a.meta.relation))).toEqual(
			new Set(['calls', 'reads', 'writes', 'embeds', 'depends-on'])
		)

		// meta.relation is what agents read; props.richText is the label a human
		// sees on the canvas. Both come from the same model edge, so they must
		// agree — otherwise the board says one thing and shows another.
		for (const arrow of arrows) {
			const label = (arrow.props.richText?.content ?? [])
				.flatMap((block) => block.content ?? [])
				.map((leaf) => leaf.text ?? '')
				.join('')
			expect(label).toBe(arrow.meta.relation)
		}
	})

	it('lays nodes out along the edge flow: callers above callees, no overlapping cards', async () => {
		const file = await tempFile()
		await buildBoardFromModel(file, model)

		const doc = await readMywbDocument(file)
		const nodes = doc.records
			.filter((r) => r.typeName === 'shape')
			.map((r) => JSON.parse(r.json) as { type: string; x: number; y: number; props: { name?: string } })
			.filter((s) => s.type === 'service-node')
		const yOf = (name: string) => nodes.find((n) => n.props.name === name)!.y
		// Acyclic call chains flow strictly downward (dagre ranks by edges, not
		// by kind): runtime → graphs → backends → tools, gateway → state.
		expect(yOf('runtime')).toBeLessThan(yOf('graphs'))
		expect(yOf('graphs')).toBeLessThan(yOf('backends'))
		expect(yOf('backends')).toBeLessThan(yOf('tools'))
		expect(yOf('gateway')).toBeLessThan(yOf('state'))
		// No two cards overlap anywhere on the page.
		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				const a = nodes[i]
				const b = nodes[j]
				const apart =
					a.x + 220 <= b.x || b.x + 220 <= a.x || a.y + 96 <= b.y || b.y + 96 <= a.y
				expect(apart, `${a.props.name} overlaps ${b.props.name}`).toBe(true)
			}
		}
	})

	it('rejects an edge whose endpoint names no component', async () => {
		const file = await tempFile()
		await expect(
			buildBoardFromModel(file, {
				components: [{ name: 'only', kind: 'lib' }],
				edges: [{ from: 'only', to: 'ghost', relation: 'calls' }]
			})
		).rejects.toThrow(/ghost/)
	})

	it('rejects an unknown kind, naming the component', async () => {
		const file = await tempFile()
		await expect(
			buildBoardFromModel(file, {
				components: [{ name: 'store', kind: 'database' as never }],
				edges: []
			})
		).rejects.toThrow(/store.*database/)
	})

	it('rejects duplicate component names (edges would be ambiguous)', async () => {
		const file = await tempFile()
		await expect(
			buildBoardFromModel(file, {
				components: [
					{ name: 'twin', kind: 'lib' },
					{ name: 'twin', kind: 'api' }
				],
				edges: []
			})
		).rejects.toThrow(/twin/)
	})
})

describe('buildBoardFromModel — groups (frames)', () => {
	const grouped: BoardModel = {
		documentId: 'grouped-demo',
		components: [
			{ name: 'ui', kind: 'web' },
			{ name: 'api', kind: 'api' },
			{ name: 'worker', kind: 'app' },
			{ name: 'db', kind: 'db' },
			{ name: 'loner', kind: 'tool' }
		],
		edges: [{ from: 'ui', to: 'api', relation: 'calls' }],
		groups: [
			{ name: 'frontend', members: ['ui'] },
			{ name: 'backend', members: ['api', 'worker', 'db'] }
		]
	}

	it('creates a frame per group and parents member nodes into it', async () => {
		const file = await tempFile()
		await buildBoardFromModel(file, grouped)
		const doc = await readMywbDocument(file)
		const shapes = doc.records
			.filter((r) => r.typeName === 'shape')
			.map((r) => JSON.parse(r.json) as { id: string; type: string; parentId: string; props: Record<string, unknown> })
		const frames = shapes.filter((s) => s.type === 'frame')
		expect(frames.map((f) => f.props.name).sort()).toEqual(['backend', 'frontend'])

		const nodeByName = new Map(
			shapes.filter((s) => s.type === 'service-node').map((s) => [s.props.name as string, s])
		)
		const frameByName = new Map(frames.map((f) => [f.props.name as string, f]))
		// members parented into their frame
		expect(nodeByName.get('ui')!.parentId).toBe(frameByName.get('frontend')!.id)
		expect(nodeByName.get('api')!.parentId).toBe(frameByName.get('backend')!.id)
		expect(nodeByName.get('db')!.parentId).toBe(frameByName.get('backend')!.id)
		// a component in no group stays parented to the page, not a frame
		expect(nodeByName.get('loner')!.parentId.startsWith('page:')).toBe(true)

		// Members use frame-relative coords (tldraw composes the frame transform
		// onto children); every member must land inside its frame's box —
		// this guards against a silent shift to page-absolute coords that
		// parentId checks wouldn't catch.
		const backendFrame = frameByName.get('backend')! as unknown as { props: { w: number; h: number } }
		const backend = ['api', 'worker', 'db'].map((n) => nodeByName.get(n)! as unknown as { x: number; y: number })
		for (const m of backend) {
			expect(m.x).toBeGreaterThanOrEqual(0)
			expect(m.x + 220).toBeLessThanOrEqual(backendFrame.props.w)
			expect(m.y).toBeGreaterThanOrEqual(0)
			expect(m.y + 96).toBeLessThanOrEqual(backendFrame.props.h)
		}
	})

	it('follows internal edges inside a frame and keeps ungrouped nodes clear of it', async () => {
		const file = await tempFile()
		await buildBoardFromModel(file, {
			components: [
				{ name: 'a', kind: 'lib' },
				{ name: 'b', kind: 'lib' },
				{ name: 'c', kind: 'lib' },
				{ name: 'd', kind: 'lib' },
				{ name: 'outsider', kind: 'web' }
			],
			// a → b → d and a → c: internal edges should drive member layout.
			edges: [
				{ from: 'a', to: 'b', relation: 'calls' },
				{ from: 'a', to: 'c', relation: 'calls' },
				{ from: 'b', to: 'd', relation: 'calls' },
				{ from: 'outsider', to: 'a', relation: 'calls' }
			],
			groups: [{ name: 'core', members: ['a', 'b', 'c', 'd'] }]
		})
		const doc = await readMywbDocument(file)
		const shapes = doc.records
			.filter((r) => r.typeName === 'shape')
			.map((r) => JSON.parse(r.json) as { id: string; type: string; x: number; y: number; parentId: string; props: Record<string, unknown> })
		const frame = shapes.find((s) => s.type === 'frame')!
		const members = shapes.filter((s) => s.type === 'service-node' && s.parentId === frame.id)
		const memberByName = new Map(members.map((m) => [m.props.name as string, m]))
		// The call chain flows downward inside the frame, and siblings on the
		// same rank (b, c) sit side by side rather than stacked.
		expect(memberByName.get('a')!.y).toBeLessThan(memberByName.get('b')!.y)
		expect(memberByName.get('b')!.y).toBeLessThan(memberByName.get('d')!.y)
		expect(memberByName.get('b')!.x).not.toBe(memberByName.get('c')!.x)
		// Every member fits inside the frame's own box.
		for (const m of members) {
			expect(m.x).toBeGreaterThanOrEqual(0)
			expect(m.x + 220).toBeLessThanOrEqual(frame.props.w as number)
			expect(m.y + 96).toBeLessThanOrEqual(frame.props.h as number)
		}
		// The ungrouped caller must not overlap the frame in page space — the
		// page-level pass treats the frame as one box and lays them apart.
		const outsider = shapes.find((s) => s.type === 'service-node' && s.parentId.startsWith('page:'))!
		const fw = frame.props.w as number
		const fh = frame.props.h as number
		const apart =
			outsider.x + 220 <= frame.x || frame.x + fw <= outsider.x ||
			outsider.y + 96 <= frame.y || frame.y + fh <= outsider.y
		expect(apart).toBe(true)
	})

	it('rejects a group member that names no component', async () => {
		const file = await tempFile()
		await expect(
			buildBoardFromModel(file, {
				components: [{ name: 'a', kind: 'lib' }],
				edges: [],
				groups: [{ name: 'g', members: ['ghost'] }]
			})
		).rejects.toThrow(/ghost/)
	})

	it('rejects a component that belongs to two groups', async () => {
		const file = await tempFile()
		await expect(
			buildBoardFromModel(file, {
				components: [{ name: 'a', kind: 'lib' }],
				edges: [],
				groups: [
					{ name: 'g1', members: ['a'] },
					{ name: 'g2', members: ['a'] }
				]
			})
		).rejects.toThrow(/a.*two groups|two groups.*a|belongs to more than one/i)
	})

	it('rejects two groups sharing a name (would orphan a frame)', async () => {
		const file = await tempFile()
		await expect(
			buildBoardFromModel(file, {
				components: [
					{ name: 'a', kind: 'lib' },
					{ name: 'b', kind: 'lib' }
				],
				edges: [],
				groups: [
					{ name: 'dup', members: ['a'] },
					{ name: 'dup', members: ['b'] }
				]
			})
		).rejects.toThrow(/duplicate group name.*dup/)
	})

	it('rejects an empty group', async () => {
		const file = await tempFile()
		await expect(
			buildBoardFromModel(file, {
				components: [{ name: 'a', kind: 'lib' }],
				edges: [],
				groups: [{ name: 'empty', members: [] }]
			})
		).rejects.toThrow(/empty/)
	})
})
