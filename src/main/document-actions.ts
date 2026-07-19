import { BrowserWindow, dialog } from 'electron'
import type { EditorSnapshotResult } from '../shared/ipc-contract'
import { installApplicationMenu } from './menu-manager'
import { recordRecentFile } from './recent-files-manager'
import { invokeRenderer } from './renderer-invoke'
import type { WindowState } from './window-manager'
import {
	findWindowByDocumentId,
	findWindowByFilePath,
	openDocumentWindow,
	setDirty,
	setFilePath
} from './window-manager'
import { WorkingCopy } from './working-copy-manager'

// Document-level commands shared by the menu, shortcuts, and close-confirm flow.

const FILE_FILTERS = [{ name: 'My Whiteboard', extensions: ['mywb'] }]

export function newDocument(): void {
	openDocumentWindow()
}

async function showErrorDialog(window: BrowserWindow | null, message: string, error: unknown): Promise<void> {
	const detail = error instanceof Error ? error.message : String(error)
	const options = { type: 'error' as const, message, detail }
	if (window) await dialog.showMessageBox(window, options)
	else await dialog.showMessageBox(options)
}

/** Open a .mywb path into a window (dialog, Open Recent, Finder open-file). */
export async function openDocumentFromPath(filePath: string): Promise<void> {
	const existing = findWindowByFilePath(filePath)
	if (existing) {
		existing.window.focus()
		return
	}
	let workingCopy: WorkingCopy
	try {
		// Extract + validate before any window opens so a corrupt file fails
		// with a dialog instead of a broken editor.
		workingCopy = await WorkingCopy.openFromArchive(
			filePath,
			(documentId) => !!findWindowByDocumentId(documentId)
		)
	} catch (error) {
		await showErrorDialog(BrowserWindow.getFocusedWindow(), 'Could not open document', error)
		return
	}
	openDocumentWindow({ workingCopy, filePath })
	await recordRecentFile(filePath)
	await installApplicationMenu()
}

export async function openDocumentViaDialog(): Promise<void> {
	const result = await dialog.showOpenDialog({
		properties: ['openFile', 'multiSelections'],
		filters: FILE_FILTERS
	})
	if (result.canceled) return
	for (const filePath of result.filePaths) {
		await openDocumentFromPath(filePath)
	}
}

/** Save the window's document. Returns false if cancelled or already saving. */
export async function saveDocument(state: WindowState, forceSaveAs = false): Promise<boolean> {
	if (state.saving) return false
	const workingCopy = state.workingCopy
	if (!workingCopy) return false

	let targetPath = state.filePath
	if (!targetPath || forceSaveAs) {
		const result = await dialog.showSaveDialog(state.window, {
			filters: FILE_FILTERS,
			defaultPath: state.filePath ?? 'Untitled.mywb'
		})
		if (result.canceled || !result.filePath) return false
		targetPath = result.filePath
	}

	// Saving onto a file that is open in another window would leave two
	// windows claiming the same path (dedupe and last-save-wins both break).
	const collision = findWindowByFilePath(targetPath)
	if (targetPath !== state.filePath && collision && collision !== state) {
		await showErrorDialog(
			state.window,
			'Cannot save here',
			new Error(`"${targetPath}" is open in another window. Close it first or choose another name.`)
		)
		return false
	}

	state.saving = true
	try {
		// Full snapshot from the renderer = exactly what the user sees. Diffs
		// arriving while packing are queued inside the working copy and applied
		// afterwards, leaving the window dirty again if they occurred.
		const snapshot = await invokeRenderer<EditorSnapshotResult>(state.window, 'editor-get-snapshot')
		await workingCopy.saveTo(targetPath, {
			records: snapshot.records,
			schemaJson: snapshot.schemaJson
		})
		setFilePath(state, targetPath)
		setDirty(state, workingCopy.dirty)
		await recordRecentFile(targetPath)
		await installApplicationMenu()
		return true
	} finally {
		state.saving = false
	}
}

/** saveDocument for fire-and-forget callers (menu): failures surface as a dialog. */
export function saveDocumentInteractive(state: WindowState, forceSaveAs = false): void {
	saveDocument(state, forceSaveAs).catch((error) => {
		void showErrorDialog(state.window, 'Save failed', error)
	})
}

/**
 * Close-confirm flow for dirty windows: Save / Don't Save / Cancel.
 * Returns true when the window should actually close.
 */
export async function confirmCloseDirtyWindow(state: WindowState): Promise<boolean> {
	const { response } = await dialog.showMessageBox(state.window, {
		type: 'warning',
		message: 'This document has unsaved changes.',
		detail: 'Your changes will be lost if you close without saving.',
		buttons: ['Save', "Don't Save", 'Cancel'],
		defaultId: 0,
		cancelId: 2
	})
	if (response === 2) return false
	if (response === 1) {
		// Explicit user intent: the unsaved working copy must not come back
		// as crash recovery on next launch.
		state.discarded = true
		return true
	}
	try {
		// Edits made while the save was packing re-dirty the window — save
		// again (bounded) so "Save and close" doesn't drop those edits.
		for (let attempt = 0; attempt < 3; attempt++) {
			const saved = await saveDocument(state)
			if (!saved) return false
			if (!state.dirty) return true
		}
		return true
	} catch (error) {
		await showErrorDialog(state.window, 'Save failed', error)
		return false
	}
}
