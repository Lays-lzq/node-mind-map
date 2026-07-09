/**
 * nodeMindMap 画布「节点」相关的纯数据与几何操作。
 *
 * 职责边界：
 * - 维护 nextNodes / prevNodes 拓扑、在列表中增删节点、画布坐标下的点选命中。
 * - 不操作 Vue 的 ref/reactive（如选中集、抽屉开关、Konva stage）；删节点后由页面自行同步 UI。
 *
 * 依赖 medicineGuide 的节点工厂与连边序列化工具，与工单 medicineOperateGuide 结构一致。
 */

import { ElMessage } from 'element-plus';
import {
    NODE_RECT_LAYOUT,
    type GuidePayload,
    createEmptyGuidePayload,
    createMindMapNode,
    normalizeLinkArray,
    reconcileMindMapNodeTopology,
    syncMindMapNodeNextNodeIDs,
    DEFAULT_MIND_MAP_CHILD_GAP_FROM_PARENT,
    DEFAULT_MIND_MAP_SIBLING_STEP_Y
} from './medicineGuide';
import {
    alternatingSiblingBaseYOffset,
    DEFAULT_MIND_MAP_GROUP_BLOCK_PAD,
    resolveNonCollidingChildCenterLikeAddChild,
    resolveNonCollidingStandaloneCenter
} from './mindMapChildPlacement';

// ---------------------------------------------------------------------------
// 类型（画布节点在运行时为 loosely-typed，此处只约束本文件用到的字段）
// ---------------------------------------------------------------------------

/** 画布上的一个思维导图节点（与 createMindMapNode 产物一致的超集） */
export interface MindMapCanvasNode {
    nodeId: number;
    x: number;
    y: number;
    rectConf?: { width?: number; height?: number };
    prevNodes?: number[] | null;
    nextNodes?: number[] | null;
    guide?: unknown;
    [key: string]: unknown;
}

/** 子节点相对于父节点的默认摆放（可与 nodeRectTemp 宽度一起传入以覆盖） */
export interface MindMapChildLayoutOptions {
    /** 节点外接盒宽度；用于与子节点横向间距叠加 */
    nodeWidth: number;
    /** 节点外接盒高度；碰撞检测用，默认与工单 NODE_RECT_LAYOUT 一致 */
    nodeHeight?: number;
    /** 两节点外包盒之间保留的最小间隙（画布坐标） */
    collisionPadding?: number;
    /** 纵向仍冲突时向右平移的步长，默认同量级为「约半格宽」 */
    lateralStepX?: number;
    /** 父右缘到子中心的水平偏移，默认与历史实现一致（nodeWidth + 150） */
    gapX?: number;
    /** 同一父节点下已有兄弟时，每条兄弟在 Y 方向的递增量 */
    siblingStepY?: number;
    /** 单次添加时由内向外尝试的「竖直步数半径」上限（每步 siblingStepY）；在首选 y 上下对称找最近空位 */
    maxVerticalScanSteps?: number;
    /** 向右「换列」的最多次数 */
    maxLateralEscalations?: number;
    /** 弱连通分组外包避让扩边，默认与序列块底衬一致 */
    groupBlockPadding?: number;
    /** 由 `addChildNodeUnder` 注入：父节点 id，用于扩围本分组盒 */
    anchorNodeId?: number;
}

/** 新建悬浮根节点时的中心点（画布 scene 坐标，非 window 像素） */
export interface MindMapPlacementCenter {
    x: number;
    y: number;
}

/** 独立根节点防重叠摆放（尺寸与 nodeRectTemp 一致） */
export interface MindMapStandaloneLayoutOptions {
    nodeWidth: number;
    nodeHeight?: number;
    collisionPadding?: number;
    groupBlockPadding?: number;
}

/**
 * 拖线预览用「光标伪终点」节点 id。
 * 须保证不在真实 nodeList 中出现，以便避障路由从障碍集中排除该中心。
 */
export const LINK_DRAG_TARGET_PHANTOM_ID = -910_000_001;

// ---------------------------------------------------------------------------
// id 与列表
// ---------------------------------------------------------------------------

/** 从当前列表取最大 nodeId；空列表时为 -1 */
export function maxNodeIdInList(nodes: readonly MindMapCanvasNode[]): number {
    if (!nodes.length) return -1;
    return Math.max(...nodes.map((n) => n.nodeId));
}

