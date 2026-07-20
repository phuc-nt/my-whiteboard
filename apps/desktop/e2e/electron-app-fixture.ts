import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))

// Shared helpers for launching the built app and talking to its agent API.
// Each launch uses its own throwaway userData dir (MYWB_TEST_USER_DATA), so
// tests never touch the real app state or fight the single-instance lock.

let userDataDir = ''

export interface AgentApi {
	base: string
	token: string
	search<T = unknown>(code: string): Promise<T>
	exec<T = unknown>(docId: string, code: string): Promise<{ success: boolean; result?: T; error?: string }>
	get(path: string): Promise<Response>
	post(path: string, body?: string): Promise<Response>
}

/** No-op kept for spec readability — each launch already gets a fresh dir. */
export async function resetUserData(): Promise<void> {}

export async function launchApp(
	env: Record<string, string> = {},
	/** Extra argv for the app, e.g. a .mywb path the way a shell would pass it. */
	extraArgs: string[] = []
): Promise<ElectronApplication> {
	userDataDir = await mkdtemp(join(tmpdir(), 'mywb-e2e-'))
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { ELECTRON_RUN_AS_NODE, ...cleanEnv } = process.env as Record<string, string>
	return electron.launch({
		args: [join(here, '..', 'out', 'main', 'index.js'), ...extraArgs],
		env: { ...cleanEnv, ...env, MYWB_TEST_USER_DATA: userDataDir }
	})
}

/** Remove the throwaway userData dir after a spec finishes. */
export async function cleanupUserData(): Promise<void> {
	if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
}

/** Path to the running test app's server.json (for CLI-under-test env). */
export function serverJsonPath(): string {
	return join(userDataDir, 'server.json')
}

/**
 * Shut an app down without hanging the suite. Electron + Playwright's
 * app.close() can block past its timeout on exit; race it against a hard
 * process kill so afterAll always completes.
 */
export async function shutdownApp(app: ElectronApplication): Promise<void> {
	const pid = app.process().pid
	await Promise.race([
		app.close().catch(() => {}),
		new Promise((resolve) => setTimeout(resolve, 5000))
	])
	try {
		if (pid) process.kill(pid, 'SIGKILL')
	} catch {
		// already exited
	}
	await cleanupUserData()
}

async function readServerJson(): Promise<{ port: number; token: string }> {
	// server.json is written right after the server starts listening.
	for (let attempt = 0; attempt < 40; attempt++) {
		try {
			const raw = await readFile(join(userDataDir, 'server.json'), 'utf8')
			const parsed = JSON.parse(raw)
			if (parsed.port && parsed.token) return parsed
		} catch {
			// not ready yet
		}
		await new Promise((r) => setTimeout(r, 250))
	}
	throw new Error('server.json never appeared — agent API did not start')
}

export async function connectAgentApi(): Promise<AgentApi> {
	const { port, token } = await readServerJson()
	const base = `http://localhost:${port}`
	const auth = { authorization: `Bearer ${token}` }
	const json = { ...auth, 'content-type': 'application/json' }
	return {
		base,
		token,
		async search(code) {
			const res = await fetch(`${base}/api/search`, {
				method: 'POST',
				headers: json,
				body: JSON.stringify({ code })
			})
			const data = await res.json()
			if (!data.success) throw new Error(data.error)
			return data.result
		},
		async exec(docId, code) {
			const res = await fetch(`${base}/api/doc/${docId}/exec`, {
				method: 'POST',
				headers: json,
				body: JSON.stringify({ code })
			})
			return res.json()
		},
		get: (path) => fetch(`${base}${path}`, { headers: auth }),
		post: (path, body) =>
			fetch(`${base}${path}`, { method: 'POST', headers: body ? json : auth, body })
	}
}

/** Wait until at least one document is open and return its id. */
export async function focusedDocId(api: AgentApi): Promise<string> {
	for (let attempt = 0; attempt < 40; attempt++) {
		const docs = await api.search<Array<{ id: string }>>('return await api.getDocs()')
		if (docs.length > 0) return docs[0].id
		await new Promise((r) => setTimeout(r, 250))
	}
	throw new Error('no document window opened')
}
