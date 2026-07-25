import { extractBoardModel, readMywbDocument } from '@mywb/node-adapter/headless-document'
import { writeFile } from 'node:fs/promises'
import { writeStdout } from './write-stdout'

// `mywb file model extract <board.mywb> <model.json|->` — read the board back
// into its declarative model. This is what makes the model canonical: extract
// once from the board you already approved, commit the JSON, then edit the model
// and re-render with `file scaffold --update`.
//
// `-` writes to stdout so a drift-checking agent can diff a board against its
// committed model in one pipe, with no temp file.

export async function runFileModelExtract(boardPath: string, targetPath: string): Promise<void> {
	const doc = await readMywbDocument(boardPath)
	const model = extractBoardModel(doc.records)
	// The board's own document id, so a re-scaffold keeps writing the same
	// document rather than minting a new one.
	model.documentId = doc.metadata.documentId
	const json = `${JSON.stringify(model, null, '\t')}\n`

	if (targetPath === '-') {
		await writeStdout(json)
		return
	}
	await writeFile(targetPath, json, 'utf8')
	await writeStdout(
		`${JSON.stringify({
			target: targetPath,
			components: model.components.length,
			edges: model.edges.length,
			groups: model.groups?.length ?? 0
		})}\n`
	)
}
