import type { ServiceKind } from '../shapes'
import { describe, expect, it } from 'vitest'
import type { BoardModel, BoardModelKind } from './board-model-schema'
import { normalizeBoardModel, parseBoardModel } from './board-model-schema'

// The model schema is the contract both directions share (scaffold consumes,
// extract produces), so its error messages are part of the CLI's public
// behavior — assert on them, not just on throw/no-throw.

// The model layer declares SERVICE_KINDS itself to stay React-free; these two
// assignments fail to compile if it ever drifts from the shape util's union.
const _kindsAreServiceKinds: ServiceKind = 'api' as BoardModelKind
const _serviceKindsAreKinds: BoardModelKind = 'api' as ServiceKind
void _kindsAreServiceKinds
void _serviceKindsAreKinds

const minimal = {
	components: [
		{ name: 'cli', kind: 'tool' },
		{ name: 'core', kind: 'lib' }
	],
	edges: [{ from: 'cli', to: 'core', relation: 'depends-on' }]
}

describe('parseBoardModel', () => {
	it('accepts a minimal model and leaves optional keys absent', () => {
		const model = parseBoardModel(minimal)
		expect(model.components).toHaveLength(2)
		expect(model.groups).toBeUndefined()
		expect(model.title).toBeUndefined()
	})

	it('accepts groups, title and documentId', () => {
		const model = parseBoardModel({
			...minimal,
			title: 'my board',
			documentId: 'doc-1',
			groups: [{ name: 'packages', members: ['core'] }]
		})
		expect(model.groups?.[0].members).toEqual(['core'])
		expect(model.title).toBe('my board')
	})

	it('rejects an unknown kind with the offending path', () => {
		expect(() =>
			parseBoardModel({ components: [{ name: 'x', kind: 'database' }], edges: [] })
		).toThrow(/components\.0\.kind/)
	})

	it('rejects an empty components array', () => {
		expect(() => parseBoardModel({ components: [], edges: [] })).toThrow(/non-empty "components"/)
	})

	it('rejects a missing edges array', () => {
		expect(() => parseBoardModel({ components: minimal.components })).toThrow(/edges/)
	})

	it('rejects an edge endpoint that names no component', () => {
		expect(() =>
			parseBoardModel({ ...minimal, edges: [{ from: 'cli', to: 'ghost', relation: 'calls' }] })
		).toThrow('edge cli -> ghost: no component named "ghost"')
	})

	it('rejects duplicate component names', () => {
		expect(() =>
			parseBoardModel({
				components: [
					{ name: 'cli', kind: 'tool' },
					{ name: 'cli', kind: 'lib' }
				],
				edges: []
			})
		).toThrow('duplicate component name: "cli"')
	})

	it('rejects duplicate group names', () => {
		expect(() =>
			parseBoardModel({
				...minimal,
				groups: [
					{ name: 'g', members: ['core'] },
					{ name: 'g', members: ['cli'] }
				]
			})
		).toThrow('duplicate group name: "g"')
	})

	it('rejects an empty group', () => {
		expect(() => parseBoardModel({ ...minimal, groups: [{ name: 'g', members: [] }] })).toThrow(
			'group "g" is empty'
		)
	})

	it('rejects a group member that names no component', () => {
		expect(() =>
			parseBoardModel({ ...minimal, groups: [{ name: 'g', members: ['ghost'] }] })
		).toThrow('group "g": no component named "ghost"')
	})

	it('rejects a component in two groups', () => {
		expect(() =>
			parseBoardModel({
				...minimal,
				groups: [
					{ name: 'a', members: ['core'] },
					{ name: 'b', members: ['core'] }
				]
			})
		).toThrow('component "core" belongs to more than one group')
	})

	it('rejects an empty-string repoUrl instead of silently keeping it', () => {
		expect(() =>
			parseBoardModel({ components: [{ name: 'x', kind: 'lib', repoUrl: '' }], edges: [] })
		).toThrow(/components\.0\.repoUrl/)
	})
})

describe('normalizeBoardModel', () => {
	it('sorts collections so equivalent models stringify identically', () => {
		const a: BoardModel = {
			components: [
				{ name: 'b', kind: 'lib' },
				{ name: 'a', kind: 'api' }
			],
			edges: [
				{ from: 'b', to: 'a', relation: 'calls' },
				{ from: 'a', to: 'b', relation: 'reads' }
			],
			groups: [{ name: 'g', members: ['b', 'a'] }]
		}
		const b: BoardModel = {
			components: [
				{ name: 'a', kind: 'api' },
				{ name: 'b', kind: 'lib' }
			],
			edges: [
				{ from: 'a', to: 'b', relation: 'reads' },
				{ from: 'b', to: 'a', relation: 'calls' }
			],
			groups: [{ name: 'g', members: ['a', 'b'] }]
		}
		expect(JSON.stringify(normalizeBoardModel(a))).toBe(JSON.stringify(normalizeBoardModel(b)))
	})

	it('drops absent and empty optional keys', () => {
		const normalized = normalizeBoardModel({
			components: [{ name: 'a', kind: 'api', repoUrl: '', ownerTeam: 'x' }],
			edges: [],
			groups: []
		})
		expect(Object.keys(normalized.components[0])).toEqual(['name', 'kind', 'ownerTeam'])
		expect(normalized.groups).toBeUndefined()
	})
})
