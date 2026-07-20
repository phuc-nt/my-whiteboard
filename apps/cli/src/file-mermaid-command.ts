import type { MermaidSyntax } from '@mywb/core/mermaid-export'
import { exportBoardToMermaid } from '@mywb/core/mermaid-export'
import { readMywbDocument } from '@mywb/node-adapter/headless-document'
import { writeStdout } from './write-stdout'

// `mywb file mermaid <board.mywb> [--syntax flowchart|c4]` — print the board
// as Mermaid text for READMEs and docs. Deterministic: same board, same text.

export const MERMAID_SYNTAXES: readonly MermaidSyntax[] = ['flowchart', 'c4']

export async function runFileMermaid(boardPath: string, syntax: MermaidSyntax): Promise<void> {
	const doc = await readMywbDocument(boardPath)
	await writeStdout(exportBoardToMermaid(doc.records, { syntax }))
}
