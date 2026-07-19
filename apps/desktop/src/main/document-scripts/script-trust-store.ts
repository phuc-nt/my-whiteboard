import { createHash } from 'crypto'
import { app } from 'electron'
import { readFile, readdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { ARCHIVE_SCRIPT_DIR } from '@mywb/core/format'

// A document script runs only if the user has consented to its exact bytes.
// Consent is keyed by the sha256 digest of the whole script/ directory, so any
// edit to the script invalidates consent and re-prompts.

function trustStorePath(): string {
	return join(app.getPath('userData'), 'script-trust.json')
}

/** sha256 over every file under a working copy's script/ dir, path-sorted. */
export async function computeScriptDigest(workingCopyDir: string): Promise<string | null> {
	const scriptDir = join(workingCopyDir, ARCHIVE_SCRIPT_DIR)
	let entries: string[]
	try {
		entries = (await readdir(scriptDir, { recursive: true, withFileTypes: true }))
			.filter((e) => e.isFile())
			.map((e) => join(e.parentPath, e.name))
			.sort()
	} catch {
		return null
	}
	if (entries.length === 0) return null
	const hash = createHash('sha256')
	for (const filePath of entries) {
		// Include the relative path so a rename changes the digest.
		hash.update(filePath.slice(scriptDir.length))
		hash.update(await readFile(filePath))
	}
	return hash.digest('hex')
}

async function readTrusted(): Promise<Set<string>> {
	try {
		const parsed = JSON.parse(await readFile(trustStorePath(), 'utf8'))
		return new Set(Array.isArray(parsed.trusted) ? parsed.trusted : [])
	} catch {
		return new Set()
	}
}

export async function isDigestTrusted(digest: string): Promise<boolean> {
	return (await readTrusted()).has(digest)
}

export async function trustDigest(digest: string): Promise<void> {
	const trusted = await readTrusted()
	if (trusted.has(digest)) return
	trusted.add(digest)
	await writeFile(trustStorePath(), JSON.stringify({ trusted: [...trusted] }, null, '\t'))
}