/** 在父节点 nextNodes 中追加子 id；若尚无出边则创建数组 */
export function appendOutgoingId(parent: MindMapCanvasNode, childId: number): void {
    if (parent.nextNodes?.length) {
        parent.nextNodes.push(childId);
    } else {
        parent.nextNodes = [childId];
    }
}

// ---------------------------------------------------------------------------
// 命中测试（画布坐标）
// ---------------------------------------------------------------------------

/**
 * 自顶向下（后绘制的在上）命中节点中心矩形。
 *
 * @param nodes 画布节点列表
 * @param px/py 画布坐标
 * @param excludeId 忽略的节点（通常为拖线起点）
 * @param fallbackRect 当节点未带 rectConf 时的默认宽高，默认工单 NODE_RECT_LAYOUT
 */
export function pickNodeAtCanvasPoint(
    nodes: readonly MindMapCanvasNode[],
    px: number,
    py: number,
    excludeId: number,
    fallbackRect: { width: number; height: number } = NODE_RECT_LAYOUT
): MindMapCanvasNode | null {
    for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (n.nodeId === excludeId) continue;
        const hw = (n.rectConf?.width ?? fallbackRect.width) / 2;
        const hh = (n.rectConf?.height ?? fallbackRect.height) / 2;
        if (
            px >= n.x - hw &&
            px <= n.x + hw &&
            py >= n.y - hh &&
            py <= n.y + hh
        ) {
            return n;
        }
    }
    return null;
}

/** 点到轴对齐矩形的最短距离平方（在矩形内则 0） */
function mindMapPointToRectMinDistSq(
    px: number,
    py: number,
    cx: number,
    cy: number,
    hw: number,
    hh: number
): number {
    const qx = Math.max(cx - hw, Math.min(px, cx + hw));
    const qy = Math.max(cy - hh, Math.min(py, cy + hh));
    const dx = px - qx;
    const dy = py - qy;
    return dx * dx + dy * dy;
}

/** 仅水平方向：点 px 到节点矩形 x 区间的最短距离平方（拖线吸附排序用，先比横向再比全距离） */
function mindMapPointToRectMinHorizDistSq(
    px: number,
    node: Pick<MindMapCanvasNode, 'x' | 'rectConf'>,
    fb: { width: number; height: number }
): number {
    const hw = Number(node.rectConf?.width ?? fb.width) / 2;
    const L = node.x - hw;
    const R = node.x + hw;
    const qx = Math.max(L, Math.min(px, R));
    const dx = px - qx;
    return dx * dx;
}

function wireDropScoreBetter(
    cand: {
        hSq: number;
        dSq: number;
        /** 光标与节点中心横向偏差平方，打破 50/52 同分总选更小 id */
        cxBiasSq: number;
        /** 光标到节点中心的距离平方 */
        toCenterSq: number;
        id: number;
    },
    best: {
        hSq: number;
        dSq: number;
        cxBiasSq: number;
        toCenterSq: number;
        id: number;
    } | null
): boolean {
    if (!best) return true;
    if (cand.hSq !== best.hSq) return cand.hSq < best.hSq;
    if (cand.dSq !== best.dSq) return cand.dSq < best.dSq;
    if (cand.cxBiasSq !== best.cxBiasSq)
        return cand.cxBiasSq < best.cxBiasSq;
    if (cand.toCenterSq !== best.toCenterSq)
        return cand.toCenterSq < best.toCenterSq;
    return cand.id < best.id;
}

/**
 * 拖线吸附「行带」：两节点 y 投影各向外再扩展 `extraPx` 后判重叠。
 * 增大该值可让略错行的横向目标仍进入首轮候选（可按画布再调）。
 */
export const DEFAULT_WIRE_DROP_Y_BAND_EXTRA_PX = Math.round(
    NODE_RECT_LAYOUT.height * 0.55
);

