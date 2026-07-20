import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { BoardModel } from './board-scaffold'
import { buildBoardFromModel } from './board-scaffold'
import { readMywbDocument } from './headless-document'

// Locks the scaffold contract: a model of components + relation edges becomes
// a complete, schema-valid board — positioned nodes, title, arrows each bound
// to both endpoints, relation carried in arrow meta.

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
	it('builds a full board: nodes, title, arrows with two bindings and relation meta', async () => {
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

		const relations = byType('arrow').map(
			(a) => (a as unknown as { meta: { relation: string } }).meta.relation
		)
		expect(new Set(relations)).toEqual(
			new Set(['calls', 'reads', 'writes', 'embeds', 'depends-on'])
		)
	})

	it('lays nodes out in kind rows: entry surfaces above gateways above libs above storage', async () => {
		const file = await tempFile()
		await buildBoardFromModel(file, model)

		const doc = await readMywbDocument(file)
		const nodes = doc.records
			.filter((r) => r.typeName === 'shape')
			.map((r) => JSON.parse(r.json) as { type: string; y: number; props: { kind?: string } })
			.filter((s) => s.type === 'service-node')
		const yOf = (kind: string) => nodes.find((n) => n.props.kind === kind)!.y
		expect(yOf('web')).toBeLessThan(yOf('api'))
		expect(yOf('api')).toBeLessThan(yOf('lib'))
		expect(yOf('lib')).toBeLessThan(yOf('db'))
		expect(yOf('web')).toBe(yOf('tool'))
		const sameRow = nodes.filter((n) => n.props.kind === 'lib')
		expect(new Set(sameRow.map((n) => (n as unknown as { x: number }).x)).size).toBe(sameRow.length)
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
