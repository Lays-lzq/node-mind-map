import {
    establishMindMapLink,
    establishMindMapLinkQuiet,
    getMindMapNodeAxisBounds,
    severAllMindMapEdgesTouchingIdSet,
    wouldMindMapLinkCreateCycle,
    type MindMapCanvasNode
} from './mindMapNodeOps';
import {
    DEFAULT_MIND_MAP_CHILD_GAP_FROM_PARENT,
    DEFAULT_MIND_MAP_SIBLING_STEP_Y,
    NODE_RECT_LAYOUT,
    normalizeLinkArray
} from './medicineGuide';
import {
    alternatingSiblingBaseYOffset,
    DEFAULT_MIND_MAP_GROUP_BLOCK_PAD,
    resolveNonCollidingChildCenterLikeAddChild
} from './mindMapChildPlacement';
import type { MultiSelectHullRect } from './mindMapMultiSelectHull';
import { getMindMapNodeAccentColorByLevel } from './mindMapNodeAccentColor';

/** 拖拽成组靠近外节点时的虚线磁吸预览（松手可能据此建边） */
export type MindMapDragBundleSnapPreview = {
    mode: 'out' | 'in';
    targetId: number;
    anchorId: number;
};

export const DRAG_BUNDLE_SNAP_PX = 80;
export const DRAG_BUNDLE_SNAP_Y_BAND_RATIO = 0.9;

/** 成组拖动（≥2）且出现磁吸连接虚线预览时为 true；单节点磁吸不在此列 */
export function isMindMapBoxSelectBundleSnapPreviewActive(
    preview: MindMapDragBundleSnapPreview | null,
    bundleMovingCount: number
): boolean {
    return preview != null && bundleMovingCount >= 2;
}

/** 外包矩形左/右衔接点（与画布虚线框圆心一致） */
export function bundleHullHandlePorts(hull: MultiSelectHullRect): {
    lx: number;
    ly: number;
    rx: number;
    ry: number;
} {
    const cy = hull.y + hull.height / 2;
    return {
        lx: hull.x,
        ly: cy,
        rx: hull.x + hull.width,
        ry: cy
    };
}

/** 框选磁吸虚线预览期间：凡与框选集合任一端点相连的实线箭头暂不绘制 */
export function mindMapArrowEdgeHiddenDuringBoxSnapPreview(
    preview: MindMapDragBundleSnapPreview | null,
    selectedNodeIds: ReadonlySet<number>,
    fromId: number,
    toId: number
): boolean {
    if (!isMindMapBoxSelectBundleSnapPreviewActive(preview, selectedNodeIds.size)) {
        return false;
    }
    return selectedNodeIds.has(fromId) || selectedNodeIds.has(toId);
}

export function dragBundleSnapLinkAllowed(
    nodes: readonly MindMapCanvasNode[],
    fromId: number,
    toId: number,
    opts?: { boxSelectPreview?: boolean }
): boolean {
    const from = nodes.find((n) => n.nodeId === fromId);
    const to = nodes.find((n) => n.nodeId === toId);
    if (!from || !to || fromId === toId) return false;
    /** 框选磁吸预览：松手会先拆光框选相关边再挂接，不按当前拓扑判环/重复 */
    if (opts?.boxSelectPreview) return true;
    if (normalizeLinkArray(from.nextNodes).includes(toId)) return false;
    return !wouldMindMapLinkCreateCycle(nodes, fromId, toId);
}

export function computeDragBundleHandlePorts(
    nodes: readonly MindMapCanvasNode[],
    movingIds: ReadonlySet<number>,
    halfWidth: number,
    halfHeight: number,
    multiBundlePad: number
): { lx: number; ly: number; rx: number; ry: number } | null {
    let minL = Infinity;
    let minT = Infinity;
    let maxR = -Infinity;
    let maxB = -Infinity;
    for (const n of nodes) {
        if (!movingIds.has(n.nodeId)) continue;
        const b = getMindMapNodeAxisBounds(n, halfWidth, halfHeight);
        minL = Math.min(minL, b.left);
        minT = Math.min(minT, b.top);
        maxR = Math.max(maxR, b.right);
        maxB = Math.max(maxB, b.bottom);
    }
    if (!Number.isFinite(minL)) return null;
    const pad = movingIds.size >= 2 ? multiBundlePad : 0;
    minL -= pad;
    maxR += pad;
    const cy = (minT + maxB) / 2;
    return { lx: minL, ly: cy, rx: maxR, ry: cy };
}

