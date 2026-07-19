import { electronApp, optimizer } from '@electron-toolkit/utils'
import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { basename, join } from 'path'
import type {
	DocLoadResult,
	StoreAssetRequest,
	StoreAssetResult
} from '../shared/ipc-contract'
import { RendererToMain } from '../shared/ipc-contract'
import type { InitialSnapshotPayload, RecordsDiffPayload } from '../shared/mywb-format-types'
import { AgentApiServer } from './agent-api/agent-api-server'
import { setAgentDocumentProvider } from './agent-api/agent-server-registry'
import {
	assetUrl,
	installAppProtocolHandler,
	installAssetProtocolHandler,
	registerAppSchemePrivileges
} from './app-protocols'
import {
	attachDocumentScripts,
	detachAllDocumentScripts,
	detachDocumentScripts,
	runNow
} from './document-scripts/document-script-coordinator'
import { computeScriptDigest, isDigestTrusted, trustDigest } from './document-scripts/script-trust-store'
import { ARCHIVE_SCRIPT_DIR } from '../shared/mywb-format-types'
import { confirmCloseDirtyWindow, newDocument, openDocumentFromPath } from './document-actions'
import { installApplicationMenu } from './menu-manager'
import {
	boundsForRestore,
	markSessionLaunched,
	readSession,
	writeSession
} from './session-restore-manager'
import type { WindowState } from './window-manager'
import {
	allOpenDocumentIds,
	findWindowByDocumentId,
	findWindowByFilePath,
	getWindowState,
	listWindowStates,
	openDocumentWindow,
	setConfirmCloseHandler,
	setDirty,
	setFilePath,
	setWindowClosedHandler,
	snapshotSessionWindows,
	windowCount
} from './window-manager'
import {
	WorkingCopy,
	cleanStaleWorkingCopies,
	discardWorkingCopies,
	listRecoverableWorkingCopies
} from './working-copy-manager'

// Tests launch throwaway instances with their own userData — the lock would
// make them quit immediately. In normal use a second launch would share
// userData (server.json clobber, working-copy races), so funnel it into the
// running instance instead.
if (process.env.MYWB_TEST_USER_DATA) {
	app.setPath('userData', process.env.MYWB_TEST_USER_DATA)
} else if (!app.requestSingleInstanceLock()) {
	app.quit()
}

app.on('second-instance', (_event, argv) => {
	// Focus something, and open any .mywb passed on the second instance's argv.
	const fileArg = argv.find((arg) => arg.endsWith('.mywb'))
	if (fileArg && startupComplete) void openDocumentFromPath(fileArg)
})

registerAppSchemePrivileges()

function stateForSender(event: Electron.IpcMainInvokeEvent): WindowState | undefined {
	const window = BrowserWindow.fromWebContents(event.sender)
	return window ? getWindowState(window) : undefined
}

/**
 * A document that fails to load must not stay associated with its file path:
 * the editor would look loaded-but-empty and the next Save would overwrite
 * the real file with a blank snapshot. Detach the path so Save becomes Save As.
 */
function detachFailedDocument(state: WindowState, error: unknown): void {
	setFilePath(state, null)
	setDirty(state, false)
	void dialog.showMessageBox(state.window, {
		type: 'error',
		message: 'Could not load document',
		detail: `${error instanceof Error ? error.message : String(error)}\n\nThe window was detached from the file so you cannot accidentally overwrite it. Use Save As to save elsewhere.`
	})
}

/**
 * On opening a document that carries a script, run it if already trusted;
 * otherwise ask for consent (keyed on the exact script digest). A test hook
 * (MYWB_E2E_AUTO_CONSENT=approve|deny) bypasses the native dialog under test.
 */
async function maybeRunTrustedScriptOnOpen(
	documentId: string,
	workingCopyDir: string,
	window: BrowserWindow
): Promise<void> {
	const digest = await computeScriptDigest(workingCopyDir)
	if (!digest) return
	if (await isDigestTrusted(digest)) {
		await runNow(documentId)
		return
	}

	let approved: boolean
	const testConsent = process.env.MYWB_E2E_AUTO_CONSENT
	if (testConsent === 'approve') approved = true
	else if (testConsent === 'deny') approved = false
	else {
		const { response } = await dialog.showMessageBox(window, {
			type: 'warning',
			message: 'This document contains a script.',
			detail:
				'Scripts embedded in a document can read and change its contents and run code on your computer. Only run scripts from documents you trust.',
			buttons: ['Run Script', "Don't Run"],
			defaultId: 1,
			cancelId: 1
		})
		approved = response === 0
	}

	if (approved) {
		await trustDigest(digest)
		await runNow(documentId)
	}
}

