import type { MywbMetadata, SerializedRecord } from '@mywb/core/format'
import { mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSnapshot } from 'tldraw'
import { z } from 'zod'
import { extractMywbArchive } from '../archive/mywb-archive-reader'
import { packDirectoryToMywbArchive } from '../archive/mywb-archive-writer'
import { RecordsDatabase } from '../archive/records-database'
import { createHeadlessStore } from './create-headless-store'

// Record-level access to a .mywb file without the app: read everything, apply
// validated put/removed changes, save back. No editor semantics — a change is
// accepted iff the app's own store schema accepts it. The file is never
// touched until validation has passed; the rewrite lands via atomic rename.
// No file locking: callers coordinate with a running desktop app themselves.

export interface HeadlessDocument {
	metadata: MywbMetadata
	schemaJson: string | null
	records: SerializedRecord[]
}

export interface RecordChanges {
	put: Array<Record<string, unknown>>
	removed: string[]
}

const recordChangesSchema = z.object({
	put: z.array(
		z
			.record(z.string(), z.unknown())
			.refine(
				(r) => typeof r.id === 'string' && r.id.length > 0 && typeof r.typeName === 'string',
				{ message: 'each put record needs a string "id" and "typeName"' }
			)
	),
	removed: z.array(z.string().min(1))
})

/** Extract into a temp dir, hand the db to `use`, always clean up. */
async function withExtracted<T>(
	filePath: string,
	use: (workDir: string, metadata: MywbMetadata, db: RecordsDatabase) => Promise<T>
): Promise<T> {
	const workDir = await mkdtemp(join(tmpdir(), 'mywb-headless-doc-'))
	try {
		const metadata = await extractMywbArchive(filePath, workDir)
		const db = new RecordsDatabase(join(workDir, 'db.sqlite'))
		try {
			return await use(workDir, metadata, db)
		} finally {
			db.close()
		}
	} finally {
		await rm(workDir, { recursive: true, force: true })
	}
}

export async function readMywbDocument(filePath: string): Promise<HeadlessDocument> {
	return withExtracted(filePath, async (_workDir, metadata, db) => ({
		metadata,
		schemaJson: db.getSchemaJson(),
		records: db.loadAllRecords()
	}))
}

/**
 * Throws (before any write) unless the app's own store schema accepts the
 * document with the changes applied.
 */
function validateChanges(
	existing: SerializedRecord[],
	schemaJson: string | null,
	put: Array<Record<string, unknown>>
): void {
	const store = createHeadlessStore()
	if (schemaJson && existing.length > 0) {
		loadSnapshot(store, {
			store: Object.fromEntries(existing.map((r) => [r.id, JSON.parse(r.json)])),
			schema: JSON.parse(schemaJson)
		})
	}
	store.put(put as never[])
}

export async function applyRecordChanges(
	filePath: string,
	changes: RecordChanges
): Promise<{ recordCount: number }> {
	const parsed = recordChangesSchema.parse(changes)

	return withExtracted(filePath, async (workDir, _metadata, db) => {
		validateChanges(db.loadAllRecords(), db.getSchemaJson(), parsed.put)

		const serialized = parsed.put.map((record) => ({
			id: record.id as string,
			typeName: record.typeName as string,
			json: JSON.stringify(record)
		}))
		db.applyDiff(serialized, parsed.removed)
		const recordCount = db.loadAllRecords().length
		db.checkpoint()

		// Pack beside the target, then rename over it — readers never observe a
		// half-written archive.
		const stagedPath = `${filePath}.tmp-${process.pid}`
		await packDirectoryToMywbArchive(workDir, stagedPath)
		await rename(stagedPath, filePath)
		return { recordCount }
	})
}
