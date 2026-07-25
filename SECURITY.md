# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately**, not through public issues.

Use GitHub's [private vulnerability reporting](https://github.com/phuc-nt/my-whiteboard/security/advisories/new)
("Report a vulnerability" under the repository's **Security** tab). We aim to
acknowledge reports within a few days and will coordinate a fix and disclosure
timeline with you.

## Security model (what to keep in mind)

My Whiteboard runs code **by design** — that is the product. Two surfaces
execute code, and both have deliberate boundaries:

- **Agent API** — an HTTP server bound to `127.0.0.1` only (loopback), guarded
  by a per-launch 32-byte bearer token written to `userData/server.json`
  (chmod 600). It is reachable only from the same machine, and only by a caller
  that can read the token file. `POST /api/…/exec` runs code against the live
  editor; `POST /api/search` runs code in a main-process sandbox.
- **Document scripts** — an optional `script/main.js` embedded in a `.mywb` file
  runs on open, but only **after digest consent**: trust is keyed on the sha256
  digest of the whole `script/` directory, and any change re-prompts. A digest
  mismatch on open means the script was tampered with inside the archive, and it
  is removed rather than run.

Consequences for users:

- Only grant agent access on a machine you control.
- Only open `.mywb` files you trust — an untrusted file can carry a script.

These are intentional trade-offs for an agent-first local tool, not bugs. A
report is most useful when it shows a way to **cross** one of these boundaries —
for example, reaching the Agent API without the token, running an embedded
script without consent, or escaping the renderer's `contextIsolation` sandbox.

## Supported versions

This project is pre-1.0. Security fixes land on the latest `main`; there are no
backported release branches yet.
