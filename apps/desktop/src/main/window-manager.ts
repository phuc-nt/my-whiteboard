import { is } from '@electron-toolkit/utils'
import { BrowserWindow, screen, shell } from 'electron'
import { basename, join } from 'path'
import { RENDERER_INDEX_URL } from './app-protocols'
import type { SessionWindow } from '@mywb/core/format'
import type { WorkingCopy } from './working-copy-manager'

export interface WindowState {
	window: BrowserWindow
	/** Live on-disk form of this window's document; null until first load. */
	workingCopy: WorkingCopy | null
	/** Absolute path of the saved document, or null for a never-saved document. */
	filePath: string | null
	dirty: boolean
	/** True while a close-confirm dialog for this window is open. */
	closing: boolean
	/** True while a save for this window is in flight. */
	saving: boolean
	/** User chose Don't Save — the working copy must be deleted on close. */
	discarded: boolean
	/** Timestamp of last focus — orders getDocs() for the agent API. */
	lastActive: number
}

export function listWindowStates(): WindowState[] {
	return [...windows.values()]
}

// One window per document. Windows keyed by BrowserWindow id; a filePath maps
// to at most one window so opening the same file twice focuses the existing one.

const windows = new Map<number, WindowState>()

/** Set by main/index.ts so close-with-unsaved-changes can offer to save. */
let confirmCloseHandler: ((state: WindowState) => Promise<boolean>) | null = null
/** Set by main/index.ts to clean up the working copy after a window closes. */
let windowClosedHandler: ((state: WindowState) => void) | null = null

export function setConfirmCloseHandler(handler: (state: WindowState) => Promise<boolean>): void {
	confirmCloseHandler = handler
}

export function setWindowClosedHandler(handler: (state: WindowState) => void): void {
	windowClosedHandler = handler
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

export function findWindowByDocumentId(documentId: string): WindowState | undefined {
	for (const state of windows.values()) {
		if (state.workingCopy?.documentId === documentId) return state
	}
	return undefined
}

export function windowCount(): number {
	return windows.size
}

/** Document ids of every open window (guards the stale working-copy sweep). */
export function allOpenDocumentIds(): Set<string> {
	const ids = new Set<string>()
	for (const state of windows.values()) {
		if (state.workingCopy) ids.add(state.workingCopy.documentId)
	}
	return ids
}

/** Session entries for every window worth restoring next launch. */
export function snapshotSessionWindows(): SessionWindow[] {
	const entries: SessionWindow[] = []
	for (const state of windows.values()) {
		if (!state.workingCopy) continue
		// An untitled, untouched window isn't worth restoring.
		if (!state.filePath && !state.dirty) continue
		const bounds = state.window.getBounds()
		entries.push({
			documentId: state.workingCopy.documentId,
			filePath: state.filePath,
			bounds,
			displayId: screen.getDisplayMatching(bounds).id
		})
	}
	return entries
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

export interface OpenDocumentWindowOptions {
	/** Pre-attached working copy (open-from-archive, restore, recovery). */
	workingCopy?: WorkingCopy
	filePath?: string | null
	bounds?: Electron.Rectangle
	/** Window starts dirty (crash recovery of unsaved changes). */
	dirty?: boolean
}

/**
 * Open a document window. If the file is already open in another window,
 * that window is focused instead of opening a duplicate.
 */
export function openDocumentWindow(options: OpenDocumentWindowOptions = {}): WindowState {
	const filePath = options.filePath ?? options.workingCopy?.filePath ?? null
	if (filePath) {
		const existing = findWindowByFilePath(filePath)
		if (existing) {
			existing.window.focus()
			return existing
		}
	}

	const window = new BrowserWindow({
		width: options.bounds?.width ?? 1200,
		height: options.bounds?.height ?? 800,
		x: options.bounds?.x,
		y: options.bounds?.y,
		show: false,
		webPreferences: {
			preload: join(import.meta.dirname, '../preload/index.cjs'),
			contextIsolation: true,
			sandbox: true
		}
	})

	const state: WindowState = {
		window,
		workingCopy: options.workingCopy ?? null,
		filePath,
		dirty: false,
		closing: false,
		saving: false,
		discarded: false,
		lastActive: Date.now()
	}
	windows.set(window.id, state)
	updateWindowTitle(state)
	if (options.dirty) setDirty(state, true)

	window.on('focus', () => {
		state.lastActive = Date.now()
	})

	window.on('ready-to-show', () => window.show())

	// Headless diagnostics for automated smoke tests (MYWB_DEBUG_PROBE=1):
	// reports whether the bridge, editor DOM, and fonts came up.
	if (process.env.MYWB_DEBUG_PROBE) {
		window.webContents.on('did-finish-load', () => {
			setTimeout(() => {
				window.webContents
					.executeJavaScript(
						`JSON.stringify({ desktop: typeof window.desktop, tlContainer: !!document.querySelector('.tl-container'), fonts: document.fonts.status, fontCount: document.fonts.size, shapes: !!document.querySelector('.tl-shapes') })`
					)
					.then((result) => console.log('[probe]', result))
					.catch((error) => console.log('[probe-error]', error))
			}, 4000)
		})
	}

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
					setDirty(state, false)
					window.close()
				}
			})
			.finally(() => {
				state.closing = false
			})
	})

	window.on('closed', () => {
		windows.delete(window.id)
		windowClosedHandler?.(state)
	})

	if (is.dev && process.env.ELECTRON_RENDERER_URL) {
		window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/#/editor`)
	} else {
		// Served over the app scheme (real origin) — file:// breaks FontFace,
		// storage, and CSP 'self' semantics.
		window.loadURL(`${RENDERER_INDEX_URL}#/editor`)
	}

	return state
}