/** 两节点外包矩形在 y 轴上是否有交集（可带竖直扩带） */
function mindMapWireDropNodeRectsOverlapY(
    a: Pick<MindMapCanvasNode, 'x' | 'y' | 'rectConf'>,
    b: Pick<MindMapCanvasNode, 'x' | 'y' | 'rectConf'>,
    fb: { width: number; height: number },
    extraPx: number
): boolean {
    const ha = Number(a.rectConf?.height ?? fb.height) / 2 + extraPx;
    const hb = Number(b.rectConf?.height ?? fb.height) / 2 + extraPx;
    const aTop = a.y - ha;
    const aBot = a.y + ha;
    const bTop = b.y - hb;
    const bBot = b.y + hb;
    return aBot >= bTop && bBot >= aTop;
}

/**
 * 拖线松手目标节点：矩形命中优先；若无命中（常见于落点仍在起点节点外包盒内而被排除），
 * 则在 `maxSnapPx` 内吸附。优先在「与起点 y 投影重叠（可经 `yBandExtraPx` 扩带）」的候选中，
 * 按 **水平距离优先、再比欧氏距离** 择优，减少误吸纯上下错位节点；无首轮命中时再全表同规则回退。
 */
export function pickNodeAtCanvasPointForWireDrop(
    nodes: readonly MindMapCanvasNode[],
    px: number,
    py: number,
    excludeFromId: number,
    fallbackRect: { width: number; height: number } = NODE_RECT_LAYOUT,
    maxSnapPx: number = Math.round(NODE_RECT_LAYOUT.width * 0.55 + 48),
    yBandExtraPx: number = DEFAULT_WIRE_DROP_Y_BAND_EXTRA_PX
): MindMapCanvasNode | null {
    const direct = pickNodeAtCanvasPoint(
        nodes,
        px,
        py,
        excludeFromId,
        fallbackRect
    );
    if (direct) return direct;

    const fromNode = nodes.find((n) => n.nodeId === excludeFromId);
    const maxSq = maxSnapPx * maxSnapPx;

    const pickBestInYBand = (): MindMapCanvasNode | null => {
        if (!fromNode) return null;
        let best: MindMapCanvasNode | null = null;
        let bestScore: {
            hSq: number;
            dSq: number;
            cxBiasSq: number;
            toCenterSq: number;
            id: number;
        } | null = null;
        for (let i = nodes.length - 1; i >= 0; i--) {
            const n = nodes[i];
            if (n.nodeId === excludeFromId) continue;
            if (
                !mindMapWireDropNodeRectsOverlapY(
                    fromNode,
                    n,
                    fallbackRect,
                    yBandExtraPx
                )
            )
                continue;
            const hw = (n.rectConf?.width ?? fallbackRect.width) / 2;
            const hh = (n.rectConf?.height ?? fallbackRect.height) / 2;
            const dSq = mindMapPointToRectMinDistSq(px, py, n.x, n.y, hw, hh);
            if (dSq > maxSq) continue;
            const hSq = mindMapPointToRectMinHorizDistSq(px, n, fallbackRect);
            const dxC = px - n.x;
            const dyC = py - n.y;
            const cand = {
                hSq,
                dSq,
                cxBiasSq: dxC * dxC,
                toCenterSq: dxC * dxC + dyC * dyC,
                id: n.nodeId
            };
            if (wireDropScoreBetter(cand, bestScore)) {
                bestScore = cand;
                best = n;
            }
        }
        return best;
    };

    const yBandBest = pickBestInYBand();
    if (yBandBest) return yBandBest;

    let best: MindMapCanvasNode | null = null;
    let bestScore: {
        hSq: number;
        dSq: number;
        cxBiasSq: number;
        toCenterSq: number;
        id: number;
    } | null = null;

    for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (n.nodeId === excludeFromId) continue;
        const hw = (n.rectConf?.width ?? fallbackRect.width) / 2;
        const hh = (n.rectConf?.height ?? fallbackRect.height) / 2;
        const dSq = mindMapPointToRectMinDistSq(px, py, n.x, n.y, hw, hh);
        if (dSq > maxSq) continue;
        const hSq = mindMapPointToRectMinHorizDistSq(px, n, fallbackRect);
        const dxC = px - n.x;
        const dyC = py - n.y;
        const cand = {
            hSq,
            dSq,
            cxBiasSq: dxC * dxC,
            toCenterSq: dxC * dxC + dyC * dyC,
            id: n.nodeId
        };
        if (wireDropScoreBetter(cand, bestScore)) {
            bestScore = cand;
            best = n;
        }
    }
    return best;
}

