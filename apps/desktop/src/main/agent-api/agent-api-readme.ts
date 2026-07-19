// Plain-text README served at GET / and /readme. Written FOR an LLM agent:
// every example runs as-is, and it hammers the two things agents get wrong
// (fresh shell per Bash call → re-read the token; verify with records).

export function getAgentApiReadme(serverJsonPath: string): string {
	return `# My Whiteboard Canvas API

Local HTTP server for reading and modifying open My Whiteboard canvases with code.

## Auth

Every request except GET / and /readme needs the per-launch bearer token from
${serverJsonPath}. Each Bash tool call runs in a FRESH shell — exported env vars
do NOT survive to the next call, so read the port and token inline every time:

  PORT=$(jq -r .port "${serverJsonPath}"); TOKEN=$(jq -r .token "${serverJsonPath}")

Send the token as:  -H "authorization: Bearer $TOKEN"
Requests without it return 401.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/search | Run JS against an \`api\` object: list docs, read shapes/bindings, screenshot |
| POST | /api/doc/:id/exec | Run JS against the live tldraw \`editor\` in one document |

Bodies accept raw JS (content-type: text/plain) or JSON {"code":"..."}. Code is
wrapped in an async function, so top-level await works.

## Use this first

Most tasks don't need to search the full editor API. Start here:

  # Pick the target doc by focused window or filename.
  curl -s -X POST http://localhost:$PORT/api/search \\
    -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" \\
    -d '{"code":"return await api.getDocs({ name: \\"NAME\\" })"}'

  # Read the current page's shapes (ids, bounds, props, meta).
  # getShapes returns { page, viewport, shapes } — read .shapes off it.
  curl -s -X POST http://localhost:$PORT/api/search \\
    -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" \\
    -d '{"code":"const doc = await api.getFocusedDoc(); const data = doc ? await api.getShapes(doc.id) : null; return { doc, shapes: data?.shapes.map(s => ({ id: s.id, type: s.type, x: s.x, y: s.y, props: s.props })) ?? [] }"}'

## api object (inside /api/search)

- api.getDocs({ name? }) — open documents, most-recently-active first. Each: { id, filePath, name, dirty, lastActive }.
- api.getFocusedDoc() — the most-recently-active document, or null.
- api.getShapes(docId) — { page, viewport, shapes } with raw tldraw records.
- api.getBindings(docId) — ARROW binding records on the current page (only
  bindings of type 'arrow'; other binding types are not returned).
- api.getScreenshot(docId) — base64 PNG data URL. The document window must be
  visible; a minimized/hidden window returns an error.

## Mutating the canvas (/api/doc/:id/exec)

Runs JS with the live \`editor\` in scope. tldraw's SDK primitives are available
on the injected \`tldraw\` binding — destructure from it (do NOT use \`import\`,
which is not available inside an exec snippet):

  curl -s -X POST http://localhost:$PORT/api/doc/DOC_ID/exec \\
    -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" \\
    -d '{"code":"const { createShapeId, toRichText } = tldraw; editor.createShape({ id: createShapeId(), type: \\"geo\\", x: 100, y: 100, props: { geo: \\"rectangle\\", w: 200, h: 120, richText: toRichText(\\"Hello\\") } }); return { created: true }"}'

Every exec call is wrapped in an editor history stopping point, so the user can
undo your change with a single Cmd+Z.

## Verify with records, not eyesight

After a mutation, re-read shapes and check the records changed — don't rely on a
screenshot unless placement is genuinely uncertain or the user asked to see it.

Return plain JSON from exec (ids, counts, booleans).
`
}
