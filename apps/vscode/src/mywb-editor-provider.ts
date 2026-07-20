import * as vscode from 'vscode'

// Custom editor for .mywb files. The host owns file bytes and the save
// contract; the webview (media/ bundle) turns bytes into a live tldraw canvas
// and hands serialized bytes back. Spike scope: open + render + dirty signal;
// the full save/backup/revert contract lands in the next phase.

export class MywbDocument implements vscode.CustomDocument {
	constructor(
		public readonly uri: vscode.Uri,
		public bytes: Uint8Array,
		private readonly onDispose: () => void
	) {}
	dispose(): void {
		this.onDispose()
	}
}

type WebviewMessage =
	| { type: 'ready' }
	| { type: 'rendered'; shapeCount: number }
	| { type: 'edited' }
	| { type: 'save-result'; bytes: number[] }

export class MywbEditorProvider implements vscode.CustomEditorProvider<MywbDocument> {
	static readonly viewType = 'mywb.board'

	// Test observability: integration tests await the webview's own report that
	// the canvas rendered N shapes — webview DOM is unreachable from the host.
	private readonly renderedEmitter = new vscode.EventEmitter<{ uri: vscode.Uri; shapeCount: number }>()
	readonly onRendered = this.renderedEmitter.event

	// Content-change (not edit) events: the canvas owns its undo/redo, so the
	// tab-level undo stack must stay out of the picture — an edit-event with
	// no-op undo would let VS Code clear dirty without reverting anything,
	// silently losing the save prompt.
	private readonly changeEmitter = new vscode.EventEmitter<
		vscode.CustomDocumentContentChangeEvent<MywbDocument>
	>()
	readonly onDidChangeCustomDocument = this.changeEmitter.event

	private readonly panels = new Map<string, vscode.WebviewPanel>()
	private readonly documents = new Map<string, MywbDocument>()
	// FIFO per document: concurrent save/backup requests each get the reply to
	// their own request-save message (webview answers in order).
	private saveWaiters = new Map<string, Array<(bytes: Uint8Array) => void>>()

	constructor(private readonly context: vscode.ExtensionContext) {}

	async openCustomDocument(uri: vscode.Uri): Promise<MywbDocument> {
		const bytes = await vscode.workspace.fs.readFile(uri)
		const key = uri.toString()
		const document = new MywbDocument(uri, bytes, () => this.documents.delete(key))
		this.documents.set(key, document)
		return document
	}

