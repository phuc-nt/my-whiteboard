import { BrowserWindow, Menu, app, dialog } from 'electron'
import { basename } from 'path'
import { installAgentSkills } from './agent-skills/skill-installer'
import {
	newDocument,
	openDocumentFromPath,
	openDocumentViaDialog,
	saveDocumentInteractive
} from './document-actions'
import { clearRecentFiles, loadRecentFiles } from './recent-files-manager'
import { getWindowState } from './window-manager'

async function runInstallAgentSkills(): Promise<void> {
	try {
		const results = await installAgentSkills()
		const installed = results.filter((r) => r.installed)
		const failed = results.filter((r) => !r.installed)
		const lines = installed.map((r) => `• ${r.host}: ${r.skillPath}`)
		if (failed.length) {
			lines.push('', 'Failed:', ...failed.map((r) => `• ${r.host}: ${r.error}`))
		}
		await dialog.showMessageBox({
			type: installed.length ? 'info' : 'warning',
			message: installed.length
				? `Installed the My Whiteboard skill for ${installed.length} agent(s).`
				: 'No agent skill directories were found.',
			detail:
				(lines.join('\n') || 'Open a coding agent (Claude Code, Codex, Cursor, Gemini) first, then try again.') +
				'\n\nStart the agent in a new session so it picks up the skill, then ask it to work with your open canvas.'
		})
	} catch (error) {
		await dialog.showMessageBox({
			type: 'error',
			message: 'Could not install agent skills',
			detail: error instanceof Error ? error.message : String(error)
		})
	}
}

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
					label: 'Install Agent Skills…',
					click: () => void runInstallAgentSkills()
				},
				{ type: 'separator' },
				{
					label: `About ${app.name}`,
					click: () => app.showAboutPanel()
				}
			]
		}
	]

	Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
