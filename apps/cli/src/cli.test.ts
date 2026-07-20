import { buildMywbFixture, readMywbDocument } from '@mywb/node-adapter/headless-document'
import { execFile } from 'node:child_process'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
