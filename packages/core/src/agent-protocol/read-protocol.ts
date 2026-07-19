import { z } from 'zod'

// The read-only wire protocol for the web Agent Gateway: a fixed set of read
// operations (no code, no exec) that an agent asks the relay to run against a
// browser tab's live editor. Structured requests, not a code string — the
// relay can never carry anything executable. Exec-remote is a separate stage.

export const readRequestSchema = z.discriminatedUnion('op', [
	z.object({ op: z.literal('list') }),
	z.object({ op: z.literal('getShapes'), documentId: z.string().min(1) }),
	z.object({ op: z.literal('getBindings'), documentId: z.string().min(1) })
])
export type ReadRequest = z.infer<typeof readRequestSchema>

/** A tab-side reply travelling back through the relay to the agent. */
export interface ReadReply {
	ok: boolean
	result?: unknown
	error?: string
}

/** Frames on the tab↔relay WebSocket. */
export interface RelayRegisterFrame {
	type: 'register'
	token: string
	documentId: string
}
export interface RelayRequestFrame {
	type: 'request'
	correlationId: string
	request: ReadRequest
}
export interface RelayReplyFrame {
	type: 'reply'
	correlationId: string
	reply: ReadReply
}
export type RelayFrame = RelayRegisterFrame | RelayRequestFrame | RelayReplyFrame