/**
 * 轴对齐外包矩形（中心点模型：x,y 为节点中心）。
 * halfWidth/halfHeight 一般取布局矩形的一半。
 */
export function getMindMapNodeAxisBounds(
    node: Pick<MindMapCanvasNode, 'x' | 'y'>,
    halfWidth: number,
    halfHeight: number
) {
    return {
        left: node.x - halfWidth,
        right: node.x + halfWidth,
        top: node.y - halfHeight,
        bottom: node.y + halfHeight
    };
}

// ---------------------------------------------------------------------------
// 环检测（拖线连边 / 非法拓扑）
// ---------------------------------------------------------------------------

/**
 * 在现有有向图中，沿 `prevNodes` 自 `targetId` 反向走，得到所有在正向图中能到达 `targetId` 的节点（含 `targetId`）。
 * 若新增边 `fromId → toId`，当且仅当 `toId` 属于此集合时，会形成有向环。
 */
export function mindMapNodeIdsThatCanReachTarget(
    nodes: readonly MindMapCanvasNode[],
    targetId: number
): Set<number> {
    const seen = new Set<number>();
    const queue: number[] = [targetId];
    while (queue.length) {
        const id = queue.shift()!;
        if (seen.has(id)) continue;
        seen.add(id);
        const n = nodes.find((x) => x.nodeId === id);
        if (!n) continue;
        for (const p of normalizeLinkArray(n.prevNodes)) {
            if (!seen.has(p)) queue.push(p);
        }
    }
    return seen;
}

/** 新增 `fromId → toId` 是否会产生有向环 */
export function wouldMindMapLinkCreateCycle(
    nodes: readonly MindMapCanvasNode[],
    fromId: number,
    toId: number
): boolean {
    return mindMapNodeIdsThatCanReachTarget(nodes, fromId).has(toId);
}

// ---------------------------------------------------------------------------
// 连边
// ---------------------------------------------------------------------------

function applyDirectedMindMapEdge(
    from: MindMapCanvasNode,
    to: MindMapCanvasNode,
    fromId: number,
    toId: number
): void {
    const nextArr = normalizeLinkArray(from.nextNodes);
    from.nextNodes = [...new Set([...nextArr, toId])].sort((a, b) => a - b);

    const prevArr = normalizeLinkArray(to.prevNodes);
    if (!prevArr.includes(fromId)) {
        to.prevNodes = [...new Set([...prevArr, fromId])].sort((a, b) => a - b);
    }
    syncMindMapNodeNextNodeIDs(from);
    syncMindMapNodeNextNodeIDs(to);
}

/**
 * 建立有向边 from → to（不写 UI）；若已存在或非法则返回 false。
 */
export function establishMindMapLinkQuiet(
    nodes: readonly MindMapCanvasNode[],
    fromId: number,
    toId: number
): boolean {
    if (fromId === toId) return false;
    const from = nodes.find((n) => n.nodeId === fromId);
    const to = nodes.find((n) => n.nodeId === toId);
    if (!from || !to) return false;

    if (wouldMindMapLinkCreateCycle(nodes, fromId, toId)) {
        return false;
    }

    const nextArr = normalizeLinkArray(from.nextNodes);
    if (nextArr.includes(toId)) return false;

    applyDirectedMindMapEdge(from, to, fromId, toId);
    reconcileMindMapNodeTopology(nodes as MindMapCanvasNode[]);
    return true;
}

/**
 * 建立有向边 from → to：写 from.nextNodes 与 to.prevNodes。
 *
 * @returns 是否写出了新边（已存在并联则提示并返回 false）
 */
export function establishMindMapLink(
    nodes: readonly MindMapCanvasNode[],
    fromId: number,
    toId: number
): boolean {
    if (fromId === toId) return false;
    const from = nodes.find((n) => n.nodeId === fromId);
    const to = nodes.find((n) => n.nodeId === toId);
    if (!from || !to) return false;

    const nextArr = normalizeLinkArray(from.nextNodes);
    if (nextArr.includes(toId)) {
        ElMessage.info('该连线已存在');
        return false;
    }

    if (wouldMindMapLinkCreateCycle(nodes, fromId, toId)) {
        ElMessage.warning('不能连接：会形成闭环');
        return false;
    }

    applyDirectedMindMapEdge(from, to, fromId, toId);
    reconcileMindMapNodeTopology(nodes as MindMapCanvasNode[]);
    return true;
}

