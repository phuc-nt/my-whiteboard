import { BrowserWindow, Menu, app } from 'electron'
import { newDocument, openDocumentViaDialog, saveDocumentInteractive } from './document-actions'
import { getWindowState } from './window-manager'

// Native application menu. File items act on the focused window; tldraw's own
// undo/redo/clipboard handling relies on the standard Edit roles being present.

function focusedState() {
	const focused = BrowserWindow.getFocusedWindow()
	return focused ? getWindowState(focused) : undefined
}

export function installApplicationMenu(): void {
	const isMac = process.platform === 'darwin'

	const template: Electron.MenuItemConstructorOptions[] = [
		...(isMac
			? [{ role: 'appMenu' as const }]
			: []),
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
