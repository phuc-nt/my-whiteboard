import type { IndexKey } from 'tldraw'
import { describe, expect, it } from 'vitest'
import { computeServiceNodeMinHeight, ServiceNodeShapeUtil } from './service-node-shape-util'

// The card grows to fit its content so repoUrl is never clipped (dogfood P5).

describe('computeServiceNodeMinHeight', () => {
	const base = { w: 220, name: 'svc', kind: 'api' as const, repoUrl: '', ownerTeam: '' }

	it('a short single-line name with no extras is compact', () => {
		expect(computeServiceNodeMinHeight(base)).toBeLessThanOrEqual(96)
	})

	it('grows when a repoUrl and owner are present', () => {
		const withExtras = { ...base, repoUrl: 'packages/core', ownerTeam: 'platform' }
		expect(computeServiceNodeMinHeight(withExtras)).toBeGreaterThan(computeServiceNodeMinHeight(base))
	})

	it('grows when the name wraps to multiple lines at the given width', () => {
		const longName = { ...base, name: '@mywb/node-adapter-with-a-very-long-package-name-here' }
		expect(computeServiceNodeMinHeight(longName)).toBeGreaterThan(computeServiceNodeMinHeight(base))
	})
})

describe('getGeometry never clips content', () => {
	it('geometry height is at least the min height even when props.h is the old default 96', () => {
		const util = new ServiceNodeShapeUtil({} as never)
		const shape = {
			id: 'shape:svc' as never,
			type: 'service-node',
			typeName: 'shape',
			x: 0,
			y: 0,
			rotation: 0,
			index: 'a1' as IndexKey,
			parentId: 'page:p' as never,
			isLocked: false,
			opacity: 1,
			meta: {},
			props: {
				w: 220,
				h: 96,
				name: '@mywb/node-adapter (a long two-line name)',
				kind: 'lib' as const,
				repoUrl: 'packages/node-adapter',
				ownerTeam: 'solo'
			}
		}
		const geo = util.getGeometry(shape as never)
		const min = computeServiceNodeMinHeight(shape.props)
		expect(geo.bounds.height).toBeGreaterThanOrEqual(min)
		expect(geo.bounds.height).toBeGreaterThan(96)
	})

	it('respects a user-resized taller card (props.h wins when larger)', () => {
		const util = new ServiceNodeShapeUtil({} as never)
		const shape = {
			id: 'shape:svc2' as never,
			type: 'service-node',
			typeName: 'shape',
			x: 0,
			y: 0,
			rotation: 0,
			index: 'a1' as IndexKey,
			parentId: 'page:p' as never,
			isLocked: false,
			opacity: 1,
			meta: {},
			props: { w: 220, h: 400, name: 'svc', kind: 'api' as const, repoUrl: '', ownerTeam: '' }
		}
		expect(util.getGeometry(shape as never).bounds.height).toBe(400)
	})
})
