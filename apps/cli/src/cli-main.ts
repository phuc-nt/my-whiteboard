// The real CLI logic. cli.ts imports this dynamically AFTER installing the
// warning filter, so node:sqlite (pulled in transitively here) loads with the
// filter already in place.
import { parseArgs } from 'node:util'
import { runAppDocs, runAppExec, runAppFocus, runAppSearch, runAppSvg } from './app-commands'
import { runFileApply } from './file-apply-command'
import { MERMAID_SYNTAXES, runFileMermaid } from './file-mermaid-command'
import { runFileRead } from './file-read-command'
import { runFileScaffold } from './file-scaffold-command'

// Companion CLI to the desktop app. `file` works on .mywb files headlessly;
// `app` talks to the RUNNING desktop app over its localhost agent API.
// Exit codes: 0 ok, 1 operation failed (validation/io/app not running),
// 2 usage error.

const USAGE = `Usage:
  mywb file read <path.mywb> [--json]   Print document summary (or full JSON with --json)
  mywb file apply <path.mywb> <changes.json>
                                        Apply {"put":[record...],"removed":[id...]} record-level
                                        changes, validated against the app's shape schemas
  mywb file scaffold <model.json> <path.mywb>
                                        Build an architecture board from a model:
                                        {"title"?,"documentId"?,"components":[{name,kind,...}],
                                        "edges":[{from,to,relation}]}
  mywb file mermaid <path.mywb> [--syntax flowchart|c4]
                                        Print the board as Mermaid text (default: flowchart,
                                        renders natively in GitHub READMEs)
  mywb app docs                         List documents open in the running app (JSON)
  mywb app search [<js>|-]              Run read-only JS in the app's search context
                                        (api.getDocs/getShapes/...); code from arg or stdin
  mywb app exec <documentId> [<js>|-]   Run JS against the live editor of an open document
  mywb app svg <documentId>             Print the document's current page as an SVG (vector,
                                        diffable) — pipe to a .svg file
  mywb app focus <documentId> <shapeId> Pan/zoom the open canvas to a shape and select it
                                        (e.g. jump to a drift finding's shape id)
  mywb mcp                              Run a stdio MCP server exposing the app's
                                        canvas as tools (add with: claude mcp add)
  mywb --help                           Show this help

Options: --server-json <path> (or MYWB_SERVER_JSON) overrides where \`app\`
commands look for the running app's server.json.

Requires Node >= 22.5 (node:sqlite). \`file\` writes are atomic; the file is
untouched when validation fails. No file locking — do not \`file apply\` a
document that is open in the desktop app while it saves.
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
			help: { type: 'boolean', default: false },
			'server-json': { type: 'string' },
			syntax: { type: 'string', default: 'flowchart' }
		},
		allowPositionals: true
	})

	if (values.help || positionals.length === 0) usageExit(values.help ? 0 : 2)

	const [ns, command, ...rest] = positionals

	if (ns === 'mcp') {
		// Import lazily so `file`/`app` commands run from a vendored dist/cli.js
		// without the externalized @modelcontextprotocol/sdk on disk — only the
		// mcp subcommand needs it. Long-lived stdio server: blocks here until the
		// client disconnects, then falls through to the normal process.exit(0).
		const { startMcpServer } = await import('./mcp/mcp-server')
		await startMcpServer()
		return
	}

	if (ns === 'file') {
		if (command === 'read' && rest.length === 1) {
			await runFileRead(rest[0], values.json)
			return
		}
		if (command === 'apply' && rest.length === 2) {
			await runFileApply(rest[0], rest[1])
			return
		}
		if (command === 'scaffold' && rest.length === 2) {
			await runFileScaffold(rest[0], rest[1])
			return
		}
		if (command === 'mermaid' && rest.length === 1) {
			const syntax = values.syntax as (typeof MERMAID_SYNTAXES)[number]
			if (!MERMAID_SYNTAXES.includes(syntax)) usageExit(2)
			await runFileMermaid(rest[0], syntax)
			return
		}
		usageExit(2)
	}

	if (ns === 'app') {
		const serverJson = values['server-json']
		if (command === 'docs' && rest.length === 0) {
			await runAppDocs(serverJson)
			return
		}
		// No code arg on an interactive terminal would silently block on stdin —
		// treat it as a usage error. Piped stdin (agents) is the supported path.
		const stdinIsTty = process.stdin.isTTY === true
		if (command === 'search' && rest.length <= 1) {
			if (rest.length === 0 && stdinIsTty) usageExit(2)
			await runAppSearch(rest[0], serverJson)
			return
		}
		if (command === 'exec' && rest.length >= 1 && rest.length <= 2) {
			if (rest.length === 1 && stdinIsTty) usageExit(2)
			await runAppExec(rest[0], rest[1], serverJson)
			return
		}
		if (command === 'svg' && rest.length === 1) {
			await runAppSvg(rest[0], serverJson)
			return
		}
		if (command === 'focus' && rest.length === 2) {
			await runAppFocus(rest[0], rest[1], serverJson)
			return
		}
		usageExit(2)
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
		// parseArgs failures are usage errors (contract: exit 2), not operation
		// failures (exit 1).
		const code = (error as { code?: unknown }).code
		if (typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS')) {
			process.stderr.write(`mywb: ${error instanceof Error ? error.message : String(error)}\n`)
			usageExit(2)
		}
		process.stderr.write(`mywb: ${error instanceof Error ? error.message : String(error)}\n`)
		process.exit(1)
	}
)
