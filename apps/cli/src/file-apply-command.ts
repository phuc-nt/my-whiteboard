import { applyRecordChanges } from '@mywb/node-adapter/headless-document'
import { readFile } from 'node:fs/promises'

// `mywb file apply <path> <changes.json>` — record-level write. The changes
// envelope and every record are validated (app store schema) before the file
// is touched; on rejection the file is untouched and we exit 1.

export async function runFileApply(filePath: string, changesPath: string): Promise<void> {
	const raw = await readFile(changesPath, 'utf8')
	const changes = JSON.parse(raw)
	const result = await applyRecordChanges(filePath, changes)
	process.stdout.write(JSON.stringify(result) + '\n')
}
