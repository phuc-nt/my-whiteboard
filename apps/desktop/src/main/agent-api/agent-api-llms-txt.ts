// llms.txt for the running app, served unauthenticated at GET /llms.txt —
// the llmstxt.org convention: an H1, a one-line blockquote, then link
// sections. Points an arriving agent at every machine-usable surface of the
// app; /readme stays the deep-dive document.

export function getAgentApiLlmsTxt(serverJsonPath: string): string {
	return `# My Whiteboard

> Local-first whiteboard where coding agents are first-class users: the canvas
> is structured data, read and edited by code over a localhost API — never by
> screenshots.

Auth: every endpoint except GET /, /readme and /llms.txt needs the per-launch
bearer token from ${serverJsonPath} (send "authorization: Bearer <token>").

## HTTP API

- [Canvas API readme](/readme): full endpoint docs with runnable examples —
  read this first
- POST /api/search: run read-only JS against an \`api\` object (list docs,
  read shapes/bindings, screenshot)
- POST /api/doc/:id/exec: run JS against the live tldraw \`editor\` of one
  open document

## Other agent surfaces

- MCP: \`mywb mcp\` (stdio) exposes list_documents, read_shapes,
  read_bindings, screenshot, exec — add with \`claude mcp add mywb\`
- CLI headless: \`mywb file read|apply|scaffold\` works on .mywb files with no
  app running; \`mywb app docs|search|exec\` talks to this server
- Document format: .mywb = zip of sqlite records + media + optional script/
`
}
