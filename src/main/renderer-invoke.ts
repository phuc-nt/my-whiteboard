import { BrowserWindow, ipcMain } from 'electron'
import type { MainInvokeReply, MainInvokeRequest, RendererServedChannel } from '../shared/ipc-contract'
import { MainToRenderer } from '../shared/ipc-contract'

// Request/response from main to a specific renderer window. Electron only has
// fire-and-forget webContents.send, so replies are correlated by request id.

const INVOKE_TIMEOUT_MS = 30_000

interface PendingInvoke {
	/** Only the window the request was sent to may settle it. */
	senderId: number
	resolve: (value: unknown) => void
	reject: (err: Error) => void
}

let nextRequestId = 1
const pending = new Map<number, PendingInvoke>()

ipcMain.on(MainToRenderer.reply, (event, reply: MainInvokeReply) => {
	const entry = pending.get(reply.id)
	if (!entry || entry.senderId !== event.sender.id) return
	pending.delete(reply.id)
	if (reply.ok) entry.resolve(reply.result)
	else entry.reject(new Error(reply.error ?? 'Unknown renderer error'))
})

export function invokeRenderer<T>(
	window: BrowserWindow,
	channel: RendererServedChannel,
	payload: unknown = undefined
): Promise<T> {
	if (window.isDestroyed()) {
		return Promise.reject(new Error(`Cannot invoke "${channel}": window is closed`))
	}
	const id = nextRequestId++
	const request: MainInvokeRequest = { id, channel, payload }
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(id)
			reject(new Error(`Renderer invoke "${channel}" timed out after ${INVOKE_TIMEOUT_MS}ms`))
		}, INVOKE_TIMEOUT_MS)
		pending.set(id, {
			senderId: window.webContents.id,
			resolve: (value) => {
				clearTimeout(timer)
				resolve(value as T)
			},
			reject: (err) => {
				clearTimeout(timer)
				reject(err)
			}
		})
		try {
			window.webContents.send(MainToRenderer.request, request)
		} catch (error) {
			clearTimeout(timer)
			pending.delete(id)
			reject(error instanceof Error ? error : new Error(String(error)))
		}
	})
}
