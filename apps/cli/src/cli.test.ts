import { buildMywbFixture, readMywbDocument } from '@mywb/node-adapter/headless-document'
import { execFile } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

// Integration tests against the BUILT bundle (dist/cli.js) — the artifact CI
// actually runs. vitest.config globalSetup builds it once per run.

const CLI = join(import.meta.dirname, '..', 'dist', 'cli.js')
const run = promisify(execFile)

const dirs: string[] = []
async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'mywb-cli-'))
	dirs.push(dir)
	return dir
}
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function makeFixture(): Promise<string> {
	const dir = await tempDir()
	const file = join(dir, 'board.mywb')
	await buildMywbFixture(file, {
		documentId: 'cli-test-doc',
		serviceNodes: [
			{ name: 'checkout-api', kind: 'api', repoUrl: 'https://github.com/acme/checkout' },
			{ name: 'orders-db', kind: 'db' }
		]
	})
	return file
}

describe('mywb file read', () => {
	it('does not leak the node:sqlite ExperimentalWarning to stderr', async () => {
		const file = await makeFixture()
		const { stderr } = await run(process.execPath, [CLI, 'file', 'read', file])
		expect(stderr).not.toContain('ExperimentalWarning')
		expect(stderr).not.toContain('SQLite')
	})

	it('--json prints full metadata, schema and parsed records on stdout', async () => {
		const file = await makeFixture()
		const { stdout } = await run(process.execPath, [CLI, 'file', 'read', file, '--json'])
		const doc = JSON.parse(stdout)
		expect(doc.metadata.documentId).toBe('cli-test-doc')
		expect(doc.schemaJson).toBeTruthy()
		const shapes = doc.records.filter((r: { typeName: string }) => r.typeName === 'shape')
		expect(shapes.map((s: { record: { props: { name: string } } }) => s.record.props.name).sort()).toEqual([
			'checkout-api',
			'orders-db'
		])
	})

	it('default output is a short summary with counts by typeName', async () => {
		const file = await makeFixture()
		const { stdout } = await run(process.execPath, [CLI, 'file', 'read', file])
		expect(stdout).toContain('cli-test-doc')
		expect(stdout).toContain('shape: 2')
	})
})

describe('mywb file apply', () => {
	it('applies valid changes and the file round-trips', async () => {
		const file = await makeFixture()
		const before = await readMywbDocument(file)
		const target = before.records.find(
			(r) => r.typeName === 'shape' && JSON.parse(r.json).props.name === 'orders-db'
		)!
		const changesPath = join(await tempDir(), 'changes.json')
		await writeFile(changesPath, JSON.stringify({ put: [], removed: [target.id] }))

		const { stdout } = await run(process.execPath, [CLI, 'file', 'apply', file, changesPath])
		expect(JSON.parse(stdout).recordCount).toBeGreaterThan(0)

		const after = await readMywbDocument(file)
		expect(after.records.some((r) => r.id === target.id)).toBe(false)
	})

	it('exits 1 with a clear stderr message on invalid props and leaves the file unchanged', async () => {
		const file = await makeFixture()
		const before = await readMywbDocument(file)
		const good = before.records.find((r) => r.typeName === 'shape')!
		const record = JSON.parse(good.json)
		record.props.kind = 'bogus'
		const changesPath = join(await tempDir(), 'changes.json')
		await writeFile(changesPath, JSON.stringify({ put: [record], removed: [] }))

		const error = (await run(process.execPath, [CLI, 'file', 'apply', file, changesPath]).then(
			() => {
				throw new Error('expected apply to fail')
			},
			(e: { code: number; stderr: string }) => e
		)) as { code: number; stderr: string }
		expect(error.code).toBe(1)
		expect(error.stderr).toMatch(/bogus|kind|Expected/i)

		const after = await readMywbDocument(file)
		expect(after.records).toEqual(before.records)
	})
})

