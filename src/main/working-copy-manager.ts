import { randomUUID } from 'crypto'
import { app } from 'electron'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type {
	InitialSnapshotPayload,
	MywbMetadata,
	RecordsDiffPayload,
	WorkingCopyState
} from '../shared/mywb-format-types'
import {
	ARCHIVE_ASSETS_DIR,
	ARCHIVE_METADATA_FILE,
	MYWB_FORMAT_VERSION,
	WORKING_COPY_STATE_FILE,
	workingCopyStateSchema
} from '../shared/mywb-format-types'
import { RecordsDatabase } from './archive/records-database'
import { extractMywbArchive } from './archive/mywb-archive-reader'
import { packDirectoryToMywbArchive } from './archive/mywb-archive-writer'

// A working copy is the live, on-disk form of an open document:
//   userData/working-copies/<documentId>/{metadata.json, db.sqlite, assets/, state.json}
// Every edit lands here (debounced diffs), so a crash never loses more than the
// debounce window. Saving packs this directory into the .mywb archive.

function workingCopiesRoot(): string {
	return join(app.getPath('userData'), 'working-copies')
}

export class WorkingCopy {
	readonly documentId: string
	readonly dir: string
	readonly db: RecordsDatabase
	#state: WorkingCopyState
	#saving = false
	#queuedDiffs: RecordsDiffPayload[] = []

	private constructor(documentId: string, dir: string, db: RecordsDatabase, state: WorkingCopyState) {
		this.documentId = documentId
		this.dir = dir
		this.db = db
		this.#state = state
	}

	static async createNew(): Promise<WorkingCopy> {
		const documentId = randomUUID()
		const dir = join(workingCopiesRoot(), documentId)
		await mkdir(join(dir, ARCHIVE_ASSETS_DIR), { recursive: true })
		const metadata: MywbMetadata = {
			formatVersion: MYWB_FORMAT_VERSION,
			appVersion: app.getVersion(),
			documentId,
			createdAt: new Date().toISOString()
		}
		await writeFile(join(dir, ARCHIVE_METADATA_FILE), JSON.stringify(metadata, null, '\t'))
		const db = new RecordsDatabase(join(dir, 'db.sqlite'))
		const copy = new WorkingCopy(documentId, dir, db, {
			documentId,
			filePath: null,
			dirty: false,
			updatedAt: Date.now()
		})
		await copy.#persistState()
		return copy
	}

	static async openFromArchive(
		archivePath: string,
		isDocumentIdInUse: (documentId: string) => boolean
	): Promise<WorkingCopy> {
		// Extract to a temp dir OUTSIDE the swept working-copies root (the
		// startup sweep must never race a half-finished extraction), read the
		// documentId, then move into place.
		const tempDir = join(app.getPath('userData'), 'extract-tmp', randomUUID())
		let metadata: MywbMetadata
		try {
			metadata = await extractMywbArchive(archivePath, tempDir)
			// documentId travels inside the archive: Save As / Finder-duplicated
			// files share one id. Never steal the directory of a live document —
			// mint a fresh identity for the incoming copy instead.
			if (isDocumentIdInUse(metadata.documentId)) {
				metadata = { ...metadata, documentId: randomUUID() }
				await writeFile(join(tempDir, ARCHIVE_METADATA_FILE), JSON.stringify(metadata, null, '\t'))
			}
			const dir = join(workingCopiesRoot(), metadata.documentId)
			await rm(dir, { recursive: true, force: true })
			await mkdir(workingCopiesRoot(), { recursive: true })
			await rename(tempDir, dir)
			await mkdir(join(dir, ARCHIVE_ASSETS_DIR), { recursive: true })
			const db = new RecordsDatabase(join(dir, 'db.sqlite'))
			const copy = new WorkingCopy(metadata.documentId, dir, db, {
				documentId: metadata.documentId,
				filePath: archivePath,
				dirty: false,
				updatedAt: Date.now()
			})
			await copy.#persistState()
			return copy
		} catch (error) {
			await rm(tempDir, { recursive: true, force: true }).catch(() => {})
			throw error
		}
	}

	/** Reattach to an existing working-copy directory (crash recovery / session restore). */
	static async openExisting(documentId: string): Promise<WorkingCopy> {
		const dir = join(workingCopiesRoot(), documentId)
		const stateRaw = await readFile(join(dir, WORKING_COPY_STATE_FILE), 'utf8')
		const state = workingCopyStateSchema.parse(JSON.parse(stateRaw))
		const db = new RecordsDatabase(join(dir, 'db.sqlite'))
		return new WorkingCopy(documentId, dir, db, state)
	}

	get filePath(): string | null {
		return this.#state.filePath
	}

	get dirty(): boolean {
		return this.#state.dirty
	}

	async applyInitialSnapshot(payload: InitialSnapshotPayload): Promise<void> {
		// Baseline write (default document records + schema); not a user edit.
		this.db.replaceAll(payload.records, payload.schemaJson)
	}

