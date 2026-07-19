import type { TLAnyShapeUtilConstructor } from 'tldraw'
import { CodeRefShapeUtil } from './code-ref/code-ref-shape-util'
import { MermaidBlockShapeUtil } from './mermaid-block/mermaid-block-shape-util'
import { ServiceNodeShapeUtil } from './service-node/service-node-shape-util'

// All custom shapes for the app, registered once and passed to <Tldraw>.
// Adding a shape = add its ShapeUtil here.
export const customShapeUtils: TLAnyShapeUtilConstructor[] = [
	ServiceNodeShapeUtil,
	CodeRefShapeUtil,
	MermaidBlockShapeUtil
]
