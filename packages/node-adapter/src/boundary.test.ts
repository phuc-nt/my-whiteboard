import { describe, expect, it } from 'vitest'
import adapterPackageJson from '../package.json'

// The boundary of @mywb/node-adapter: Node builtins are fine (that is the
// point of this package), Electron is not — this code must run on a bare CI
// runner. Same raw-source scan technique as the core boundary gate.

const sources = (
	import.meta as unknown as {
		glob(pattern: string, opts: { query: string; import: string; eager: true }): Record<string, string>
	}
).glob('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

const FORBIDDEN = [
	/from\s+['"]electron['"]/,
	/import\s*\(?\s*['"]electron['"]/,
	/require\(\s*['"]electron['"]/,
	/window\.desktop/,
	/window\[\s*['"]desktop['"]\s*\]/
]

describe('node-adapter boundary', () => {
	it('sources never touch electron or the desktop IPC bridge', () => {
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
		expect(Object.keys(sources).length).toBeGreaterThan(2)
	})

	it('package.json declares no electron dependency', () => {
		const declared = Object.keys({
			...adapterPackageJson.dependencies,
			...adapterPackageJson.devDependencies,
			...(adapterPackageJson as { peerDependencies?: Record<string, string> }).peerDependencies
		})
		expect(declared).not.toContain('electron')
	})
})
