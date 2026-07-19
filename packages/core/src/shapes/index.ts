// Importing this module also applies the TLGlobalShapePropsMap augmentations
// declared in each shape-util file, so consumers get typed createShape calls.
export { customShapeUtils } from './custom-shapes-registry'
export { CodeRefShapeUtil } from './code-ref/code-ref-shape-util'
export type { CodeRefProps, CodeRefShape } from './code-ref/code-ref-shape-util'
export { MermaidBlockShapeUtil } from './mermaid-block/mermaid-block-shape-util'
export type { MermaidBlockProps, MermaidBlockShape } from './mermaid-block/mermaid-block-shape-util'
export { ServiceNodeShapeUtil } from './service-node/service-node-shape-util'
export type { ServiceKind, ServiceNodeProps, ServiceNodeShape } from './service-node/service-node-shape-util'
