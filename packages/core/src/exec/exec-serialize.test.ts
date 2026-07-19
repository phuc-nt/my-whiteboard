import { describe, expect, it } from 'vitest'
import { serializeExecReturnValue } from './exec-code-handler'

// The full runExecCode path needs a live Editor and is covered by the desktop
// e2e suite (agent-api.spec.ts). This locks just the serialize-degrade rule.

describe('serializeExecReturnValue', () => {
	it('maps undefined to null and passes JSON-safe values through', () => {
		expect(serializeExecReturnValue(undefined)).toBeNull()
		expect(serializeExecReturnValue({ ok: true, n: 2 })).toEqual({ ok: true, n: 2 })
	})

	it('degrades unserializable objects to a placeholder string', () => {
		const cyclic: Record<string, unknown> = {}
		cyclic.self = cyclic
		expect(serializeExecReturnValue(cyclic)).toBe('[unserializable object]')
	})

	it('degrades unserializable non-objects via String()', () => {
		expect(serializeExecReturnValue(10n)).toBe('10')
	})
})
