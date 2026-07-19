import type { RecordProps, TLBaseShape } from 'tldraw'
import { HTMLContainer, Rectangle2d, ShapeUtil, T } from 'tldraw'

// A service in a software architecture diagram: named box with a kind badge and
// optional repo link + owning team. Props are structured data (not just a
// drawing) so an agent can read/write the architecture, not pixels.

export type ServiceKind = 'api' | 'db' | 'queue' | 'cron' | 'web' | 'lib' | 'app' | 'tool'

export interface ServiceNodeProps {
	w: number
	h: number
	name: string
	kind: ServiceKind
	repoUrl: string
	ownerTeam: string
}

export type ServiceNodeShape = TLBaseShape<'service-node', ServiceNodeProps>

// Register the shape's type→props mapping so tldraw recognizes it as a TLShape.
declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		'service-node': ServiceNodeProps
	}
}

const KIND_LABEL: Record<ServiceKind, string> = {
	api: 'API',
	db: 'Database',
	queue: 'Queue',
	cron: 'Cron',
	web: 'Web',
	lib: 'Library',
	app: 'App',
	tool: 'Tool'
}

const KIND_COLOR: Record<ServiceKind, string> = {
	api: '#2563eb',
	db: '#7c3aed',
	queue: '#d97706',
	cron: '#0891b2',
	web: '#059669',
	lib: '#0d9488',
	app: '#4f46e5',
	tool: '#64748b'
}

// Layout constants shared by the height calculation and the rendered card, so
// the geometry (hit-test, indicator, arrow binding) matches what is drawn.
const CARD_PADDING = 10
const HEADER_HEIGHT = 22
const ROW_HEIGHT = 18
const NAME_LINE_HEIGHT = 20
// Rough chars-per-line for the name: ~15px font, and the kind badge (~86px)
// eats the start of the header row, leaving less width than the full card.
const HEADER_BADGE_WIDTH = 86
const NAME_CHARS_PER_100PX = 13

/**
 * Minimum height that shows all of a service-node's content without clipping.
 * Pure (no editor/DOM) so it is unit-testable and usable from getGeometry.
 * Deliberately errs generous — better a little tall than a clipped repoUrl.
 */
export function computeServiceNodeMinHeight(props: {
	w: number
	name: string
	repoUrl: string
	ownerTeam: string
}): number {
	// The name shares the header row with the badge, so its usable width is the
	// card width minus the badge and padding.
	const nameWidth = Math.max(60, props.w - CARD_PADDING * 2 - HEADER_BADGE_WIDTH)
	const charsPerLine = Math.max(6, Math.floor((nameWidth / 100) * NAME_CHARS_PER_100PX))
	const nameLines = Math.max(1, Math.ceil(props.name.length / charsPerLine))
	let height = CARD_PADDING * 2
	// Header row grows with wrapped name lines beyond the first.
	height += HEADER_HEIGHT + (nameLines - 1) * NAME_LINE_HEIGHT
	if (props.ownerTeam) height += ROW_HEIGHT
	if (props.repoUrl) height += ROW_HEIGHT
	return Math.round(height)
}

export class ServiceNodeShapeUtil extends ShapeUtil<ServiceNodeShape> {
	static override type = 'service-node' as const

	static override props: RecordProps<ServiceNodeShape> = {
		w: T.number,
		h: T.number,
		name: T.string,
		kind: T.literalEnum('api', 'db', 'queue', 'cron', 'web', 'lib', 'app', 'tool'),
		repoUrl: T.string,
		ownerTeam: T.string
	}

	getDefaultProps(): ServiceNodeShape['props'] {
		// h is a floor the user can grow by resizing; geometry/render never go
		// below the content's min height regardless of this value.
		return { w: 220, h: 96, name: 'service', kind: 'api', repoUrl: '', ownerTeam: '' }
	}

	getGeometry(shape: ServiceNodeShape) {
		// Never smaller than the content needs — a card authored with the old
		// fixed h=96 still renders its repoUrl instead of clipping it.
		const height = Math.max(shape.props.h, computeServiceNodeMinHeight(shape.props))
		return new Rectangle2d({ width: shape.props.w, height, isFilled: true })
	}

	override canResize() {
		return true
	}

	component(shape: ServiceNodeShape) {
		const { name, kind, repoUrl, ownerTeam, w } = shape.props
		const accent = KIND_COLOR[kind]
		const h = Math.max(shape.props.h, computeServiceNodeMinHeight(shape.props))
		return (
			<HTMLContainer
				style={{
					width: w,
					height: h,
					boxSizing: 'border-box',
					border: `2px solid ${accent}`,
					borderRadius: 8,
					background: 'var(--color-panel, #fff)',
					padding: 10,
					display: 'flex',
					flexDirection: 'column',
					gap: 4,
					pointerEvents: 'all',
					overflow: 'hidden',
					fontFamily: 'var(--tl-font-sans, sans-serif)'
				}}
			>
				<div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
					<span
						style={{
							flexShrink: 0,
							fontSize: 10,
							fontWeight: 700,
							color: '#fff',
							background: accent,
							borderRadius: 4,
							padding: '1px 6px',
							textTransform: 'uppercase',
							letterSpacing: 0.5,
							// Nudge the badge down to align with the first text line.
							marginTop: 2
						}}
					>
						{KIND_LABEL[kind]}
					</span>
					{/* Wraps to as many lines as needed — computeServiceNodeMinHeight
					    budgets the card height for exactly this. */}
					<span
						style={{
							fontWeight: 600,
							fontSize: 15,
							minWidth: 0,
							whiteSpace: 'normal',
							wordBreak: 'break-word'
						}}
					>
						{name}
					</span>
				</div>
				{ownerTeam ? <div style={{ fontSize: 12, opacity: 0.7 }}>owner: {ownerTeam}</div> : null}
				{repoUrl ? (
					<a
						href={repoUrl}
						onClick={(e) => e.stopPropagation()}
						style={{ fontSize: 12, color: accent, textDecoration: 'underline', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
					>
						{repoUrl.replace(/^https?:\/\//, '')}
					</a>
				) : null}
			</HTMLContainer>
		)
	}

	getIndicatorPath(shape: ServiceNodeShape) {
		const height = Math.max(shape.props.h, computeServiceNodeMinHeight(shape.props))
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, height, 8)
		return path
	}
}
