// lib.dom.d.ts ships FileSystemFileHandle + createWritable but not the picker
// entry points yet. Declare just those two (Chromium-only, feature-detected at
// runtime) so we don't pull in @types/wicg-file-system-access, which redefines
// FileSystemFileHandle and clashes with the built-in lib.

interface FilePickerAcceptType {
	description?: string
	accept: Record<string, string[]>
}

interface OpenFilePickerOptions {
	types?: FilePickerAcceptType[]
	multiple?: boolean
}

interface SaveFilePickerOptions {
	suggestedName?: string
	types?: FilePickerAcceptType[]
}

interface Window {
	showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>
	showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>
}
