import { app } from 'electron'
import { appendFile, mkdir } from 'fs/promises'
import { join } from 'path'

// Append-only audit log of agent API traffic. Local debugging aid; also the
// paper trail for "what did the agent do to my document".

function logDir(): string {
	return join(app.getPath('userData'), 'agent-api-logs')
}

function logPath(): string {
	return join(logDir(), 'requests.log')
}

let ensured = false

export function getRequestLogPath(): string {
	return logPath()
}

export async function appendRequestLog(entry: Record<string, unknown>): Promise<void> {
	try {
		if (!ensured) {
			await mkdir(logDir(), { recursive: true })
			ensured = true
		}
		await appendFile(logPath(), JSON.stringify({ at: Date.now(), ...entry }) + '\n')
	} catch {
		// Logging must never break a request.
	}
}
