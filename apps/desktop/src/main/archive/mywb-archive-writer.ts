import { randomBytes } from 'crypto'
import { createWriteStream } from 'fs'
import { readdir, rename, stat, unlink } from 'fs/promises'
import { join, relative, sep } from 'path'
import yazl from 'yazl'
import { WORKING_COPY_STATE_FILE } from '../../shared/mywb-format-types'

// Packs a working-copy directory into a .mywb zip archive.
// Excluded from the archive: working-copy internals (state.json) and SQLite
// sidecar files — the db must be checkpointed by the caller before packing.

const EXCLUDED_FILES = new Set([WORKING_COPY_STATE_FILE])
const EXCLUDED_SUFFIXES = ['.sqlite-wal', '.sqlite-shm', '.tmp']

async function collectFiles(rootDir: string, dir: string, out: string[]): Promise<void> {
	const entries = await readdir(dir, { withFileTypes: true })
	for (const entry of entries) {
		const absolute = join(dir, entry.name)
		if (entry.isDirectory()) {
			await collectFiles(rootDir, absolute, out)
			continue
		}
		if (!entry.isFile()) continue
		const relativePath = relative(rootDir, absolute)
		if (EXCLUDED_FILES.has(relativePath)) continue
		if (EXCLUDED_SUFFIXES.some((suffix) => relativePath.endsWith(suffix))) continue
		out.push(relativePath)
	}
}

export async function packDirectoryToMywbArchive(workingDir: string, targetPath: string): Promise<void> {
	const files: string[] = []
	await collectFiles(workingDir, workingDir, files)
	// Zip entry names always use forward slashes regardless of platform.
	const entryName = (relativePath: string): string => relativePath.split(sep).join('/')

	const tempPath = `${targetPath}.${randomBytes(6).toString('hex')}.tmp`
	try {
		await new Promise<void>((resolve, reject) => {
			const zip = new yazl.ZipFile()
			const output = createWriteStream(tempPath)
			output.on('error', reject)
			output.on('close', () => resolve())
			zip.outputStream.on('error', reject)
			zip.outputStream.pipe(output)
			for (const relativePath of files) {
				zip.addFile(join(workingDir, relativePath), entryName(relativePath))
			}
			zip.end()
		})
		// Guard against packing an empty/uninitialized working copy.
		const packed = await stat(tempPath)
		if (packed.size === 0) throw new Error('Packed archive is empty')
		await rename(tempPath, targetPath)
	} catch (error) {
		await unlink(tempPath).catch(() => {})
		throw error
	}
}
