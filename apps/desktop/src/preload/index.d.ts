import type { DesktopApi } from './index'

// Ambient type of the API exposed by preload via contextBridge — derived from
// the implementation so the two can't drift.
declare global {
	interface Window {
		desktop: DesktopApi
	}
}

export {}
