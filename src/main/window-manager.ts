import { is } from '@electron-toolkit/utils'
import { BrowserWindow, shell } from 'electron'
import { basename, join } from 'path'

export interface WindowState {
	window: BrowserWindow
	/** Absolute path of the saved document, or null for a never-saved document. */
	filePath: string | null
	dirty: boolean
	/** True while a close-confirm dialog for this window is open. */
	closing: boolean
	/** True while a save for this window is in flight. */
	saving: boolean
}

// One window per document. Windows keyed by BrowserWindow id; a filePath maps
// to at most one window so opening the same file twice focuses the existing one.

const windows = new Map<number, WindowState>()

/** Set by main/index.ts so close-with-unsaved-changes can offer to save. */
let confirmCloseHandler: ((state: WindowState) => Promise<boolean>) | null = null

export function setConfirmCloseHandler(handler: (state: WindowState) => Promise<boolean>): void {
	confirmCloseHandler = handler
}

export function getWindowState(window: BrowserWindow): WindowState | undefined {
	return windows.get(window.id)
}

export function getFocusedWindowState(): WindowState | undefined {
	const focused = BrowserWindow.getFocusedWindow()
	return focused ? windows.get(focused.id) : undefined
}

export function findWindowByFilePath(filePath: string): WindowState | undefined {
	for (const state of windows.values()) {
		if (state.filePath === filePath) return state
	}
	return undefined
}

export function windowCount(): number {
	return windows.size
}

export function setFilePath(state: WindowState, filePath: string | null): void {
	state.filePath = filePath
	updateWindowTitle(state)
}

export function setDirty(state: WindowState, dirty: boolean): void {
	if (state.dirty === dirty) return
	state.dirty = dirty
	// macOS shows the dot in the close button; the title suffix covers the rest.
	state.window.setDocumentEdited(dirty)
	updateWindowTitle(state)
}

function documentDisplayName(state: WindowState): string {
	if (!state.filePath) return 'Untitled'
	return basename(state.filePath).replace(/\.mywb$/, '')
}

function updateWindowTitle(state: WindowState): void {
	const suffix = state.dirty ? ' — Edited' : ''
	state.window.setTitle(`${documentDisplayName(state)}${suffix}`)
	if (state.filePath) state.window.setRepresentedFilename(state.filePath)
}

/**
 * Open a document window. If the file is already open in another window,
 * that window is focused instead of opening a duplicate.
 */
export function openDocumentWindow(filePath: string | null): WindowState {
	if (filePath) {
		const existing = findWindowByFilePath(filePath)
		if (existing) {
			existing.window.focus()
			return existing
		}
	}

	const window = new BrowserWindow({
		width: 1200,
		height: 800,
		show: false,
		webPreferences: {
			preload: join(import.meta.dirname, '../preload/index.cjs'),
			contextIsolation: true,
			sandbox: true
		}
	})

	const state: WindowState = { window, filePath, dirty: false, closing: false, saving: false }
	windows.set(window.id, state)
	updateWindowTitle(state)

	window.on('ready-to-show', () => window.show())

	// The renderer is a local document editor: never navigate anywhere, and
	// only hand http(s) links to the OS browser — document content can carry
	// arbitrary URLs (file:, smb:, app schemes) that must not launch handlers.
	window.webContents.on('will-navigate', (event) => event.preventDefault())
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:$/.test(new URL(url).protocol)) void shell.openExternal(url)
		return { action: 'deny' }
	})

	window.on('close', (event) => {
		if (!state.dirty || !confirmCloseHandler) return
		event.preventDefault()
		// A second close while the confirm dialog is open must not stack
		// another dialog on the same window.
		if (state.closing) return
		state.closing = true
		confirmCloseHandler(state)
			.then((shouldClose) => {
				if (shouldClose) {
					state.dirty = false
					window.close()
				}
			})
			.finally(() => {
				state.closing = false
			})
	})

	window.on('closed', () => {
		windows.delete(window.id)
	})

	if (is.dev && process.env.ELECTRON_RENDERER_URL) {
		window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/#/editor`)
	} else {
		window.loadFile(join(import.meta.dirname, '../renderer/index.html'), { hash: '/editor' })
	}

	return state
}
