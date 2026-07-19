import type { ExecResult } from '@mywb/core/agent-protocol'
import type { Editor } from 'tldraw'
import * as tldraw from 'tldraw'
import { buildScriptHelpers } from './script-helpers'

// Runs agent exec code against the live editor. Wrapped in a history stopping
// point so the whole exec is one Cmd+Z for the user. Result is serialized to
// plain JSON for IPC — non-serializable returns degrade to a string.

export type { ExecResult }

// A bare `import('tldraw')` inside exec code can't resolve (it never went
// through the bundler), so exec code uses the injected `tldraw` binding
// directly — e.g. `const { createShapeId } = tldraw`. We deliberately do NOT
// rewrite the source: textual rewriting would corrupt `import(` appearing in
// string literals or comments (an agent authoring a note that mentions it).
export async function runExecCode(editor: Editor, code: string): Promise<ExecResult> {
	editor.markHistoryStoppingPoint('agent-exec')
	try {
		const helpers = buildScriptHelpers(editor)
		// eslint-disable-next-line no-new-func -- deliberate, authenticated local code execution
		const fn = new Function('editor', 'helpers', 'tldraw', `return (async () => { ${code} })()`)
		const result = await fn(editor, helpers, tldraw)
		let serialized: unknown = null
		try {
			serialized = result === undefined ? null : JSON.parse(JSON.stringify(result))
		} catch {
			serialized = typeof result === 'object' ? '[unserializable object]' : String(result)
		}
		return { success: true, result: serialized }
	} catch (error) {
		return { success: false, error: error instanceof Error ? error.message : String(error) }
	}
}
