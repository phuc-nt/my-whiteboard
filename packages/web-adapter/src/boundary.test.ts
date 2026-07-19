import { describe, expect, it } from 'vitest'
import adapterPackageJson from '../package.json'

// @mywb/web-adapter runs in the browser: no electron, no node builtins, no
// desktop IPC bridge in RUNTIME sources. (Tests may use node:* to build
// fixtures via @mywb/node-adapter — the boundary protects what ships.) Same
// raw-source scan as the other boundary gates.

const sources = (
	import.meta as unknown as {
		glob(pattern: string, opts: { query: string; import: string; eager: true }): Record<string, string>
	}
).glob('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

const FORBIDDEN = [
	/from\s+['"]electron['"]/,
	/import\s*\(?\s*['"]electron['"]/,
	/require\(\s*['"]electron['"]/,
	/from\s+['"]node:/,
	/import\s*\(?\s*['"]node:/,
	/require\(\s*['"]node:/,
	/window\.desktop/,
	/window\[\s*['"]desktop['"]\s*\]/
]

describe('web-adapter boundary', () => {
	it('runtime sources never touch electron, node builtins, or window.desktop', () => {
		const offenders: string[] = []
		for (const [path, content] of Object.entries(sources)) {
			if (path.includes('.test.')) continue
			for (const pattern of FORBIDDEN) {
				if (pattern.test(content)) offenders.push(`${path} matches ${pattern}`)
			}
		}
		expect(offenders).toEqual([])
	})

	it('scans a non-trivial number of source files (glob is not silently empty)', () => {
		expect(Object.keys(sources).length).toBeGreaterThan(4)
	})

	it('package.json declares no electron dependency', () => {
		const declared = Object.keys({
			...adapterPackageJson.dependencies,
			...adapterPackageJson.devDependencies
		})
		expect(declared).not.toContain('electron')
	})
})