describe('mywb file scaffold', () => {
	const model = {
		title: 'scaffold-cli-test',
		documentId: 'scaffold-cli-doc',
		components: [
			{ name: 'ui', kind: 'web' },
			{ name: 'api', kind: 'api' },
			{ name: 'store', kind: 'db' }
		],
		edges: [
			{ from: 'ui', to: 'api', relation: 'calls' },
			{ from: 'api', to: 'store', relation: 'reads' }
		]
	}

	it('builds a board from a model and file read sees nodes, arrows and bindings', async () => {
		const dir = await tempDir()
		const modelPath = join(dir, 'model.json')
		const board = join(dir, 'board.mywb')
		await writeFile(modelPath, JSON.stringify(model))

		await run(process.execPath, [CLI, 'file', 'scaffold', modelPath, board])

		const { stdout } = await run(process.execPath, [CLI, 'file', 'read', board, '--json'])
		const doc = JSON.parse(stdout)
		expect(doc.metadata.documentId).toBe('scaffold-cli-doc')
		const shapes = doc.records.filter((r: { typeName: string }) => r.typeName === 'shape')
		const ofType = (t: string) => shapes.filter((s: { record: { type: string } }) => s.record.type === t)
		expect(ofType('service-node')).toHaveLength(3)
		expect(ofType('arrow')).toHaveLength(2)
		expect(ofType('text')).toHaveLength(1)
		expect(doc.records.filter((r: { typeName: string }) => r.typeName === 'binding')).toHaveLength(4)
		const relations = ofType('arrow').map((a: { record: { meta: { relation: string } } }) => a.record.meta.relation)
		expect(relations.sort()).toEqual(['calls', 'reads'])
	})

	it('exits 1 with the offending name on a dangling edge endpoint', async () => {
		const dir = await tempDir()
		const modelPath = join(dir, 'model.json')
		await writeFile(
			modelPath,
			JSON.stringify({ components: [{ name: 'a', kind: 'lib' }], edges: [{ from: 'a', to: 'nope', relation: 'calls' }] })
		)
		const error = (await run(process.execPath, [CLI, 'file', 'scaffold', modelPath, join(dir, 'x.mywb')]).then(
			() => {
				throw new Error('expected scaffold to fail')
			},
			(e: { code: number; stderr: string }) => e
		)) as { code: number; stderr: string }
		expect(error.code).toBe(1)
		expect(error.stderr).toContain('nope')
	})

	it('missing args is a usage error: exit 2', async () => {
		const error = (await run(process.execPath, [CLI, 'file', 'scaffold', 'only-one-arg']).then(
			() => {
				throw new Error('expected usage error')
			},
			(e: { code: number }) => e
		)) as { code: number }
		expect(error.code).toBe(2)
	})

	it('--update merges a changed model, keeping a moved node where the human put it', async () => {
		const dir = await tempDir()
		const modelPath = join(dir, 'model.json')
		const board = join(dir, 'board.mywb')
		await writeFile(modelPath, JSON.stringify(model))
		await run(process.execPath, [CLI, 'file', 'scaffold', modelPath, board])

		// Simulate a human dragging the ui card, through the same public path an
		// agent would use: a record-level apply.
		const before = JSON.parse(
			(await run(process.execPath, [CLI, 'file', 'read', board, '--json'])).stdout
		) as { records: Array<{ id: string; typeName: string; record: Record<string, unknown> }> }
		const ui = before.records.find(
			(r) => r.typeName === 'shape' && (r.record.props as { name?: string })?.name === 'ui'
		)!
		const changesPath = join(dir, 'changes.json')
		await writeFile(changesPath, JSON.stringify({ put: [{ ...ui.record, x: 1500, y: 900 }], removed: [] }))
		await run(process.execPath, [CLI, 'file', 'apply', board, changesPath])

		// The model gains a component and an edge.
		await writeFile(
			modelPath,
			JSON.stringify({
				...model,
				components: [...model.components, { name: 'cli', kind: 'tool' }],
				edges: [...model.edges, { from: 'cli', to: 'api', relation: 'calls' }]
			})
		)
		const { stdout } = await run(process.execPath, [CLI, 'file', 'scaffold', modelPath, board, '--update'])
		expect(JSON.parse(stdout).updated.put).toBeGreaterThan(0)

		const after = JSON.parse(
			(await run(process.execPath, [CLI, 'file', 'read', board, '--json'])).stdout
		) as { records: Array<{ typeName: string; record: Record<string, unknown> }> }
		const shapes = after.records.filter((r) => r.typeName === 'shape').map((r) => r.record)
		const nodes = shapes.filter((s) => s.type === 'service-node')
		expect(nodes.map((n) => (n.props as { name: string }).name).sort()).toEqual(['api', 'cli', 'store', 'ui'])
		expect(shapes.filter((s) => s.type === 'arrow')).toHaveLength(3)
		const movedUi = nodes.find((n) => (n.props as { name: string }).name === 'ui')!
		expect([movedUi.x, movedUi.y]).toEqual([1500, 900])
	})

	it('--update on a missing board fails as an operation error, not a silent rebuild', async () => {
		const dir = await tempDir()
		const modelPath = join(dir, 'model.json')
		await writeFile(modelPath, JSON.stringify(model))
		const error = (await run(process.execPath, [
			CLI,
			'file',
			'scaffold',
			modelPath,
			join(dir, 'nope.mywb'),
			'--update'
		]).then(
			() => {
				throw new Error('expected update to fail')
			},
			(e: { code: number }) => e
		)) as { code: number }
		expect(error.code).toBe(1)
	})
})

