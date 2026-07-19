#!/usr/bin/env node
// Entry shim. node:sqlite emits an ExperimentalWarning at import time, and ESM
// import hoisting means a static import of the real CLI would load sqlite
// before any filter could run. So install the filter here — this file imports
// nothing at module level — then load the real logic via dynamic import (not
// hoisted), by which point node:sqlite honors the filter.
process.removeAllListeners('warning')
process.on('warning', (warning) => {
	if (warning.name === 'ExperimentalWarning' && /SQLite/i.test(warning.message)) return
	process.stderr.write(`(node) ${warning.name}: ${warning.message}\n`)
})

// Dynamic import (not hoisted) so the filter above is installed first.
void import('./cli-main')

export {}
