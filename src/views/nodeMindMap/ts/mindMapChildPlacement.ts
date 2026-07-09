/** 子节点几何（与画布 `addChildNodeUnder` / 工单 NODE_RECT_LAYOUT 对齐；无业务依赖便于 medicineGuide / nodeOps 共用） */

import {
    buildMindMapWeakComponentGroupBounds,
    mindMapGroupBlocksOverlap,
    weakComponentIdSetContaining
} from './mindMapWeakComponents';

/** 与序列块底衬、多分量自动布局留白一致 */
export const DEFAULT_MIND_MAP_GROUP_BLOCK_PAD = 34;

export interface MindMapChildLayoutGeom {
    nodeWidth: number;
    /** 缺省则用 `resolve…` 内与宽度相关的默认高 */
    nodeHeight?: number;
    collisionPadding?: number;
    lateralStepX?: number;
    gapX?: number;
    siblingStepY?: number;
    maxVerticalScanSteps?: number;
    maxLateralEscalations?: number;
    /** 加子节点所属弱连通分量锚点（父 nodeId），用于与其它分组外包盒避让 */
    anchorNodeId?: number;
    /** 分组外包盒扩边，默认 {@link DEFAULT_MIND_MAP_GROUP_BLOCK_PAD} */
    groupBlockPadding?: number;
}

export type MindMapNodeLike = {
    nodeId: number;
    x: number;
    y: number;
    rectConf?: { width?: number; height?: number };
    prevNodes?: number[] | null;
};

/** 自中心点模型：两轴对齐矩形是否相交（含外层间隙） */
function centerRectsOverlap(
    ax: number,
    ay: number,
    aHw: number,
    aHh: number,
    bx: number,
    by: number,
    bHw: number,
    bHh: number,
    pad: number
): boolean {
    const dx = Math.abs(ax - bx);
    const dy = Math.abs(ay - by);
    return dx < aHw + bHw + pad && dy < aHh + bHh + pad;
}

function newChildCenterCollidesExisting(
    cx: number,
    cy: number,
    newHw: number,
    newHh: number,
    nodes: readonly MindMapNodeLike[],
    pad: number,
    fallbackW: number,
    fallbackH: number
): boolean {
    for (const n of nodes) {
        const ohw = (n.rectConf?.width ?? fallbackW) / 2;
        const ohh = (n.rectConf?.height ?? fallbackH) / 2;
        if (
            centerRectsOverlap(cx, cy, newHw, newHh, n.x, n.y, ohw, ohh, pad)
        )
            return true;
    }
    return false;
}

function sameNodeIdSet(
    a: ReadonlySet<number>,
    b: ReadonlySet<number>
): boolean {
    if (a.size !== b.size) return false;
    for (const id of a) {
        if (!b.has(id)) return false;
    }
    return true;
}

/** 待放置中心是否与其它弱连通分组（序列块）外包盒重叠 */
function newCenterCollidesOtherGroupBlocks(
    nodes: readonly MindMapNodeLike[],
    cx: number,
    cy: number,
    newHw: number,
    newHh: number,
    owningComponentIds: ReadonlySet<number> | null,
    groupPad: number,
    interGroupGap: number,
    fallbackW: number,
    fallbackH: number
): boolean {
    const blocks = buildMindMapWeakComponentGroupBounds(
        nodes,
        groupPad,
        fallbackW,
        fallbackH
    );
    if (!blocks.length) return false;
    /** 在已有分组内加子：仅一块时循环会跳过本组，无需再比 */
    if (blocks.length === 1 && owningComponentIds) return false;

    /** 加子只挪动新节点：用新节点外包盒与其它分组比，勿用整组投影（否则易误判并触发全图最右兜底） */
    const candidate = {
        left: cx - newHw - groupPad,
        right: cx + newHw + groupPad,
        top: cy - newHh - groupPad,
        bottom: cy + newHh + groupPad
    };

    for (const blk of blocks) {
        if (owningComponentIds && sameNodeIdSet(blk.nodeIds, owningComponentIds)) {
            continue;
        }
        if (mindMapGroupBlocksOverlap(candidate, blk, interGroupGap)) return true;
    }
    return false;
}

function placementCenterInvalid(
    nodes: readonly MindMapNodeLike[],
    cx: number,
    cy: number,
    newHw: number,
    newHh: number,
    pad: number,
    fallbackW: number,
    fallbackH: number,
    owningComponentIds: ReadonlySet<number> | null,
    groupPad: number
): boolean {
    if (
        newChildCenterCollidesExisting(
            cx,
            cy,
            newHw,
            newHh,
            nodes,
            pad,
            fallbackW,
            fallbackH
        )
    ) {
        return true;
    }
    return newCenterCollidesOtherGroupBlocks(
        nodes,
        cx,
        cy,
        newHw,
        newHh,
        owningComponentIds,
        groupPad,
        groupPad,
        fallbackW,
        fallbackH
    );
}

