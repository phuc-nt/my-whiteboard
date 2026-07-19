import { readMywbDocument } from '@mywb/node-adapter/headless-document'

// `mywb file read <path> [--json]` — data access for agents: full JSON on
// stdout with --json, otherwise a short human summary.

export async function runFileRead(filePath: string, asJson: boolean): Promise<void> {
	const doc = await readMywbDocument(filePath)

	if (asJson) {
		process.stdout.write(
			JSON.stringify(
				{
					metadata: doc.metadata,
					schemaJson: doc.schemaJson,
					records: doc.records.map((record) => ({
						id: record.id,
						typeName: record.typeName,
						record: JSON.parse(record.json)
					}))
				},
				null,
				2
			) + '\n'
		)
		return
	}

	const counts = new Map<string, number>()
	for (const record of doc.records) {
		counts.set(record.typeName, (counts.get(record.typeName) ?? 0) + 1)
	}
	const lines = [
		`document: ${doc.metadata.documentId}`,
		...[...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([t, n]) => `${t}: ${n}`)
	]
	process.stdout.write(lines.join('\n') + '\n')
}
