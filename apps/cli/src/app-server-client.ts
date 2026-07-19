import { AGENT_API_SEARCH_PATH, serverInfoSchema } from '@mywb/core/agent-protocol'
import type { ServerInfo } from '@mywb/core/agent-protocol'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Finds the running desktop app via its server.json and speaks its agent API.
// Resolution order: --server-json flag > MYWB_SERVER_JSON env > the platform
// userData dir for productName "My Whiteboard" (same location the app's
// serverJsonPath() writes to).

export class AppNotRunningError extends Error {}

export function defaultServerJsonPath(): string {
	const home = homedir()
	switch (process.platform) {
		case 'darwin':
			return join(home, 'Library', 'Application Support', 'My Whiteboard', 'server.json')
		case 'win32':
			return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'My Whiteboard', 'server.json')
		default:
			return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'My Whiteboard', 'server.json')
	}
}

export function resolveServerJsonPath(flagValue?: string): string {
	return flagValue ?? process.env.MYWB_SERVER_JSON ?? defaultServerJsonPath()
}

export async function loadServerInfo(path: string): Promise<ServerInfo> {
	let raw: string
	try {
		raw = await readFile(path, 'utf8')
	} catch {
		throw new AppNotRunningError(
			`My Whiteboard is not running (no server.json at ${path}). Launch the app, or point --server-json / MYWB_SERVER_JSON at the right userData dir.`
		)
	}
	try {
		return serverInfoSchema.parse(JSON.parse(raw))
	} catch {
		throw new AppNotRunningError(
			`server.json at ${path} is unreadable (stale or truncated) — relaunch the app.`
		)
	}
}

async function post(info: ServerInfo, path: string, code: string): Promise<unknown> {
	let res: Response
	try {
		res = await fetch(`http://127.0.0.1:${info.port}${path}`, {
			method: 'POST',
			headers: { authorization: `Bearer ${info.token}`, 'content-type': 'text/plain' },
			body: code
		})
	} catch {
		throw new AppNotRunningError(
			`My Whiteboard is not running (connection refused on port ${info.port}). server.json may be stale — launch the app.`
		)
	}
	// Operator errors (401 bad token, 404 unknown doc, 413, ...) must FAIL the
	// command — agents chain on exit codes. A 200 with success:false (a JS
	// error inside exec) is a valid result envelope and passes through.
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as { error?: string } | null
		throw new Error(`HTTP ${res.status}: ${body?.error ?? res.statusText}`)
	}
	return res.json()
}

/** Run read code in the app's main-process search context. */
export function runSearch(info: ServerInfo, code: string): Promise<unknown> {
	return post(info, AGENT_API_SEARCH_PATH, code)
}

/** Run code against the live editor of an open document. */
export function runExec(info: ServerInfo, documentId: string, code: string): Promise<unknown> {
	return post(info, `/api/doc/${encodeURIComponent(documentId)}/exec`, code)
}
