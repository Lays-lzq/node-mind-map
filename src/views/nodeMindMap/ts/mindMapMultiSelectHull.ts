import {
    getMindMapNodeAxisBounds,
    type MindMapCanvasNode
} from './mindMapNodeOps';

/** 多选外包 AABB（画布 scene 坐标） */
export type MultiSelectHullRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

/** 与单节点衔接圆点一致的 Konva 圆配置片段 */
export type MindMapHullCircleLayout = {
    radius: number;
    stroke: string;
    strokeWidth: number;
    fill: string;
    scale: { x: number; y: number };
};

export function buildMultiSelectHullRect(options: {
    nodes: readonly MindMapCanvasNode[];
    selectedIds: ReadonlySet<number>;
    halfWidth: number;
    halfHeight: number;
    pad?: number;
}): MultiSelectHullRect | null {
    const { nodes, selectedIds, halfWidth, halfHeight } = options;
    const pad = options.pad ?? 8;
    if (selectedIds.size < 2) return null;
    let minL = Infinity;
    let minT = Infinity;
    let maxR = -Infinity;
    let maxB = -Infinity;
    for (const n of nodes) {
        if (!selectedIds.has(n.nodeId)) continue;
        const b = getMindMapNodeAxisBounds(n, halfWidth, halfHeight);
        minL = Math.min(minL, b.left);
        minT = Math.min(minT, b.top);
        maxR = Math.max(maxR, b.right);
        maxB = Math.max(maxB, b.bottom);
    }
    if (!Number.isFinite(minL)) return null;
    return {
        x: minL - pad,
        y: minT - pad,
        width: maxR - minL + pad * 2,
        height: maxB - minT + pad * 2
    };
}

/** 外包框左右中点圆（装饰用，listening 由调用方覆盖） */
export function buildMultiSelectHullHandleCircles(
    hull: MultiSelectHullRect | null,
    layout: MindMapHullCircleLayout
): {
    left: Record<string, unknown>;
    right: Record<string, unknown>;
} | null {
    if (!hull) return null;
    const cy = hull.y + hull.height / 2;
    const { radius, stroke, strokeWidth, fill, scale } = layout;
    const base = {
        radius,
        stroke,
        strokeWidth,
        fill,
        scale,
        listening: false
    };
    return {
        left: { ...base, x: hull.x, y: cy },
        right: { ...base, x: hull.x + hull.width, y: cy }
    };
}

export function isScenePointInsideMultiSelectHull(
    pt: { x: number; y: number },
    hull: MultiSelectHullRect
): boolean {
    return (
        pt.x >= hull.x &&
        pt.x <= hull.x + hull.width &&
        pt.y >= hull.y &&
        pt.y <= hull.y + hull.height
    );
}
