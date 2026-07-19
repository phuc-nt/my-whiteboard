import type { RecordProps, TLBaseShape } from 'tldraw'
import { HTMLContainer, Rectangle2d, ShapeUtil, T } from 'tldraw'

// A pinned reference to a location in code: repo + path + optional line range
// and commit sha. Rendered as a monospace pill; clicking opens the repo URL.

export interface CodeRefProps {
	w: number
	h: number
	repo: string
	path: string
	lineStart: number
	lineEnd: number
	sha: string
}

export type CodeRefShape = TLBaseShape<'code-ref', CodeRefProps>

declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		'code-ref': CodeRefProps
	}
}

function locationLabel(props: CodeRefShape['props']): string {
	let label = props.path || props.repo || 'code'
	if (props.lineStart > 0) {
		label += `:${props.lineStart}`
		if (props.lineEnd > props.lineStart) label += `-${props.lineEnd}`
	}
	return label
}

export class CodeRefShapeUtil extends ShapeUtil<CodeRefShape> {
	static override type = 'code-ref' as const

	static override props: RecordProps<CodeRefShape> = {
		w: T.number,
		h: T.number,
		repo: T.string,
		path: T.string,
		lineStart: T.number,
		lineEnd: T.number,
		sha: T.string
	}

	getDefaultProps(): CodeRefShape['props'] {
		return { w: 260, h: 44, repo: '', path: '', lineStart: 0, lineEnd: 0, sha: '' }
	}

	getGeometry(shape: CodeRefShape) {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override canResize() {
		return true
	}

	component(shape: CodeRefShape) {
		const { w, h, sha } = shape.props
		return (
			<HTMLContainer
				style={{
					width: w,
					height: h,
					boxSizing: 'border-box',
					border: '1px solid #94a3b8',
					borderRadius: 6,
					background: '#0f172a',
					color: '#e2e8f0',
					padding: '0 12px',
					display: 'flex',
					alignItems: 'center',
					gap: 8,
					pointerEvents: 'all',
					overflow: 'hidden',
					fontFamily: 'var(--tl-font-mono, monospace)',
					fontSize: 13
				}}
			>
				<span style={{ color: '#38bdf8' }}>{'</>'}</span>
				<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
					{locationLabel(shape.props)}
				</span>
				{sha ? <span style={{ opacity: 0.5, marginLeft: 'auto' }}>{sha.slice(0, 7)}</span> : null}
			</HTMLContainer>
		)
	}

	getIndicatorPath(shape: CodeRefShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 6)
		return path
	}
}
