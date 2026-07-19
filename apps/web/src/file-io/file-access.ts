// Open/Save .mywb bytes across browsers. Chromium uses the File System Access
// API and keeps a handle so Save writes in place; Firefox/Safari fall back to
// an <input type=file> open and an anchor-download save (each save is a fresh
// download — no in-place). Feature-detected at call time.

export interface OpenedFile {
	/** Present only on Chromium — lets Save write back to the same file. */
	handle: FileSystemFileHandle | null
	name: string
	bytes: Uint8Array
}

const MYWB_PICKER_TYPES = [
	{ description: 'My Whiteboard', accept: { 'application/octet-stream': ['.mywb'] } }
]

export function supportsFileSystemAccess(): boolean {
	return typeof window !== 'undefined' && 'showOpenFilePicker' in window
}

export async function openFile(): Promise<OpenedFile | null> {
	if (supportsFileSystemAccess()) {
		let handle: FileSystemFileHandle
		try {
			;[handle] = await window.showOpenFilePicker({ types: MYWB_PICKER_TYPES })
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return null
			throw error
		}
		const file = await handle.getFile()
		return { handle, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
	}
	return openWithInput()
}

function openWithInput(): Promise<OpenedFile | null> {
	return new Promise((resolve, reject) => {
		const input = document.createElement('input')
		input.type = 'file'
		input.accept = '.mywb'
		input.onchange = async () => {
			const file = input.files?.[0]
			if (!file) return resolve(null)
			try {
				resolve({ handle: null, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })
			} catch (error) {
				reject(error)
			}
		}
		// A cancelled picker fires no event; the promise simply never resolves,
		// which is acceptable for a user-initiated action.
		input.click()
	})
}

/** Write to an existing handle (in-place); throws if the handle is null. */
export async function saveToHandle(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
	const writable = await handle.createWritable()
	// Copy into a plain ArrayBuffer — a Uint8Array view may be backed by a
	// SharedArrayBuffer, which write() does not accept.
	await writable.write(bytes.slice().buffer)
	await writable.close()
}

/**
 * Save As: on Chromium prompt for a new file and return its handle (so later
 * Saves write in place); elsewhere trigger a download and return null.
 */
export async function saveAs(
	bytes: Uint8Array,
	suggestedName: string
): Promise<FileSystemFileHandle | null> {
	if (supportsFileSystemAccess()) {
		let handle: FileSystemFileHandle
		try {
			handle = await window.showSaveFilePicker({ suggestedName, types: MYWB_PICKER_TYPES })
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return null
			throw error
		}
		await saveToHandle(handle, bytes)
		return handle
	}
	downloadBytes(bytes, suggestedName)
	return null
}

export function downloadBytes(bytes: Uint8Array, name: string): void {
	// Copy into a fresh ArrayBuffer so Blob gets a plain BlobPart, never a
	// SharedArrayBuffer-backed view.
	const buffer = bytes.slice().buffer
	const url = URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' }))
	const a = document.createElement('a')
	a.href = url
	a.download = name
	a.click()
	URL.revokeObjectURL(url)
}
