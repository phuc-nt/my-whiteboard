import type { MywbMetadata } from '@mywb/core/format'
import { zipSync } from 'fflate'

// Writes a .mywb archive in the browser (fflate). Mirrors the Node yazl writer's
// layout so the produced file opens on desktop.

export interface MywbArchiveInput {
	metadata: MywbMetadata
	dbBytes: Uint8Array
	assets: Map<string, Uint8Array>
	scriptFiles?: Map<string, string>
}

export function writeMywbArchive(input: MywbArchiveInput): Uint8Array {
	const encoder = new TextEncoder()
	const entries: Record<string, Uint8Array> = {
		'metadata.json': encoder.encode(JSON.stringify(input.metadata, null, 2)),
		'db.sqlite': input.dbBytes
	}
	for (const [name, content] of input.assets) {
		entries[`assets/${name}`] = content
	}
	if (input.scriptFiles) {
		for (const [name, text] of input.scriptFiles) {
			entries[`script/${name}`] = encoder.encode(text)
		}
	}
	return zipSync(entries, { level: 6 })
}
