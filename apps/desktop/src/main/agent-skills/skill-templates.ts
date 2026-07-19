// Content rendered into the agent skill files. The SKILL.md is written FOR an
// LLM coding agent: every example runs as-is against a running app, and it
// pre-empts the two mistakes agents make (fresh shell per call → re-read token;
// verify with records). serverJsonPath is baked in so no discovery is needed.

/** Single-quote a path for safe embedding in a POSIX shell command. */
function shellQuote(path: string): string {
	return `'${path.replaceAll("'", `'\\''`)}'`
}

export function renderSkillMarkdown(serverJsonPath: string, mywbScriptPath: string): string {
	const sj = shellQuote(serverJsonPath)
	const mywb = shellQuote(mywbScriptPath)
	return `# My Whiteboard canvas operator

Use this skill for tasks involving open My Whiteboard documents. The desktop app
runs a local HTTP server that lists documents, reads canvas state, captures
screenshots, and executes JavaScript against a live tldraw editor.

## Server

Default: http://localhost:7236. If that port isn't active, read \`port\` from
${serverJsonPath}. A clean quit removes server.json; the next launch rewrites it.

Every request except GET / and /readme needs the per-launch \`token\` from that
same server.json, sent as: -H "authorization: Bearer <token>".

**Each Bash tool call runs in a FRESH shell — exported env vars do NOT survive
to the next call.** Re-read the port and token at the top of every call:

\`\`\`bash
PORT=$(jq -r .port ${sj}); TOKEN=$(jq -r .token ${sj})
\`\`\`

### Preferred: the mywb binary (app mode)

If the \`mywb\` CLI is available (on PATH, or built in the repo at
\`apps/cli/dist/cli.js\` — run as \`node <repo>/apps/cli/dist/cli.js\`), prefer it:
it finds the running app itself (server.json), handles the token, prints JSON:

\`\`\`bash
mywb app docs                                  # open documents (JSON)
mywb app search 'return await api.getDocs()'   # read-only JS in the search context
mywb app exec DOC_ID 'return editor.getCurrentPageShapes().length'
# long code? pipe it:  echo "$CODE" | mywb app exec DOC_ID -
\`\`\`

### Legacy fallback: the bundled sh helper

When the binary is not available, a helper script ships with this skill. It
re-reads port + token on every call, so you never handle the token or the
fresh-shell problem:

\`\`\`bash
sh ${mywb} POST /api/search '{"code":"return await api.getDocs()"}'
sh ${mywb} POST /api/doc/DOC_ID/exec 'return editor.getCurrentPageShapes().length'
sh ${mywb} GET  /readme
\`\`\`

A body starting with { is sent as JSON; anything else as text/plain.

## Use this first

Most tasks don't need the full editor API. Start here:

\`\`\`bash
# Pick the target doc by focused window or filename.
sh ${mywb} POST /api/search '{"code":"return await api.getDocs({ name: \\"NAME\\" })"}'

# Read the current page's shapes. getShapes returns { page, viewport, shapes }.
sh ${mywb} POST /api/search '{"code":"const doc = await api.getFocusedDoc(); const data = doc ? await api.getShapes(doc.id) : null; return { doc, shapes: data?.shapes.map(s => ({ id: s.id, type: s.type, x: s.x, y: s.y, props: s.props })) ?? [] }"}'
\`\`\`

## api object (POST /api/search)

- api.getDocs({ name? }) — open documents, most-recently-active first: { id, filePath, name, dirty, lastActive }.
- api.getFocusedDoc() — most-recently-active document, or null.
- api.getShapes(docId) — { page, viewport, shapes } with raw tldraw records.
- api.getBindings(docId) — arrow binding records only.
- api.getScreenshot(docId) — base64 PNG (window must be visible).

## Mutating (POST /api/doc/:id/exec)

Runs JS with the live \`editor\` and a \`tldraw\` binding in scope. Destructure SDK
primitives from \`tldraw\` (do NOT use \`import\`):

\`\`\`bash
sh ${mywb} POST /api/doc/DOC_ID/exec 'const { createShapeId, toRichText } = tldraw; editor.createShape({ id: createShapeId(), type: "geo", x: 100, y: 100, props: { geo: "rectangle", w: 200, h: 120, richText: toRichText("Hello") } }); return { created: true }'
\`\`\`

Every exec is one undo stopping point — the user can Cmd+Z your whole change.

## Custom dev shapes

This app adds shapes beyond tldraw's defaults, created the same way via exec:

- \`service-node\` — props { name, kind: 'api'|'db'|'queue'|'cron'|'web', repoUrl?, ownerTeam? }
- \`code-ref\` — props { repo, path, lineStart?, lineEnd?, sha? }
- \`mermaid-block\` — props { source } (Mermaid diagram text)

Example: draw a service architecture node:

\`\`\`bash
sh ${mywb} POST /api/doc/DOC_ID/exec 'const { createShapeId } = tldraw; editor.createShape({ id: createShapeId(), type: "service-node", x: 200, y: 200, props: { name: "auth-api", kind: "api", ownerTeam: "platform" } }); return { ok: true }'
\`\`\`

## Arrow relationships (calls vs depends-on)

Arrows carry meaning via their \`meta\`. When you draw an arrow between two
service-nodes, tag the relationship so an agent (or a drift check) can tell a
call from a dependency:

\`\`\`bash
sh ${mywb} POST /api/doc/DOC_ID/exec 'const { createShapeId } = tldraw; const id = createShapeId(); editor.createShape({ id, type: "arrow", meta: { relation: "depends-on" } }); editor.createBinding({ type: "arrow", fromId: id, toId: "shape:FROM", props: { terminal: "start" } }); editor.createBinding({ type: "arrow", fromId: id, toId: "shape:TO", props: { terminal: "end" } }); return { ok: true }'
\`\`\`

Convention: \`meta.relation\` is one of \`'calls'\` or \`'depends-on'\`. Read it back
from the arrow records (getShapes) to interpret the architecture. \`meta\` is a
first-class record field, so it round-trips through .mywb like any other prop.

## Verify with records, not eyesight

After a mutation, re-read shapes and check the records changed. Only take a
screenshot when placement is genuinely uncertain or the user asked to see it.
Return plain JSON from exec (ids, counts, booleans).
`
}