describe('mywb file model extract', () => {
	const model = {
		title: 'extract-cli-test',
		documentId: 'extract-cli-doc',
		components: [
			{ name: 'ui', kind: 'web' },
			{ name: 'api', kind: 'api', repoUrl: 'src/api' },
			{ name: 'store', kind: 'db' }
		],
		edges: [
			{ from: 'ui', to: 'api', relation: 'calls' },
			{ from: 'api', to: 'store', relation: 'reads' }
		],
		groups: [{ name: 'backend', members: ['api', 'store'] }]
	}

	async function scaffolded(): Promise<{ dir: string; board: string }> {
		const dir = await tempDir()
		const modelPath = join(dir, 'model.json')
		const board = join(dir, 'board.mywb')
		await writeFile(modelPath, JSON.stringify(model))
		await run(process.execPath, [CLI, 'file', 'scaffold', modelPath, board])
		return { dir, board }
	}

	it('writes a model file that round-trips back to an equivalent board', async () => {
		const { dir, board } = await scaffolded()
		const extracted = join(dir, 'extracted.model.json')

		const { stdout } = await run(process.execPath, [CLI, 'file', 'model', 'extract', board, extracted])
		expect(JSON.parse(stdout)).toMatchObject({ components: 3, edges: 2, groups: 1 })

		const written = JSON.parse(await readFile(extracted, 'utf8'))
		expect(written.title).toBe('extract-cli-test')
		expect(written.documentId).toBe('extract-cli-doc')
		expect(written.groups).toEqual([{ name: 'backend', members: ['api', 'store'] }])

		// The extracted model is usable as scaffold input — the loop the whole
		// feature exists for.
		const rebuilt = join(dir, 'rebuilt.mywb')
		await run(process.execPath, [CLI, 'file', 'scaffold', extracted, rebuilt])
		const before = await run(process.execPath, [CLI, 'file', 'mermaid', board])
		const after = await run(process.execPath, [CLI, 'file', 'mermaid', rebuilt])
		expect(after.stdout).toBe(before.stdout)
	})

	it('- prints the model to stdout so an agent can diff without a temp file', async () => {
		const { board } = await scaffolded()
		const { stdout } = await run(process.execPath, [CLI, 'file', 'model', 'extract', board, '-'])
		const printed = JSON.parse(stdout)
		expect(printed.components.map((c: { name: string }) => c.name).sort()).toEqual(['api', 'store', 'ui'])
	})

	it('missing args is a usage error: exit 2', async () => {
		const error = (await run(process.execPath, [CLI, 'file', 'model', 'extract', 'only-one-arg']).then(
			() => {
				throw new Error('expected usage error')
			},
			(e: { code: number }) => e
		)) as { code: number }
		expect(error.code).toBe(2)
	})
})

