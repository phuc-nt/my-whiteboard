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