/**
 * 解除与 idSet 中任一节点相关的所有有向边：
 * - idSet 内节点：清空 prev/next 与 prevNodeIDs/nextNodeIDs；
 * - idSet 外节点：从 prev/next 中移除所有指向或来自 idSet 的引用（含框内↔框外连线）。
 */
export function severAllMindMapEdgesTouchingIdSet(
    nodes: MindMapCanvasNode[],
    idSet: ReadonlySet<number>
): void {
    const set = new Set<number>([...idSet].map((x) => Number(x)));
    for (const n of nodes) {
        const nid = Number(n.nodeId);
        if (Number.isNaN(nid)) continue;
        if (set.has(nid)) {
            n.nextNodes = null;
            n.prevNodes = null;
            syncMindMapNodeNextNodeIDs(n);
            continue;
        }
        if (n.nextNodes?.length) {
            const nx = normalizeLinkArray(n.nextNodes).filter((x) => !set.has(Number(x)));
            n.nextNodes = nx.length ? nx : null;
        }
        if (n.prevNodes?.length) {
            const pr = normalizeLinkArray(n.prevNodes).filter((x) => !set.has(Number(x)));
            n.prevNodes = pr.length ? pr : null;
        }
        syncMindMapNodeNextNodeIDs(n);
    }
    reconcileMindMapNodeTopology(nodes);
}

/**
 * 移除两端均在 idSet 内的所有有向边（用于多选成组重新挂靠前清空组内拓扑）。
 */
export function stripMindMapInternalEdgesAmongIds(
    nodes: MindMapCanvasNode[],
    idSet: ReadonlySet<number>
): void {
    const set = new Set<number>([...idSet].map((x) => Number(x)));

    let guard = 0;
    const maxPasses = 32;
    while (guard++ < maxPasses) {
        const pairs: { from: number; to: number }[] = [];
        for (const n of nodes) {
            const nid = Number(n.nodeId);
            if (Number.isNaN(nid) || !set.has(nid)) continue;
            for (const raw of normalizeLinkArray(n.nextNodes)) {
                const tid = Number(raw);
                if (Number.isNaN(tid) || !set.has(tid)) continue;
                pairs.push({ from: nid, to: tid });
            }
        }
        if (!pairs.length) break;
        for (const { from, to } of pairs) {
            removeMindMapDirectedEdge(nodes, from, to);
        }
    }
}

/**
 * 删除有向边 from → to（只移除此向，不删节点）。若无该边则返回 false。
 */
export function removeMindMapDirectedEdge(
    nodes: readonly MindMapCanvasNode[],
    fromId: number,
    toId: number
): boolean {
    if (fromId === toId) return false;
    const from = nodes.find((n) => n.nodeId === fromId);
    const to = nodes.find((n) => n.nodeId === toId);
    if (!from || !to) return false;

    const nextArr = normalizeLinkArray(from.nextNodes);
    if (!nextArr.includes(toId)) return false;
    const nextNext = nextArr.filter((id) => id !== toId).sort((a, b) => a - b);
    from.nextNodes = nextNext.length ? nextNext : null;

    const prevArr = normalizeLinkArray(to.prevNodes);
    const nextPrev = prevArr.filter((id) => id !== fromId).sort((a, b) => a - b);
    to.prevNodes = nextPrev.length ? nextPrev : null;

    syncMindMapNodeNextNodeIDs(from);
    syncMindMapNodeNextNodeIDs(to);
    reconcileMindMapNodeTopology(nodes as MindMapCanvasNode[]);
    return true;
}

/**
 * 按 id 集合删除节点，并通过 reconcileMindMapNodeTopology 双向绑定刷新存活节点的连线。
 */
export function removeMindMapNodesById(
    nodes: MindMapCanvasNode[],
    removedIds: ReadonlySet<number>
): void {
    if (!removedIds.size) return;
    const removed = new Set(
        [...removedIds].map((id) => Number(id)).filter((id) => !Number.isNaN(id))
    );
    const kept = nodes.filter((n) => !removed.has(Number(n.nodeId)));
    nodes.splice(0, nodes.length, ...kept);
    reconcileMindMapNodeTopology(nodes);
}

