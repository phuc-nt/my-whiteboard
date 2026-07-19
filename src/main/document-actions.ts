import { BrowserWindow, dialog } from 'electron'
import type { MarkSavedResult } from '../shared/ipc-contract'
import { readDocumentFile, writeDocumentFile } from './document-file-store'
import { invokeRenderer } from './renderer-invoke'
import type { WindowState } from './window-manager'
import { findWindowByFilePath, openDocumentWindow, setDirty, setFilePath } from './window-manager'

// Document-level commands shared by the menu, shortcuts, and close-confirm flow.

const FILE_FILTERS = [{ name: 'My Whiteboard', extensions: ['mywb'] }]

export function newDocument(): void {
	openDocumentWindow(null)
}

async function showErrorDialog(window: BrowserWindow | null, message: string, error: unknown): Promise<void> {
	const detail = error instanceof Error ? error.message : String(error)
	const options = { type: 'error' as const, message, detail }
	if (window) await dialog.showMessageBox(window, options)
	else await dialog.showMessageBox(options)
}

export async function openDocumentViaDialog(): Promise<void> {
	const result = await dialog.showOpenDialog({
		properties: ['openFile', 'multiSelections'],
		filters: FILE_FILTERS
	})
	if (result.canceled) return
	for (const filePath of result.filePaths) {
		const existing = findWindowByFilePath(filePath)
		if (existing) {
			existing.window.focus()
			continue
		}
		try {
			// Validate before opening a window so a corrupt file fails with a
			// dialog instead of a broken editor.
			await readDocumentFile(filePath)
		} catch (error) {
			await showErrorDialog(BrowserWindow.getFocusedWindow(), 'Could not open document', error)
			continue
		}
		openDocumentWindow(filePath)
	}
}

/** Save the window's document. Returns false if cancelled or already saving. */
export async function saveDocument(state: WindowState, forceSaveAs = false): Promise<boolean> {
	if (state.saving) return false

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
	if (targetPath !== state.filePath && findWindowByFilePath(targetPath)) {
		await showErrorDialog(
			state.window,
			'Cannot save here',
			new Error(`"${targetPath}" is open in another window. Close it first or choose another name.`)
		)
		return false
	}

	state.saving = true
	try {
		const { snapshotJson } = await invokeRenderer<{ snapshotJson: string }>(
			state.window,
			'editor-get-snapshot'
		)
		await writeDocumentFile(targetPath, snapshotJson)
		setFilePath(state, targetPath)
		// Edits made while the write was in flight are not in the file yet —
		// the renderer knows whether anything changed since the snapshot.
		const { stillDirty } = await invokeRenderer<MarkSavedResult>(state.window, 'editor-mark-saved')
		setDirty(state, stillDirty)
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
	if (response === 1) return true
	try {
		return await saveDocument(state)
	} catch (error) {
		await showErrorDialog(state.window, 'Save failed', error)
		return false
	}
}
