import { useEffect, useRef, useState } from 'react'
import type { RecordProps, TLBaseShape } from 'tldraw'
import { HTMLContainer, Rectangle2d, ShapeUtil, T, stopEventPropagation } from 'tldraw'

// A Mermaid diagram embedded on the canvas. `source` is the Mermaid text; the
// SVG is rendered client-side. Mermaid is heavy (~2MB), so it is imported
// lazily the first time a block actually renders.

export interface MermaidBlockProps {
	w: number
	h: number
	source: string
}

export type MermaidBlockShape = TLBaseShape<'mermaid-block', MermaidBlockProps>

declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		'mermaid-block': MermaidBlockProps
	}
}

const DEFAULT_SOURCE = 'graph TD\n  A[Start] --> B[End]'

let mermaidReady: Promise<typeof import('mermaid').default> | null = null
function loadMermaid(): Promise<typeof import('mermaid').default> {
	mermaidReady ??= import('mermaid').then((mod) => {
		mod.default.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
		return mod.default
	})
	return mermaidReady
}

let renderSeq = 0

function MermaidView({ shape }: { shape: MermaidBlockShape }) {
	const { source, w, h } = shape.props
	const [svg, setSvg] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const containerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		let cancelled = false
		const id = `mermaid-${shape.id.replace(/[^\w-]/g, '')}-${renderSeq++}`
		loadMermaid()
			.then((mermaid) => mermaid.render(id, source || DEFAULT_SOURCE))
			.then(({ svg }) => {
				if (!cancelled) {
					setSvg(svg)
					setError(null)
				}
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : String(err))
			})
		return () => {
			cancelled = true
		}
	}, [source, shape.id])

	return (
		<div
			ref={containerRef}
			style={{
				width: w,
				height: h,
				boxSizing: 'border-box',
				border: '1px solid #cbd5e1',
				borderRadius: 8,
				background: '#fff',
				padding: 8,
				overflow: 'auto',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center'
			}}
		>
			{error ? (
				<div style={{ color: '#b91c1c', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap' }}>
					Mermaid error: {error}
					{'\n\n'}
					{source}
				</div>
			) : svg ? (
				<div style={{ width: '100%' }} dangerouslySetInnerHTML={{ __html: svg }} />
			) : (
				<div style={{ opacity: 0.5, fontSize: 12 }}>Rendering…</div>
			)}
		</div>
	)
}

export class MermaidBlockShapeUtil extends ShapeUtil<MermaidBlockShape> {
	static override type = 'mermaid-block' as const

	static override props: RecordProps<MermaidBlockShape> = {
		w: T.number,
		h: T.number,
		source: T.string
	}

	getDefaultProps(): MermaidBlockShape['props'] {
		return { w: 320, h: 220, source: DEFAULT_SOURCE }
	}

	getGeometry(shape: MermaidBlockShape) {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override canResize() {
		return true
	}

	override canEdit() {
		return true
	}

	component(shape: MermaidBlockShape) {
		return (
			<HTMLContainer style={{ pointerEvents: 'all' }} onPointerDown={stopEventPropagation}>
				<MermaidView shape={shape} />
			</HTMLContainer>
		)
	}

	getIndicatorPath(shape: MermaidBlockShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 8)
		return path
	}
}