export function pickRightMostInMoving(
    nodes: readonly MindMapCanvasNode[],
    movingIds: ReadonlySet<number>,
    defaultNodeWidth: number
): number | null {
    let bestR = -Infinity;
    let bestId: number | null = null;
    for (const n of nodes) {
        if (!movingIds.has(n.nodeId)) continue;
        const w = Number(n.rectConf?.width ?? defaultNodeWidth) / 2;
        const r = n.x + w;
        if (r > bestR) {
            bestR = r;
            bestId = n.nodeId;
        }
    }
    return bestId;
}

export function pickLeftMostInMoving(
    nodes: readonly MindMapCanvasNode[],
    movingIds: ReadonlySet<number>,
    defaultNodeWidth: number
): number | null {
    let bestL = Infinity;
    let bestId: number | null = null;
    for (const n of nodes) {
        if (!movingIds.has(n.nodeId)) continue;
        const w = Number(n.rectConf?.width ?? defaultNodeWidth) / 2;
        const l = n.x - w;
        if (l < bestL) {
            bestL = l;
            bestId = n.nodeId;
        }
    }
    return bestId;
}

function boxSnapCandidateYAligned(
    cand: MindMapCanvasNode,
    nodes: readonly MindMapCanvasNode[],
    movingIds: ReadonlySet<number>,
    yBand: number,
    hullCenterY?: number
): boolean {
    if (
        hullCenterY != null &&
        Number.isFinite(hullCenterY) &&
        Math.abs(cand.y - hullCenterY) <= yBand
    ) {
        return true;
    }
    for (const n of nodes) {
        if (!movingIds.has(n.nodeId)) continue;
        if (Math.abs(cand.y - n.y) <= yBand) return true;
    }
    return false;
}

function boxSnapMinVerticalDistToMoving(
    cand: MindMapCanvasNode,
    nodes: readonly MindMapCanvasNode[],
    movingIds: ReadonlySet<number>
): number {
    let min = Infinity;
    for (const n of nodes) {
        if (!movingIds.has(n.nodeId)) continue;
        min = Math.min(min, Math.abs(cand.y - n.y));
    }
    return min;
}

