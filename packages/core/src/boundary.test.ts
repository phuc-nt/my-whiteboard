import { describe, expect, it } from 'vitest'
import corePackageJson from '../package.json'

// The hard boundary of @mywb/core: no Electron, no Node builtins, no desktop
// IPC bridge. Runtime sources are scanned as raw text via import.meta.glob so
// this gate itself needs no node:fs import. Test files are exempt — the
// boundary protects what ships, not the harness around it.

// Typed loosely: import.meta.glob is provided by vitest's vite pipeline but is
// not part of the ES import.meta type surface this tsconfig knows about.
const sources = (
	import.meta as unknown as {
		glob(pattern: string, opts: { query: string; import: string; eager: true }): Record<string, string>
	}
).glob('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

// Covers named (`from 'x'`), side-effect (`import 'x'`), dynamic
// (`import('x')`), and CJS (`require('x')`) forms.
const FORBIDDEN = [
	/from\s+['"]electron['"]/,
	/import\s*\(?\s*['"]electron['"]/,
	/require\(\s*['"]electron['"]/,
	/from\s+['"]node:/,
	/import\s*\(?\s*['"]node:/,
	/require\(\s*['"]node:/,
	/window\.desktop/
]

describe('core boundary', () => {
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
		expect(Object.keys(sources).length).toBeGreaterThan(10)
	})

	it('package.json declares no electron or node type dependencies', () => {
		const declared = Object.keys({
			...corePackageJson.dependencies,
			...corePackageJson.devDependencies,
			...(corePackageJson as { peerDependencies?: Record<string, string> }).peerDependencies
		})
		expect(declared).not.toContain('electron')
		expect(declared).not.toContain('@types/node')
	})
})