export function renderMywbHelperScript(serverJsonPath: string): string {
	const sj = shellQuote(serverJsonPath)
	return `#!/bin/sh
# mywb — call the My Whiteboard agent API. Re-reads port+token from server.json
# on every invocation, so it is immune to the fresh-shell env problem.
# Usage: sh mywb <METHOD> <path> [body]
#   body starting with { is sent as JSON; anything else as text/plain.
set -e
SERVER_JSON=${sj}
if [ ! -f "$SERVER_JSON" ]; then
  echo "My Whiteboard is not running (no server.json at $SERVER_JSON)." >&2
  exit 1
fi
PORT=$(jq -r .port "$SERVER_JSON")
TOKEN=$(jq -r .token "$SERVER_JSON")
METHOD="$1"; PATH_="$2"; BODY="$3"
if [ -z "$METHOD" ] || [ -z "$PATH_" ]; then
  echo "Usage: sh mywb <METHOD> <path> [body]" >&2
  exit 2
fi
URL="http://localhost:$PORT$PATH_"
if [ -z "$BODY" ]; then
  curl -s -X "$METHOD" "$URL" -H "authorization: Bearer $TOKEN"
else
  case "$BODY" in
    \\{*) CT="application/json" ;;
    *) CT="text/plain" ;;
  esac
  curl -s -X "$METHOD" "$URL" -H "authorization: Bearer $TOKEN" -H "content-type: $CT" -d "$BODY"
fi
`
}
