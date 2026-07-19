import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite'
import { useCallback, useRef } from 'react'
import type { Editor } from 'tldraw'
import { Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import { deserializeDocument, serializeDocument } from '../document-serialization'

// Full-window tldraw editor. On mount it pulls the window's document from the
// main process, then serves snapshot requests and reports dirty state back.

// Bundled by Vite — the app never fetches fonts/icons/translations from a CDN.
const assetUrls = getAssetUrlsByImport()

export function EditorPage() {
	const cleanupRef = useRef<(() => void) | null>(null)

	const handleMount = useCallback((editor: Editor) => {
		cleanupRef.current?.()

		let disposed = false
		// Tracks edits made after the last snapshot handed to main — those are
		// not in the saved file, so the window must stay dirty after that save.
		let changedSinceSnapshot = false
		let dirtyReported = false

		window.desktop
			.loadDocument()
			.then((doc) => {
				if (disposed || !doc.documentJson) return
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
				// Loading the saved document must not count as an edit.
				changedSinceSnapshot = false
				dirtyReported = false
				void window.desktop.markDirty(false)
			})
			.catch((error) => console.error('Failed to load document:', error))

		const offSnapshot = window.desktop.onInvoke('editor-get-snapshot', () => {
			const snapshotJson = serializeDocument(editor)
			changedSinceSnapshot = false
			return { snapshotJson }
		})

		const offMarkSaved = window.desktop.onInvoke('editor-mark-saved', () => {
			if (!changedSinceSnapshot) dirtyReported = false
			return { stillDirty: changedSinceSnapshot }
		})

		// Only user-originated document changes mark the window dirty —
		// camera moves and presence updates don't. Reported on transition
		// only, not per store commit.
		const stopListening = editor.store.listen(
			() => {
				changedSinceSnapshot = true
				if (!dirtyReported) {
					dirtyReported = true
					void window.desktop.markDirty(true)
				}
			},
			{ scope: 'document', source: 'user' }
		)

		cleanupRef.current = () => {
			disposed = true
			offSnapshot()
			offMarkSaved()
			stopListening()
		}
	}, [])

	return (
		<div style={{ position: 'fixed', inset: 0 }}>
			<Tldraw colorScheme="system" assetUrls={assetUrls} onMount={handleMount} />
		</div>
	)
}
