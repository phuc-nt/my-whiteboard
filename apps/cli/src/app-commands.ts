import { loadServerInfo, resolveServerJsonPath, runExec, runSearch } from './app-server-client'
import { writeStdout } from './write-stdout'

// `mywb app` subcommands: thin verbs over the running app's agent API. Output
// is always JSON on stdout (pipeable); human text goes to stderr.

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = []
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
	return Buffer.concat(chunks).toString('utf8')
}

/** Code comes from the arg, or stdin when absent or '-' — agents pipe long code. */
async function resolveCode(arg: string | undefined): Promise<string> {
	if (arg !== undefined && arg !== '-') return arg
	return readStdin()
}

export async function runAppDocs(serverJsonFlag?: string): Promise<void> {
	const info = await loadServerInfo(resolveServerJsonPath(serverJsonFlag))
	const reply = (await runSearch(info, 'return await api.getDocs()')) as {
		success: boolean
		result?: unknown
		error?: string
	}
	if (!reply.success) throw new Error(reply.error ?? 'search failed')
	await writeStdout(JSON.stringify(reply.result, null, 2) + '\n')
}

export async function runAppSearch(codeArg: string | undefined, serverJsonFlag?: string): Promise<void> {
	const info = await loadServerInfo(resolveServerJsonPath(serverJsonFlag))
	const reply = await runSearch(info, await resolveCode(codeArg))
	await writeStdout(JSON.stringify(reply, null, 2) + '\n')
}

export async function runAppExec(
	documentId: string,
	codeArg: string | undefined,
	serverJsonFlag?: string
): Promise<void> {
	const info = await loadServerInfo(resolveServerJsonPath(serverJsonFlag))
	const reply = await runExec(info, documentId, await resolveCode(codeArg))
	await writeStdout(JSON.stringify(reply, null, 2) + '\n')
}

/** SVG string that captures the current page as vector art. Shared verbatim
 * by the CLI and the MCP export_svg tool so both stay in sync. */
export const SVG_EXEC = `const ids = [...editor.getCurrentPageShapeIds()]
if (ids.length === 0) throw new Error('document has no shapes to export')
const out = await editor.getSvgString(ids, { background: true })
if (!out?.svg) throw new Error('getSvgString returned no svg')
return out.svg`

export async function runAppSvg(documentId: string, serverJsonFlag?: string): Promise<void> {
	const info = await loadServerInfo(resolveServerJsonPath(serverJsonFlag))
	const reply = (await runExec(info, documentId, SVG_EXEC)) as {
		success: boolean
		result?: string
		error?: string
	}
	if (!reply.success) throw new Error(reply.error ?? 'svg export failed')
	await writeStdout(reply.result ?? '')
}

/** Move the app's camera to a shape and select it. Selection = highlight. */
export function focusExec(shapeId: string): string {
	return `const s = editor.getShape(${JSON.stringify(shapeId)})
if (!s) throw new Error('no shape ' + ${JSON.stringify(shapeId)})
editor.select(${JSON.stringify(shapeId)})
editor.zoomToSelection({ animation: { duration: 400 } })
return { focused: ${JSON.stringify(shapeId)} }`
}

export async function runAppFocus(
	documentId: string,
	shapeId: string,
	serverJsonFlag?: string
): Promise<void> {
	const info = await loadServerInfo(resolveServerJsonPath(serverJsonFlag))
	const reply = (await runExec(info, documentId, focusExec(shapeId))) as {
		success: boolean
		result?: unknown
		error?: string
	}
	// A missing shape is a real failure (exit 1), not a value to print — the
	// caller asked to focus something that isn't there.
	if (!reply.success) throw new Error(reply.error ?? 'focus failed')
	await writeStdout(JSON.stringify(reply.result) + '\n')
}
