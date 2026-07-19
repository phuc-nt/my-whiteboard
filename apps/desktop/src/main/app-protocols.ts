import { createReadStream } from 'fs'
import { readFile, stat } from 'fs/promises'
import { protocol } from 'electron'
import { extname, join, normalize, sep } from 'path'
import { Readable } from 'stream'

// Custom schemes:
//  - mywb-app://renderer/...  serves the built renderer in production. A real
//    (standard, secure) origin instead of file:// — FontFace/fetch/storage and
//    CSP 'self' all behave like a normal web origin.
//  - mywb-asset://doc/<documentId>/<assetId> serves working-copy media.

export const APP_SCHEME = 'mywb-app'
export const ASSET_SCHEME = 'mywb-asset'

export const RENDERER_INDEX_URL = `${APP_SCHEME}://renderer/index.html`

const MIME_TYPES: Record<string, string> = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.css': 'text/css',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.json': 'application/json',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2'
}

/** Must run before app.whenReady(). registerSchemesAsPrivileged is once-only. */
export function registerAppSchemePrivileges(): void {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: APP_SCHEME,
			privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
		},
		{
			scheme: ASSET_SCHEME,
			privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
		}
	])
}

async function fileResponse(filePath: string): Promise<Response> {
	const info = await stat(filePath)
	if (!info.isFile()) return new Response('Not found', { status: 404 })
	return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
		headers: {
			'content-type': MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
			'content-length': String(info.size)
		}
	})
}

/**
 * resolveScriptPath maps (documentId, relativeFile) to a trusted script file
 * path, or null. Document scripts are served from the SAME origin as the
 * renderer (mywb-app://renderer/...) because Chromium only allows cross-origin
 * module imports for http/https/data — a separate scheme would be CORS-blocked.
 */
type ScriptResolver = (documentId: string, relativeFile: string) => Promise<string | null>

/** Serve the built renderer directory (production only) + document scripts. */
export function installAppProtocolHandler(rendererDir: string, resolveScriptPath: ScriptResolver): void {
	protocol.handle(APP_SCHEME, async (request) => {
		try {
			const url = new URL(request.url)
			if (url.host !== 'renderer') return new Response('Not found', { status: 404 })
			const requested = decodeURIComponent(url.pathname)

			// Same-origin document scripts: mywb-app://renderer/__script__/<docId>/<digest>/<file>
			const scriptMatch = requested.match(/^\/__script__\/([^/]+)\/[^/]+\/(.+)$/)
			if (scriptMatch) {
				const [, documentId, relativeFile] = scriptMatch
				if (relativeFile.includes('..') || relativeFile.includes('\\')) {
					return new Response('Forbidden', { status: 403 })
				}
				const filePath = await resolveScriptPath(documentId, relativeFile)
				if (!filePath) return new Response('Not found or not trusted', { status: 404 })
				const bytes = await readFile(filePath)
				return new Response(bytes, { status: 200, headers: { 'content-type': 'text/javascript' } })
			}

			const relativePath = requested === '/' || requested === '' ? 'index.html' : requested.slice(1)
			// URL paths are untrusted: never escape the renderer directory.
			const destination = join(rendererDir, normalize(relativePath))
			if (destination !== rendererDir && !destination.startsWith(rendererDir + sep)) {
				return new Response('Forbidden', { status: 403 })
			}
			return await fileResponse(destination)
		} catch {
			return new Response('Not found', { status: 404 })
		}
	})
}

/** URL for a document script, on the renderer's own origin (no CORS). */
export function scriptUrl(documentId: string, digest: string, fileName: string): string {
	return `${APP_SCHEME}://renderer/__script__/${documentId}/${digest}/${fileName}`
}

/**
 * resolveAssetPath maps (documentId, assetId) to an absolute file path, or
 * null when the document isn't open / the id is malformed.
 */
export function installAssetProtocolHandler(
	resolveAssetPath: (documentId: string, assetId: string) => string | null
): void {
	protocol.handle(ASSET_SCHEME, async (request) => {
		try {
			const url = new URL(request.url)
			// URL shape: mywb-asset://doc/<documentId>/<assetId>
			const [, documentId, assetId] = url.pathname.split('/')
			if (url.host !== 'doc' || !documentId || !assetId) {
				return new Response('Bad asset URL', { status: 400 })
			}
			const filePath = resolveAssetPath(documentId, decodeURIComponent(assetId))
			if (!filePath) return new Response('Not found', { status: 404 })
			return await fileResponse(filePath)
		} catch {
			return new Response('Not found', { status: 404 })
		}
	})
}

export function assetUrl(documentId: string, assetId: string): string {
	return `${ASSET_SCHEME}://doc/${documentId}/${encodeURIComponent(assetId)}`
}
