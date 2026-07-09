import {
    getMindMapNodeAxisBounds,
    type MindMapCanvasNode
} from './mindMapNodeOps';

/** 进入吸附的距离（画布坐标 px） */
export const DRAG_ALIGN_SNAP_PX = 8;
/** 沿吸附轴拖过该距离后解除吸附，恢复自由拖动 */
export const DRAG_ALIGN_BREAK_PX = 12;

export type MindMapDragAlignGuide = {
    kind: 'vertical' | 'horizontal';
    /** 竖线 x；横线 y */
    pos: number;
    start: number;
    end: number;
};

export type MindMapDragAlignAxisLock = {
    alignCoord: number;
    bundleEdge: 'left' | 'right' | 'centerX' | 'top' | 'bottom' | 'centerY';
};

export type MindMapDragAlignSnapSession = {
    xLock: MindMapDragAlignAxisLock | null;
    yLock: MindMapDragAlignAxisLock | null;
};

export function createMindMapDragAlignSnapSession(): MindMapDragAlignSnapSession {
    return { xLock: null, yLock: null };
}

type AxisBounds = {
    left: number;
    right: number;
    top: number;
    bottom: number;
    centerX: number;
    centerY: number;
};

type XEdge = 'left' | 'right' | 'centerX';
type YEdge = 'top' | 'bottom' | 'centerY';

const X_EDGES: XEdge[] = ['left', 'right', 'centerX'];
const Y_EDGES: YEdge[] = ['top', 'bottom', 'centerY'];

function nodeBounds(
    node: MindMapCanvasNode,
    halfWidth: number,
    halfHeight: number
): AxisBounds {
    const b = getMindMapNodeAxisBounds(node, halfWidth, halfHeight);
    return {
        ...b,
        centerX: node.x,
        centerY: node.y
    };
}

function mergeMovingBounds(
    nodes: readonly MindMapCanvasNode[],
    movingIds: ReadonlySet<number>,
    origins: ReadonlyMap<number, { x: number; y: number }>,
    dx: number,
    dy: number,
    halfWidth: number,
    halfHeight: number
): AxisBounds | null {
    let minL = Infinity;
    let minT = Infinity;
    let maxR = -Infinity;
    let maxB = -Infinity;
    for (const n of nodes) {
        if (!movingIds.has(n.nodeId)) continue;
        const o = origins.get(n.nodeId);
        if (!o) continue;
        const b = getMindMapNodeAxisBounds(
            { x: o.x + dx, y: o.y + dy },
            halfWidth,
            halfHeight
        );
        minL = Math.min(minL, b.left);
        minT = Math.min(minT, b.top);
        maxR = Math.max(maxR, b.right);
        maxB = Math.max(maxB, b.bottom);
    }
    if (!Number.isFinite(minL)) return null;
    return {
        left: minL,
        right: maxR,
        top: minT,
        bottom: maxB,
        centerX: (minL + maxR) / 2,
        centerY: (minT + maxB) / 2
    };
}

function bundleEdgeValue(b: AxisBounds, edge: XEdge | YEdge): number {
    switch (edge) {
        case 'left':
            return b.left;
        case 'right':
            return b.right;
        case 'centerX':
            return b.centerX;
        case 'top':
            return b.top;
        case 'bottom':
            return b.bottom;
        case 'centerY':
            return b.centerY;
    }
}

function verticalGuide(
    x: number,
    y1: number,
    y2: number
): MindMapDragAlignGuide {
    return {
        kind: 'vertical',
        pos: x,
        start: Math.min(y1, y2),
        end: Math.max(y1, y2)
    };
}

function horizontalGuide(
    y: number,
    x1: number,
    x2: number
): MindMapDragAlignGuide {
    return {
        kind: 'horizontal',
        pos: y,
        start: Math.min(x1, x2),
        end: Math.max(x1, x2)
    };
}

type SnapPick = {
    bundleEdge: XEdge | YEdge;
    alignCoord: number;
    dist: number;
};

