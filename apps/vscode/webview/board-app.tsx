import { customShapeUtils } from '@mywb/core/shapes'
import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite'
import { useCallback, useEffect, useRef } from 'react'
import type { Editor } from 'tldraw'
import { Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import { loadMywbIntoEditor, saveEditorToMywb } from '@mywb/web-adapter/editor-bridge'
import type { LoadedMywb } from '@mywb/web-adapter/editor-bridge'

// The webview side of the custom editor. The extension host owns the file;
// this app only turns bytes into a live canvas and back:
//   host → { type: 'init', bytes }            hydrate the editor
//   this → { type: 'ready' }                  request init after mount
//   this → { type: 'rendered', shapeCount }   observable proof the canvas is up
//   this → { type: 'edited' }                 mark the document dirty
//   host → { type: 'request-save' }           serialize and answer with bytes
//   this → { type: 'save-result', bytes }

// Pass-through: formatAssetUrl only treats http(s) as absolute, so under the
// vscode-webview:// origin it would mangle the vite-resolved font/icon URLs
// (same bug as the desktop's mywb-app:// scheme).
const assetUrls = getAssetUrlsByImport((url) => url)

const vscode = (
	window as unknown as { acquireVsCodeApi(): { postMessage(message: unknown): void } }
).acquireVsCodeApi()

export function BoardApp() {
	const editorRef = useRef<Editor | null>(null)
	const loadedRef = useRef<LoadedMywb | null>(null)
	const dirtyUnsubRef = useRef<(() => void) | null>(null)

	const handleMount = useCallback((editor: Editor) => {
		editorRef.current = editor
		vscode.postMessage({ type: 'ready' })
	}, [])

	useEffect(() => {
		// tldraw hydration commits with source 'user' and flushes listener
		// history on the NEXT animation frame, so a mask flag cannot separate
		// init writes from user edits. store.listen flushes pending history
		// BEFORE adding the listener, so (re)registering it after each
		// init/revert load deterministically skips the hydration entries.
		const hookDirtyListener = (editor: Editor) => {
			dirtyUnsubRef.current?.()
			dirtyUnsubRef.current = editor.store.listen(
				() => vscode.postMessage({ type: 'edited' }),
				{ source: 'user', scope: 'document' }
			)
		}

		const onMessage = async (event: MessageEvent) => {
			const message = event.data as { type: string; bytes?: number[]; name?: string }
			const editor = editorRef.current
			if (!editor) return
			if (message.type === 'init') {
				dirtyUnsubRef.current?.()
				dirtyUnsubRef.current = null
				// VS Code's webview channel serializes messages with JSON, not
				// structured clone: a Uint8Array arrives as a plain index object.
				// Both sides therefore ship byte arrays as number[].
				const bytes = new Uint8Array(message.bytes ?? [])
				loadedRef.current = await loadMywbIntoEditor(editor, bytes, message.name ?? 'board')
				editor.zoomToFit()
				hookDirtyListener(editor)
				vscode.postMessage({
					type: 'rendered',
					shapeCount: editor.store.allRecords().filter((r) => r.typeName === 'shape').length
				})
			}
			if (message.type === 'request-save') {
				const loaded = loadedRef.current
				if (!loaded) return
				const bytes = await saveEditorToMywb(editor, loaded)
				vscode.postMessage({ type: 'save-result', bytes: Array.from(bytes) })
			}
		}
		window.addEventListener('message', onMessage)
		return () => {
			window.removeEventListener('message', onMessage)
			dirtyUnsubRef.current?.()
		}
	}, [])

	return (
		<div style={{ position: 'fixed', inset: 0 }}>
			<Tldraw assetUrls={assetUrls} shapeUtils={customShapeUtils} onMount={handleMount} />
		</div>
	)
}