/**
 * 在「父节点右侧、兄弟阶梯」首选位置附近搜索，使新节点不与任何已有节点重叠。
 * 与同文件 `addChildNodeUnder` 使用的几何一致，实现见 `./mindMapChildPlacement`。
 */
function resolveNonCollidingChildCenter(
    nodes: readonly MindMapCanvasNode[],
    preferredX: number,
    baseY: number,
    newHw: number,
    newHh: number,
    layout: MindMapChildLayoutOptions
): { x: number; y: number } {
    return resolveNonCollidingChildCenterLikeAddChild(
        nodes,
        preferredX,
        baseY,
        newHw,
        newHh,
        layout
    );
}

// ---------------------------------------------------------------------------
// 新增节点
// ---------------------------------------------------------------------------

/**
 * 在父节点右侧（及兄弟竖向阶梯）追加一个子节点，并写父 next / 子 prev。
 * 新节点使用空的 guide 载荷。
 *
 * 初始中心会避开与已有节点外包盒重叠（含一圈 collisionPadding），尽量不挤占已有排版。
 */
export function addChildNodeUnder(
    nodes: MindMapCanvasNode[],
    parent: MindMapCanvasNode,
    layout: MindMapChildLayoutOptions
): void {
    const { nodeId, x, y } = parent;
    const childNodeId = maxNodeIdInList(nodes) + 1;

    const gapX = layout.gapX ?? DEFAULT_MIND_MAP_CHILD_GAP_FROM_PARENT;
    const nh = layout.nodeHeight ?? NODE_RECT_LAYOUT.height;
    const pad = layout.collisionPadding ?? 14;
    const stepY =
        layout.siblingStepY ??
        Math.max(DEFAULT_MIND_MAP_SIBLING_STEP_Y, nh + pad * 2);

    appendOutgoingId(parent, childNodeId);

    const siblingIndex = nodes.filter((n) =>
        n.prevNodes?.includes(nodeId)
    ).length;
    const preferredX = x + gapX;
    const baseY = y + alternatingSiblingBaseYOffset(siblingIndex, stepY);
    const newHw = layout.nodeWidth / 2;
    const newHh = nh / 2;

    const groupPad =
        layout.groupBlockPadding ?? DEFAULT_MIND_MAP_GROUP_BLOCK_PAD;
    const { x: newX, y: newY } = resolveNonCollidingChildCenter(
        nodes,
        preferredX,
        baseY,
        newHw,
        newHh,
        { ...layout, anchorNodeId: nodeId, groupBlockPadding: groupPad }
    );

    const child = createMindMapNode({
        nodeId: childNodeId,
        x: newX,
        y: newY,
        prevNodes: [nodeId],
        nextNodes: null,
        guide: createEmptyGuidePayload()
    }) as MindMapCanvasNode;
    nodes.push(child);
    syncMindMapNodeNextNodeIDs(parent);
    syncMindMapNodeNextNodeIDs(child);
}

/**
 * 在画布上追加一个无前后驱的「根」节点（「新建起始节点」/「添加节点」模板）。
 * id 自动为当前最大 id + 1；中心点在首选位置附近避让已有节点。
 */
export function appendStandaloneMindMapNode(
    nodes: MindMapCanvasNode[],
    center: MindMapPlacementCenter,
    guide?: GuidePayload,
    layout?: MindMapStandaloneLayoutOptions
): void {
    const maxId = maxNodeIdInList(nodes);
    const nw = layout?.nodeWidth ?? NODE_RECT_LAYOUT.width;
    const nh = layout?.nodeHeight ?? NODE_RECT_LAYOUT.height;
    const groupPad =
        layout?.groupBlockPadding ?? DEFAULT_MIND_MAP_GROUP_BLOCK_PAD;
    const { x, y } = resolveNonCollidingStandaloneCenter(
        nodes,
        center.x,
        center.y,
        {
            nodeWidth: nw,
            nodeHeight: nh,
            collisionPadding: layout?.collisionPadding,
            groupBlockPadding: groupPad
        }
    );
    nodes.push(
        createMindMapNode({
            nodeId: maxId + 1,
            x,
            y,
            prevNodes: null,
            nextNodes: null,
            guide: guide ?? createEmptyGuidePayload()
        }) as MindMapCanvasNode
    );
}