function registerIpcHandlers(): void {
	ipcMain.handle(RendererToMain.docLoad, async (event): Promise<DocLoadResult> => {
		const state = stateForSender(event)
		if (!state) return { filePath: null, documentJson: null }
		try {
			// New windows get their working copy lazily on first load.
			state.workingCopy ??= await WorkingCopy.createNew()
			const result = {
				filePath: state.filePath,
				documentJson: state.workingCopy.loadSnapshotJson()
			}
			// Wire document scripts now that the working copy exists. A script
			// arriving inside an opened file needs consent before it runs.
			attachDocumentScripts(state.workingCopy.documentId, state.window, state.workingCopy.dir)
			void maybeRunTrustedScriptOnOpen(state.workingCopy.documentId, state.workingCopy.dir, state.window)
			return result
		} catch (error) {
			detachFailedDocument(state, error)
			return { filePath: null, documentJson: null }
		}
	})

	ipcMain.handle(RendererToMain.docLoadFailed, (event, message: string) => {
		const state = stateForSender(event)
		if (state) detachFailedDocument(state, new Error(message))
	})

	ipcMain.handle(RendererToMain.docPushInitialSnapshot, async (event, payload: InitialSnapshotPayload) => {
		const state = stateForSender(event)
		if (!state?.workingCopy) return
		await state.workingCopy.applyInitialSnapshot(payload)
	})

	ipcMain.handle(RendererToMain.docPushDiff, async (event, diff: RecordsDiffPayload) => {
		const state = stateForSender(event)
		if (!state?.workingCopy) return
		await state.workingCopy.applyDiff(diff)
		setDirty(state, state.workingCopy.dirty)
	})

	ipcMain.handle(
		RendererToMain.docStoreAsset,
		async (event, request: StoreAssetRequest): Promise<StoreAssetResult> => {
			const state = stateForSender(event)
			if (!state?.workingCopy) throw new Error('No document loaded')
			await state.workingCopy.storeAsset(request.assetId, new Uint8Array(request.bytes))
			setDirty(state, true)
			return { src: assetUrl(state.workingCopy.documentId, request.assetId) }
		}
	)
}

async function persistSession(cleanExit: boolean): Promise<void> {
	await writeSession({ cleanExit, windows: snapshotSessionWindows() })
}

const documentIdInUse = (documentId: string): boolean => !!findWindowByDocumentId(documentId)

/** Crash recovery + session restore, run once at startup before any window. */
async function restoreOrRecoverStartupWindows(): Promise<void> {
	const previousSession = await readSession()
	const recoverables = await listRecoverableWorkingCopies()
	await markSessionLaunched(previousSession)

	// A dirty working copy with no owning window is unclaimed unsaved work,
	// regardless of how the last run ended — always offer it.
	if (recoverables.length > 0) {
		const { response } = await dialog.showMessageBox({
			type: 'question',
			message: 'Restore unsaved work?',
			detail: `${recoverables.length} document(s) with unsaved changes can be restored.`,
			buttons: ['Restore', 'Discard'],
			defaultId: 0,
			cancelId: 1
		})
		if (response === 0) {
			for (const recoverable of recoverables) {
				const sessionEntry = previousSession?.windows.find(
					(w) => w.documentId === recoverable.documentId
				)
				try {
					const workingCopy = await WorkingCopy.openExisting(recoverable.documentId)
					openDocumentWindow({
						workingCopy,
						filePath: recoverable.filePath,
						bounds: sessionEntry ? boundsForRestore(sessionEntry) : undefined,
						dirty: true
					})
				} catch (error) {
					await dialog.showMessageBox({
						type: 'error',
						message: 'Could not restore a document',
						detail: `${recoverable.filePath ?? 'An untitled document'} could not be recovered: ${error instanceof Error ? error.message : String(error)}`
					})
				}
			}
		} else {
			await discardWorkingCopies(recoverables.map((r) => r.documentId))
		}
	}

	// Reopen the previous session's saved documents (also after a crash — a
	// crash must not silently drop the clean windows of that session).
	for (const entry of previousSession?.windows ?? []) {
		if (!entry.filePath || findWindowByFilePath(entry.filePath)) continue
		try {
			const workingCopy = await WorkingCopy.openFromArchive(entry.filePath, documentIdInUse)
			openDocumentWindow({
				workingCopy,
				filePath: entry.filePath,
				bounds: boundsForRestore(entry)
			})
		} catch (error) {
			console.error(`Could not restore ${entry.filePath}:`, error)
		}
	}
}

const agentApiServer = new AgentApiServer()

/** Wire the Agent API to live document windows without leaking window internals. */
function installAgentDocumentProvider(): void {
	setAgentDocumentProvider({
		listOpenDocuments() {
			return listWindowStates()
				.filter((state) => state.workingCopy)
				.map((state) => ({
					id: state.workingCopy!.documentId,
					filePath: state.filePath,
					name: state.filePath ? basename(state.filePath).replace(/\.mywb$/, '') : 'Untitled',
					dirty: state.dirty,
					lastActive: state.lastActive
				}))
		},
		getTarget(documentId) {
			const state = findWindowByDocumentId(documentId)
			if (!state?.workingCopy || state.window.isDestroyed()) return null
			return { documentId, window: state.window, workingCopy: state.workingCopy }
		}
	})
}

