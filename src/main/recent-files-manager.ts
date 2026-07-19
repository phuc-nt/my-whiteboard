import { app } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { RecentFiles } from '../shared/mywb-format-types'
import { recentFilesSchema } from '../shared/mywb-format-types'

// Most-recently-used document paths for the File → Open Recent menu.

const MAX_RECENT_FILES = 5

function recentFilesPath(): string {
	return join(app.getPath('userData'), 'recent-files.json')
}

let cached: RecentFiles = { entries: [] }
let loaded = false

export async function loadRecentFiles(): Promise<string[]> {
	if (!loaded) {
		loaded = true
		try {
			const raw = await readFile(recentFilesPath(), 'utf8')
			cached = recentFilesSchema.parse(JSON.parse(raw))
		} catch {
			cached = { entries: [] }
		}
	}
	return cached.entries.map((entry) => entry.filePath)
}

export async function recordRecentFile(filePath: string): Promise<void> {
	await loadRecentFiles()
	cached.entries = [
		{ filePath, lastOpenedAt: Date.now() },
		...cached.entries.filter((entry) => entry.filePath !== filePath)
	].slice(0, MAX_RECENT_FILES)
	await writeFile(recentFilesPath(), JSON.stringify(cached))
	// macOS also keeps its own native recent-documents list.
	app.addRecentDocument(filePath)
}

export async function clearRecentFiles(): Promise<void> {
	cached = { entries: [] }
	loaded = true
	await writeFile(recentFilesPath(), JSON.stringify(cached))
	app.clearRecentDocuments()
}
