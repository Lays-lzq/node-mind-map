/**
 * 弱连通分量（画布「分组」）划分与外包 AABB，供落点避让与序列块底衬共用。
 */

export type MindMapNodeLike = {
    nodeId: number;
    x: number;
    y: number;
    rectConf?: { width?: number; height?: number };
    prevNodes?: number[] | null;
    nextNodes?: number[] | null;
};

export type MindMapGroupBlockRect = {
    left: number;
    right: number;
    top: number;
    bottom: number;
    nodeIds: ReadonlySet<number>;
};

/** 按无向 prev/next 划分弱连通分量 */
export function partitionMindMapWeakComponents(
    nodes: readonly MindMapNodeLike[]
): number[][] {
    const ids = nodes.map((n) => n.nodeId);
    const idSet = new Set(ids);
    const adj = new Map<number, number[]>();
    for (const id of ids) adj.set(id, []);
    const addEdge = (a: number, b: number) => {
        if (a === b || !idSet.has(a) || !idSet.has(b)) return;
        adj.get(a)!.push(b);
        adj.get(b)!.push(a);
    };
    for (const n of nodes) {
        const nid = n.nodeId;
        for (const p of n.prevNodes ?? []) addEdge(nid, p);
        for (const c of n.nextNodes ?? []) addEdge(nid, c);
    }
    const seen = new Set<number>();
    const comps: number[][] = [];
    const sortedIds = [...ids].sort((a, b) => a - b);
    for (const start of sortedIds) {
        if (seen.has(start)) continue;
        const stack = [start];
        const bucket: number[] = [];
        while (stack.length) {
            const x = stack.pop()!;
            if (seen.has(x)) continue;
            seen.add(x);
            bucket.push(x);
            for (const nb of adj.get(x)!) stack.push(nb);
        }
        bucket.sort((a, b) => a - b);
        comps.push(bucket);
    }
    comps.sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
    return comps;
}

/** 同一 nodes 引用下复用分量索引，避免每条边重复 O(N) 划分 */
let routeComponentIndexCache: {
    nodes: readonly MindMapNodeLike[];
    byNodeId: Map<number, ReadonlySet<number>>;
} | null = null;

export function invalidateMindMapRouteComponentIndexCache(): void {
    routeComponentIndexCache = null;
}

function routeComponentIndexForNodes(
    nodes: readonly MindMapNodeLike[]
): Map<number, ReadonlySet<number>> {
    if (routeComponentIndexCache?.nodes === nodes) {
        return routeComponentIndexCache.byNodeId;
    }
    const byNodeId = new Map<number, ReadonlySet<number>>();
    for (const ids of partitionMindMapWeakComponents(nodes)) {
        const set = new Set(ids);
        for (const id of ids) byNodeId.set(id, set);
    }
    routeComponentIndexCache = { nodes, byNodeId };
    return byNodeId;
}

export function weakComponentIdSetContaining(
    nodes: readonly MindMapNodeLike[],
    nodeId: number
): ReadonlySet<number> | null {
    return routeComponentIndexForNodes(nodes).get(nodeId) ?? null;
}

/**
 * 连线避障范围：起点所在弱连通分量（画布分组 A/B…）内的节点 id。
 * 返回 null 表示未找到分量，调用方宜回退为全图避障。
 */
export function routeObstacleComponentNodeIds(
    nodes: readonly MindMapNodeLike[],
    fromNodeId: number
): ReadonlySet<number> | null {
    return weakComponentIdSetContaining(nodes, fromNodeId);
}

/** 是否应作为该条边的障碍节点（排除端点、排除其它分组） */
export function nodeCountsAsRouteObstacle(
    nodeId: number,
    fromNodeId: number,
    toNodeId: number,
    componentScope: ReadonlySet<number> | null
): boolean {
    if (nodeId === fromNodeId || nodeId === toNodeId) return false;
    if (!componentScope) return true;
    return componentScope.has(nodeId);
}

function nodeContentAabb(
    n: MindMapNodeLike,
    fallbackW: number,
    fallbackH: number
): { left: number; right: number; top: number; bottom: number } {
    const hw = (n.rectConf?.width ?? fallbackW) / 2;
    const hh = (n.rectConf?.height ?? fallbackH) / 2;
    return {
        left: n.x - hw,
        right: n.x + hw,
        top: n.y - hh,
        bottom: n.y + hh
    };
}

/** 分量节点外包盒，四周扩 backdropPad（与序列块底衬一致） */
export function componentGroupBounds(
    nodes: readonly MindMapNodeLike[],
    componentNodeIds: ReadonlySet<number>,
    backdropPad: number,
    fallbackW: number,
    fallbackH: number
): MindMapGroupBlockRect | null {
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const n of nodes) {
        if (!componentNodeIds.has(n.nodeId)) continue;
        const b = nodeContentAabb(n, fallbackW, fallbackH);
        left = Math.min(left, b.left);
        right = Math.max(right, b.right);
        top = Math.min(top, b.top);
        bottom = Math.max(bottom, b.bottom);
    }
    if (!Number.isFinite(left)) return null;
    return {
        left: left - backdropPad,
        right: right + backdropPad,
        top: top - backdropPad,
        bottom: bottom + backdropPad,
        nodeIds: componentNodeIds
    };
}

export function buildMindMapWeakComponentGroupBounds(
    nodes: readonly MindMapNodeLike[],
    backdropPad: number,
    fallbackW: number,
    fallbackH: number
): MindMapGroupBlockRect[] {
    const out: MindMapGroupBlockRect[] = [];
    for (const ids of partitionMindMapWeakComponents(nodes)) {
        const b = componentGroupBounds(
            nodes,
            new Set(ids),
            backdropPad,
            fallbackW,
            fallbackH
        );
        if (b) out.push(b);
    }
    return out;
}

/** 在分量现有节点基础上并入一个待放置节点中心，得到扩围后的分组盒 */
export function projectedGroupBoundsWithExtraNode(
    nodes: readonly MindMapNodeLike[],
    componentNodeIds: ReadonlySet<number>,
    cx: number,
    cy: number,
    newHw: number,
    newHh: number,
    backdropPad: number,
    fallbackW: number,
    fallbackH: number
): MindMapGroupBlockRect {
    let left = cx - newHw;
    let right = cx + newHw;
    let top = cy - newHh;
    let bottom = cy + newHh;
    for (const n of nodes) {
        if (!componentNodeIds.has(n.nodeId)) continue;
        const b = nodeContentAabb(n, fallbackW, fallbackH);
        left = Math.min(left, b.left);
        right = Math.max(right, b.right);
        top = Math.min(top, b.top);
        bottom = Math.max(bottom, b.bottom);
    }
    return {
        left: left - backdropPad,
        right: right + backdropPad,
        top: top - backdropPad,
        bottom: bottom + backdropPad,
        nodeIds: componentNodeIds
    };
}

export function mindMapGroupBlocksOverlap(
    a: { left: number; right: number; top: number; bottom: number },
    b: { left: number; right: number; top: number; bottom: number },
    gap: number
): boolean {
    return !(
        a.right + gap <= b.left ||
        a.left >= b.right + gap ||
        a.bottom + gap <= b.top ||
        a.top >= b.bottom + gap
    );
}
