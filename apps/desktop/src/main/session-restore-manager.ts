import { app, screen } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { AppSession, SessionWindow } from '@mywb/core/format'
import { appSessionSchema } from '@mywb/core/format'

// session.json remembers the open windows across launches, plus a clean-exit
// marker: launch flips it to false, a normal quit writes it back as true.
// After a crash the marker is still false, which is what arms crash recovery.

function sessionPath(): string {
	return join(app.getPath('userData'), 'session.json')
}

export async function readSession(): Promise<AppSession | null> {
	try {
		const raw = await readFile(sessionPath(), 'utf8')
		return appSessionSchema.parse(JSON.parse(raw))
	} catch {
		return null
	}
}

export async function writeSession(session: AppSession): Promise<void> {
	await writeFile(sessionPath(), JSON.stringify(session, null, '\t'))
}

export async function markSessionLaunched(previous: AppSession | null): Promise<void> {
	await writeSession({ cleanExit: false, windows: previous?.windows ?? [] })
}

/** Clamp remembered bounds to a display that still exists (fall back to primary). */
export function boundsForRestore(entry: SessionWindow): Electron.Rectangle {
	const displays = screen.getAllDisplays()
	const target = displays.find((d) => d.id === entry.displayId)
	if (target) return entry.bounds
	const primary = screen.getPrimaryDisplay().workArea
	return {
		x: primary.x + Math.max(0, Math.round((primary.width - entry.bounds.width) / 2)),
		y: primary.y + Math.max(0, Math.round((primary.height - entry.bounds.height) / 2)),
		width: Math.min(entry.bounds.width, primary.width),
		height: Math.min(entry.bounds.height, primary.height)
	}
}
