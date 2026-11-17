import type { CoreNode } from '../CoreNode.js';
export declare const sortByZIndexStable: (nodes: CoreNode[]) => void;
export declare const incrementalRepositionByZIndex: (changedNodes: CoreNode[], nodes: CoreNode[]) => void;
export declare const findChildIndexById: (node: CoreNode, children: CoreNode[]) => number;
export declare const removeChild: (node: CoreNode, children: CoreNode[]) => void;
