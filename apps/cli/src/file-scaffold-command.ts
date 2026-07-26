import type { BoardModel } from '@mywb/node-adapter/headless-document'
import {
	applyRecordChanges,
	buildBoardFromModel,
	lintBoardLayout,
	readMywbDocument,
	updateBoardFromModel
} from '@mywb/node-adapter/headless-document'
import { readFile } from 'node:fs/promises'
import { writeStderr, writeStdout } from './write-stdout'

// `mywb file scaffold <model.json> <target.mywb>` — build a complete
// architecture board (positioned service nodes, title, relation arrows) from
// a declarative model, headlessly. Validation errors from the model or the
// store schema surface as operation failures (exit 1) via the cli-main
// error contract.
//
// With `--update` the target must already exist and is merged instead of
// rebuilt: the model's structure wins, everything the human added or moved on
// the canvas survives. That is what makes the committed model a living source
// of truth rather than a one-shot generator input.

export async function runFileScaffold(
	modelPath: string,
	targetPath: string,
	options: { update?: boolean } = {}
): Promise<void> {
	const model = JSON.parse(await readFile(modelPath, 'utf8')) as BoardModel
	if (!Array.isArray(model.components) || model.components.length === 0) {
		throw new Error('model needs a non-empty "components" array')
	}
	if (!Array.isArray(model.edges)) {
		throw new Error('model needs an "edges" array (may be empty)')
	}

	let changed: { put: number; removed: number } | undefined
	if (options.update) {
		const doc = await readMywbDocument(targetPath)
		const changes = updateBoardFromModel(doc.records, model)
		await applyRecordChanges(targetPath, changes)
		changed = { put: changes.put.length, removed: changes.removed.length }
	} else {
		await buildBoardFromModel(targetPath, model)
	}

	await writeStdout(
		`${JSON.stringify({
			target: targetPath,
			components: model.components.length,
			edges: model.edges.length,
			...(changed ? { updated: changed } : {})
		})}\n`
	)

	// Self-check only — never blocks. A human-moved card during --update is the
	// human's choice; the hard gate is the standalone `lint-layout` command.
	const written = await readMywbDocument(targetPath)
	const violations = lintBoardLayout(written.records)
	if (violations.length > 0) {
		const lines = violations.map((v) => `${v.severity} ${v.rule}: ${v.message} [${v.shapeIds.join(', ')}]`)
		await writeStderr(`lint-layout warnings:\n${lines.join('\n')}\n`)
	}
}