app.whenReady().then(async () => {
	electronApp.setAppUserModelId('com.mywhiteboard.app')

	// Standard devtools shortcuts in dev, ignored in production.
	app.on('browser-window-created', (_, window) => {
		optimizer.watchWindowShortcuts(window)
	})

	setConfirmCloseHandler(async (state) => {
		const shouldClose = await confirmCloseDirtyWindow(state)
		// Cancelling the dialog during Cmd+Q aborts the quit — reset the flag
		// or every later close would take the quit branch (and a later crash
		// would skip recovery).
		if (!shouldClose && quitting) quitting = false
		return shouldClose
	})
	setWindowClosedHandler((state) => {
		const workingCopy = state.workingCopy
		if (!workingCopy) return
		detachDocumentScripts(workingCopy.documentId)
		if (state.discarded) {
			// Explicit Don't Save — never resurrect as recovery.
			void workingCopy.dispose().catch((error) => console.error('Working copy cleanup failed:', error))
		} else if (quitting) {
			// Keep files on disk for session restore / crash recovery.
			workingCopy.detach()
		} else if (workingCopy.dirty) {
			// Edits landed after the last save (queued during pack) — keep the
			// copy so recovery can offer the delta next launch.
			workingCopy.detach()
		} else {
			void workingCopy.dispose().catch((error) => console.error('Working copy cleanup failed:', error))
		}
		if (!quitting) void persistSession(false)
	})

	// Document scripts are served on the renderer's own origin (mywb-app://) so
	// module imports aren't CORS-blocked. Trust is enforced here: a script whose
	// current on-disk digest isn't trusted is never served, even if guessed.
	installAppProtocolHandler(join(import.meta.dirname, '../renderer'), async (documentId, relativeFile) => {
		const state = findWindowByDocumentId(documentId)
		if (!state?.workingCopy) return null
		const digest = await computeScriptDigest(state.workingCopy.dir)
		if (!digest || !(await isDigestTrusted(digest))) return null
		return join(state.workingCopy.dir, ARCHIVE_SCRIPT_DIR, relativeFile)
	})
	installAssetProtocolHandler((documentId, assetId) => {
		const state = findWindowByDocumentId(documentId)
		if (!state?.workingCopy) return null
		try {
			return state.workingCopy.assetPath(assetId)
		} catch {
			return null
		}
	})

	registerIpcHandlers()
	installAgentDocumentProvider()
	await installApplicationMenu()
	await restoreOrRecoverStartupWindows()
	if (windowCount() === 0) newDocument()
	await persistSession(false)

	// Crash leftovers of clean windows hold nothing recoverable — sweep them.
	const openDocumentIds = new Set(
		snapshotSessionWindows()
			.map((w) => w.documentId)
			.concat([...allOpenDocumentIds()])
	)
	await cleanStaleWorkingCopies(openDocumentIds)

	startupComplete = true
	for (const filePath of pendingOpenFiles.splice(0)) {
		void openDocumentFromPath(filePath)
	}

	// Start the agent API only after windows exist and are hydrating — an exec
	// arriving mid-restore would run against an empty editor that deserialize
	// then overwrites. The app is fully usable without it, so never block.
	await agentApiServer.start().catch((error) => {
		console.error('Agent API server failed to start:', error)
	})

	// macOS: clicking the dock icon with no windows opens a fresh document.
	app.on('activate', () => {
		if (windowCount() === 0) newDocument()
	})
})

// Finder double-click / "Open With" on .mywb files. Queued until startup
// restore/recovery finished — an early open must not race the working-copy
// sweep or the initial-window logic.
let startupComplete = false
const pendingOpenFiles: string[] = []
app.on('open-file', (event, filePath) => {
	event.preventDefault()
	if (startupComplete) void openDocumentFromPath(filePath)
	else pendingOpenFiles.push(filePath)
})

let quitting = false
let sessionWindowsAtQuit: ReturnType<typeof snapshotSessionWindows> | null = null
let cleanExitPersisted = false

app.on('before-quit', () => {
	quitting = true
	// Capture the window list while the windows still exist. cleanExit stays
	// false until will-quit — a crash between here and there must still arm
	// recovery, and a cancelled quit must not fake a clean exit.
	sessionWindowsAtQuit = snapshotSessionWindows()
	// Close file watchers so no open handle keeps the process alive at exit.
	detachAllDocumentScripts()
})

// Electron does not drain pending promises on exit: block the quit once,
// write the final session synchronously from the app's point of view, then
// quit for real.
app.on('will-quit', (event) => {
	if (cleanExitPersisted) return
	// Under test, let the app quit immediately — the deferred re-quit dance
	// confuses Playwright's app.close() and the throwaway userData is discarded
	// anyway, so a final clean session write isn't needed.
	if (process.env.MYWB_TEST_USER_DATA) {
		void agentApiServer.dispose().catch(() => {})
		return
	}
	event.preventDefault()
	Promise.all([
		writeSession({ cleanExit: true, windows: sessionWindowsAtQuit ?? [] }).catch((error) =>
			console.error('Final session write failed:', error)
		),
		// Remove server.json so a stale port/token isn't advertised to agents.
		agentApiServer.dispose().catch(() => {})
	]).finally(() => {
		cleanExitPersisted = true
		app.quit()
	})
})

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit()
})
