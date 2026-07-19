import { mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { ARCHIVE_SCRIPT_DIR } from '../../shared/mywb-format-types'

// Exposes a document's live script/ directory so an agent can edit main.js
// with its own file tools. Creates a starter template on first access.

const SCRIPT_ENTRY = 'main.js'

const STARTER_TEMPLATE = `// Document script — runs when this file is opened (after you consent).
// Default export receives { editor, helpers, signal }. Use signal to clean up.
//
// Import tldraw primitives at the top level:
//   import { createShapeId } from 'tldraw'
//
// Keep script-owned writes out of the user's undo stack:
//   editor.run(() => { /* ... */ }, { history: 'ignore' })

export default function ({ editor, signal }) {
	// Example: log how many shapes are on the page whenever the document changes.
	function update() {
		// Read records and update the canvas here.
	}
	const stop = editor.store.listen(update, { scope: 'document' })
	signal.addEventListener('abort', () => stop())
	update()
}
`

export interface ScriptWorkspace {
	scriptDir: string
	mainJsPath: string
	/** True while main.js is still the untouched starter (safe to overwrite). */
	isDefaultScript: boolean
}

export async function openScriptWorkspace(workingCopyDir: string): Promise<ScriptWorkspace> {
	const scriptDir = join(workingCopyDir, ARCHIVE_SCRIPT_DIR)
	const mainJsPath = join(scriptDir, SCRIPT_ENTRY)
	await mkdir(scriptDir, { recursive: true })
	let isDefaultScript = true
	if (!existsSync(mainJsPath)) {
		await writeFile(mainJsPath, STARTER_TEMPLATE)
	} else {
		const current = await readFile(mainJsPath, 'utf8')
		isDefaultScript = current === STARTER_TEMPLATE
	}
	return { scriptDir, mainJsPath, isDefaultScript }
}
