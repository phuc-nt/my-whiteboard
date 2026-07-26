import { lintBoardLayout, readMywbDocument } from '@mywb/node-adapter/headless-document'
import { writeStdout } from './write-stdout'

// `mywb file lint-layout <board.mywb> [--json]` — mechanical geometry checks:
// overlapping cards, arrows crossing unrelated cards, cards sticking out of
// their frame. Catches what dagre auto-layout can silently get wrong; human
// eyes were the only check for this before. Reports only — never writes.
//
// Returns true when the board has no ERROR violations, so the caller can pick
// the exit code (0 clean, 2 errors found — distinct from 1, an operation
// failure). warn-severity violations (arrow-through-card) print but never
// fail the exit code: dense boards cross arrows over cards legitimately, so
// warn is a hint for a human, not a gate.

export async function runFileLintLayout(boardPath: string, asJson: boolean): Promise<boolean> {
	const doc = await readMywbDocument(boardPath)
	const violations = lintBoardLayout(doc.records)
	const clean = violations.every((v) => v.severity !== 'error')

	if (asJson) {
		await writeStdout(`${JSON.stringify({ violations })}\n`)
		return clean
	}

	if (violations.length === 0) {
		await writeStdout('lint-layout: clean\n')
		return true
	}
	const lines = violations.map((v) => `${v.severity} ${v.rule}: ${v.message} [${v.shapeIds.join(', ')}]`)
	await writeStdout(lines.join('\n') + '\n')
	return clean
}
