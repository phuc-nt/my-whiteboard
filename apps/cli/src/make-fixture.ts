#!/usr/bin/env node
import type { ServiceNodeSeed } from '@mywb/node-adapter/headless-document'
import { buildMywbFixture } from '@mywb/node-adapter/headless-document'
import { readFile } from 'node:fs/promises'

// Builds a sample .mywb through the real writer + store schema (never a
// hand-crafted zip). Used by tests and the ci-drift-check example.
//
//   node dist/make-fixture.js <target.mywb> <seeds.json>
//   seeds.json: { "documentId"?: string, "serviceNodes": [{ name, kind, repoUrl?, ownerTeam? }] }

async function main(): Promise<void> {
	const [target, seedsPath] = process.argv.slice(2)
	if (!target || !seedsPath) {
		process.stderr.write('Usage: node make-fixture.js <target.mywb> <seeds.json>\n')
		process.exit(2)
	}
	const seeds = JSON.parse(await readFile(seedsPath, 'utf8')) as {
		documentId?: string
		serviceNodes: ServiceNodeSeed[]
	}
	await buildMywbFixture(target, seeds)
	process.stderr.write(`wrote ${target} (${seeds.serviceNodes.length} service nodes)\n`)
}

main().then(
	// tldraw keeps a live timer in the event loop outside NODE_ENV=test — exit
	// explicitly once done.
	() => process.exit(0),
	(error: unknown) => {
		process.stderr.write(`make-fixture: ${error instanceof Error ? error.message : String(error)}\n`)
		process.exit(1)
	}
)
