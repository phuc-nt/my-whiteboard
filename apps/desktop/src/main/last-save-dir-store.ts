import { app } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'

// Remembers the directory of the last Save As so the next Save dialog opens
// there instead of always defaulting to Documents (dogfood P6). Best-effort:
// any read/write failure just falls back to no-remembered-dir — it never blocks
// a save. Mirrors recent-files-manager's persistence pattern.

function prefsPath(): string {
	return join(app.getPath('userData'), 'save-prefs.json')
}

let cached: { lastSaveDir: string | null } | null = null

export async function getLastSaveDir(): Promise<string | null> {
	if (cached) return cached.lastSaveDir
	try {
		const raw = await readFile(prefsPath(), 'utf8')
		const parsed = JSON.parse(raw) as { lastSaveDir?: unknown }
		cached = { lastSaveDir: typeof parsed.lastSaveDir === 'string' ? parsed.lastSaveDir : null }
	} catch {
		cached = { lastSaveDir: null }
	}
	return cached.lastSaveDir
}

export async function setLastSaveDir(dir: string): Promise<void> {
	cached = { lastSaveDir: dir }
	try {
		await writeFile(prefsPath(), JSON.stringify(cached))
	} catch {
		// Best-effort — losing the preference must never break saving.
	}
}
