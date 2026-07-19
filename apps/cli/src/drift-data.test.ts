import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

// Proves the CI drift-check flow has the data it needs: the sample fixture
// (same seeds file the example ships) read through the built CLI exposes every
// field SKILL.md tells the agent to compare. We test data sufficiency, not the
// agent's judgement.

const DIST = join(import.meta.dirname, '..', 'dist')
const SEEDS = join(import.meta.dirname, '..', '..', '..', 'examples', 'ci-drift-check', 'sample-board.json')
const run = promisify(execFile)

const dirs: string[] = []
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

describe('drift-check data flow', () => {
	it('fixture built from the example seeds exposes name/kind/repoUrl/ownerTeam per service', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'mywb-drift-'))
		dirs.push(dir)
		const board = join(dir, 'architecture.mywb')

		await run(process.execPath, [join(DIST, 'make-fixture.js'), board, SEEDS])
		const { stdout } = await run(process.execPath, [join(DIST, 'cli.js'), 'file', 'read', board, '--json'])

		const doc = JSON.parse(stdout)
		const services = doc.records
			.filter((r: { typeName: string }) => r.typeName === 'shape')
			.map((r: { record: { type: string; props: Record<string, unknown> } }) => r.record)
			.filter((rec: { type: string }) => rec.type === 'service-node')

		expect(services.length).toBeGreaterThanOrEqual(2)
		for (const service of services) {
			expect(typeof service.props.name).toBe('string')
			expect(typeof service.props.kind).toBe('string')
			expect(typeof service.props.repoUrl).toBe('string')
			expect(typeof service.props.ownerTeam).toBe('string')
		}
		// The example seeds contain deliberate drift bait for the agent demo.
		expect(services.some((s: { props: { repoUrl: string } }) => s.props.repoUrl.length > 0)).toBe(true)
	})
})
