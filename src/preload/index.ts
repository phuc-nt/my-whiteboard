import { contextBridge, ipcRenderer } from 'electron'
import type { DocLoadResult, MainInvokeReply, MainInvokeRequest } from '../shared/ipc-contract'
import { MainToRenderer, RendererToMain } from '../shared/ipc-contract'

// Narrow, typed bridge — the renderer never sees Node or Electron APIs directly.

type InvokeHandler = (payload: unknown) => Promise<unknown> | unknown

const handlers = new Map<string, InvokeHandler>()

ipcRenderer.on(MainToRenderer.request, async (_event, request: MainInvokeRequest) => {
	const handler = handlers.get(request.channel)
	const reply: MainInvokeReply = { id: request.id, ok: false }
	if (!handler) {
		reply.error = `No renderer handler for "${request.channel}"`
	} else {
		try {
			reply.result = await handler(request.payload)
			reply.ok = true
		} catch (error) {
			reply.error = error instanceof Error ? error.message : String(error)
		}
	}
	ipcRenderer.send(MainToRenderer.reply, reply)
})

const desktopApi = {
	/** Ask main for the document this window should display. */
	loadDocument: (): Promise<DocLoadResult> => ipcRenderer.invoke(RendererToMain.docLoad),
	/** Report unsaved-changes state so main can update title/close behavior. */
	markDirty: (dirty: boolean): Promise<void> => ipcRenderer.invoke(RendererToMain.docMarkDirty, dirty),
	/** Report that the loaded document could not be applied to the editor. */
	reportLoadFailed: (message: string): Promise<void> =>
		ipcRenderer.invoke(RendererToMain.docLoadFailed, message),
	/** Serve a main→renderer request channel (e.g. editor-get-snapshot). */
	onInvoke: (channel: string, handler: InvokeHandler): (() => void) => {
		handlers.set(channel, handler)
		return () => {
			if (handlers.get(channel) === handler) handlers.delete(channel)
		}
	}
}

export type DesktopApi = typeof desktopApi

contextBridge.exposeInMainWorld('desktop', desktopApi)
