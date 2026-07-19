import { createWriteStream } from 'fs'
import { mkdir, readFile, stat } from 'fs/promises'
import { dirname, join, normalize, sep } from 'path'
import { pipeline } from 'stream/promises'
import yauzl from 'yauzl'
import type { MywbMetadata } from '../../shared/mywb-format-types'
import {
	ARCHIVE_DB_FILE,
	ARCHIVE_METADATA_FILE,
	MYWB_FORMAT_VERSION,
	mywbMetadataSchema
} from '../../shared/mywb-format-types'

// Extracts a .mywb zip archive into a working-copy directory, then validates
// the result. Entry names are untrusted input: reject anything that would
// escape the target directory (path traversal, absolute paths, drive letters).

/** Exported for unit tests — entry names are untrusted input. */
export function safeEntryPath(targetDir: string, entryName: string): string {
	if (entryName.includes('\\')) throw new Error(`Invalid archive entry name: ${entryName}`)
	const normalized = normalize(entryName)
	if (normalized.startsWith('..') || normalized.startsWith(sep) || /^[a-zA-Z]:/.test(normalized)) {
		throw new Error(`Archive entry escapes target directory: ${entryName}`)
	}
	const destination = join(targetDir, normalized)
	if (!destination.startsWith(targetDir + sep)) {
		throw new Error(`Archive entry escapes target directory: ${entryName}`)
	}
	return destination
}

function openZip(archivePath: string): Promise<yauzl.ZipFile> {
	return new Promise((resolve, reject) => {
		yauzl.open(archivePath, { lazyEntries: true }, (error, zipfile) => {
			if (error || !zipfile) reject(error ?? new Error('Could not open archive'))
			else resolve(zipfile)
		})
	})
}

async function extractEntries(zipfile: yauzl.ZipFile, targetDir: string): Promise<void> {
	await new Promise<void>((resolve, rejectRaw) => {
		// Close the zip fd on every failure path, not just traversal rejects.
		const reject = (error: unknown): void => {
			try {
				zipfile.close()
			} catch {
				// already closed
			}
			rejectRaw(error)
		}
		zipfile.on('error', reject)
		zipfile.on('end', () => resolve())
		zipfile.on('entry', (entry: yauzl.Entry) => {
			const isDirectory = entry.fileName.endsWith('/')
			let destination: string
			try {
				destination = safeEntryPath(targetDir, entry.fileName)
			} catch (error) {
				reject(error)
				return
			}
			if (isDirectory) {
				mkdir(destination, { recursive: true })
					.then(() => zipfile.readEntry())
					.catch(reject)
				return
			}
			zipfile.openReadStream(entry, (error, readStream) => {
				if (error || !readStream) {
					reject(error ?? new Error(`Could not read archive entry ${entry.fileName}`))
					return
				}
				mkdir(dirname(destination), { recursive: true })
					.then(() => pipeline(readStream, createWriteStream(destination)))
					.then(() => zipfile.readEntry())
					.catch(reject)
			})
		})
		zipfile.readEntry()
	})
}

/**
 * Extract archivePath into targetDir (must be empty/fresh) and validate the
 * required entries. Returns the parsed archive metadata.
 */
export async function extractMywbArchive(archivePath: string, targetDir: string): Promise<MywbMetadata> {
	await mkdir(targetDir, { recursive: true })
	const zipfile = await openZip(archivePath)
	await extractEntries(zipfile, targetDir)

	let metadataRaw: string
	try {
		metadataRaw = await readFile(join(targetDir, ARCHIVE_METADATA_FILE), 'utf8')
	} catch {
		throw new Error(`"${archivePath}" is not a My Whiteboard document (missing ${ARCHIVE_METADATA_FILE}).`)
	}
	const parsed = mywbMetadataSchema.safeParse(JSON.parse(metadataRaw))
	if (!parsed.success) {
		throw new Error(`"${archivePath}" has invalid document metadata.`)
	}
	if (parsed.data.formatVersion > MYWB_FORMAT_VERSION) {
		throw new Error(
			`"${archivePath}" was created by a newer version of My Whiteboard (format v${parsed.data.formatVersion}, this app reads up to v${MYWB_FORMAT_VERSION}). Update the app to open it.`
		)
	}
	try {
		const dbInfo = await stat(join(targetDir, ARCHIVE_DB_FILE))
		if (!dbInfo.isFile() || dbInfo.size === 0) throw new Error('empty')
	} catch {
		throw new Error(`"${archivePath}" is missing its document database.`)
	}
	return parsed.data
}
