import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerMywbTools } from './mcp-tools'

// `mywb mcp` — a stdio MCP server exposing the running app's canvas as tools any
// MCP client (Claude Code, Cursor, ...) can discover and call. Long-lived: the
// returned promise resolves only when the client disconnects (transport closes
// stdin), so the caller must NOT process.exit() after it.

export async function startMcpServer(): Promise<void> {
	const server = new McpServer({ name: 'mywb', version: '0.1.0' })
	registerMywbTools(server)
	await server.connect(new StdioServerTransport())
	// Resolve only when stdin ends (client disconnects), keeping the process
	// alive as a server rather than exiting immediately.
	await new Promise<void>((resolve) => {
		process.stdin.on('close', resolve)
		process.stdin.on('end', resolve)
	})
}
