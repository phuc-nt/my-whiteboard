import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite'
import { useCallback, useRef } from 'react'
import type { Editor } from 'tldraw'
import { Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import { documentAssetStore } from '../document-assets'
import { startDocumentSync, captureFullSnapshot } from '../document-sync'
import { deserializeDocument } from '../document-serialization'

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
		let stopSync: (() => void) | null = null
		let offSnapshot: (() => void) | null = null

		window.desktop
			.loadDocument()
			.then((doc) => {
				if (disposed) return
				if (doc.documentJson) {
					try {
						deserializeDocument(editor, doc.documentJson)
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
				stopSync = startDocumentSync(editor)
				offSnapshot = window.desktop.onInvoke('editor-get-snapshot', () =>
					captureFullSnapshot(editor)
				)
			})
			.catch((error) => console.error('Failed to load document:', error))

		cleanupRef.current = () => {
			disposed = true
			offSnapshot?.()
			stopSync?.()
		}
	}, [])

	return (
		<div style={{ position: 'fixed', inset: 0 }}>
			<Tldraw
				colorScheme="system"
				assetUrls={assetUrls}
				assets={documentAssetStore}
				onMount={handleMount}
			/>
		</div>
	)
}
