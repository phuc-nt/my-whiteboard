import { runExecCode } from '@mywb/core/exec'
import { customShapeUtils } from '@mywb/core/shapes'
import { MemoryRecordStore } from '@mywb/core/storage'
import { startDocumentSync } from '@mywb/core/sync'
import type { DocumentSyncHandle } from '@mywb/core/sync'
import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite'
import { useCallback, useRef, useState } from 'react'
import type { Editor, TLShapePartial } from 'tldraw'
import { createShapeId, Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import type { ServiceNodeShape } from '@mywb/core/shapes'

// Smoke proof that @mywb/core runs in a plain browser: mount the canvas with
// the custom shapes, stream sync into an in-memory RecordStore instead of IPC,
// and run one agent-style exec round-trip. Nothing here persists or talks to
// a server — that is Stage 2 scope.

const assetUrls = getAssetUrlsByImport()

// Typed cross-package proof: this only compiles if the TLGlobalShapePropsMap
// augmentation from @mywb/core/shapes reaches this consumer.
function seedServiceNode(editor: Editor): void {
	const seed: TLShapePartial<ServiceNodeShape> = {
		id: createShapeId(),
		type: 'service-node',
		x: 96,
		y: 96,
		props: { name: 'web-smoke', kind: 'web' }
	}
	editor.createShape(seed)
}

const EXEC_SAMPLE = `
const id = tldraw.createShapeId()
editor.createShape({ id, type: 'service-node', x: 360, y: 96, props: { name: 'checkout-api', kind: 'api' } })
return editor.getShape(id)
`

export function SmokePage() {
	const editorRef = useRef<Editor | null>(null)
	const storeRef = useRef(new MemoryRecordStore())
	const syncRef = useRef<DocumentSyncHandle | null>(null)
	const [execOutput, setExecOutput] = useState('')

	const handleMount = useCallback((editor: Editor) => {
		editorRef.current = editor
		seedServiceNode(editor)
		syncRef.current?.dispose()
		syncRef.current = startDocumentSync(editor.store, {
			pushInitialSnapshot: ({ records, schemaJson }) => {
				storeRef.current.replaceAll(records, schemaJson)
				return Promise.resolve()
			},
			pushDiff: ({ put, removed }) => {
				storeRef.current.applyDiff(put, removed)
				return Promise.resolve()
			}
		})
	}, [])

	const runSample = useCallback(async () => {
		const editor = editorRef.current
		if (!editor) return
		const result = await runExecCode(editor, EXEC_SAMPLE)
		// The store delivers history to listeners on the next animation frame —
		// wait one frame so document-sync has seen the exec change, then flush.
		await new Promise(requestAnimationFrame)
		syncRef.current?.flush()
		const allRecords = storeRef.current.loadAllRecords()
		const serviceNodes = allRecords.filter((record) => record.json.includes('"service-node"'))
		setExecOutput(
			JSON.stringify(
				{
					exec: result,
					serviceNodesInStore: serviceNodes.length,
					recordsInStore: allRecords.map((r) => r.id)
				},
				null,
				2
			)
		)
	}, [])

	return (
		<div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
			<div style={{ padding: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
				<button data-testid="run-exec" onClick={() => void runSample()}>
					Run exec sample
				</button>
				<pre data-testid="exec-result" style={{ margin: 0, maxHeight: 96, overflow: 'auto' }}>
					{execOutput}
				</pre>
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