function findBestXSnap(
    bundle: AxisBounds,
    staticBounds: AxisBounds[],
    snapPx: number
): SnapPick | null {
    let best: SnapPick | null = null;
    for (const be of X_EDGES) {
        const bv = bundleEdgeValue(bundle, be);
        for (const sb of staticBounds) {
            for (const se of X_EDGES) {
                const sv = bundleEdgeValue(sb, se);
                const dist = Math.abs(bv - sv);
                if (dist > snapPx) continue;
                const pick: SnapPick = {
                    bundleEdge: be,
                    alignCoord: sv,
                    dist
                };
                if (
                    !best ||
                    pick.dist < best.dist ||
                    (pick.dist === best.dist &&
                        pick.bundleEdge.localeCompare(best.bundleEdge) < 0)
                ) {
                    best = pick;
                }
            }
        }
    }
    return best;
}

function findBestYSnap(
    bundle: AxisBounds,
    staticBounds: AxisBounds[],
    snapPx: number
): SnapPick | null {
    let best: SnapPick | null = null;
    for (const be of Y_EDGES) {
        const bv = bundleEdgeValue(bundle, be);
        for (const sb of staticBounds) {
            for (const se of Y_EDGES) {
                const sv = bundleEdgeValue(sb, se);
                const dist = Math.abs(bv - sv);
                if (dist > snapPx) continue;
                const pick: SnapPick = {
                    bundleEdge: be,
                    alignCoord: sv,
                    dist
                };
                if (
                    !best ||
                    pick.dist < best.dist ||
                    (pick.dist === best.dist &&
                        pick.bundleEdge.localeCompare(best.bundleEdge) < 0)
                ) {
                    best = pick;
                }
            }
        }
    }
    return best;
}

function extendVerticalGuide(
    alignX: number,
    bundle: AxisBounds,
    staticBounds: AxisBounds[]
): MindMapDragAlignGuide {
    let yMin = bundle.top;
    let yMax = bundle.bottom;
    for (const sb of staticBounds) {
        for (const se of X_EDGES) {
            if (Math.abs(bundleEdgeValue(sb, se) - alignX) < 0.5) {
                yMin = Math.min(yMin, sb.top);
                yMax = Math.max(yMax, sb.bottom);
            }
        }
    }
    return verticalGuide(alignX, yMin, yMax);
}

function extendHorizontalGuide(
    alignY: number,
    bundle: AxisBounds,
    staticBounds: AxisBounds[]
): MindMapDragAlignGuide {
    let xMin = bundle.left;
    let xMax = bundle.right;
    for (const sb of staticBounds) {
        for (const se of Y_EDGES) {
            if (Math.abs(bundleEdgeValue(sb, se) - alignY) < 0.5) {
                xMin = Math.min(xMin, sb.left);
                xMax = Math.max(xMax, sb.right);
            }
        }
    }
    return horizontalGuide(alignY, xMin, xMax);
}

function applyAxisLock(
    bundle: AxisBounds,
    lock: MindMapDragAlignAxisLock,
    breakPx: number
): { delta: number; broken: boolean } {
    const cur = bundleEdgeValue(bundle, lock.bundleEdge);
    if (Math.abs(cur - lock.alignCoord) > breakPx) {
        return { delta: 0, broken: true };
    }
    return { delta: lock.alignCoord - cur, broken: false };
}