function contentBoundsOfNodes(
    nodes: readonly MindMapNodeLike[],
    fallbackW: number,
    fallbackH: number
): {
    left: number;
    right: number;
    top: number;
    bottom: number;
    cx: number;
    cy: number;
} | null {
    if (!nodes.length) return null;
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const n of nodes) {
        const hw = (n.rectConf?.width ?? fallbackW) / 2;
        const hh = (n.rectConf?.height ?? fallbackH) / 2;
        left = Math.min(left, n.x - hw);
        right = Math.max(right, n.x + hw);
        top = Math.min(top, n.y - hh);
        bottom = Math.max(bottom, n.y + hh);
    }
    return {
        left,
        right,
        top,
        bottom,
        cx: (left + right) / 2,
        cy: (top + bottom) / 2
    };
}

/**
 * 同父兄弟相对父中心的首选竖向偏移：0 → +1 → −1 → +2 → −2 …（步长为 stepY）。
 * 第 1 个子与父同高，其后在上下轨交替外扩，与泳道 +1/−1 轮换一致。
 */
export function alternatingSiblingBaseYOffset(
    siblingOrdinal: number,
    stepY: number
): number {
    if (siblingOrdinal <= 0) return 0;
    const ring = Math.ceil(siblingOrdinal / 2);
    const sign = siblingOrdinal % 2 === 1 ? 1 : -1;
    return sign * ring * stepY;
}

function rightmostSiblingContentEdgeX(
    nodes: readonly MindMapNodeLike[],
    parentId: number,
    fallbackW: number
): number | null {
    let right = -Infinity;
    let any = false;
    for (const n of nodes) {
        if (!n.prevNodes?.includes(parentId)) continue;
        any = true;
        const hw = (n.rectConf?.width ?? fallbackW) / 2;
        right = Math.max(right, n.x + hw);
    }
    return any && Number.isFinite(right) ? right : null;
}

function tryPlaceChildAtColumn(
    nodes: readonly MindMapNodeLike[],
    xCol: number,
    baseY: number,
    newHw: number,
    newHh: number,
    pad: number,
    stepY: number,
    maxV: number,
    fw: number,
    fh: number,
    owningComponentIds: ReadonlySet<number> | null,
    groupPad: number,
    extraY?: number[]
): { x: number; y: number } | null {
    for (let k = 0; k <= maxV; k++) {
        const yCandidates =
            k === 0
                ? [...(extraY ?? []), baseY]
                : [
                      baseY - k * stepY,
                      baseY + k * stepY,
                      ...(extraY ?? []).flatMap((y0) => [
                          y0 - k * stepY,
                          y0 + k * stepY
                      ])
                  ];
        for (const yCand of yCandidates) {
            if (
                !placementCenterInvalid(
                    nodes,
                    xCol,
                    yCand,
                    newHw,
                    newHh,
                    pad,
                    fw,
                    fh,
                    owningComponentIds,
                    groupPad
                )
            ) {
                return { x: xCol, y: yCand };
            }
        }
    }
    return null;
}

/**
 * 「父右侧 / 首选 baseY」附近纵向扫描换列**，与画布追加子节点的行为一致。
 */
