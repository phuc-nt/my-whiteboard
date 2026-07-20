import * as vscode from 'vscode'
import { MywbEditorProvider } from './mywb-editor-provider'

// Registers the .mywb custom editor. activate() returns the provider so
// integration tests can observe render/save events through extension.exports.

export function activate(context: vscode.ExtensionContext): { provider: MywbEditorProvider } {
	const provider = new MywbEditorProvider(context)
	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(MywbEditorProvider.viewType, provider, {
			webviewOptions: { retainContextWhenHidden: true },
			supportsMultipleEditorsPerDocument: false
		})
	)
	return { provider }
}

export function deactivate(): void {}
