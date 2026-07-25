import { app } from 'electron'
import { copyFile, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

// A blank canvas on first launch says nothing about what this app is for, so the
// very first run opens a small real board instead: four cards showing how an
// agent reaches the canvas, plus notes with the MCP command. It is a normal
// .mywb file opened through the normal path — no special-case rendering.

const WELCOME_RESOURCE = 'welcome.mywb'

/**
 * Path to the bundled welcome board, or null when it is missing. Packaged builds
 * carry it in resources/ (electron-builder extraResources); a dev run reads it
 * straight from the repo.
 */
function welcomeSourcePath(): string {
	return app.isPackaged
		? join(process.resourcesPath, WELCOME_RESOURCE)
		: join(import.meta.dirname, '../../resources', WELCOME_RESOURCE)
}

/**
 * A private copy of the welcome board to open, or null if it cannot be staged.
 *
 * Opening the bundled file directly would let a save write into the app's own
 * resources (and fail once installed read-only), so hand out a temp copy: the
 * user gets an ordinary document they can save wherever they like.
 */
export async function stageWelcomeBoard(): Promise<string | null> {
	try {
		const dir = await mkdtemp(join(tmpdir(), 'mywb-welcome-'))
		const target = join(dir, WELCOME_RESOURCE)
		await copyFile(welcomeSourcePath(), target)
		return target
	} catch (error) {
		// Best-effort: a missing or unreadable resource must never block startup.
		// The caller falls back to the empty document it would have opened anyway.
		console.error('Welcome board unavailable:', error)
		return null
	}
}
