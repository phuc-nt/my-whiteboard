import type { BoardModel } from '@mywb/node-adapter/headless-document'
import { buildBoardFromModel } from '@mywb/node-adapter/headless-document'
import { readFile } from 'node:fs/promises'
import { writeStdout } from './write-stdout'

// `mywb file scaffold <model.json> <target.mywb>` — build a complete
// architecture board (positioned service nodes, title, relation arrows) from
// a declarative model, headlessly. Validation errors from the model or the
// store schema surface as operation failures (exit 1) via the cli-main
// error contract.

export async function runFileScaffold(modelPath: string, targetPath: string): Promise<void> {
	const model = JSON.parse(await readFile(modelPath, 'utf8')) as BoardModel
	if (!Array.isArray(model.components) || model.components.length === 0) {
		throw new Error('model needs a non-empty "components" array')
	}
	if (!Array.isArray(model.edges)) {
		throw new Error('model needs an "edges" array (may be empty)')
	}
	await buildBoardFromModel(targetPath, model)
	await writeStdout(
		`${JSON.stringify({
			target: targetPath,
			components: model.components.length,
			edges: model.edges.length
		})}\n`
	)
}