	async applyDiff(diff: RecordsDiffPayload): Promise<void> {
		if (this.#saving) {
			this.#queuedDiffs.push(diff)
			return
		}
		this.db.applyDiff(diff.put, diff.removed)
		if (!this.#state.dirty) {
			this.#state.dirty = true
			await this.#persistState()
		}
	}

	/**
	 * Pack the working copy into targetPath. `records`/`schemaJson` is the full
	 * snapshot captured from the renderer at save time — the db is rewritten
	 * from it so the archive is exactly what the user saw. Diffs arriving while
	 * packing are queued and applied afterwards (window stays dirty then).
	 */
	async saveTo(targetPath: string, snapshot: InitialSnapshotPayload): Promise<void> {
		this.#saving = true
		try {
			this.db.replaceAll(snapshot.records, snapshot.schemaJson)
			this.db.checkpoint()
			await packDirectoryToMywbArchive(this.dir, targetPath)
			this.#state.filePath = targetPath
			this.#state.dirty = false
		} finally {
			// Drain even when the pack failed: a stranded queue would replay
			// stale diffs after a LATER successful save and corrupt the copy.
			this.#saving = false
			const queued = this.#queuedDiffs
			this.#queuedDiffs = []
			for (const diff of queued) await this.applyDiff(diff)
			await this.#persistState()
		}
	}

	/** Serialized full snapshot for the renderer to hydrate from. */
	loadSnapshotJson(): string | null {
		const records = this.db.loadAllRecords()
		const schemaJson = this.db.getSchemaJson()
		if (records.length === 0 && !schemaJson) return null
		// Records without a schema must not fall through to "new document" —
		// the renderer would show an empty canvas and Save would overwrite the
		// real file. Throwing routes into the detach-from-file error path.
		if (records.length > 0 && !schemaJson) {
			throw new Error('Document database is missing its schema (corrupt working copy).')
		}
		if (!schemaJson) return null
		const store: Record<string, unknown> = {}
		for (const record of records) store[record.id] = JSON.parse(record.json)
		return JSON.stringify({ store, schema: JSON.parse(schemaJson) })
	}

	assetPath(assetId: string): string {
		// assetId comes from IPC/protocol URLs — keep it a plain file name.
		if (!/^[\w.-]+$/.test(assetId)) throw new Error(`Invalid asset id: ${assetId}`)
		return join(this.dir, ARCHIVE_ASSETS_DIR, assetId)
	}

	async storeAsset(assetId: string, bytes: Uint8Array): Promise<void> {
		// An asset landing between collectFiles and pack would be missing from
		// the archive being written — wait out an in-flight save first.
		while (this.#saving) await new Promise((resolve) => setTimeout(resolve, 25))
		await writeFile(this.assetPath(assetId), bytes)
		if (!this.#state.dirty) {
			this.#state.dirty = true
			await this.#persistState()
		}
	}

	async #persistState(): Promise<void> {
		this.#state.updatedAt = Date.now()
		await writeFile(join(this.dir, WORKING_COPY_STATE_FILE), JSON.stringify(this.#state))
	}

	/** Close the db and delete the directory (clean close or discard). */
	async dispose(): Promise<void> {
		this.db.close()
		await rm(this.dir, { recursive: true, force: true })
	}

	/** Close the db but keep files on disk (app quit with session restore). */
	detach(): void {
		this.db.close()
	}
}

/** Working copies whose state says they hold unsaved changes (crash leftovers). */
export async function listRecoverableWorkingCopies(): Promise<WorkingCopyState[]> {
	const root = workingCopiesRoot()
	let entries: string[]
	try {
		entries = await readdir(root)
	} catch {
		return []
	}
	const recoverable: WorkingCopyState[] = []
	for (const entry of entries) {
		try {
			const raw = await readFile(join(root, entry, WORKING_COPY_STATE_FILE), 'utf8')
			const state = workingCopyStateSchema.parse(JSON.parse(raw))
			if (state.dirty) recoverable.push(state)
		} catch {
			// Unreadable/foreign directory — ignore rather than block startup.
		}
	}
	return recoverable
}

/** Delete working-copy directories (used when the user declines recovery). */
export async function discardWorkingCopies(documentIds: string[]): Promise<void> {
	for (const documentId of documentIds) {
		await rm(join(workingCopiesRoot(), documentId), { recursive: true, force: true })
	}
}

/**
 * Remove leftover non-dirty working copies (e.g. after a crash of a clean
 * window). They hold nothing recoverable and would otherwise pile up forever.
 * `keepDocumentIds` protects copies belonging to windows already open.
 */
export async function cleanStaleWorkingCopies(keepDocumentIds: Set<string>): Promise<void> {
	const root = workingCopiesRoot()
	let entries: string[]
	try {
		entries = await readdir(root)
	} catch {
		return
	}
	for (const entry of entries) {
		if (keepDocumentIds.has(entry)) continue
		try {
			const raw = await readFile(join(root, entry, WORKING_COPY_STATE_FILE), 'utf8')
			const state = workingCopyStateSchema.parse(JSON.parse(raw))
			if (state.dirty) continue
		} catch {
			// Unreadable/foreign — treat as stale.
		}
		await rm(join(root, entry), { recursive: true, force: true }).catch(() => {})
	}
}
