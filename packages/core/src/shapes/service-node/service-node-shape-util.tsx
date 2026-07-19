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
		return { w: 220, h: 96, name: 'service', kind: 'api', repoUrl: '', ownerTeam: '' }
	}

	getGeometry(shape: ServiceNodeShape) {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override canResize() {
		return true
	}

	component(shape: ServiceNodeShape) {
		const { name, kind, repoUrl, ownerTeam, w, h } = shape.props
		const accent = KIND_COLOR[kind]
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
				<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
					<span
						style={{
							fontSize: 10,
							fontWeight: 700,
							color: '#fff',
							background: accent,
							borderRadius: 4,
							padding: '1px 6px',
							textTransform: 'uppercase',
							letterSpacing: 0.5
						}}
					>
						{KIND_LABEL[kind]}
					</span>
					<span style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 8)
		return path
	}
}
