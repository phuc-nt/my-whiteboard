import type { SerializedRecord } from '@mywb/core/format'
import { captureFullSnapshot } from '@mywb/core/sync'
import type { ServiceKind } from '@mywb/core/shapes'
import type { IndexKey } from 'tldraw'
import { createShapeId, getIndexAbove } from 'tldraw'
import { createHeadlessStore } from './create-headless-store'
import { writeMywbArchiveFromRecords } from './write-mywb-archive'

// Builds real .mywb files through the same writer + sqlite + store schema the
// app uses — fixtures for tests and the CI drift-check example, never
// hand-crafted zips.

export interface ServiceNodeSeed {
	name: string
	kind: ServiceKind
	repoUrl?: string
	ownerTeam?: string
}

export interface MywbFixtureOptions {
	documentId?: string
	serviceNodes?: ServiceNodeSeed[]
	/** Embed a document script; digest is stamped into metadata verbatim. */
	script?: { mainJs: string; digest: string }
}

/**
 * Build a full service-node shape record parented to the document's page.
 * `existingRecords` supplies the page id and keeps the fractional index unique.
 */
export function makeServiceNodeRecord(
	seed: ServiceNodeSeed,
	existingRecords: SerializedRecord[]
): Record<string, unknown> {
	const page = existingRecords.find((r) => r.typeName === 'page')
	if (!page) throw new Error('document has no page record')
	const shapes = existingRecords.filter((r) => r.typeName === 'shape')
	// Fractional index keys sort lexicographically; naive `a${n}` breaks at the
	// 9th shape ("a10" is not a valid key), so derive the next key from the
	// current topmost one. Records are serialized — the index lives inside json.
	const topIndex = shapes
		.map((s) => (JSON.parse(s.json) as { index: IndexKey }).index)
		.sort()
		.at(-1)
	return {
		id: createShapeId(),
		typeName: 'shape',
		type: 'service-node',
		x: 96 + shapes.length * 260,
		y: 96,
		rotation: 0,
		index: topIndex ? getIndexAbove(topIndex) : ('a1' as IndexKey),
		parentId: page.id,
		isLocked: false,
		opacity: 1,
		meta: {},
		props: {
			w: 220,
			h: 96,
			name: seed.name,
			kind: seed.kind,
			repoUrl: seed.repoUrl ?? '',
			ownerTeam: seed.ownerTeam ?? ''
		}
	}
}

export async function buildMywbFixture(
	targetPath: string,
	options: MywbFixtureOptions = {}
): Promise<void> {
	const store = createHeadlessStore()
	for (const seed of options.serviceNodes ?? []) {
		const snapshot = captureFullSnapshot(store)
		store.put([makeServiceNodeRecord(seed, snapshot.records) as never])
	}
	const { records, schemaJson } = captureFullSnapshot(store)
	await writeMywbArchiveFromRecords(records, schemaJson, targetPath, {
		documentId: options.documentId ?? 'fixture-doc',
		appVersion: '0.0.0-fixture',
		script: options.script
	})
}
