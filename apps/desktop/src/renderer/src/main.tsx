import React from 'react'
import ReactDOM from 'react-dom/client'
import { EditorPage } from './pages/editor'

// Single route for now; the hash (#/editor) is reserved for future pages
// (home, settings) without needing a router yet.
ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<EditorPage />
	</React.StrictMode>
)
