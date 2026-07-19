import { customShapeUtils } from '@mywb/core/shapes'
import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from 'tldraw'
import { Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import { downloadBytes, openFile, saveAs, saveToHandle, supportsFileSystemAccess } from './file-io/file-access'
import { loadMywbIntoEditor, saveEditorToMywb } from './file-io/mywb-document'
import type { LoadedMywb } from './file-io/mywb-document'
import { startRelayClient } from './relay-client/relay-client'

// My Whiteboard on the web: mount the canvas with the custom shapes and
// open/save .mywb files via the File System Access API (Chromium) or a
// download/upload fallback (Firefox/Safari).

const assetUrls = getAssetUrlsByImport()

// Opt-in read-only Agent Gateway: when a relay URL + token are configured, the
// tab connects out and exposes the open document to agents for reading. Off by
// default — the whiteboard works standalone without any server.
const RELAY_URL = import.meta.env.VITE_RELAY_URL as string | undefined
const RELAY_TOKEN = import.meta.env.VITE_RELAY_TOKEN as string | undefined

export function App() {
	const editorRef = useRef<Editor | null>(null)
	const handleRef = useRef<FileSystemFileHandle | null>(null)
	const loadedRef = useRef<LoadedMywb | null>(null)
	const stopRelayRef = useRef<(() => void) | null>(null)
	const [fileName, setFileName] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)

	// Close the relay WebSocket if the app unmounts.
	useEffect(() => () => stopRelayRef.current?.(), [])

	const handleMount = useCallback((editor: Editor) => {
		editorRef.current = editor
		// Test hook: e2e cannot drive the native file picker, so it injects bytes
		// through the same open/save code path the buttons use.
		;(window as unknown as Record<string, unknown>).__mywbTest = {
			load: (bytes: Uint8Array, name: string) => doLoad(bytes, name),
			save: () => (loadedRef.current ? saveEditorToMywb(editor, loadedRef.current) : null)
		}
	}, [])

	const doLoad = useCallback(async (bytes: Uint8Array, name: string) => {
		const editor = editorRef.current
		if (!editor) return
		const loaded = await loadMywbIntoEditor(editor, bytes, name)
		loadedRef.current = loaded
		setFileName(name)
		// Re-register with the relay for the newly loaded document.
		if (RELAY_URL && RELAY_TOKEN) {
			stopRelayRef.current?.()
			stopRelayRef.current = startRelayClient({
				url: RELAY_URL,
				token: RELAY_TOKEN,
				documentId: loaded.metadata.documentId,
				editor
			})
		}
	}, [])

	const onOpen = useCallback(async () => {
		setBusy(true)
		try {
			const opened = await openFile()
			if (!opened) return
			handleRef.current = opened.handle
			await doLoad(opened.bytes, opened.name)
		} finally {
			setBusy(false)
		}
	}, [doLoad])

	const onSave = useCallback(async () => {
		const editor = editorRef.current
		const loaded = loadedRef.current
		if (!editor || !loaded) return
		setBusy(true)
		try {
			const bytes = await saveEditorToMywb(editor, loaded)
			if (handleRef.current) {
				await saveToHandle(handleRef.current, bytes)
			} else {
				downloadBytes(bytes, loaded.name)
			}
		} finally {
			setBusy(false)
		}
	}, [])

	const onSaveAs = useCallback(async () => {
		const editor = editorRef.current
		const loaded = loadedRef.current
		if (!editor || !loaded) return
		setBusy(true)
		try {
			const bytes = await saveEditorToMywb(editor, loaded)
			const handle = await saveAs(bytes, loaded.name)
			if (handle) {
				handleRef.current = handle
				setFileName(handle.name)
			}
		} finally {
			setBusy(false)
		}
	}, [])

	const hasDoc = fileName !== null
	return (
		<div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
			<div style={{ padding: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
				<button data-testid="open" onClick={() => void onOpen()} disabled={busy}>
					Open
				</button>
				<button data-testid="save" onClick={() => void onSave()} disabled={busy || !hasDoc}>
					Save
				</button>
				<button data-testid="save-as" onClick={() => void onSaveAs()} disabled={busy || !hasDoc}>
					Save As
				</button>
				<span data-testid="file-name">{fileName ?? 'No file'}</span>
				{!supportsFileSystemAccess() && (
					<span style={{ color: '#b8232c', fontSize: 12 }}>
						download/upload mode (no in-place save)
					</span>
				)}
			</div>
			<div style={{ flex: 1, position: 'relative' }}>
				<Tldraw
					colorScheme="system"
					assetUrls={assetUrls}
					shapeUtils={customShapeUtils}
					onMount={handleMount}
				/>
			</div>
		</div>
	)
}
