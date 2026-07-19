import { BrowserWindow, Menu, app } from 'electron'
import { basename } from 'path'
import {
	newDocument,
	openDocumentFromPath,
	openDocumentViaDialog,
	saveDocumentInteractive
} from './document-actions'
import { clearRecentFiles, loadRecentFiles } from './recent-files-manager'
import { getWindowState } from './window-manager'

// Native application menu. File items act on the focused window; tldraw's own
// undo/redo/clipboard handling relies on the standard Edit roles being present.
// Rebuilt (installApplicationMenu) whenever the recent-files list changes.

function focusedState() {
	const focused = BrowserWindow.getFocusedWindow()
	return focused ? getWindowState(focused) : undefined
}

async function buildOpenRecentSubmenu(): Promise<Electron.MenuItemConstructorOptions[]> {
	const recent = await loadRecentFiles()
	if (recent.length === 0) return [{ label: 'No Recent Documents', enabled: false }]
	return [
		...recent.map(
			(filePath): Electron.MenuItemConstructorOptions => ({
				label: basename(filePath),
				toolTip: filePath,
				click: () => void openDocumentFromPath(filePath)
			})
		),
		{ type: 'separator' },
		{
			label: 'Clear Menu',
			click: () => {
				void clearRecentFiles().then(() => installApplicationMenu())
			}
		}
	]
}

export async function installApplicationMenu(): Promise<void> {
	const isMac = process.platform === 'darwin'

	const template: Electron.MenuItemConstructorOptions[] = [
		...(isMac ? [{ role: 'appMenu' as const }] : []),
		{
			label: 'File',
			submenu: [
				{
					label: 'New',
					accelerator: 'CmdOrCtrl+N',
					click: () => newDocument()
				},
				{
					label: 'Open…',
					accelerator: 'CmdOrCtrl+O',
					click: () => void openDocumentViaDialog()
				},
				{
					label: 'Open Recent',
					submenu: await buildOpenRecentSubmenu()
				},
				{ type: 'separator' },
				{
					label: 'Save',
					accelerator: 'CmdOrCtrl+S',
					click: () => {
						const state = focusedState()
						if (state) saveDocumentInteractive(state)
					}
				},
				{
					label: 'Save As…',
					accelerator: 'CmdOrCtrl+Shift+S',
					click: () => {
						const state = focusedState()
						if (state) saveDocumentInteractive(state, true)
					}
				},
				{ type: 'separator' },
				{ role: 'close', accelerator: 'CmdOrCtrl+W' },
				...(isMac ? [] : [{ role: 'quit' as const }])
			]
		},
		{ role: 'editMenu' },
		{
			label: 'View',
			submenu: [
				{ role: 'reload' },
				{ role: 'toggleDevTools' },
				{ type: 'separator' },
				{ role: 'togglefullscreen' }
			]
		},
		{ role: 'windowMenu' },
		{
			role: 'help',
			submenu: [
				{
					label: `About ${app.name}`,
					click: () => app.showAboutPanel()
				}
			]
		}
	]

	Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
