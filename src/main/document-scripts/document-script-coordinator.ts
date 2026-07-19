import type { BrowserWindow } from 'electron'
import { watch, type FSWatcher } from 'fs'
import { join } from 'path'
import { ARCHIVE_SCRIPT_DIR } from '../../shared/mywb-format-types'
import { scriptUrl } from '../app-protocols'
import { invokeRenderer } from '../renderer-invoke'
import { computeScriptDigest, isDigestTrusted, trustDigest } from './script-trust-store'

// Per-document glue for document scripts: watches the working copy's script/
// dir, recomputes the digest on change, auto-trusts LOCAL edits (an edit made
// through the workspace is user-initiated on this machine), and asks the
// renderer to (re)run the script. Tracks derived status for /script-status.

export type ScriptState = 'none' | 'pending' | 'applied' | 'error'

export interface ScriptStatus {
	state: ScriptState
	digest: string | null
	appliedDigest: string | null
	lastApplyError: string | null
}

interface Coordinator {
	window: BrowserWindow
	workingCopyDir: string
	watcher: FSWatcher | null
	debounce: ReturnType<typeof setTimeout> | null
	digest: string | null
	appliedDigest: string | null
	lastApplyError: string | null
	pending: boolean
}

const coordinators = new Map<string, Coordinator>()

/** Called when a document window opens: start watching and run any script. */
export function attachDocumentScripts(
	documentId: string,
	window: BrowserWindow,
	workingCopyDir: string
): void {
	if (coordinators.has(documentId)) return
	const coordinator: Coordinator = {
		window,
		workingCopyDir,
		watcher: null,
		debounce: null,
		digest: null,
		appliedDigest: null,
		lastApplyError: null,
		pending: false
	}
	coordinators.set(documentId, coordinator)

	const scriptDir = join(workingCopyDir, ARCHIVE_SCRIPT_DIR)
	try {
		coordinator.watcher = watch(scriptDir, { recursive: true }, () => scheduleReconcile(documentId))
	} catch {
		// script/ may not exist yet; created lazily by openScriptWorkspace,
		// after which the first reconcile (triggered by the workspace call)
		// starts the watcher.
	}
	void reconcile(documentId, { localEdit: false })
}

export function detachDocumentScripts(documentId: string): void {
	const coordinator = coordinators.get(documentId)
	if (!coordinator) return
	coordinator.watcher?.close()
	if (coordinator.debounce) clearTimeout(coordinator.debounce)
	coordinators.delete(documentId)
}

/** Close every watcher (app quit) so no handles keep the process alive. */
export function detachAllDocumentScripts(): void {
	for (const documentId of [...coordinators.keys()]) detachDocumentScripts(documentId)
}

/** Ensure a watcher exists (called after the workspace creates script/). */
export function ensureWatching(documentId: string): void {
	const coordinator = coordinators.get(documentId)
	if (!coordinator || coordinator.watcher) return
	const scriptDir = join(coordinator.workingCopyDir, ARCHIVE_SCRIPT_DIR)
	try {
		coordinator.watcher = watch(scriptDir, { recursive: true }, () => scheduleReconcile(documentId))
	} catch {
		// still absent — no-op
	}
	void reconcile(documentId, { localEdit: true })
}

function scheduleReconcile(documentId: string): void {
	const coordinator = coordinators.get(documentId)
	if (!coordinator) return
	if (coordinator.debounce) clearTimeout(coordinator.debounce)
	coordinator.debounce = setTimeout(() => {
		coordinator.debounce = null
		// A filesystem edit under the workspace is a local, user-initiated
		// change → trust it automatically (consent is for scripts arriving
		// inside opened files, not edits the user drives here).
		void reconcile(documentId, { localEdit: true })
	}, 200)
}

/**
 * Recompute the digest and, if it's trusted (or we auto-trust a local edit),
 * ask the renderer to run the script. `localEdit=false` is the on-open path,
 * which requires prior consent (granted separately via the consent flow).
 */
async function reconcile(documentId: string, opts: { localEdit: boolean }): Promise<void> {
	const coordinator = coordinators.get(documentId)
	if (!coordinator || coordinator.window.isDestroyed()) return

	const digest = await computeScriptDigest(coordinator.workingCopyDir)
	coordinator.digest = digest
	if (!digest) {
		coordinator.appliedDigest = null
		coordinator.lastApplyError = null
		coordinator.pending = false
		return
	}
	if (digest === coordinator.appliedDigest) return

	if (opts.localEdit) {
		await trustDigest(digest)
	} else if (!(await isDigestTrusted(digest))) {
		// On-open path without consent — leave pending; the consent flow will
		// call runNow() after the user approves.
		coordinator.pending = true
		return
	}

	await runNow(documentId)
}

/** Run the current script in the renderer and record the outcome. */
export async function runNow(documentId: string): Promise<void> {
	const coordinator = coordinators.get(documentId)
	if (!coordinator || coordinator.window.isDestroyed() || !coordinator.digest) return
	coordinator.pending = true
	try {
		// Same-origin URL (mywb-app://), digest in the path for cache-busting.
		const result = await invokeRenderer<{ ok: boolean; error?: string }>(
			coordinator.window,
			'run-document-script',
			{ scriptUrl: scriptUrl(documentId, coordinator.digest, 'main.js') }
		)
		coordinator.appliedDigest = coordinator.digest
		coordinator.lastApplyError = result.ok ? null : (result.error ?? 'Script failed')
	} catch (error) {
		coordinator.lastApplyError = error instanceof Error ? error.message : String(error)
	} finally {
		coordinator.pending = false
	}
}

export function getScriptStatus(documentId: string): ScriptStatus {
	const coordinator = coordinators.get(documentId)
	if (!coordinator) return { state: 'none', digest: null, appliedDigest: null, lastApplyError: null }
	let state: ScriptState = 'none'
	if (!coordinator.digest) state = 'none'
	else if (coordinator.lastApplyError) state = 'error'
	else if (coordinator.pending || coordinator.digest !== coordinator.appliedDigest) state = 'pending'
	else state = 'applied'
	return {
		state,
		digest: coordinator.digest,
		appliedDigest: coordinator.appliedDigest,
		lastApplyError: coordinator.lastApplyError
	}
}

export function getWorkingCopyDir(documentId: string): string | null {
	return coordinators.get(documentId)?.workingCopyDir ?? null
}
