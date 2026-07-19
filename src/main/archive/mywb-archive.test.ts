import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, sep } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	ARCHIVE_ASSETS_DIR,
	ARCHIVE_METADATA_FILE,
	MYWB_FORMAT_VERSION,
	WORKING_COPY_STATE_FILE
} from '../../shared/mywb-format-types'
import { extractMywbArchive, safeEntryPath } from './mywb-archive-reader'
import { packDirectoryToMywbArchive } from './mywb-archive-writer'
import { RecordsDatabase } from './records-database'

describe('mywb archive round-trip', () => {
	let root: string

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'mywb-archive-test-'))
	})

	afterEach(async () => {
		await rm(root, { recursive: true, force: true })
	})

	async function buildWorkingDir(): Promise<string> {
		const dir = join(root, 'working')
		await mkdir(join(dir, ARCHIVE_ASSETS_DIR), { recursive: true })
		await writeFile(
			join(dir, ARCHIVE_METADATA_FILE),
			JSON.stringify({
				formatVersion: MYWB_FORMAT_VERSION,
				appVersion: '0.1.0-test',
				documentId: 'doc-test-1',
				createdAt: new Date().toISOString()
			})
		)
		const db = new RecordsDatabase(join(dir, 'db.sqlite'))
		db.replaceAll([{ id: 'shape:a', typeName: 'shape', json: '{"id":"shape:a"}' }], '{"v":1}')
		db.checkpoint()
		db.close()
		await writeFile(join(dir, ARCHIVE_ASSETS_DIR, 'img-1.png'), Buffer.from([1, 2, 3]))
		// Working-copy internals that must NOT be packed:
		await writeFile(join(dir, WORKING_COPY_STATE_FILE), '{"private":true}')
		return dir
	}

	it('pack → extract restores records, metadata, and assets — but not state.json', async () => {
		const workingDir = await buildWorkingDir()
		const archivePath = join(root, 'doc.mywb')
		await packDirectoryToMywbArchive(workingDir, archivePath)

		const extractedDir = join(root, 'extracted')
		const metadata = await extractMywbArchive(archivePath, extractedDir)
		expect(metadata.documentId).toBe('doc-test-1')

		const db = new RecordsDatabase(join(extractedDir, 'db.sqlite'))
		expect(db.loadAllRecords().map((r) => r.id)).toEqual(['shape:a'])
		expect(db.getSchemaJson()).toBe('{"v":1}')
		db.close()

		const asset = await readFile(join(extractedDir, ARCHIVE_ASSETS_DIR, 'img-1.png'))
		expect([...asset]).toEqual([1, 2, 3])

		await expect(readFile(join(extractedDir, WORKING_COPY_STATE_FILE))).rejects.toThrow()
	})

	it('rejects a file that is not a zip archive', async () => {
		const bogusPath = join(root, 'bogus.mywb')
		await writeFile(bogusPath, 'this is not a zip')
		await expect(extractMywbArchive(bogusPath, join(root, 'out1'))).rejects.toThrow()
	})

	it('rejects an archive from a newer format version', async () => {
		const workingDir = await buildWorkingDir()
		await writeFile(
			join(workingDir, ARCHIVE_METADATA_FILE),
			JSON.stringify({
				formatVersion: MYWB_FORMAT_VERSION + 1,
				appVersion: '99.0.0',
				documentId: 'doc-future',
				createdAt: new Date().toISOString()
			})
		)
		const archivePath = join(root, 'future.mywb')
		await packDirectoryToMywbArchive(workingDir, archivePath)
		await expect(extractMywbArchive(archivePath, join(root, 'out2'))).rejects.toThrow(/newer version/)
	})

	it('rejects a zip missing the document database', async () => {
		const dir = join(root, 'no-db')
		await mkdir(dir, { recursive: true })
		await writeFile(
			join(dir, ARCHIVE_METADATA_FILE),
			JSON.stringify({
				formatVersion: MYWB_FORMAT_VERSION,
				appVersion: '0.1.0-test',
				documentId: 'doc-no-db',
				createdAt: new Date().toISOString()
			})
		)
		const archivePath = join(root, 'no-db.mywb')
		await packDirectoryToMywbArchive(dir, archivePath)
		await expect(extractMywbArchive(archivePath, join(root, 'out3'))).rejects.toThrow(/database/)
	})
})

describe('safeEntryPath (path traversal guard)', () => {
	const target = `${sep}safe${sep}target`

	it('accepts normal nested entries', () => {
		expect(safeEntryPath(target, 'assets/img.png')).toBe(join(target, 'assets', 'img.png'))
	})

	it.each(['../evil.txt', 'assets/../../evil.txt', '/etc/passwd', 'C:whatever', 'a\\b.txt'])(
		'rejects %s',
		(entryName) => {
			expect(() => safeEntryPath(target, entryName)).toThrow()
		}
	)
})
