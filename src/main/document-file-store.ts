import { randomBytes } from 'crypto'
import { readFile, rename, unlink, writeFile } from 'fs/promises'
import type { DocumentFileEnvelope } from '../shared/ipc-contract'

// Phase 1 on-disk format: a JSON envelope around the tldraw snapshot.
// Phase 2 swaps these two functions for the .mywb zip archive; callers only
// ever exchange the serialized document string, so the swap is contained here.

export async function readDocumentFile(filePath: string): Promise<string> {
	const raw = await readFile(filePath, 'utf8')
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		throw new Error(`"${filePath}" is not a valid My Whiteboard document (invalid JSON).`)
	}
	const envelope = parsed as Partial<DocumentFileEnvelope>
	if (envelope.formatVersion !== 0 || envelope.snapshot === undefined) {
		throw new Error(`"${filePath}" has an unsupported document format.`)
	}
	return JSON.stringify(envelope.snapshot)
}

export async function writeDocumentFile(filePath: string, snapshotJson: string): Promise<void> {
	const envelope: DocumentFileEnvelope = {
		formatVersion: 0,
		snapshot: JSON.parse(snapshotJson)
	}
	// Atomic write via unique temp file: concurrent saves can't interleave on
	// one temp path, and a failed rename never leaves junk at the target.
	const tempPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`
	try {
		await writeFile(tempPath, JSON.stringify(envelope), 'utf8')
		await rename(tempPath, filePath)
	} catch (error) {
		await unlink(tempPath).catch(() => {})
		throw error
	}
}