export function computeMindMapDragBundleSnapPreview(
    nodes: readonly MindMapCanvasNode[],
    movingIds: ReadonlySet<number>,
    layout: {
        nodeWidth: number;
        nodeHeight: number;
        snapPx?: number;
        yBandRatio?: number;
        bundleSidePad?: number;
        /** 成组拖动：仅虚线框左端口 ↔ 外部节点右端口（in） */
        boxSelectSnap?: boolean;
        /** 与画布虚线框一致的外包矩形；有则磁吸距离按左/右圆点判定 */
        bundleHull?: MultiSelectHullRect | null;
    }
): MindMapDragBundleSnapPreview | null {
    if (!movingIds.size) return null;
    const hw = layout.nodeWidth / 2;
    const hh = layout.nodeHeight / 2;
    const snapPx = layout.snapPx ?? DRAG_BUNDLE_SNAP_PX;
    const yBandRatio = layout.yBandRatio ?? DRAG_BUNDLE_SNAP_Y_BAND_RATIO;
    const bundlePad = layout.bundleSidePad ?? 8;
    const bundleHull = layout.bundleHull ?? null;

    const ports = bundleHull
        ? bundleHullHandlePorts(bundleHull)
        : computeDragBundleHandlePorts(
              nodes,
              movingIds,
              hw,
              hh,
              bundlePad
          );
    if (!ports) return null;

    const yBand = layout.nodeHeight * yBandRatio;
    const boxSelectSnap =
        layout.boxSelectSnap === true ||
        (bundleHull != null && movingIds.size >= 2);
    const anchorOut = pickRightMostInMoving(
        nodes,
        movingIds,
        layout.nodeWidth
    );
    const anchorIn = pickLeftMostInMoving(nodes, movingIds, layout.nodeWidth);

    let best: {
        mode: 'out' | 'in';
        targetId: number;
        anchorId: number;
        dist: number;
    } | null = null;

    const linkOk = (fromId: number, toId: number) =>
        dragBundleSnapLinkAllowed(nodes, fromId, toId, {
            boxSelectPreview: boxSelectSnap
        });

    for (const cand of nodes) {
        if (movingIds.has(cand.nodeId)) continue;
        if (boxSelectSnap) {
            if (
                !boxSnapCandidateYAligned(
                    cand,
                    nodes,
                    movingIds,
                    yBand,
                    ports.ly
                )
            ) {
                continue;
            }
        } else if (Math.abs(cand.y - ports.ly) > yBand) {
            continue;
        }

        const cl = cand.x - hw;
        const cr = cand.x + hw;

        /** 框选磁吸：只允许外包左口 ← 外节点右口，不走右口 out */
        if (anchorOut != null && !boxSelectSnap) {
            const dyOut = boxSelectSnap
                ? Math.min(
                      Math.abs(cand.y - ports.ry),
                      boxSnapMinVerticalDistToMoving(
                          cand,
                          nodes,
                          movingIds
                      )
                  )
                : Math.abs(cand.y - ports.ry);
            const gapOut = boxSelectSnap ? cl - ports.rx : ports.rx - cl;
            const dOut = Math.hypot(gapOut, dyOut);
            const outSideOk = boxSelectSnap ? gapOut > 0 : gapOut >= 0;
            if (
                outSideOk &&
                dOut <= snapPx &&
                linkOk(anchorOut, cand.nodeId)
            ) {
                const c = {
                    mode: 'out' as const,
                    targetId: cand.nodeId,
                    anchorId: anchorOut,
                    dist: dOut
                };
                if (
                    !best ||
                    c.dist < best.dist ||
                    (c.dist === best.dist && c.targetId < best.targetId)
                ) {
                    best = c;
                }
            }
        }

        if (anchorIn != null) {
            const dy = boxSelectSnap
                ? Math.min(
                      Math.abs(cand.y - ports.ly),
                      boxSnapMinVerticalDistToMoving(
                          cand,
                          nodes,
                          movingIds
                      )
                  )
                : Math.abs(cand.y - ports.ly);
            const gapIn = boxSelectSnap ? ports.lx - cr : cr - ports.lx;
            const dIn = Math.hypot(gapIn, dy);
            const inSideOk = boxSelectSnap ? gapIn > 0 : gapIn >= 0;
            if (
                inSideOk &&
                dIn <= snapPx &&
                linkOk(cand.nodeId, anchorIn)
            ) {
                const c = {
                    mode: 'in' as const,
                    targetId: cand.nodeId,
                    anchorId: anchorIn,
                    dist: dIn
                };
                if (
                    !best ||
                    c.dist < best.dist ||
                    (c.dist === best.dist && c.targetId < best.targetId)
                ) {
                    best = c;
                }
            }
        }
    }

    if (!best) return null;
    return {
        mode: best.mode,
        targetId: best.targetId,
        anchorId: best.anchorId
    };
}

export type MindMapDragBundleSnapLayout = {
    nodeWidth?: number;
    nodeHeight?: number;
};

