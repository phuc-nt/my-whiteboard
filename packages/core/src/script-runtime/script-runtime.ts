import type { Editor } from 'tldraw'
import { buildScriptHelpers } from '../exec/script-helpers'

// Runs a document script in the renderer. Each run gets a fresh AbortController;
// starting a new run aborts the previous one (its `signal` fires) so listeners
// and loops the script registered are torn down. The module is imported from
// the trusted mywb-script:// URL, cache-busted by digest.

let currentController: AbortController | null = null

export interface ScriptRunResult {
	ok: boolean
	error?: string
}

export async function runDocumentScript(editor: Editor, scriptUrl: string): Promise<ScriptRunResult> {
	// Abort the previous run before starting a new one.
	currentController?.abort()
	const controller = new AbortController()
	currentController = controller

	let main: unknown
	try {
		const module = await import(/* @vite-ignore */ scriptUrl)
		main = module.default
	} catch (error) {
		return { ok: false, error: `import failed: ${error instanceof Error ? error.message : String(error)}` }
	}
	if (controller.signal.aborted) return { ok: true }
	if (typeof main !== 'function') {
		return { ok: false, error: 'script default export must be a function' }
	}

	try {
		await (main as (ctx: unknown) => unknown)({
			editor,
			helpers: buildScriptHelpers(editor),
			signal: controller.signal
		})
		return { ok: true }
	} catch (error) {
		if (controller.signal.aborted) return { ok: true }
		return { ok: false, error: error instanceof Error ? error.message : String(error) }
	}
}

/** Abort any running script (window teardown). */
export function stopDocumentScript(): void {
	currentController?.abort()
	currentController = null
}