describe('mywb file mermaid', () => {
	async function scaffoldBoard(): Promise<string> {
		const dir = await tempDir()
		const modelPath = join(dir, 'model.json')
		const board = join(dir, 'board.mywb')
		await writeFile(
			modelPath,
			JSON.stringify({
				components: [
					{ name: 'ui', kind: 'web' },
					{ name: 'store', kind: 'db' }
				],
				edges: [{ from: 'ui', to: 'store', relation: 'reads' }]
			})
		)
		await run(process.execPath, [CLI, 'file', 'scaffold', modelPath, board])
		return board
	}

	it('prints a flowchart by default with nodes, kinds and relation edges', async () => {
		const board = await scaffoldBoard()
		const { stdout } = await run(process.execPath, [CLI, 'file', 'mermaid', board])
		expect(stdout.startsWith('flowchart LR')).toBe(true)
		expect(stdout).toContain('["ui"]:::web')
		expect(stdout).toContain('["store"]:::db')
		expect(stdout).toContain('-->|"reads"|')
	})

	it('--syntax c4 prints a C4Context document', async () => {
		const board = await scaffoldBoard()
		const { stdout } = await run(process.execPath, [CLI, 'file', 'mermaid', board, '--syntax', 'c4'])
		expect(stdout.startsWith('C4Context')).toBe(true)
		expect(stdout).toContain('SystemDb(')
	})

	it('rejects an unknown syntax with a usage error: exit 2', async () => {
		const board = await scaffoldBoard()
		const error = (await run(process.execPath, [CLI, 'file', 'mermaid', board, '--syntax', 'd2']).then(
			() => {
				throw new Error('expected usage error')
			},
			(e: { code: number }) => e
		)) as { code: number }
		expect(error.code).toBe(2)
	})

	it('scaffolds groups into frames and renders them as mermaid subgraphs', async () => {
		const dir = await tempDir()
		const modelPath = join(dir, 'model.json')
		const board = join(dir, 'board.mywb')
		await writeFile(
			modelPath,
			JSON.stringify({
				components: [
					{ name: 'ui', kind: 'web' },
					{ name: 'api', kind: 'api' },
					{ name: 'db', kind: 'db' }
				],
				edges: [{ from: 'ui', to: 'api', relation: 'calls' }],
				groups: [{ name: 'backend', members: ['api', 'db'] }]
			})
		)
		await run(process.execPath, [CLI, 'file', 'scaffold', modelPath, board])
		const { stdout } = await run(process.execPath, [CLI, 'file', 'mermaid', board])
		expect(stdout).toContain('subgraph')
		expect(stdout).toContain('["backend"]')
	})
})

describe('mywb vendored dist', () => {
	// The CI drift-check vendors the built dist/ (cli.js + assets/) into a target
	// repo with no node_modules. @modelcontextprotocol/sdk is externalized but the
	// mcp import is lazy, so `file read` must not pull it in. Proven by copying
	// dist/ into a bare dir and running it from there.
	it('file read runs from a vendored dist copy with no node_modules on disk', async () => {
		const file = await makeFixture()
		const bare = await tempDir()
		await cp(dirname(CLI), join(bare, 'dist'), { recursive: true })

		const { stdout } = await run(process.execPath, [join(bare, 'dist', 'cli.js'), 'file', 'read', file, '--json'])
		expect(JSON.parse(stdout).metadata.documentId).toBe('cli-test-doc')
	})
})

describe('mywb CLI surface', () => {
	it('unknown command exits 2 with usage on stderr', async () => {
		const error = (await run(process.execPath, [CLI, 'nonsense']).then(
			() => {
				throw new Error('expected unknown command to fail')
			},
			(e: { code: number; stderr: string }) => e
		)) as { code: number; stderr: string }
		expect(error.code).toBe(2)
		expect(error.stderr).toContain('Usage')
	})

	it('unknown flag is a usage error: exit 2', async () => {
		const file = await makeFixture()
		const error = (await run(process.execPath, [CLI, 'file', 'read', file, '--bogus']).then(
			() => {
				throw new Error('expected unknown flag to fail')
			},
			(e: { code: number }) => e
		)) as { code: number }
		expect(error.code).toBe(2)
	})

	it('--help exits 0 and prints usage', async () => {
		const { stdout } = await run(process.execPath, [CLI, '--help'])
		expect(stdout).toContain('mywb file read')
	})
})
