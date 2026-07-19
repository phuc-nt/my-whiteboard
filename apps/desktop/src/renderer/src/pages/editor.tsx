import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite'
import { useCallback, useRef } from 'react'
import type { Editor } from 'tldraw'
import { Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import { runExecCode } from '@mywb/core/exec'
import { runDocumentScript, stopDocumentScript } from '@mywb/core/script-runtime'
import { customShapeUtils } from '@mywb/core/shapes'
import { captureFullSnapshot, deserializeDocument, startDocumentSync } from '@mywb/core/sync'
import type { DocumentSyncHandle } from '@mywb/core/sync'
import { documentAssetStore } from '../document-assets'

// Full-window tldraw editor. On mount it pulls the window's document from the
// main process, starts streaming changes to the working copy, and serves the
// full-snapshot capture used by Save.

// Bundled by Vite — the app never fetches fonts/icons/translations from a CDN.
const assetUrls = getAssetUrlsByImport()

export function EditorPage() {
	const cleanupRef = useRef<(() => void) | null>(null)

	const handleMount = useCallback((editor: Editor) => {
		cleanupRef.current?.()

		let disposed = false
		let sync: DocumentSyncHandle | null = null
		let offSnapshot: (() => void) | null = null

		// Core streams through this transport; the IPC bridge and window
		// lifecycle (pagehide flush) are this adapter's responsibility.
		const syncTransport = {
			pushInitialSnapshot: (p: Parameters<typeof window.desktop.pushInitialSnapshot>[0]) =>
				window.desktop.pushInitialSnapshot(p),
			pushDiff: (p: Parameters<typeof window.desktop.pushDiff>[0]) => window.desktop.pushDiff(p)
		}
		const onPageHide = (): void => sync?.flush()

		// The agent exec channel is safe before hydration (it acts on whatever
		// is loaded); snapshot/sync must wait for the document to load.
		const offExec = window.desktop.onInvoke('exec-code', (payload) =>
			runExecCode(editor, (payload as { code: string }).code)
		)

		const offRunScript = window.desktop.onInvoke('run-document-script', (payload) =>
			runDocumentScript(editor, (payload as { scriptUrl: string }).scriptUrl)
		)

		window.desktop
			.loadDocument()
			.then((doc) => {
				if (disposed) return
				if (doc.documentJson) {
					try {
						deserializeDocument(editor.store, doc.documentJson)
					} catch (error) {
						// Main detaches the file path so a later Save can't
						// overwrite the real document with an empty canvas.
						void window.desktop.reportLoadFailed(
							error instanceof Error ? error.message : String(error)
						)
						return
					}
				}
				// Sync AND the save-snapshot handler start only after hydration:
				// a Save answered before the document loaded would capture an
				// empty canvas and overwrite the real file with it.
				sync = startDocumentSync(editor.store, syncTransport)
				// Best-effort final flush when the window is going away.
				window.addEventListener('pagehide', onPageHide)
				offSnapshot = window.desktop.onInvoke('editor-get-snapshot', () =>
					captureFullSnapshot(editor.store)
				)
			})
			.catch((error) => console.error('Failed to load document:', error))

		cleanupRef.current = () => {
			disposed = true
			offExec()
			offRunScript()
			stopDocumentScript()
			offSnapshot?.()
			window.removeEventListener('pagehide', onPageHide)
			sync?.dispose()
		}
	}, [])

	return (
		<div style={{ position: 'fixed', inset: 0 }}>
			<Tldraw
				colorScheme="system"
				assetUrls={assetUrls}
				assets={documentAssetStore}
				shapeUtils={customShapeUtils}
				onMount={handleMount}
			/>
		</div>
	)
}
