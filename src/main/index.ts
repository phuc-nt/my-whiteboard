import { electronApp, optimizer } from '@electron-toolkit/utils'
import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import type { DocLoadResult } from '../shared/ipc-contract'
import { RendererToMain } from '../shared/ipc-contract'
import { confirmCloseDirtyWindow, newDocument } from './document-actions'
import { readDocumentFile } from './document-file-store'
import { installApplicationMenu } from './menu-manager'
import { getWindowState, setConfirmCloseHandler, setDirty, setFilePath, windowCount } from './window-manager'

function stateForSender(event: Electron.IpcMainInvokeEvent) {
	const window = BrowserWindow.fromWebContents(event.sender)
	return window ? getWindowState(window) : undefined
}

/**
 * A document that fails to load must not stay associated with its file path:
 * the editor would look loaded-but-empty and the next Save would overwrite
 * the real file with a blank snapshot. Detach the path so Save becomes Save As.
 */
function detachFailedDocument(state: ReturnType<typeof getWindowState> & object, error: unknown): void {
	setFilePath(state, null)
	setDirty(state, false)
	void dialog.showMessageBox(state.window, {
		type: 'error',
		message: 'Could not load document',
		detail: `${error instanceof Error ? error.message : String(error)}\n\nThe window was detached from the file so you cannot accidentally overwrite it. Use Save As to save elsewhere.`
	})
}

function registerIpcHandlers(): void {
	ipcMain.handle(RendererToMain.docLoad, async (event): Promise<DocLoadResult> => {
		const state = stateForSender(event)
		if (!state || !state.filePath) return { filePath: null, documentJson: null }
		try {
			return {
				filePath: state.filePath,
				documentJson: await readDocumentFile(state.filePath)
			}
		} catch (error) {
			detachFailedDocument(state, error)
			return { filePath: null, documentJson: null }
		}
	})

	ipcMain.handle(RendererToMain.docMarkDirty, (event, dirty: boolean) => {
		const state = stateForSender(event)
		if (state) setDirty(state, dirty)
	})

	ipcMain.handle(RendererToMain.docLoadFailed, (event, message: string) => {
		const state = stateForSender(event)
		if (state) detachFailedDocument(state, new Error(message))
	})
}

app.whenReady().then(() => {
	electronApp.setAppUserModelId('com.mywhiteboard.app')

	// Standard devtools shortcuts in dev, ignored in production.
	app.on('browser-window-created', (_, window) => {
		optimizer.watchWindowShortcuts(window)
	})

	setConfirmCloseHandler(confirmCloseDirtyWindow)
	registerIpcHandlers()
	installApplicationMenu()
	newDocument()

	// macOS: clicking the dock icon with no windows opens a fresh document.
	app.on('activate', () => {
		if (windowCount() === 0) newDocument()
	})
})

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit()
})