	async resolveCustomEditor(document: MywbDocument, panel: vscode.WebviewPanel): Promise<void> {
		const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media')
		panel.webview.options = { enableScripts: true, localResourceRoots: [mediaRoot] }
		panel.webview.html = await this.buildHtml(panel.webview, mediaRoot)
		this.panels.set(document.uri.toString(), panel)
		panel.onDidDispose(() => this.panels.delete(document.uri.toString()))

		panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
			this.handleWebviewMessage(document, panel, message)
		})
	}

	/** Separated so integration tests can drive the protocol directly. */
	handleWebviewMessage(
		document: MywbDocument,
		panel: vscode.WebviewPanel,
		message: WebviewMessage
	): void {
		if (message.type === 'ready') {
			void panel.webview.postMessage({
				type: 'init',
				bytes: Array.from(document.bytes),
				name: document.uri.path.split('/').pop() ?? 'board'
			})
		}
		if (message.type === 'rendered') {
			this.renderedEmitter.fire({ uri: document.uri, shapeCount: message.shapeCount })
		}
		if (message.type === 'edited') {
			this.changeEmitter.fire({ document })
		}
		if (message.type === 'save-result') {
			const queue = this.saveWaiters.get(document.uri.toString())
			const waiter = queue?.shift()
			if (queue && queue.length === 0) this.saveWaiters.delete(document.uri.toString())
			waiter?.(new Uint8Array(message.bytes))
		}
	}

	/** Ask the webview to serialize the current canvas; resolves with the bytes. */
	private requestSave(document: MywbDocument): Promise<Uint8Array> {
		const panel = this.panels.get(document.uri.toString())
		if (!panel) return Promise.resolve(document.bytes)
		return new Promise((resolve, reject) => {
			const key = document.uri.toString()
			const waiter = (bytes: Uint8Array) => {
				clearTimeout(timer)
				resolve(bytes)
			}
			const timer = setTimeout(() => {
				const queue = this.saveWaiters.get(key)
				const index = queue?.indexOf(waiter) ?? -1
				if (queue && index >= 0) queue.splice(index, 1)
				reject(new Error('webview did not answer the save request in time'))
			}, 15_000)
			const queue = this.saveWaiters.get(key) ?? []
			queue.push(waiter)
			this.saveWaiters.set(key, queue)
			void panel.webview.postMessage({ type: 'request-save' })
		})
	}

	async saveCustomDocument(document: MywbDocument): Promise<void> {
		const bytes = await this.requestSave(document)
		document.bytes = bytes
		await vscode.workspace.fs.writeFile(document.uri, bytes)
	}

	async saveCustomDocumentAs(document: MywbDocument, destination: vscode.Uri): Promise<void> {
		const bytes = await this.requestSave(document)
		await vscode.workspace.fs.writeFile(destination, bytes)
	}

	async revertCustomDocument(document: MywbDocument): Promise<void> {
		document.bytes = await vscode.workspace.fs.readFile(document.uri)
		const panel = this.panels.get(document.uri.toString())
		if (panel) {
			void panel.webview.postMessage({
				type: 'init',
				bytes: Array.from(document.bytes),
				name: document.uri.path.split('/').pop() ?? 'board'
			})
		}
	}

	async backupCustomDocument(
		document: MywbDocument,
		context: vscode.CustomDocumentBackupContext
	): Promise<vscode.CustomDocumentBackup> {
		const bytes = await this.requestSave(document)
		await vscode.workspace.fs.writeFile(context.destination, bytes)
		return {
			id: context.destination.toString(),
			delete: async () => {
				try {
					await vscode.workspace.fs.delete(context.destination)
				} catch {
					// already gone
				}
			}
		}
	}

	// Narrow test seams: integration tests cannot reach the webview DOM, so
	// they drive the host side of the protocol against the REAL registered
	// document and panel. Each wraps the production path unchanged.
	private documentForTest(uri: vscode.Uri): MywbDocument {
		const document = this.documents.get(uri.toString())
		if (!document) throw new Error(`no open document for ${uri.toString()}`)
		return document
	}

	simulateEditedForTest(uri: vscode.Uri): void {
		const document = this.documentForTest(uri)
		const panel = this.panels.get(uri.toString())
		if (!panel) throw new Error('no panel')
		this.handleWebviewMessage(document, panel, { type: 'edited' })
	}

	saveDocumentForTest(uri: vscode.Uri): Promise<void> {
		return this.saveCustomDocument(this.documentForTest(uri))
	}

	backupDocumentForTest(
		uri: vscode.Uri,
		destination: vscode.Uri
	): Promise<vscode.CustomDocumentBackup> {
		return this.backupCustomDocument(this.documentForTest(uri), {
			destination
		} as vscode.CustomDocumentBackupContext)
	}

	revertDocumentForTest(uri: vscode.Uri): Promise<void> {
		return this.revertCustomDocument(this.documentForTest(uri))
	}

	private async buildHtml(webview: vscode.Webview, mediaRoot: vscode.Uri): Promise<string> {
		const indexUri = vscode.Uri.joinPath(mediaRoot, 'index.html')
		const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(indexUri))
		// Vite emitted relative URLs (base './'); point them at webview URIs.
		const mediaBase = webview.asWebviewUri(mediaRoot).toString()
		const withAssets = raw.replace(/(src|href)="\.\/([^"]+)"/g, `$1="${mediaBase}/$2"`)
		// sql.js instantiates its engine from fetched wasm bytes —
		// 'wasm-unsafe-eval' is the narrowest directive VS Code webviews accept
		// for that. No remote hosts anywhere.
		const csp = [
			`default-src 'none'`,
			`img-src ${webview.cspSource} data: blob:`,
			`style-src ${webview.cspSource} 'unsafe-inline'`,
			`font-src ${webview.cspSource} data:`,
			`script-src ${webview.cspSource} 'wasm-unsafe-eval'`,
			`connect-src ${webview.cspSource}`
		].join('; ')
		return withAssets.replace(
			'<head>',
			`<head>\n\t\t<meta http-equiv="Content-Security-Policy" content="${csp}" />`
		)
	}
}
