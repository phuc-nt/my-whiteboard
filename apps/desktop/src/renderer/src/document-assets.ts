import type { TLAssetStore } from 'tldraw'

// Media pasted or dropped onto the canvas is stored in the document's working
// copy (and packed into the .mywb archive on save) instead of being inlined
// into the store as base64.

/** "asset:abc123" → file-name-safe id, keeping the extension for sniffing. */
function assetFileName(assetId: string, fileName: string): string {
	const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : ''
	const plainId = assetId.replace(/^asset:/, '')
	return `${plainId}${extension}`.replace(/[^\w.-]/g, '_')
}

export const documentAssetStore: TLAssetStore = {
	async upload(asset, file) {
		const bytes = await file.arrayBuffer()
		const { src } = await window.desktop.storeAsset({
			assetId: assetFileName(asset.id, file.name),
			bytes
		})
		return { src }
	},
	resolve(asset) {
		return asset.props.src
	}
}
