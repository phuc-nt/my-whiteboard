#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { runFileApply } from './file-apply-command'
import { runFileRead } from './file-read-command'

// Headless companion to the desktop app. Namespaced under `file` so it never
// collides with the localhost-API helper script installed by agent skills.
// Exit codes: 0 ok, 1 operation failed (validation/io), 2 usage error.

const USAGE = `Usage:
  mywb file read <path.mywb> [--json]   Print document summary (or full JSON with --json)
  mywb file apply <path.mywb> <changes.json>
                                        Apply {"put":[record...],"removed":[id...]} record-level
                                        changes, validated against the app's shape schemas
  mywb --help                           Show this help

Requires Node >= 22.5 (node:sqlite). Writes are atomic; the file is untouched
when validation fails. No file locking — do not point it at a document that is
open in the desktop app while it saves.
`

function usageExit(code: number): never {
	;(code === 0 ? process.stdout : process.stderr).write(USAGE)
	process.exit(code)
}

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		args: process.argv.slice(2),
		options: {
			json: { type: 'boolean', default: false },
			help: { type: 'boolean', default: false }
		},
		allowPositionals: true
	})

	if (values.help || positionals.length === 0) usageExit(values.help ? 0 : 2)

	const [ns, command, ...rest] = positionals
	if (ns !== 'file') usageExit(2)

	if (command === 'read' && rest.length === 1) {
		await runFileRead(rest[0], values.json)
		return
	}
	if (command === 'apply' && rest.length === 2) {
		await runFileApply(rest[0], rest[1])
		return
	}
	usageExit(2)
}

main().then(
	() => {
		// Importing tldraw keeps a live timer in the event loop outside
		// NODE_ENV=test — a finished CLI must exit explicitly. stdout writes in
		// the commands are awaited, so nothing is truncated here.
		process.exit(0)
	},
	(error: unknown) => {
		process.stderr.write(`mywb: ${error instanceof Error ? error.message : String(error)}\n`)
		process.exit(1)
	}
)
