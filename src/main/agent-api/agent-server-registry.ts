import type { BrowserWindow } from 'electron'
import type { EditorSnapshotResult } from '../../shared/ipc-contract'
import { invokeRenderer } from '../renderer-invoke'
import type { WorkingCopy } from '../working-copy-manager'

// Bridges the Agent API server (which knows nothing about windows) to the live
// documents. The server calls these to list docs, read shapes, run exec code,
// and capture screenshots without importing window-manager internals.

export interface OpenDocumentInfo {
	id: string
	filePath: string | null
	name: string
	dirty: boolean
	lastActive: number
}

export interface AgentDocumentTarget {
	documentId: string
	window: BrowserWindow
	workingCopy: WorkingCopy
}

export interface AgentExecResult {
	success: boolean
	result?: unknown
	error?: string
}

/** Supplied by main/index.ts — the only coupling to window state. */
export interface AgentDocumentProvider {
	listOpenDocuments(): OpenDocumentInfo[]
	getTarget(documentId: string): AgentDocumentTarget | null
}

let provider: AgentDocumentProvider | null = null

export function setAgentDocumentProvider(next: AgentDocumentProvider): void {
	provider = next
}

function requireProvider(): AgentDocumentProvider {
	if (!provider) throw new Error('Agent document provider not initialized')
	return provider
}

export function listOpenDocuments(nameFilter?: string): OpenDocumentInfo[] {
	const docs = requireProvider().listOpenDocuments()
	const filtered = nameFilter
		? docs.filter((doc) => doc.name.toLowerCase().includes(nameFilter.toLowerCase()))
		: docs
	return [...filtered].sort((a, b) => b.lastActive - a.lastActive)
}

export function getFocusedDocument(): OpenDocumentInfo | null {
	return listOpenDocuments()[0] ?? null
}

/** Thrown when a document id doesn't map to an open window — maps to HTTP 404. */
export class DocumentNotFoundError extends Error {
	constructor(documentId: string) {
		super(`Document "${documentId}" not found`)
		this.name = 'DocumentNotFoundError'
	}
}

function requireTarget(documentId: string): AgentDocumentTarget {
	const target = requireProvider().getTarget(documentId)
	if (!target) throw new DocumentNotFoundError(documentId)
	return target
}

/** Run JS against the live editor in a document's renderer. */
export function execInDocument(documentId: string, code: string): Promise<AgentExecResult> {
	const target = requireTarget(documentId)
	return invokeRenderer<AgentExecResult>(target.window, 'exec-code', { code })
}

/** Read the current page's shapes, page info, and viewport. */
export async function getDocumentShapes(documentId: string): Promise<unknown> {
	const result = await execInDocument(
		documentId,
		`const shapes = editor.getCurrentPageShapes()
		 const page = editor.getCurrentPage()
		 const viewport = editor.getViewportPageBounds()
		 return {
		   page: { id: page.id, name: page.name },
		   viewport: { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h },
		   shapes,
		 }`
	)
	if (!result.success) throw new Error(result.error ?? 'Failed to read shapes')
	return result.result
}

/** Read all binding records on the current page. */
export async function getDocumentBindings(documentId: string): Promise<unknown> {
	const result = await execInDocument(
		documentId,
		`const shapes = editor.getCurrentPageShapes()
		 return shapes.flatMap((s) => editor.getBindingsFromShape(s.id, 'arrow'))`
	)
	if (!result.success) throw new Error(result.error ?? 'Failed to read bindings')
	return result.result
}

/** Capture a PNG of the current page as a base64 data URL. */
export async function getDocumentScreenshot(documentId: string): Promise<string> {
	const target = requireTarget(documentId)
	// A minimized/hidden window paints nothing (or a stale frame) — capturePage
	// would hand back a blank PNG the agent can't distinguish from a real one.
	if (target.window.isMinimized() || !target.window.isVisible()) {
		throw new Error('Document window is not visible; cannot capture a screenshot.')
	}
	const image = await target.window.webContents.capturePage()
	return `data:image/png;base64,${image.toPNG().toString('base64')}`
}

/** Snapshot (records + schema) captured directly from the renderer. */
export function getDocumentSnapshot(documentId: string): Promise<EditorSnapshotResult> {
	const target = requireTarget(documentId)
	return invokeRenderer<EditorSnapshotResult>(target.window, 'editor-get-snapshot')
}
