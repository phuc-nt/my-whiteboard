import type { Editor } from 'tldraw'
import * as tldraw from 'tldraw'
import type { ExecResult } from '../agent-protocol/agent-protocol'
import { buildScriptHelpers } from './script-helpers'

// Runs agent exec code against the live editor. Wrapped in a history stopping
// point so the whole exec is one Cmd+Z for the user. Result is serialized to
// plain JSON for the transport — non-serializable returns degrade to a string.

export type { ExecResult }

/**
 * Exec return values cross a serialization boundary (IPC / HTTP), so anything
 * JSON can't represent degrades: objects to a placeholder, the rest via String.
 */
export function serializeExecReturnValue(value: unknown): unknown {
	try {
		return value === undefined ? null : JSON.parse(JSON.stringify(value))
	} catch {
		return typeof value === 'object' ? '[unserializable object]' : String(value)
	}
}

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
		return { success: true, result: serializeExecReturnValue(result) }
	} catch (error) {
		return { success: false, error: error instanceof Error ? error.message : String(error) }
	}
}
