import { MYWB_FORMAT_VERSION, mywbMetadataSchema } from '@mywb/core/format'
import type { SerializedRecord } from '@mywb/core/format'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packDirectoryToMywbArchive } from '../archive/mywb-archive-writer'
import { RecordsDatabase } from '../archive/records-database'

// Shared tail of every headless .mywb producer (fixture builder, board
// scaffold): captured store records → sqlite → metadata/assets/script → packed
// archive. Callers own building the records; this owns the on-disk format.

export interface WriteMywbArchiveOptions {
	documentId: string
	appVersion: string
	/** Embed a document script; digest is stamped into metadata verbatim. */
	script?: { mainJs: string; digest: string }
}

export async function writeMywbArchiveFromRecords(
	records: SerializedRecord[],
	schemaJson: string,
	targetPath: string,
	options: WriteMywbArchiveOptions
): Promise<void> {
	const workDir = await mkdtemp(join(tmpdir(), 'mywb-headless-write-'))
	try {
		const db = new RecordsDatabase(join(workDir, 'db.sqlite'))
		try {
			db.replaceAll(records, schemaJson)
			db.checkpoint()
		} finally {
			db.close()
		}

		const metadata = mywbMetadataSchema.parse({
			formatVersion: MYWB_FORMAT_VERSION,
			appVersion: options.appVersion,
			documentId: options.documentId,
			createdAt: new Date().toISOString(),
			...(options.script ? { scriptDigest: options.script.digest } : {})
		})
		await writeFile(join(workDir, 'metadata.json'), JSON.stringify(metadata, null, 2))
		await mkdir(join(workDir, 'assets'))
		if (options.script) {
			await mkdir(join(workDir, 'script'))
			await writeFile(join(workDir, 'script', 'main.js'), options.script.mainJs)
		}

		await packDirectoryToMywbArchive(workDir, targetPath)
	} finally {
		await rm(workDir, { recursive: true, force: true })
	}
}
