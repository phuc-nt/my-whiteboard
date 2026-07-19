import { z } from 'zod'

// Schemas for everything the .mywb archive and the working-copy layer persist.
// Read paths validate with zod so a corrupt/foreign file fails loudly and early.

export const MYWB_FORMAT_VERSION = 1

/** metadata.json inside a .mywb archive. */
export const mywbMetadataSchema = z.object({
	formatVersion: z.number().int().positive(),
	appVersion: z.string(),
	documentId: z.string().min(1),
	createdAt: z.string(),
	/** sha256 of the script/ dir at save time; absent when no script. */
	scriptDigest: z.string().nullish()
})
export type MywbMetadata = z.infer<typeof mywbMetadataSchema>

/** state.json inside a working-copy directory (never packed into the archive). */
export const workingCopyStateSchema = z.object({
	documentId: z.string().min(1),
	filePath: z.string().nullable(),
	dirty: z.boolean(),
	updatedAt: z.number()
})
export type WorkingCopyState = z.infer<typeof workingCopyStateSchema>

/** One window entry in session.json. */
export const sessionWindowSchema = z.object({
	documentId: z.string().min(1),
	filePath: z.string().nullable(),
	bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
	displayId: z.number()
})
export type SessionWindow = z.infer<typeof sessionWindowSchema>

/** session.json in userData: window layout + clean-exit marker. */
export const appSessionSchema = z.object({
	cleanExit: z.boolean(),
	windows: z.array(sessionWindowSchema)
})
export type AppSession = z.infer<typeof appSessionSchema>

/** recent-files.json in userData. */
export const recentFilesSchema = z.object({
	entries: z.array(z.object({ filePath: z.string(), lastOpenedAt: z.number() }))
})
export type RecentFiles = z.infer<typeof recentFilesSchema>

/** A tldraw record serialized for IPC and SQLite storage. */
export interface SerializedRecord {
	id: string
	typeName: string
	json: string
}

/** Renderer → main incremental document change. */
export interface RecordsDiffPayload {
	put: SerializedRecord[]
	removed: string[]
}

/** Renderer → main one-time full snapshot after mount (also carries schema). */
export interface InitialSnapshotPayload {
	records: SerializedRecord[]
	schemaJson: string
}

/** Names of well-known entries inside the archive / working copy. */
export const ARCHIVE_METADATA_FILE = 'metadata.json'
export const ARCHIVE_DB_FILE = 'db.sqlite'
export const ARCHIVE_ASSETS_DIR = 'assets'
export const ARCHIVE_SCRIPT_DIR = 'script'
export const WORKING_COPY_STATE_FILE = 'state.json'
