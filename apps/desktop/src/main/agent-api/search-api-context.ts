import vm from 'node:vm'
import {
	getDocumentBindings,
	getDocumentScreenshot,
	getDocumentShapes,
	getFocusedDocument,
	listOpenDocuments
} from './agent-server-registry'

// The `api` object exposed inside POST /api/search code. Read-oriented: list
// open documents, read their shapes/bindings, capture screenshots. Mutations
// go through /api/doc/:id/exec instead.

export interface SearchApi {
	getDocs(opts?: { name?: string }): ReturnType<typeof listOpenDocuments>
	getFocusedDoc(): ReturnType<typeof getFocusedDocument>
	getShapes(documentId: string): Promise<unknown>
	getBindings(documentId: string): Promise<unknown>
	getScreenshot(documentId: string): Promise<string>
}

function buildSearchApi(): SearchApi {
	return {
		getDocs: (opts) => listOpenDocuments(opts?.name),
		getFocusedDoc: () => getFocusedDocument(),
		getShapes: (documentId) => getDocumentShapes(documentId),
		getBindings: (documentId) => getDocumentBindings(documentId),
		getScreenshot: (documentId) => getDocumentScreenshot(documentId)
	}
}

/**
 * Run agent-provided code with the `api` object in scope. This is deliberate,
 * authenticated code execution on localhost. The vm is convenience, NOT a
 * security boundary — the token is the boundary (search is already authorized,
 * and exec grants full execution anyway). The `timeout` only bounds synchronous
 * work; awaited async ops are additionally capped below.
 */
const ASYNC_TIMEOUT_MS = 30_000

export async function runSearchCode(code: string): Promise<unknown> {
	const api = buildSearchApi()
	const context = vm.createContext({ api })
	const wrapped = `(async () => { ${code} })()`
	const result = vm.runInContext(wrapped, context, { timeout: 15_000 })
	return Promise.race([
		Promise.resolve(result),
		new Promise((_, reject) =>
			setTimeout(() => reject(new Error('Search code timed out')), ASYNC_TIMEOUT_MS)
		)
	])
}
