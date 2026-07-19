import { describe, expect, it } from 'vitest'
import { CodeRefShapeUtil } from './code-ref/code-ref-shape-util'
import { customShapeUtils } from './custom-shapes-registry'
import { MermaidBlockShapeUtil } from './mermaid-block/mermaid-block-shape-util'
import { ServiceNodeShapeUtil } from './service-node/service-node-shape-util'

// Validates the structured-data contract of the custom shapes without an
// editor: the static T validators are what the store (and agents via /exec)
// run against every record write.

function validateProps(util: { props?: Record<string, { validate(v: unknown): unknown }> }, props: Record<string, unknown>): void {
	for (const [key, validator] of Object.entries(util.props ?? {})) {
		validator.validate(props[key])
	}
}

describe('service-node props', () => {
	const valid = { w: 220, h: 96, name: 'service', kind: 'api', repoUrl: '', ownerTeam: '' }

	it('accepts the default shape props', () => {
		expect(() => validateProps(ServiceNodeShapeUtil, valid)).not.toThrow()
	})

	it('accepts every service kind, including lib/app/tool', () => {
		for (const kind of ['api', 'db', 'queue', 'cron', 'web', 'lib', 'app', 'tool']) {
			expect(() => ServiceNodeShapeUtil.props.kind.validate(kind)).not.toThrow()
		}
	})

	it('rejects an unknown kind', () => {
		expect(() => ServiceNodeShapeUtil.props.kind.validate('bogus')).toThrow()
	})

	it('rejects a non-numeric width', () => {
		expect(() => ServiceNodeShapeUtil.props.w.validate('wide')).toThrow()
	})
})

describe('code-ref props', () => {
	it('accepts typical props and rejects non-string path', () => {
		expect(() => CodeRefShapeUtil.props.path.validate('src/index.ts')).not.toThrow()
		expect(() => CodeRefShapeUtil.props.path.validate(42)).toThrow()
		expect(() => CodeRefShapeUtil.props.lineStart.validate('ten')).toThrow()
	})
})

describe('mermaid-block props', () => {
	it('accepts a source string and rejects non-string source', () => {
		expect(() => MermaidBlockShapeUtil.props.source.validate('graph TD; a-->b')).not.toThrow()
		expect(() => MermaidBlockShapeUtil.props.source.validate(null)).toThrow()
	})
})

describe('custom shapes registry', () => {
	it('exposes exactly the three dev-workflow shape utils', () => {
		expect(customShapeUtils.map((u) => u.type).sort()).toEqual([
			'code-ref',
			'mermaid-block',
			'service-node'
		])
	})
})