export function resolveNonCollidingChildCenterLikeAddChild(
    nodes: readonly MindMapNodeLike[],
    preferredX: number,
    baseY: number,
    newHw: number,
    newHh: number,
    layout: MindMapChildLayoutGeom
): { x: number; y: number } {
    const pad = layout.collisionPadding ?? 14;
    const stepY = layout.siblingStepY ?? 50;
    const gapX =
        layout.gapX ?? layout.nodeWidth + 150;
    const lateralStep =
        layout.lateralStepX ??
        Math.max(Math.floor(layout.nodeWidth * 0.45), 96);
    const maxV = layout.maxVerticalScanSteps ?? 72;
    const maxLat = layout.maxLateralEscalations ?? 12;
    const fw = layout.nodeWidth;
    const fh =
        layout.nodeHeight ?? Math.round(Math.max(fw * 0.46, fw * 0.35));
    const groupPad = layout.groupBlockPadding ?? DEFAULT_MIND_MAP_GROUP_BLOCK_PAD;
    const owningComponentIds =
        layout.anchorNodeId != null
            ? weakComponentIdSetContaining(nodes, layout.anchorNodeId)
            : null;

    const tryLatRange = (latStart: number, latEnd: number, xOrigin: number) => {
        for (let lat = latStart; lat <= latEnd; lat++) {
            const hit = tryPlaceChildAtColumn(
                nodes,
                xOrigin + lat * lateralStep,
                baseY,
                newHw,
                newHh,
                pad,
                stepY,
                maxV,
                fw,
                fh,
                owningComponentIds,
                groupPad
            );
            if (hit) return hit;
        }
        return null;
    };

    const primary = tryLatRange(0, maxLat, preferredX);
    if (primary) return primary;

    /** 首选列仍满：在父附近继续右移扩列，避免落到「全图最右」 */
    const extended = tryLatRange(maxLat + 1, maxLat + 28, preferredX);
    if (extended) return extended;

    if (layout.anchorNodeId != null) {
        const parent = nodes.find((n) => n.nodeId === layout.anchorNodeId);
        const sibRight = rightmostSiblingContentEdgeX(
            nodes,
            layout.anchorNodeId,
            fw
        );
        const localX0 =
            Math.max(
                preferredX,
                (sibRight ?? parent?.x ?? preferredX) + pad + newHw
            ) + gapX * 0.15;
        const local = tryLatRange(0, 16, localX0);
        if (local) return local;
    }

    const lastX = preferredX + (maxLat + 28) * lateralStep;
    const anchor = contentBoundsOfNodes(nodes, fw, fh);
    if (anchor && layout.anchorNodeId == null) {
        const xFallback = anchor.right + pad + newHw;
        const hit = tryPlaceChildAtColumn(
            nodes,
            xFallback,
            baseY,
            newHw,
            newHh,
            pad,
            stepY,
            maxV,
            fw,
            fh,
            owningComponentIds,
            groupPad,
            [anchor.cy]
        );
        if (hit) return hit;
    }

    return { x: lastX, y: baseY };
}

/** 独立根节点摆放（螺旋扫描 + 全图右侧兜底） */
export interface MindMapStandalonePlacementGeom {
    nodeWidth: number;
    nodeHeight?: number;
    collisionPadding?: number;
    scanStepX?: number;
    scanStepY?: number;
    maxSpiralRings?: number;
    groupBlockPadding?: number;
}

/**
 * 在首选中心附近找不与其他节点重叠的位置（新建起始节点 / 模板节点）。
 */
export function resolveNonCollidingStandaloneCenter(
    nodes: readonly MindMapNodeLike[],
    preferredX: number,
    preferredY: number,
    layout: MindMapStandalonePlacementGeom
): { x: number; y: number } {
    const pad = layout.collisionPadding ?? 14;
    const fw = layout.nodeWidth;
    const fh =
        layout.nodeHeight ?? Math.round(Math.max(fw * 0.46, fw * 0.35));
    const newHw = fw / 2;
    const newHh = fh / 2;
    const stepX = layout.scanStepX ?? fw + pad;
    const stepY = layout.scanStepY ?? fh + pad;
    const maxRing = layout.maxSpiralRings ?? 24;
    const groupPad = layout.groupBlockPadding ?? DEFAULT_MIND_MAP_GROUP_BLOCK_PAD;

    if (
        !placementCenterInvalid(
            nodes,
            preferredX,
            preferredY,
            newHw,
            newHh,
            pad,
            fw,
            fh,
            null,
            groupPad
        )
    ) {
        return { x: preferredX, y: preferredY };
    }

    for (let ring = 1; ring <= maxRing; ring++) {
        for (let dx = -ring; dx <= ring; dx++) {
            for (let dy = -ring; dy <= ring; dy++) {
                if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
                const cx = preferredX + dx * stepX;
                const cy = preferredY + dy * stepY;
                if (
                    !placementCenterInvalid(
                        nodes,
                        cx,
                        cy,
                        newHw,
                        newHh,
                        pad,
                        fw,
                        fh,
                        null,
                        groupPad
                    )
                ) {
                    return { x: cx, y: cy };
                }
            }
        }
    }

    const anchor = contentBoundsOfNodes(nodes, fw, fh);
    if (anchor) {
        const xRight = anchor.right + pad + newHw;
        if (
            !placementCenterInvalid(
                nodes,
                xRight,
                anchor.cy,
                newHw,
                newHh,
                pad,
                fw,
                fh,
                null,
                groupPad
            )
        ) {
            return { x: xRight, y: anchor.cy };
        }
        return resolveNonCollidingChildCenterLikeAddChild(
            nodes,
            xRight,
            anchor.cy,
            newHw,
            newHh,
            {
                nodeWidth: fw,
                nodeHeight: fh,
                collisionPadding: pad,
                siblingStepY: stepY,
                lateralStepX: stepX,
                groupBlockPadding: groupPad
            }
        );
    }

    return { x: preferredX, y: preferredY };
}