/** 将若干子节点按「父右侧 + 兄弟阶梯」重排（与 addChildNodeUnder / 增量布局同源几何） */
export function relayoutMindMapNodesAsChildrenOf(
    nodes: readonly MindMapCanvasNode[],
    parentId: number,
    childIds: readonly number[],
    layout?: MindMapDragBundleSnapLayout
): void {
    const parent = nodes.find((n) => n.nodeId === parentId);
    if (!parent || !Number.isFinite(parent.x) || !Number.isFinite(parent.y)) {
        return;
    }

    const nw = layout?.nodeWidth ?? NODE_RECT_LAYOUT.width;
    const nh = layout?.nodeHeight ?? NODE_RECT_LAYOUT.height;
    const gapX = DEFAULT_MIND_MAP_CHILD_GAP_FROM_PARENT;
    const siblingStepY = DEFAULT_MIND_MAP_SIBLING_STEP_Y;
    const pad = 14;
    const stepY = Math.max(DEFAULT_MIND_MAP_SIBLING_STEP_Y, nh + pad * 2);
    const halfW = nw / 2;
    const halfH = nh / 2;
    const groupPad = DEFAULT_MIND_MAP_GROUP_BLOCK_PAD;
    const geom = {
        nodeWidth: nw,
        nodeHeight: nh,
        collisionPadding: pad,
        lateralStepX: Math.max(Math.floor(nw * 0.45), 96),
        gapX,
        siblingStepY: stepY,
        maxVerticalScanSteps: 72,
        maxLateralEscalations: 12,
        anchorNodeId: parentId,
        groupBlockPadding: groupPad
    };

    const sorted = [...childIds]
        .map((x) => Number(x))
        .filter((id) => id !== parentId && !Number.isNaN(id))
        .sort((a, b) => a - b);

    for (let i = 0; i < sorted.length; i++) {
        const child = nodes.find((n) => n.nodeId === sorted[i]);
        if (!child) continue;
        const preferredX = parent.x + gapX;
        const baseY =
            parent.y + alternatingSiblingBaseYOffset(i, siblingStepY);
        const { x, y } = resolveNonCollidingChildCenterLikeAddChild(
            nodes,
            preferredX,
            baseY,
            halfW,
            halfH,
            geom
        );
        child.x = x;
        child.y = y;
    }
}

/**
 * 磁吸松手：多选框选时先拆除框选集合相关的全部连线（含与框外节点的边），再以磁吸目标为父挂回全组并局部排版；
 * 单选沿用 anchor 方向建边。
 */
export function commitMindMapDragBundleSnap(
    nodes: MindMapCanvasNode[],
    args: {
        movingIds: Set<number> | null;
        preview: MindMapDragBundleSnapPreview | null;
        selectedNodeIds: ReadonlySet<number>;
        layout?: MindMapDragBundleSnapLayout;
    }
): boolean {
    const { movingIds, preview: snap, selectedNodeIds, layout } = args;
    if (!movingIds?.size || !snap) return false;

    const stripIds = new Set<number>(
        selectedNodeIds.size >= 2
            ? [...selectedNodeIds].map((x) => Number(x))
            : [...movingIds].map((x) => Number(x))
    );

    const groupCommit = stripIds.size >= 2;
    if (groupCommit) {
        if (snap.mode !== 'in') return false;
        const parentId = Number(snap.targetId);
        if (Number.isNaN(parentId) || !nodes.some((n) => n.nodeId === parentId)) {
            return false;
        }

        /** 框选内↔框选内、框选内↔框外：凡与 stripIds 相关的有向边全部拆除 */
        severAllMindMapEdgesTouchingIdSet(nodes, stripIds);

        const childIds: number[] = [];
        const sortedG = [...stripIds].sort((a, b) => a - b);
        for (const gid of sortedG) {
            if (gid === parentId) continue;
            if (establishMindMapLinkQuiet(nodes, parentId, gid)) {
                childIds.push(gid);
            }
        }

        if (childIds.length) {
            relayoutMindMapNodesAsChildrenOf(nodes, parentId, childIds, layout);
        }
        return true;
    }

    const fromId = snap.mode === 'out' ? snap.anchorId : snap.targetId;
    const toId = snap.mode === 'out' ? snap.targetId : snap.anchorId;
    if (!dragBundleSnapLinkAllowed(nodes, fromId, toId)) return false;
    return establishMindMapLink(nodes, fromId, toId);
}

export type DragBundleSnapPreviewPathHelpers = {
    edgePorts: (
        from: MindMapCanvasNode,
        to: MindMapCanvasNode
    ) => { sx: number; sy: number; ex: number; ey: number };
    obstaclePath: (
        startX: number,
        startY: number,
        endX: number,
        endY: number,
        from: MindMapCanvasNode,
        to: MindMapCanvasNode
    ) => number[];
    roundedPath: (points: number[], radius: number) => string | undefined | null;
};

