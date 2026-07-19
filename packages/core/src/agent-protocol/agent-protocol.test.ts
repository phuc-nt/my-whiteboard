import { describe, expect, it } from 'vitest'
import { parseCode, safeSerialize, serverInfoSchema } from './agent-protocol'

// parseCode behavior is copied verbatim from the desktop agent-api server —
// these cases lock the wire contract before the logic moved into core.

describe('parseCode', () => {
	it('accepts a JSON body with a string code field', () => {
		expect(parseCode('{"code":"return 1"}', 'application/json')).toEqual({ code: 'return 1' })
	})

	it('rejects a JSON body without a string code field', () => {
		expect(parseCode('{"code":42}', 'application/json')).toEqual({
			error: 'JSON body must have a string "code" field'
		})
		expect(parseCode('{}', 'application/json')).toEqual({
			error: 'JSON body must have a string "code" field'
		})
	})

	it('rejects malformed JSON', () => {
		expect(parseCode('{nope', 'application/json')).toEqual({ error: 'Invalid JSON body' })
	})

	it('treats non-JSON content types as raw code', () => {
		expect(parseCode('return 1', 'text/plain')).toEqual({ code: 'return 1' })
		expect(parseCode('return 1', undefined)).toEqual({ code: 'return 1' })
	})

	it('rejects an empty or whitespace-only raw body', () => {
		expect(parseCode('', undefined)).toEqual({ error: 'Empty request body' })
		expect(parseCode('   ', 'text/plain')).toEqual({ error: 'Empty request body' })
	})
})

describe('safeSerialize', () => {
	it('passes JSON-safe values through', () => {
		expect(safeSerialize({ a: 1, b: [true, 'x'] })).toEqual({ a: 1, b: [true, 'x'] })
	})

	it('maps undefined and null to null', () => {
		expect(safeSerialize(undefined)).toBeNull()
		expect(safeSerialize(null)).toBeNull()
	})

	it('degrades values that cannot survive JSON to a string', () => {
		expect(safeSerialize(10n)).toBe('10')
	})
})

describe('serverInfoSchema', () => {
	it('round-trips the server.json shape', () => {
		const info = {
			port: 7236,
			token: 'a'.repeat(64),
			pid: 123,
			startedAt: 1700000000000,
			requestLogPath: '/tmp/agent-api.log'
		}
		expect(serverInfoSchema.parse(info)).toEqual(info)
	})

	it('rejects a missing token', () => {
		expect(serverInfoSchema.safeParse({ port: 7236 }).success).toBe(false)
	})
})