export function computeMindMapDragAlignSnap(input: {
    nodes: readonly MindMapCanvasNode[];
    movingIds: ReadonlySet<number>;
    origins: ReadonlyMap<number, { x: number; y: number }>;
    dx: number;
    dy: number;
    session: MindMapDragAlignSnapSession;
    halfWidth: number;
    halfHeight: number;
    snapPx?: number;
    breakPx?: number;
}): {
    dx: number;
    dy: number;
    guides: MindMapDragAlignGuide[];
    session: MindMapDragAlignSnapSession;
} {
    const snapPx = input.snapPx ?? DRAG_ALIGN_SNAP_PX;
    const breakPx = input.breakPx ?? DRAG_ALIGN_BREAK_PX;
    let { dx, dy } = input;
    const session: MindMapDragAlignSnapSession = {
        xLock: input.session.xLock,
        yLock: input.session.yLock
    };
    const guides: MindMapDragAlignGuide[] = [];

    const staticBounds: AxisBounds[] = [];
    for (const n of input.nodes) {
        if (input.movingIds.has(n.nodeId)) continue;
        staticBounds.push(
            nodeBounds(n, input.halfWidth, input.halfHeight)
        );
    }
    if (!staticBounds.length) {
        return { dx, dy, guides, session };
    }

    const bundleAt = (dx0: number, dy0: number) =>
        mergeMovingBounds(
            input.nodes,
            input.movingIds,
            input.origins,
            dx0,
            dy0,
            input.halfWidth,
            input.halfHeight
        );

    // --- X 轴 ---
    if (session.xLock) {
        const bundle = bundleAt(dx, dy);
        if (bundle) {
            const locked = applyAxisLock(bundle, session.xLock, breakPx);
            if (locked.broken) {
                session.xLock = null;
            } else {
                dx += locked.delta;
                const bundle2 = bundleAt(dx, dy);
                if (bundle2 && session.xLock) {
                    guides.push(
                        extendVerticalGuide(
                            session.xLock.alignCoord,
                            bundle2,
                            staticBounds
                        )
                    );
                }
            }
        }
    }

    if (!session.xLock) {
        const bundle = bundleAt(dx, dy);
        if (bundle) {
            const pick = findBestXSnap(bundle, staticBounds, snapPx);
            if (pick) {
                dx +=
                    pick.alignCoord -
                    bundleEdgeValue(bundle, pick.bundleEdge as XEdge);
                session.xLock = {
                    alignCoord: pick.alignCoord,
                    bundleEdge: pick.bundleEdge as XEdge
                };
                const bundle2 = bundleAt(dx, dy);
                if (bundle2) {
                    guides.push(
                        extendVerticalGuide(
                            pick.alignCoord,
                            bundle2,
                            staticBounds
                        )
                    );
                }
            }
        }
    }

    // --- Y 轴 ---
    if (session.yLock) {
        const bundle = bundleAt(dx, dy);
        if (bundle) {
            const locked = applyAxisLock(bundle, session.yLock, breakPx);
            if (locked.broken) {
                session.yLock = null;
            } else {
                dy += locked.delta;
                const bundle2 = bundleAt(dx, dy);
                if (bundle2 && session.yLock) {
                    guides.push(
                        extendHorizontalGuide(
                            session.yLock.alignCoord,
                            bundle2,
                            staticBounds
                        )
                    );
                }
            }
        }
    }

    if (!session.yLock) {
        const bundle = bundleAt(dx, dy);
        if (bundle) {
            const pick = findBestYSnap(bundle, staticBounds, snapPx);
            if (pick) {
                dy +=
                    pick.alignCoord -
                    bundleEdgeValue(bundle, pick.bundleEdge as YEdge);
                session.yLock = {
                    alignCoord: pick.alignCoord,
                    bundleEdge: pick.bundleEdge as YEdge
                };
                const bundle2 = bundleAt(dx, dy);
                if (bundle2) {
                    guides.push(
                        extendHorizontalGuide(
                            pick.alignCoord,
                            bundle2,
                            staticBounds
                        )
                    );
                }
            }
        }
    }

    return { dx, dy, guides, session };
}

export function buildMindMapDragAlignGuideLineConfig(
    guide: MindMapDragAlignGuide
): Record<string, unknown> {
    const points =
        guide.kind === 'vertical'
            ? [guide.pos, guide.start, guide.pos, guide.end]
            : [guide.start, guide.pos, guide.end, guide.pos];
    return {
        points,
        stroke: '#FF4D4F',
        strokeWidth: 1,
        dash: [4, 4],
        listening: false,
        perfectDrawEnabled: false
    };
}
