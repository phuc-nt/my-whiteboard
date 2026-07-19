import { customShapeUtils } from '@mywb/core/shapes'
import type { TLStore } from 'tldraw'
import { createTLStore, defaultBindingUtils, defaultShapeUtils } from 'tldraw'

// A TLStore with the exact schema the app runs (default + custom shapes), no
// editor, no DOM. Whatever this store accepts, the desktop canvas accepts.

export function createHeadlessStore(): TLStore {
	const store = createTLStore({
		shapeUtils: [...defaultShapeUtils, ...customShapeUtils],
		bindingUtils: defaultBindingUtils
	})
	// Create the default document/page records the way the editor does on
	// mount. Public at runtime but @internal in the d.ts, hence the cast.
	;(store as unknown as { ensureStoreIsUsable(): void }).ensureStoreIsUsable()
	return store
}
