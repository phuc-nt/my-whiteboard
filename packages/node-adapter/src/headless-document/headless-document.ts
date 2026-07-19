import type { MywbMetadata, SerializedRecord } from '@mywb/core/format'
import { captureFullSnapshot } from '@mywb/core/sync'
import { mkdtemp, rm } from 'node:fs/promises'
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
 * document with the changes applied. Two layers: per-record schema validation
 * (store.put throws on bad props) and a structural pass — the changed document
 * is run through the store's own integrity healer; if healing would alter
 * anything (deleted page, orphaned shapes, dangling parentId), the change is
 * rejected instead of persisting a board the app would silently repair.
 */
function validateChanges(
	existing: SerializedRecord[],
	schemaJson: string | null,
	put: Array<Record<string, unknown>>,
	removed: string[]
): void {
	if (!schemaJson) {
		throw new Error('document has no schema (corrupt file) — re-save it in the app first')
	}
	const store = createHeadlessStore()
	// The put records were authored against THIS library's schema; refuse to
	// mix them into a file written under a different schema version.
	const currentSchemaJson = JSON.stringify(store.schema.serialize())
	if (JSON.stringify(JSON.parse(schemaJson)) !== currentSchemaJson) {
		throw new Error(
			'document schema differs from this tool\'s tldraw version — re-save the file in the app or update the CLI'
		)
	}
	if (existing.length > 0) {
		loadSnapshot(store, {
			store: Object.fromEntries(existing.map((r) => [r.id, JSON.parse(r.json)])),
			schema: JSON.parse(schemaJson)
		})
	}
	store.remove(removed as never[])
	store.put(put as never[])

	const before = captureFullSnapshot(store)
	;(store as unknown as { ensureStoreIsUsable(): void }).ensureStoreIsUsable()
	const after = captureFullSnapshot(store)
	const key = (records: SerializedRecord[]) =>
		records
			.map((r) => `${r.id}:${r.json}`)
			.sort()
			.join('\n')
	if (key(before.records) !== key(after.records)) {
		throw new Error(
			'changes leave the document structurally broken (missing page/document or orphaned shapes) — rejected'
		)
	}

	// The healer does not chase references — check them explicitly: a shape's
	// parent and a binding's endpoints must exist in the final document.
	const ids = new Set(before.records.map((r) => r.id))
	for (const record of before.records) {
		const parsed = JSON.parse(record.json) as Record<string, unknown>
		if (record.typeName === 'shape' && typeof parsed.parentId === 'string' && !ids.has(parsed.parentId)) {
			throw new Error(`shape ${record.id} has a dangling parentId ${parsed.parentId} — rejected`)
		}
		if (record.typeName === 'binding') {
			for (const end of ['fromId', 'toId'] as const) {
				if (typeof parsed[end] === 'string' && !ids.has(parsed[end] as string)) {
					throw new Error(`binding ${record.id} references missing shape ${parsed[end]} — rejected`)
				}
			}
		}
	}
}

export async function applyRecordChanges(
	filePath: string,
	changes: RecordChanges
): Promise<{ recordCount: number }> {
	const parsed = recordChangesSchema.parse(changes)

	return withExtracted(filePath, async (workDir, _metadata, db) => {
		validateChanges(db.loadAllRecords(), db.getSchemaJson(), parsed.put, parsed.removed)

		const serialized = parsed.put.map((record) => ({
			id: record.id as string,
			typeName: record.typeName as string,
			json: JSON.stringify(record)
		}))
		db.applyDiff(serialized, parsed.removed)
		const recordCount = db.loadAllRecords().length
		db.checkpoint()

		// The writer itself stages to a temp file and renames, so readers never
		// observe a half-written archive.
		await packDirectoryToMywbArchive(workDir, filePath)
		return { recordCount }
	})
}
