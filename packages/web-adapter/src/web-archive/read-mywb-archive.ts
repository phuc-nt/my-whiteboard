import { mywbMetadataSchema } from '@mywb/core/format'
import type { MywbMetadata } from '@mywb/core/format'
import { unzipSync } from 'fflate'

// Reads a .mywb archive in the browser (fflate, in-memory). Same layout as the
// Node yauzl reader: metadata.json + db.sqlite + assets/ + optional script/.

export interface MywbArchiveContents {
	metadata: MywbMetadata
	dbBytes: Uint8Array
	/** Asset file name (relative to assets/) → bytes. */
	assets: Map<string, Uint8Array>
	/** Script file name (relative to script/) → text; absent when no script/. */
	scriptFiles?: Map<string, string>
}

const ARCHIVE_METADATA_FILE = 'metadata.json'
const ARCHIVE_DB_FILE = 'db.sqlite'
const ARCHIVE_ASSETS_PREFIX = 'assets/'
const ARCHIVE_SCRIPT_PREFIX = 'script/'

export function readMywbArchive(bytes: Uint8Array): MywbArchiveContents {
	const entries = unzipSync(bytes)
	const decoder = new TextDecoder()

	const metadataBytes = entries[ARCHIVE_METADATA_FILE]
	if (!metadataBytes) throw new Error('.mywb archive is missing metadata.json')
	const metadata = mywbMetadataSchema.parse(JSON.parse(decoder.decode(metadataBytes)))

	const dbBytes = entries[ARCHIVE_DB_FILE]
	if (!dbBytes) throw new Error('.mywb archive is missing db.sqlite')

	const assets = new Map<string, Uint8Array>()
	const scriptFiles = new Map<string, string>()
	for (const [path, content] of Object.entries(entries)) {
		// fflate returns directory entries as zero-length values with a trailing
		// slash — skip them, keep only files under the prefixes.
		if (path.endsWith('/')) continue
		if (path.startsWith(ARCHIVE_ASSETS_PREFIX)) {
			assets.set(path.slice(ARCHIVE_ASSETS_PREFIX.length), content)
		} else if (path.startsWith(ARCHIVE_SCRIPT_PREFIX)) {
			scriptFiles.set(path.slice(ARCHIVE_SCRIPT_PREFIX.length), decoder.decode(content))
		}
	}

	return {
		metadata,
		dbBytes,
		assets,
		...(scriptFiles.size > 0 ? { scriptFiles } : {})
	}
}