/** 多选成组时虚线一端贴在此外包矩形边上（与画布 multiSelectHullRect 一致），不深入组内节点 */
export type BuildDragBundleSnapPreviewOptions = {
    bundleHull: MultiSelectHullRect | null;
    /** 源节点拓扑层级，用于虚线颜色与正式边一致 */
    sourceNodeLevel?: number;
};

/** 主轴式预览：先横再竖的 L 折线，避开组内避障对虚线过度弯折 */
function buildDragBundleHullPreviewPoints(
    sx: number,
    sy: number,
    ex: number,
    ey: number
): number[] {
    if (Math.hypot(sx - ex, sy - ey) < 0.5) return [sx, sy, ex, ey];
    if (Math.abs(sy - ey) < 0.5) return [sx, sy, ex, ey];
    if (Math.abs(sx - ex) < 0.5) return [sx, sy, ex, ey];
    return [sx, sy, ex, sy, ex, ey];
}

/** 拖线 / 磁吸预览虚线：略粗 + 白描边光晕，避免被节点白底盖住后看不清 */
export function buildMindMapDashedPreviewPathKonvaConfig(
    data: string,
    overrides?: Record<string, unknown> & { stroke?: string }
): Record<string, unknown> {
    const { stroke: strokeOverride, ...restOverrides } = overrides ?? {};
    return {
        data,
        stroke: strokeOverride ?? '#1A55E9',
        strokeWidth: 3,
        lineCap: 'round',
        lineJoin: 'round',
        dash: [14, 7],
        fill: '',
        listening: false,
        perfectDrawEnabled: false,
        shadowColor: '#ffffff',
        shadowBlur: 10,
        shadowOpacity: 1,
        shadowEnabled: true,
        ...restOverrides
    };
}

/** 磁吸虚线路径的 Konva Path config（依赖画布避障路由，由宿主注入） */
export function buildDragBundleSnapPreviewPathConfig(
    snap: MindMapDragBundleSnapPreview | null,
    nodes: readonly MindMapCanvasNode[],
    helpers: DragBundleSnapPreviewPathHelpers,
    options?: BuildDragBundleSnapPreviewOptions
): Record<string, unknown> | null {
    if (!snap) return null;

    const fromId = snap.mode === 'out' ? snap.anchorId : snap.targetId;
    const toId = snap.mode === 'out' ? snap.targetId : snap.anchorId;
    const fromNode = nodes.find((n) => n.nodeId === fromId);
    const toNode = nodes.find((n) => n.nodeId === toId);
    if (!fromNode || !toNode) return null;

    const ports = helpers.edgePorts(fromNode, toNode);

    const bundleHull = options?.bundleHull ?? null;
    let startX: number;
    let startY: number;
    let endX: number;
    let endY: number;
    let points: number[];

    if (bundleHull) {
        const hy = bundleHull.y + bundleHull.height / 2;
        if (snap.mode === 'out') {
            startX = bundleHull.x + bundleHull.width;
            startY = hy;
            endX = ports.ex;
            endY = ports.ey;
        } else {
            startX = ports.sx;
            startY = ports.sy;
            endX = bundleHull.x;
            endY = hy;
        }
        points = buildDragBundleHullPreviewPoints(startX, startY, endX, endY);
    } else {
        startX = ports.sx;
        startY = ports.sy;
        endX = ports.ex;
        endY = ports.ey;
        points = helpers.obstaclePath(
            startX,
            startY,
            endX,
            endY,
            fromNode,
            toNode
        );
    }

    let pathData = '';
    if (points.length >= 4) {
        pathData = helpers.roundedPath(points.slice(), 8) ?? '';
    }
    if (!pathData) {
        pathData =
            helpers.roundedPath([startX, startY, endX, endY], 8) ??
            `M ${startX} ${startY} L ${endX} ${endY}`;
    }

    return buildMindMapDashedPreviewPathKonvaConfig(pathData, {
        stroke: getMindMapNodeAccentColorByLevel(options?.sourceNodeLevel ?? 0)
    });
}
