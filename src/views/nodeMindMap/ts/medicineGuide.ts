/**
 * 与工单「方案操作说明」表结构（nodeEditor.vue / medicineOperateGuide）对齐的脑图节点数据工具。
 * 画布节点在 nodeId + prevNodes/nextNodes 之外挂载 guide，用于保存/接口 JSON。
 */
import { deepClone } from '@/utils/other';
import {
    alternatingSiblingBaseYOffset,
    resolveNonCollidingChildCenterLikeAddChild
} from './mindMapChildPlacement';
import { partitionMindMapWeakComponents } from './mindMapWeakComponents';

export { partitionMindMapWeakComponents } from './mindMapWeakComponents';

/** 与 addNodeTemplate[0] 空白节点一致的业务字段（不含 nodeID / 前后继） */
export interface GuidePayload {
    operationDesc: string;
    operationTypes: string[];
    targetDesc: string;
    targetDiagram: { url: string; name: string }[];
    targetDiagramUrl: string[];
    monitoringDesc: string;
    monitorUndoneDesc: string;
    abnormalDesc: string;
    abnormalDiagram: { url: string; name: string }[];
    abnormalDiagramUrl: string[];
}

/** 保存在 medicineOperateGuide 每行 JSON 里的脑图画布坐标（与 Konva 层坐标一致） */
export const MEDICINE_OPERATE_MIND_MAP_CANVAS_X = 'mindMapCanvasX';
export const MEDICINE_OPERATE_MIND_MAP_CANVAS_Y = 'mindMapCanvasY';

/** 接口/本地 JSON 中的一行（nodeID 为字符串，与旧表一致） */
export interface MedicineOperateTableRow extends GuidePayload {
    nodeID: string;
    /** 与 nodeID 一致，工单 JSON 中为字符串 ID */
    prevNodeIDs: string[];
    nextNodeIDs: string[];
    /** 可选；仅存于 nodeMindMap 保存。缺省或不齐则加载时用自动布局 */
    [MEDICINE_OPERATE_MIND_MAP_CANVAS_X]?: number | null;
    [MEDICINE_OPERATE_MIND_MAP_CANVAS_Y]?: number | null;
}

/** 节点卡片底色：白底 80% 不透明（约 20% 透明，连线可轻微透出） */
export const NODE_RECT_FILL = 'rgba(255, 255, 255, 0.8)';

export const NODE_RECT_LAYOUT = {
    width: 300,
    height: 140,
    fill: NODE_RECT_FILL,
    stroke: '#E4E3F0',
    strokeWidth: 2,
    cornerRadius: 14
} as const;

/** 与 `mindMapNodeOps.addChildNodeUnder` 未显式传入 `gapX` / `siblingStepY` 时一致（画布点圆环加子） */
export const DEFAULT_MIND_MAP_CHILD_GAP_FROM_PARENT =
    NODE_RECT_LAYOUT.width + 150;
export const DEFAULT_MIND_MAP_SIBLING_STEP_Y = 50;

/** 自动布局：相邻泳道中心间距 = 节点高度 + 该轨间留白（画布坐标） */
const MIND_MAP_LAYOUT_LANE_Y_GAP = 72;

export const NODE_CIRCLE_LAYOUT = {
    radius: 6,
    stroke: '#1A55E9',
    strokeWidth: 2,
    fill: '#fff',
    scale: { x: 1, y: 1 }
} as const;

/** 保证 guide 上数组字段存在，便于抽屉表单与 OSS 上传 */
export function ensureGuideCollectionsFor(
    g: Record<string, any> | null | undefined
) {
    if (!g || typeof g !== 'object') return;
    if (typeof g.monitorUndoneDesc !== 'string') g.monitorUndoneDesc = '';
    if (!Array.isArray(g.operationTypes)) g.operationTypes = [];
    if (!Array.isArray(g.targetDiagram)) g.targetDiagram = [];
    if (!Array.isArray(g.targetDiagramUrl)) g.targetDiagramUrl = [];
    if (!Array.isArray(g.abnormalDiagram)) g.abnormalDiagram = [];
    if (!Array.isArray(g.abnormalDiagramUrl)) g.abnormalDiagramUrl = [];
}

export function createEmptyGuidePayload(): GuidePayload {
    return {
        operationDesc: '',
        operationTypes: [],
        targetDesc: '',
        targetDiagram: [],
        targetDiagramUrl: [],
        monitoringDesc: '',
        monitorUndoneDesc: '',
        abnormalDesc: '',
        abnormalDiagram: [],
        abnormalDiagramUrl: []
    };
}

export function normalizeLinkArray(
    raw: unknown,
    /** 节点在数据中的出现次序；若提供则邻接表按此排序，不依赖 nodeId 数值 */
    nodeOrder?: Map<number, number>
): number[] {
    if (!Array.isArray(raw)) return [];
    const arr = [
        ...new Set(raw.map((x) => Number(x)).filter((x) => !Number.isNaN(x)))
    ];
    if (nodeOrder && arr.every((id) => nodeOrder.has(id))) {
        return arr.sort(
            (a, b) => (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0)
        );
    }
    return arr.sort((a, b) => a - b);
}

/** 邻接 ID 转为 string[]（与 nodeID 一致；顺序遵循 nodeOrder / 列表次序） */
export function toLinkIdStringArray(
    raw: unknown,
    nodeOrder?: Map<number, number>
): string[] {
    return normalizeLinkArray(raw, nodeOrder).map((id) => String(id));
}

function sameLinkIdStringArray(a: unknown, b: string[]): boolean {
    if (!Array.isArray(a) || a.length !== b.length) return false;
    return a.every((v, i) => String(v) === b[i]);
}

/** 同步画布节点上的 prevNodeIDs / nextNodeIDs（string[]），与 prevNodes / nextNodes 一致 */
export function syncMindMapNodeNextNodeIDs(
    node: Record<string, any> | null | undefined
): void {
    if (!node) return;
    const prev = toLinkIdStringArray(node.prevNodes);
    const next = toLinkIdStringArray(node.nextNodes);
    if (!sameLinkIdStringArray(node.prevNodeIDs, prev)) {
        node.prevNodeIDs = prev;
    }
    if (!sameLinkIdStringArray(node.nextNodeIDs, next)) {
        node.nextNodeIDs = next;
    }
}

/**
 * 拓扑双向绑定：从 prev/next（number[] 或 string[]）汇总有向边，剔除不存在节点的引用，
 * 再写回各节点 prevNodes/nextNodes 与 prevNodeIDs/nextNodeIDs（A→B 则 A.next 含 B 且 B.prev 含 A）。
 */
export function reconcileMindMapNodeTopology(
    nodes: readonly Record<string, any>[]
): void {
    if (!nodes.length) return;

    const byId = new Map<number, Record<string, any>>();
    for (const n of nodes) {
        const id = Number(n.nodeId);
        if (!Number.isNaN(id)) byId.set(id, n);
    }
    const validIds = new Set(byId.keys());
    const edgeKeys = new Set<string>();

    const addEdge = (fromId: number, toId: number) => {
        if (!validIds.has(fromId) || !validIds.has(toId) || fromId === toId)
            return;
        edgeKeys.add(`${fromId}>${toId}`);
    };

    for (const node of nodes) {
        const fromId = Number(node.nodeId);
        if (Number.isNaN(fromId) || !validIds.has(fromId)) continue;

        for (const toId of normalizeLinkArray(
            node.nextNodes ?? node.nextNodeIDs
        )) {
            addEdge(fromId, toId);
        }
        for (const prevId of normalizeLinkArray(
            node.prevNodes ?? node.prevNodeIDs
        )) {
            addEdge(prevId, fromId);
        }
    }

    const nextById = new Map<number, number[]>();
    const prevById = new Map<number, number[]>();
    for (const id of validIds) {
        nextById.set(id, []);
        prevById.set(id, []);
    }
    for (const key of edgeKeys) {
        const sep = key.indexOf('>');
        const fromId = Number(key.slice(0, sep));
        const toId = Number(key.slice(sep + 1));
        nextById.get(fromId)!.push(toId);
        prevById.get(toId)!.push(fromId);
    }

    for (const [id, node] of byId) {
        const next = [...new Set(nextById.get(id) ?? [])].sort((a, b) => a - b);
        const prev = [...new Set(prevById.get(id) ?? [])].sort((a, b) => a - b);
        node.nextNodes = next.length ? next : null;
        node.prevNodes = prev.length ? prev : null;
        syncMindMapNodeNextNodeIDs(node);
    }
}

function toNumericNodeId(raw: unknown): number {
    const n = Number(raw);
    return Number.isNaN(n) ? -1 : n;
}

/** 从表行读取脑图画布坐标；缺省或非合法数字则为 null */
export function parseMindMapRowCanvasPosition(
    row: Record<string, unknown>
): { x: number; y: number } | null {
    const x = Number(row[MEDICINE_OPERATE_MIND_MAP_CANVAS_X]);
    const y = Number(row[MEDICINE_OPERATE_MIND_MAP_CANVAS_Y]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
}

/** 当且仅当每个节点 id 在行里都能找到且带有合法画布坐标（完整快照）时，沿用保存位置且不跑泳道算法 */
function mindMapCanvasSnapshotCompleteForAllNodes(
    rows: Record<string, unknown>[],
    expectedIds: ReadonlySet<number>
): boolean {
    if (!expectedIds.size) return false;
    const pending = new Set(expectedIds);
    for (const row of rows) {
        const nodeId = toNumericNodeId(row.nodeID);
        if (!pending.has(nodeId)) continue;
        if (!parseMindMapRowCanvasPosition(row)) return false;
        pending.delete(nodeId);
    }
    return pending.size === 0;
}

/** 从接口行中提取 guide（忽略 nodeID / prev / next） */
export function extractGuideFromRow(
    row: Record<string, unknown>
): GuidePayload {
    Array.isArray(row.abnormalDiagram) &&
        row.abnormalDiagram.forEach((item: { url: string; name: string }) => {
            if (typeof item === 'object' && item.url) {
                (row.abnormalDiagramUrl as string[]).push(item.url);
            }
        });
    row.abnormalDiagramUrl = Array.from(
        new Set(row.abnormalDiagramUrl as string[])
    );
    row.abnormalDiagram = [];
    Array.isArray(row.targetDiagram) &&
        row.targetDiagram.forEach((item: { url: string; name: string }) => {
            if (typeof item === 'object' && item.url) {
                (row.targetDiagramUrl as string[]).push(item.url);
            }
        });
    row.targetDiagramUrl = Array.from(
        new Set(row.targetDiagramUrl as string[])
    );
    row.targetDiagram = [];
    const empty = createEmptyGuidePayload();
    const opTypes = row.operationTypes;
    const tDiag = row.targetDiagram;
    const tDiagUrl = row.targetDiagramUrl;
    const aDiag = row.abnormalDiagram;
    const aDiagUrl = row.abnormalDiagramUrl;

    return {
        operationDesc: String(row.operationDesc ?? empty.operationDesc),
        operationTypes: Array.isArray(opTypes)
            ? opTypes.map((x) => String(x))
            : empty.operationTypes,
        targetDesc: String(row.targetDesc ?? empty.targetDesc),
        targetDiagram: Array.isArray(tDiag)
            ? (tDiag as { url: string; name: string }[]).map((x) => ({
                  url: String((x as any).url ?? ''),
                  name: String((x as any).name ?? '')
              }))
            : empty.targetDiagram,
        targetDiagramUrl: Array.isArray(tDiagUrl)
            ? tDiagUrl.map((x) => String(x))
            : empty.targetDiagramUrl,
        monitoringDesc: String(row.monitoringDesc ?? empty.monitoringDesc),
        monitorUndoneDesc: String(
            row.monitorUndoneDesc ?? empty.monitorUndoneDesc
        ),
        abnormalDesc: String(row.abnormalDesc ?? empty.abnormalDesc),
        abnormalDiagram: Array.isArray(aDiag)
            ? (aDiag as { url: string; name: string }[]).map((x) => ({
                  url: String((x as any).url ?? ''),
                  name: String((x as any).name ?? '')
              }))
            : empty.abnormalDiagram,
        abnormalDiagramUrl: Array.isArray(aDiagUrl)
            ? aDiagUrl.map((x) => String(x))
            : empty.abnormalDiagramUrl
    };
}

function buildCircleConfs(rectW: number, rectH: number) {
    const cTemp = deepClone(NODE_CIRCLE_LAYOUT);
    const midY = rectH / 2;
    return {
        startCircleConf: {
            ...cTemp,
            x: 0,
            y: midY,
            offset: { x: 0, y: 0 }
        },
        endCircleConf: {
            ...cTemp,
            x: rectW,
            y: midY,
            offset: { x: 0, y: 0 }
        }
    };
}

/** 创建画布节点对象（含 Konva 配置 + guide） */
export function createMindMapNode(options: {
    nodeId: number;
    x: number;
    y: number;
    prevNodes: number[] | null;
    nextNodes: number[] | null;
    guide?: GuidePayload;
}): any {
    const rTemp = deepClone(NODE_RECT_LAYOUT);
    const { startCircleConf, endCircleConf } = buildCircleConfs(
        rTemp.width,
        rTemp.height
    );
    const node: Record<string, any> = {
        nodeId: options.nodeId,
        x: options.x,
        y: options.y,
        prevNodes: options.prevNodes,
        nextNodes: options.nextNodes,
        guide: options.guide
            ? deepClone(options.guide)
            : createEmptyGuidePayload(),
        offset: {
            x: rTemp.width / 2,
            y: rTemp.height / 2
        },
        rectConf: { ...rTemp },
        startCircleConf,
        endCircleConf
    };
    syncMindMapNodeNextNodeIDs(node);
    return node;
}

export interface LayoutOptions {
    startX: number;
    startY: number;
    layerStepX: number;
    /** 主轴与侧轨的纵向间距（泳道半高）；越大上下轨离中间主轴越远。 */
    layerStepY: number;
}

/** —— 以下为泳道自动布局：拓扑 / 主轴 DP / 分叉与列收紧 —— */

function nodeByIdMap(list: any[]): Map<number, any> {
    const m = new Map<number, any>();
    for (const n of list) m.set(n.nodeId, n);
    return m;
}

/** 节点在列表/表行中的首次出现次序，用于平局与邻接排序，不依赖 nodeId 数值大小 */
function buildListOrderIndex(list: any[]): Map<number, number> {
    const m = new Map<number, number>();
    let i = 0;
    for (const n of list) {
        if (!m.has(n.nodeId)) m.set(n.nodeId, i++);
    }
    return m;
}

function resolveNodeOrder(
    nodes: any[],
    explicit?: Map<number, number>
): Map<number, number> {
    return explicit ?? buildListOrderIndex(nodes);
}

/** 占位结点（无操作/目标/监控文案）在长链 DP 中选前驱时扣减的上游深度，避免绕经 13→17→1 挤占中轨 */
const MIND_MAP_LAYOUT_STUB_UPSTREAM_PENALTY = 3;
/** 主轴贪心分叉：到终点跳数差在此以内视为「等价」，改按表序取更靠前分支（保留 1→3→5 而非 1→6→7） */
const MIND_MAP_SPINE_HOP_TIE_SLACK = 1;

/**
 * 自动布局用：是否视为「仅占位」结点（无实质 guide 文案与操作类型）。
 * 此类结点仍可连边，但不宜作为全局最长主轴的绕路中继。
 */
function isMindMapLayoutStubNode(n: any | undefined): boolean {
    if (!n) return false;
    const g =
        n.guide && typeof n.guide === 'object'
            ? (n.guide as GuidePayload)
            : null;
    if (!g) return true;
    const texts = [
        g.operationDesc,
        g.targetDesc,
        g.monitoringDesc,
        g.abnormalDesc
    ];
    if (texts.some((t) => String(t ?? '').trim().length > 0)) return false;
    if (Array.isArray(g.operationTypes) && g.operationTypes.length > 0) {
        return false;
    }
    const diagrams = [g.targetDiagram, g.abnormalDiagram];
    if (diagrams.some((d) => Array.isArray(d) && d.length > 0)) return false;
    return true;
}

function mindMapLayoutUpstreamScoreForSpine(
    nodeId: number,
    upstreamDist: Map<number, number>,
    byId: Map<number, any>
): number {
    let s = upstreamDist.get(nodeId) ?? 0;
    if (isMindMapLayoutStubNode(byId.get(nodeId))) {
        s -= MIND_MAP_LAYOUT_STUB_UPSTREAM_PENALTY;
    }
    return s;
}

/**
 * 「长链锚父」平局规则：有效上游深度（占位结点扣分）→ 下游最远叶 `downLen`
 * → 表次序 `ord`（小者优先）。用于 {@link longestChainPathIds} 与 {@link pickLongestSequencePredecessor}。
 */
function precedenceCompareForLongChain(
    cand: number,
    bestSoFar: number | null | undefined,
    upstreamDist: Map<number, number>,
    downLen: Map<number, number>,
    ord: Map<number, number>,
    byId: Map<number, any>
): boolean {
    if (bestSoFar === null || bestSoFar === undefined) return true;
    const cC = mindMapLayoutUpstreamScoreForSpine(cand, upstreamDist, byId) + 1;
    const cB =
        mindMapLayoutUpstreamScoreForSpine(bestSoFar, upstreamDist, byId) + 1;
    if (cC !== cB) return cC > cB;
    const dlC = downLen.get(cand) ?? 0;
    const dlB = downLen.get(bestSoFar) ?? 0;
    if (dlC !== dlB) return dlC > dlB;
    return (ord.get(cand) ?? Infinity) < (ord.get(bestSoFar) ?? Infinity);
}

/** 分叉子边排序：`edgesUntilMerge` → `downLen` → 数据序，与主轴 walk / 秩收敛共用 */
function createForkEdgeComparator(
    edgesUntilMerge: Map<number, number>,
    downLen: Map<number, number>,
    nodeOrder: Map<number, number>
): (a: number, b: number) => number {
    return (a: number, b: number): number => {
        const ub = edgesUntilMerge.get(b) ?? 0;
        const ua = edgesUntilMerge.get(a) ?? 0;
        if (ub !== ua) return ub - ua;
        const db = downLen.get(b) ?? 0;
        const da = downLen.get(a) ?? 0;
        if (db !== da) return db - da;
        return (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0);
    };
}

/**
 * 表数据里常把「分叉父 35」和「链上中继 36」同时写进 prevNodeIDs。
 * 定列时若不合并，会走「混合前驱 → mx+0.92*layerStepX」，把 38 摆到 36 右侧。
 * 若在 pathIds 上为连续紧挨链，只保留链头（索引最小）主轴前驱，等同「仅由分叉点定列」。
 */
function collapseConsecutiveSpinePredecessorsForLayout(
    predsRaw: number[],
    spineSet: Set<number>,
    spineIndex: Map<number, number>,
    pathIds: number[]
): number[] {
    if (predsRaw.length <= 1) return predsRaw;
    const nonSpine = predsRaw.filter((p) => !spineSet.has(p));
    const spinePreds = predsRaw
        .filter((p) => spineSet.has(p))
        .sort((a, b) => (spineIndex.get(a) ?? 0) - (spineIndex.get(b) ?? 0));
    if (spinePreds.length <= 1) return predsRaw;

    for (let i = 0; i < spinePreds.length - 1; i++) {
        const a = spinePreds[i]!;
        const b = spinePreds[i + 1]!;
        const ia = spineIndex.get(a) ?? -1;
        const ib = spineIndex.get(b) ?? -1;
        if (
            ib !== ia + 1 ||
            ia < 0 ||
            ia + 1 >= pathIds.length ||
            pathIds[ia + 1] !== b
        ) {
            return predsRaw;
        }
    }
    const keepSpine = spinePreds[0]!;
    return [...nonSpine, keepSpine];
}

/** 稳定拓扑序；若有环则余下节点按数据序追加，避免崩 */
function topologicalSortNodes(
    nodes: any[],
    idSet: Set<number>,
    nodeOrder?: Map<number, number>
): any[] {
    const ord = resolveNodeOrder(nodes, nodeOrder);
    const byId = nodeByIdMap(nodes);
    const inDeg = new Map<number, number>();
    for (const id of idSet) inDeg.set(id, 0);
    for (const n of nodes) {
        for (const nx of (n.nextNodes ?? []).filter((x: number) =>
            idSet.has(x)
        )) {
            inDeg.set(nx, (inDeg.get(nx) ?? 0) + 1);
        }
    }
    const frontier = [...idSet].filter((id) => (inDeg.get(id) ?? 0) === 0);
    frontier.sort((a, b) => (ord.get(a) ?? 0) - (ord.get(b) ?? 0));
    const out: any[] = [];
    while (frontier.length) {
        const id = frontier.shift()!;
        const n = byId.get(id);
        if (n) out.push(n);
        if (!n) continue;
        for (const nx of (n.nextNodes ?? []).filter((x: number) =>
            idSet.has(x)
        )) {
            const d = (inDeg.get(nx) ?? 0) - 1;
            inDeg.set(nx, d);
            if (d === 0) frontier.push(nx);
        }
        frontier.sort((a, b) => (ord.get(a) ?? 0) - (ord.get(b) ?? 0));
    }
    if (out.length < nodes.length) {
        const seen = new Set(out.map((n) => n.nodeId));
        for (const n of [...nodes].sort(
            (a, b) => (ord.get(a.nodeId) ?? 0) - (ord.get(b.nodeId) ?? 0)
        )) {
            if (!seen.has(n.nodeId)) out.push(n);
        }
    }
    return out;
}

/** 各点到最远叶的最长下游链长度（边数）；用于汇合点平局时择优走较深的主干 */
function longestDownLen(
    nodes: any[],
    idSet: Set<number>,
    nodeOrder?: Map<number, number>
): Map<number, number> {
    const order = topologicalSortNodes(nodes, idSet, nodeOrder);
    const rev = [...order].reverse();
    const downLen = new Map<number, number>();
    for (const n of rev) {
        const nexts = normalizeLinkArray(n.nextNodes, nodeOrder).filter(
            (nx: number) => idSet.has(nx)
        );
        if (nexts.length === 0) downLen.set(n.nodeId, 0);
        else {
            let m = 0;
            for (const nx of nexts) {
                m = Math.max(m, (downLen.get(nx) ?? 0) + 1);
            }
            downLen.set(n.nodeId, m);
        }
    }
    return downLen;
}

/** 画布内 indegree≥2（多父汇入）结点，分叉选主枝时用「谁先碰到汇入」更准确 */
function buildMergeNodeIdSet(list: any[], idSet: Set<number>): Set<number> {
    const merges = new Set<number>();
    for (const n of list) {
        if (!idSet.has(n.nodeId)) continue;
        const preds = (n.prevNodes ?? []).filter((p: number) => idSet.has(p));
        if (preds.length >= 2) merges.add(n.nodeId);
    }
    return merges;
}

/**
 * 自某点沿下游任选路径能延长的最长边数，一旦经由出边进入汇入点或多父结点则不再穿过该汇入点计数。
 * 父结点多分叉时：**值大者** 与父同泳道（如 30→43→44→45→46→33）；避免仅用「到叶最远」误判 27 枝更长。
 */
function precomputeLongestEdgesUntilMerge(
    list: any[],
    idSet: Set<number>,
    mergeIds: Set<number>,
    nodeOrder: Map<number, number>
): Map<number, number> {
    const byId = nodeByIdMap(list);
    const memo = new Map<number, number>();
    const dfs = (v: number): number => {
        if (memo.has(v)) return memo.get(v)!;
        if (mergeIds.has(v)) {
            memo.set(v, 0);
            return 0;
        }
        const outs = normalizeLinkArray(
            byId.get(v)?.nextNodes,
            nodeOrder
        ).filter((x: number) => idSet.has(x));
        if (!outs.length) {
            memo.set(v, 0);
            return 0;
        }
        let best = 0;
        for (const w of outs) {
            if (mergeIds.has(w)) best = Math.max(best, 1);
            else best = Math.max(best, 1 + dfs(w));
        }
        memo.set(v, best);
        return best;
    };
    const out = new Map<number, number>();
    for (const id of idSet) {
        out.set(id, dfs(id));
    }
    return out;
}

/**
 * 多父汇入中选「更长序列」上的前驱；平局规则见 {@link precedenceCompareForLongChain}。
 */
function pickLongestSequencePredecessor(
    preds: readonly number[],
    ord: Map<number, number>,
    upstreamDist: Map<number, number>,
    downLen: Map<number, number>,
    byId: Map<number, any>
): number | undefined {
    if (!preds.length) return undefined;
    if (preds.length === 1) return preds[0];
    let bp: number | undefined;
    for (const p of preds) {
        if (
            precedenceCompareForLongChain(
                p,
                bp,
                upstreamDist,
                downLen,
                ord,
                byId
            )
        ) {
            bp = p;
        }
    }
    return bp;
}

/** 拓扑序递增：任一源到该点的最长上游链长度（边数）；根为 0 */
function upstreamLongestEdgeLenByTopoOrder(
    topo: readonly any[],
    idSet: Set<number>
): Map<number, number> {
    const dist = new Map<number, number>();
    for (const n of topo) {
        const preds = (n.prevNodes ?? []).filter((p: number) => idSet.has(p));
        if (preds.length === 0) {
            dist.set(n.nodeId, 0);
            continue;
        }
        let m = 0;
        for (const p of preds) {
            m = Math.max(m, (dist.get(p) ?? 0) + 1);
        }
        dist.set(n.nodeId, m);
    }
    return dist;
}

/** 起点到各点最长链长 + 反链指针，用于还原一条全局最长有限路径 */
function longestChainPathIds(
    nodes: any[],
    idSet: Set<number>,
    nodeOrder?: Map<number, number>
): number[] {
    const ord = resolveNodeOrder(nodes, nodeOrder);
    const order = topologicalSortNodes(nodes, idSet, nodeOrder);
    const downLen = longestDownLen(nodes, idSet, nodeOrder);
    const byId = nodeByIdMap(nodes);
    const dist = new Map<number, number>();
    const prev = new Map<number, number | null>();
    for (const id of idSet) {
        dist.set(id, 0);
        prev.set(id, null);
    }
    for (const n of order) {
        const preds = (n.prevNodes ?? []).filter((p: number) => idSet.has(p));
        if (preds.length === 0) {
            dist.set(n.nodeId, 0);
            prev.set(n.nodeId, null);
            continue;
        }
        let bp: number | null = null;
        for (const p of preds) {
            if (
                precedenceCompareForLongChain(p, bp, dist, downLen, ord, byId)
            ) {
                bp = p;
            }
        }
        const best = bp === null ? -1 : (dist.get(bp) ?? 0) + 1;
        dist.set(n.nodeId, best);
        prev.set(n.nodeId, bp);
    }
    let endId: number | undefined;
    let bestD = -1;
    for (const id of idSet) {
        const d = dist.get(id) ?? 0;
        const io = ord.get(id) ?? 0;
        if (
            endId === undefined ||
            d > bestD ||
            (d === bestD && io < (ord.get(endId) ?? 0))
        ) {
            bestD = d;
            endId = id;
        }
    }
    if (endId === undefined) return [];
    const path: number[] = [];
    let c: number | null = endId;
    while (c != null) {
        path.push(c);
        c = prev.get(c) ?? null;
    }
    path.reverse();
    return path;
}

/**
 * DP 回溯的主轴链若某段在画布 next 上不可行走，则从该点开始截断/跳过，仅用 forward 可走边接上。
 */
function repairSpineChainToCanvasForwardEdges(
    pathIds: number[],
    byId: Map<number, any>,
    nodeOrder: Map<number, number>,
    idSet: Set<number>
): number[] {
    if (pathIds.length <= 1) return pathIds;
    const out: number[] = [pathIds[0]!];
    let i = 1;
    while (i < pathIds.length) {
        const cur = out[out.length - 1]!;
        const cand = pathIds[i]!;
        const outs = normalizeLinkArray(
            byId.get(cur)?.nextNodes,
            nodeOrder
        ).filter((t: number) => idSet.has(t));
        if (outs.includes(cand)) {
            out.push(cand);
            i++;
            continue;
        }
        let pickIdx = -1;
        for (let j = i; j < pathIds.length; j++) {
            if (outs.includes(pathIds[j]!)) {
                pickIdx = j;
                break;
            }
        }
        if (pickIdx === -1) break;
        out.push(pathIds[pickIdx]!);
        i = pickIdx + 1;
    }
    return out.length >= 2 ? out : pathIds;
}

/**
 * 主轴上若出现 a→x→b 但实际存在 a→b，且 a 的子边不含 x（把无 a→x 的旁路当成主链格子），则从 pathIds 去掉 x，
 * 避免 37 等与 38 并排却多占一主轴列——与 repair 互补；逻辑上对应「仅有 35→38、36→37 时 x 不占主链档」。
 */
function shortenSpineWhereDirectArcSkipsMiddle(
    pathIds: number[],
    byId: Map<number, any>,
    nodeOrder: Map<number, number>,
    idSet: Set<number>
): number[] {
    if (pathIds.length < 3) return pathIds;
    const arr = [...pathIds];
    let changed = true;
    while (changed) {
        changed = false;
        for (let i = 0; i + 2 < arr.length; i++) {
            const a = arr[i]!;
            const x = arr[i + 1]!;
            const b = arr[i + 2]!;
            const outs = normalizeLinkArray(
                byId.get(a)?.nextNodes,
                nodeOrder
            ).filter((t: number) => idSet.has(t));
            if (outs.includes(b) && !outs.includes(x)) {
                arr.splice(i + 1, 1);
                changed = true;
                break;
            }
        }
    }
    return arr.length >= 2 ? arr : pathIds;
}

/**
 * 主轴上若存在 a→…→b 且画布有 a→b 直连，中间段均为占位结点，则删去绕路中继
 *（如 0→13→17→1 收束为 0→1，1→15→3 收束为 1→3）。
 */
function shortenSpineThroughStubRelayNodes(
    pathIds: number[],
    byId: Map<number, any>,
    nodeOrder: Map<number, number>,
    idSet: Set<number>
): number[] {
    if (pathIds.length < 3) return pathIds;
    let arr = [...pathIds];
    let changed = true;
    while (changed) {
        changed = false;
        outer: for (let i = 0; i < arr.length; i++) {
            const a = arr[i]!;
            const outs = normalizeLinkArray(
                byId.get(a)?.nextNodes,
                nodeOrder
            ).filter((t: number) => idSet.has(t));
            for (let j = arr.length - 1; j > i + 1; j--) {
                const b = arr[j]!;
                if (!outs.includes(b)) continue;
                const mids = arr.slice(i + 1, j);
                if (
                    !mids.every((mid) => isMindMapLayoutStubNode(byId.get(mid)))
                ) {
                    continue;
                }
                arr = [...arr.slice(0, i + 1), ...arr.slice(j)];
                changed = true;
                break outer;
            }
        }
    }
    return arr.length >= 2 ? arr : pathIds;
}

/** 自各点沿 next 能否到达 target（用于主轴贪心） */
function mindMapNodesCanReachTarget(
    byId: Map<number, any>,
    target: number,
    idSet: Set<number>,
    nodeOrder: Map<number, number>
): Set<number> {
    const canReach = new Set<number>([target]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const id of idSet) {
            if (canReach.has(id)) continue;
            const outs = normalizeLinkArray(
                byId.get(id)?.nextNodes,
                nodeOrder
            ).filter((o: number) => idSet.has(o));
            if (outs.some((o) => canReach.has(o))) {
                canReach.add(id);
                changed = true;
            }
        }
    }
    return canReach;
}

/** 到 target 的最短跳数（边数）；不可达则不写入 */
function shortestHopCountToTarget(
    target: number,
    byId: Map<number, any>,
    idSet: Set<number>,
    nodeOrder: Map<number, number>
): Map<number, number> {
    const hop = new Map<number, number>();
    hop.set(target, 0);
    let changed = true;
    while (changed) {
        changed = false;
        for (const id of idSet) {
            if (hop.has(id)) continue;
            const outs = normalizeLinkArray(
                byId.get(id)?.nextNodes,
                nodeOrder
            ).filter((o: number) => idSet.has(o));
            const known = outs.filter((o) => hop.has(o));
            if (!known.length) continue;
            hop.set(id, 1 + Math.min(...known.map((o) => hop.get(o)!)));
            changed = true;
        }
    }
    return hop;
}

/**
 * 在分叉处选主轴下一跳：优先更短到达终点，平局取表序更靠前；占位结点劣后。
 */
function pickSpineNextHopTowardEnd(
    candidates: number[],
    hopToEnd: Map<number, number>,
    ord: Map<number, number>,
    byId: Map<number, any>
): number {
    const ranked = [...candidates].sort((a, b) => {
        const ha = hopToEnd.get(a);
        const hb = hopToEnd.get(b);
        const aReach = ha !== undefined;
        const bReach = hb !== undefined;
        if (aReach !== bReach) return aReach ? -1 : 1;
        if (aReach && bReach && ha !== hb) {
            if (Math.abs(ha - hb) <= MIND_MAP_SPINE_HOP_TIE_SLACK) {
                return (ord.get(a) ?? 0) - (ord.get(b) ?? 0);
            }
            return ha - hb;
        }
        const stubA = isMindMapLayoutStubNode(byId.get(a)) ? 1 : 0;
        const stubB = isMindMapLayoutStubNode(byId.get(b)) ? 1 : 0;
        if (stubA !== stubB) return stubA - stubB;
        return (ord.get(a) ?? 0) - (ord.get(b) ?? 0);
    });
    return ranked[0]!;
}

/**
 * 以 DP/捷径得到的终点为目标，从入口沿「最短跳数」贪心重铺主轴，避免为全局最长链绕经占位支路或回折支路。
 */
function rebuildSpineByShortestGreedyToEnd(
    pathIds: number[],
    list: any[],
    idSet: Set<number>,
    nodeOrder: Map<number, number>,
    byId: Map<number, any>
): number[] {
    if (pathIds.length < 2) return pathIds;
    const endId = pathIds[pathIds.length - 1]!;
    const canReach = mindMapNodesCanReachTarget(byId, endId, idSet, nodeOrder);
    const hopToEnd = shortestHopCountToTarget(endId, byId, idSet, nodeOrder);
    const roots = list
        .filter(
            (nn) =>
                !(nn.prevNodes ?? []).filter((p: number) => idSet.has(p)).length
        )
        .sort(
            (a, b) =>
                (nodeOrder.get(a.nodeId) ?? 0) - (nodeOrder.get(b.nodeId) ?? 0)
        );
    const rootId = roots[0]?.nodeId ?? pathIds[0]!;
    if (!canReach.has(rootId) || !hopToEnd.has(rootId)) {
        return pathIds;
    }

    const path: number[] = [rootId];
    let cur = rootId;
    const guard = idSet.size + 4;
    for (let step = 0; step < guard && cur !== endId; step++) {
        const outs = normalizeLinkArray(
            byId.get(cur)?.nextNodes,
            nodeOrder
        ).filter(
            (c: number) => idSet.has(c) && canReach.has(c) && hopToEnd.has(c)
        );
        if (!outs.length) break;
        const next = pickSpineNextHopTowardEnd(outs, hopToEnd, nodeOrder, byId);
        if (path.includes(next)) break;
        path.push(next);
        cur = next;
    }
    if (path[path.length - 1] !== endId) {
        return pathIds;
    }
    return path.length >= 2 ? path : pathIds;
}

/**
 * 有向无环图分层：layer = 无入边为 0，否则 max(前驱 layer)+1。
 * 全图列坐标由此决定，使上下轨同一逻辑深度对齐到同一竖列（网格化泳道）。
 * 与 Python StepAction 拓扑图 `compute_node_levels` 规则一致。
 */
function computeTopologicalLayers(
    nodes: any[],
    idSet: Set<number>,
    nodeOrder?: Map<number, number>
): Map<number, number> {
    const order = topologicalSortNodes(nodes, idSet, nodeOrder);
    const layer = new Map<number, number>();
    for (const n of order) {
        const preds = (n.prevNodes ?? []).filter((p: number) => idSet.has(p));
        if (!preds.length) {
            layer.set(n.nodeId, 0);
        } else {
            let m = -1;
            for (const p of preds) {
                m = Math.max(m, layer.get(p) ?? 0);
            }
            layer.set(n.nodeId, m + 1);
        }
    }
    for (const n of nodes) {
        if (!idSet.has(n.nodeId)) continue;
        if (!layer.has(n.nodeId)) layer.set(n.nodeId, 0);
    }
    return layer;
}

/** 画布节点拓扑层级（无入边为 0，多前驱取 max+1），供区分色与 Python 拓扑图对齐 */
export function computeMindMapNodeLevels(
    nodes: readonly { nodeId: number; prevNodes?: number[] | null }[]
): Map<number, number> {
    const list = [...nodes];
    const idSet = new Set(list.map((n) => n.nodeId));
    const nodeOrder = buildListOrderIndex(list);
    return computeTopologicalLayers(list, idSet, nodeOrder);
}

/**
 * 块内次序按「直连主轴前驱锚列」升序，再拓扑序平局（菱形 37/38）。
 */
function assignSpineColumnsToRailComponent(
    comp: number[],
    idSet: Set<number>,
    spineSet: Set<number>,
    spineIndex: Map<number, number>,
    pathIds: number[],
    byId: Map<number, any>,
    opts: LayoutOptions,
    topoOrd: Map<number, number>,
    nodeOrder: Map<number, number>
) {
    let fromPred = Infinity;
    let fromSucc = Infinity;
    for (const uid of comp) {
        const un = byId.get(uid)!;
        for (const pid of (un.prevNodes ?? []).filter(
            (p: number) => idSet.has(p) && spineSet.has(p)
        )) {
            fromPred = Math.min(fromPred, (spineIndex.get(pid) ?? 0) + 1);
        }
        for (const tid of normalizeLinkArray(un.nextNodes, nodeOrder).filter(
            (t) => idSet.has(t) && spineSet.has(t)
        )) {
            fromSucc = Math.min(fromSucc, spineIndex.get(tid) ?? 0);
        }
    }

    /** 整块与主轴无边（无上轨/下轨前驱也不在主轴指向主轴出口）时，勿用 pathIds 下标重写 x，
     * 否则会误把汇合点（如 37）拖到与底层末端（32）同列。保留拓扑阶段 + unify 算出的坐标。 */
    if (fromPred === Infinity && fromSucc === Infinity) {
        return;
    }

    const nComp = comp.length;
    let colStart: number;
    if (fromPred < Infinity) {
        colStart = fromPred;
    } else if (fromSucc < Infinity) {
        colStart =
            nComp === 1
                ? Math.max(0, fromSucc - 1)
                : Math.max(0, fromSucc - (nComp - 1));
    } else {
        colStart = 1;
    }
    colStart = Math.max(0, Math.min(colStart, pathIds.length - 1));

    /** 分叉后主轴上的「下一格」与侧轨无连边时（如 36—38 无边），侧轨不是主列延续；
     * 仅靠汇入点算列易把列推到更右；钉在分叉父后的第一个主轴点列（与 36 同栅格）。 */
    if (nComp === 1 && pathIds.length >= 2) {
        const uid = comp[0]!;
        let clampCol = Infinity;
        const un = byId.get(uid)!;
        for (const pid of (un.prevNodes ?? []).filter(
            (p: number) => idSet.has(p) && spineSet.has(p)
        )) {
            const iP = spineIndex.get(pid) ?? -1;
            if (iP < 0 || iP + 1 >= pathIds.length) continue;
            const spineChildId = pathIds[iP + 1]!;
            if (spineChildId === uid) continue;
            const outsSc = normalizeLinkArray(
                byId.get(spineChildId)?.nextNodes,
                nodeOrder
            ).filter((t: number) => idSet.has(t));
            if (!outsSc.includes(uid)) {
                clampCol = Math.min(clampCol, iP + 1);
            }
        }
        if (clampCol < Infinity) {
            colStart = Math.min(colStart, clampCol);
            colStart = Math.max(0, Math.min(colStart, pathIds.length - 1));
        }
    }

    const spinePredColHint = (uid: number): number => {
        const un = byId.get(uid)!;
        let h = Infinity;
        for (const pid of (un.prevNodes ?? []).filter(
            (p: number) => idSet.has(p) && spineSet.has(p)
        )) {
            h = Math.min(h, (spineIndex.get(pid) ?? 0) + 1);
        }
        return h;
    };
    comp.sort((a, b) => {
        const ha = spinePredColHint(a);
        const hb = spinePredColHint(b);
        const fa = Number.isFinite(ha) ? ha : 1e9;
        const fb = Number.isFinite(hb) ? hb : 1e9;
        if (fa !== fb) return fa - fb;
        return (topoOrd.get(a) ?? 0) - (topoOrd.get(b) ?? 0);
    });

    const lastSi = pathIds.length - 1;
    const lastSx = byId.get(pathIds[lastSi])!.x;
    for (let k = 0; k < comp.length; k++) {
        const spineCol = colStart + k;
        const un = byId.get(comp[k])!;
        if (spineCol <= lastSi) {
            un.x = byId.get(pathIds[spineCol])!.x;
        } else {
            un.x = lastSx + (spineCol - lastSi) * opts.layerStepX;
        }
    }
}

/**
 * 对指定泳道集合（负秩上轨 / 正秩下轨）内互相连通的子图逐块做竖列对齐。
 * 原先仅对上轨做此步，下轨仍用 spineForkSlot + railStagger，会导致同父分叉的上下轨子节点（如 27 与 26）x 不一致。
 */
function sweepAlignRailLaneToSpineColumns(
    list: any[],
    idSet: Set<number>,
    spineSet: Set<number>,
    pathIds: number[],
    spineIndex: Map<number, number>,
    byId: Map<number, any>,
    opts: LayoutOptions,
    topoOrd: Map<number, number>,
    railNodeIds: Set<number>,
    nodeOrder: Map<number, number>
) {
    if (!railNodeIds.size) return;

    const adj = new Map<number, number[]>();
    for (const id of railNodeIds) adj.set(id, []);

    const link = (a: number, b: number) => {
        if (!railNodeIds.has(a) || !railNodeIds.has(b)) return;
        adj.get(a)!.push(b);
        adj.get(b)!.push(a);
    };

    for (const n of list) {
        if (!railNodeIds.has(n.nodeId)) continue;
        for (const t of normalizeLinkArray(n.nextNodes, nodeOrder).filter(
            (x: number) => idSet.has(x)
        )) {
            link(n.nodeId, t);
        }
        for (const p of (n.prevNodes ?? []).filter((xid: number) =>
            idSet.has(xid)
        )) {
            link(n.nodeId, p);
        }
    }

    const seen = new Set<number>();
    for (const seed of railNodeIds) {
        if (seen.has(seed)) continue;
        const comp: number[] = [];
        const stack = [seed];
        seen.add(seed);
        while (stack.length) {
            const u = stack.pop()!;
            comp.push(u);
            for (const v of adj.get(u) ?? []) {
                if (!seen.has(v)) {
                    seen.add(v);
                    stack.push(v);
                }
            }
        }
        assignSpineColumnsToRailComponent(
            comp,
            idSet,
            spineSet,
            spineIndex,
            pathIds,
            byId,
            opts,
            topoOrd,
            nodeOrder
        );
    }
}

/**
 * 同父兄弟「同列」收紧：入口结点下第一层共列；其余仅在**同一泳道秩**且非主轴下一环的兄弟间共列
 *（菱形 35→36/38）。勿把主轴后继与侧轨（如 1→3 与 6、15）压到同一 x，否则整图挤成一列。
 */
function unifySiblingColumnsByParent(
    list: any[],
    idSet: Set<number>,
    spineSet: Set<number>,
    spineIndex: Map<number, number>,
    pathIds: number[],
    byId: Map<number, any>,
    opts: LayoutOptions,
    nodeOrder: Map<number, number>,
    laneRank: Map<number, number>
): void {
    const applyAnchorToGroup = (group: number[], anchorX: number) => {
        for (const cid of group) {
            const cn = byId.get(cid);
            if (cn) cn.x = anchorX;
        }
    };

    for (const p of list) {
        if (!idSet.has(p.nodeId)) continue;
        const childIds = normalizeLinkArray(p.nextNodes, nodeOrder).filter(
            (c: number) => idSet.has(c)
        );
        if (childIds.length < 2) continue;

        const isRoot = !(p.prevNodes ?? []).some((pid: number) =>
            idSet.has(pid)
        );
        if (isRoot) {
            applyAnchorToGroup(childIds, p.x + opts.layerStepX);
            continue;
        }

        let spineNextId: number | null = null;
        if (spineSet.has(p.nodeId)) {
            const si = spineIndex.get(p.nodeId) ?? -1;
            if (si >= 0 && si + 1 < pathIds.length) {
                const sn = pathIds[si + 1]!;
                if (childIds.includes(sn)) spineNextId = sn;
            }
        }

        const byLr = new Map<number, number[]>();
        for (const cid of childIds) {
            if (spineNextId !== null && cid === spineNextId) continue;
            const lr = laneRank.get(cid) ?? 0;
            const bucket = byLr.get(lr) ?? [];
            bucket.push(cid);
            byLr.set(lr, bucket);
        }

        for (const group of byLr.values()) {
            if (group.length < 2) continue;

            let anchorX: number | undefined;
            const spineInGroup = group.filter((c) => spineSet.has(c));
            if (spineInGroup.length >= 1) {
                spineInGroup.sort(
                    (a, b) =>
                        (spineIndex.get(a) ?? 9999) -
                        (spineIndex.get(b) ?? 9999)
                );
                anchorX = byId.get(spineInGroup[0]!)!.x;
            }
            const ax = anchorX ?? p.x + opts.layerStepX;
            applyAnchorToGroup(group, ax);
        }
    }
}

/**
 * 兄弟同列后，汇入点（如 37）的 x 可能仍按「旧 38 列」算过而多空一格；凡多前驱共列则统一为「该列 + 一格」。
 */
function snapMergeNodesAfterSiblingColumnUnify(
    list: any[],
    idSet: Set<number>,
    byId: Map<number, any>,
    opts: LayoutOptions
): void {
    const colEps = 6;
    for (const n of list) {
        if (!idSet.has(n.nodeId)) continue;
        const preds = (n.prevNodes ?? []).filter((pid: number) =>
            idSet.has(pid)
        );
        if (preds.length < 2) continue;
        let minXp = Infinity;
        let maxXp = -Infinity;
        for (const pid of preds) {
            const px = byId.get(pid)!.x;
            minXp = Math.min(minXp, px);
            maxXp = Math.max(maxXp, px);
        }
        if (!Number.isFinite(minXp) || maxXp - minXp > colEps) continue;
        n.x = minXp + opts.layerStepX;
    }
}

/**
 * 多前驱汇入：列对齐 **最长前置路径深度**（自根拓扑 DP 的 upstreamDist[p]）
 * 的一侧，再在并列最深前驱中取 `max(x)+step`。**不再**仅用「与汇入点同泳道秩」的前驱，
 * 否则会出现短枝先入列而把汇入（如 33）钉在短枝末端、长链被迫大 U（30→⋯→53 短于 27→⋯→32）的问题。
 *
 * 「37/31 平直横排」仍由拓扑初算 x 与同父 unify 约束；仅在多父收口处用整条图的最长前缀深度判左右。
 */
function snapMultiPredMergeNodesToMaxPredColumn(
    list: any[],
    idSet: Set<number>,
    spineSet: Set<number>,
    spineIndex: Map<number, number>,
    byId: Map<number, any>,
    opts: LayoutOptions,
    upstreamDist: Map<number, number>
): void {
    /** 两前驱列距小于此值视为「同列栅格 + 轨间错开」；仍用 max(x)+整格 会把汇入点（如 36）甩到过右、横线过长 */
    const mergeColSpreadSlack = Math.min(
        160,
        Math.max(80, opts.layerStepX * 0.34)
    );

    for (const n of list) {
        if (!idSet.has(n.nodeId) || spineSet.has(n.nodeId)) continue;
        const preds = (n.prevNodes ?? []).filter((pid: number) =>
            idSet.has(pid)
        );
        if (preds.length < 2) continue;

        let minAll = Infinity;
        let maxAll = -Infinity;
        for (const pid of preds) {
            const px = byId.get(pid)!.x;
            minAll = Math.min(minAll, px);
            maxAll = Math.max(maxAll, px);
        }

        /** 含主轴前驱的汇入（如 15←1,14,17）：列 = max(全部前驱 x)+一格，避免只跟 1 同列而与 14 叠在一起 */
        const spinePreds = preds.filter((pid: number) => spineSet.has(pid));
        if (spinePreds.length >= 1) {
            let mxPred = -1e9;
            for (const pid of preds) {
                mxPred = Math.max(mxPred, byId.get(pid)!.x);
            }
            n.x = mxPred + opts.layerStepX;
            continue;
        }

        let bestDepth = -1;
        for (const pid of preds) {
            bestDepth = Math.max(bestDepth, upstreamDist.get(pid) ?? -1);
        }
        const deepest = preds.filter(
            (pid: number) => (upstreamDist.get(pid) ?? -1) === bestDepth
        );

        let mx = -1e9;
        for (const pid of deepest) {
            mx = Math.max(mx, byId.get(pid)!.x);
        }

        if (maxAll - minAll <= mergeColSpreadSlack) {
            n.x = minAll + opts.layerStepX;
        } else {
            n.x = mx + opts.layerStepX;
        }
    }
}

/**
 * 父结点已在中轨 lr=0、且子图内父→子唯一边、子也唯认此父时，把子拉回中轨，
 * 避免单列延续链被 walkAssignLane 残留成上轨。多叉父（如 34→35/39）不参与。
 */
function snapLinearMiddleLaneDownChain(
    list: any[],
    idSet: Set<number>,
    byId: Map<number, any>,
    laneRank: Map<number, number>,
    nodeOrder: Map<number, number>
): void {
    const cap = idSet.size + 3;
    for (let rep = 0; rep < cap; rep++) {
        let changed = false;
        for (const n of list) {
            if (!idSet.has(n.nodeId)) continue;
            if ((laneRank.get(n.nodeId) ?? 0) !== 0) continue;
            const outs = normalizeLinkArray(n.nextNodes, nodeOrder).filter(
                (t: number) => idSet.has(t)
            );
            if (outs.length !== 1) continue;
            const v = outs[0]!;
            const predsV = (byId.get(v)!.prevNodes ?? []).filter((p: number) =>
                idSet.has(p)
            );
            if (predsV.length !== 1 || predsV[0] !== n.nodeId) continue;
            if ((laneRank.get(v) ?? 0) === 0) continue;
            laneRank.set(v, 0);
            changed = true;
        }
        if (!changed) break;
    }
}

/**
 * 严格遵守「无双叉则同行」：**出边唯一**的子结点必须与父结点同泳道秩；
 * **多父汇入点**的泳道与 **最长前置路径深度** 一侧的前驱对齐（并列最深再按分叉比较器 tie-break），
 * 避免汇入点被 `forkCmp` 短枝（如 53）抬到上轨、与长链前驱（32）同级却「升行」。
 * 须经若干轮迭代至稳定，以铺满 43→44→… 整链而不会把 43 单独抬到外行。
 */
function snapLaneRanksStrictNoForkSameRow(
    list: any[],
    idSet: Set<number>,
    byId: Map<number, any>,
    nodeOrder: Map<number, number>,
    laneRank: Map<number, number>,
    edgesUntilMerge: Map<number, number>,
    downLen: Map<number, number>,
    upstreamDist: Map<number, number>
): void {
    const forkCmp = createForkEdgeComparator(
        edgesUntilMerge,
        downLen,
        nodeOrder
    );

    const topo = topologicalSortNodes(list, idSet, nodeOrder);
    const limit = Math.max(idSet.size * 3, 8);
    for (let rep = 0; rep < limit; rep++) {
        let changed = false;
        for (const n of topo) {
            if (!idSet.has(n.nodeId)) continue;
            const preds = (byId.get(n.nodeId)?.prevNodes ?? []).filter(
                (p: number) => idSet.has(p)
            );
            if (preds.length >= 2) {
                let bestDepth = -1;
                for (const p of preds) {
                    bestDepth = Math.max(bestDepth, upstreamDist.get(p) ?? -1);
                }
                const deepest = preds.filter(
                    (p: number) => (upstreamDist.get(p) ?? -1) === bestDepth
                );
                const mainP = [...deepest].sort(forkCmp)[0]!;
                const lrP = laneRank.get(mainP);
                if (
                    lrP !== undefined &&
                    (laneRank.get(n.nodeId) ?? Infinity) !== lrP
                ) {
                    laneRank.set(n.nodeId, lrP);
                    changed = true;
                }
            }
            const outsRaw = normalizeLinkArray(
                byId.get(n.nodeId)?.nextNodes,
                nodeOrder
            ).filter((c: number) => idSet.has(c));
            if (outsRaw.length !== 1) continue;
            const c = outsRaw[0]!;
            const lrForChild = laneRank.get(n.nodeId);
            if (lrForChild === undefined) continue;
            if ((laneRank.get(c) ?? Infinity) !== lrForChild) {
                laneRank.set(c, lrForChild);
                changed = true;
            }
        }
        if (!changed) break;
    }
}

/**
 * 单前驱且父不在主轴：子列固定在父列 + 一格。须在兄弟同列 unify 之前调用，避免侧轨并联子被拉散。
 */
function snapSinglePredOffSpineChainColumn(
    list: any[],
    idSet: Set<number>,
    spineSet: Set<number>,
    byId: Map<number, any>,
    opts: LayoutOptions,
    topoOrd: Map<number, number>
): void {
    const ordered = [...list]
        .filter((n) => idSet.has(n.nodeId))
        .sort(
            (a, b) =>
                (topoOrd.get(a.nodeId) ?? 0) - (topoOrd.get(b.nodeId) ?? 0)
        );
    for (const n of ordered) {
        if (spineSet.has(n.nodeId)) continue;
        const preds = (n.prevNodes ?? []).filter((pid: number) =>
            idSet.has(pid)
        );
        if (preds.length !== 1) continue;
        const p = preds[0]!;
        if (spineSet.has(p)) continue;
        const pn = byId.get(p)!;
        n.x = pn.x + opts.layerStepX;
    }
}

/**
 * 下轨（laneRank>0）与主轴按「到根最长边数」同深度对齐到同一竖列。
 * sweep 后 snapSinglePred 会把链末（如 8）写成父列+整格而比主轴末端（7）多出一列，此处收回。
 */
function snapLowerRailDepthToSpineColumns(
    list: any[],
    idSet: Set<number>,
    spineSet: Set<number>,
    pathIds: number[],
    byId: Map<number, any>,
    laneRank: Map<number, number>,
    upstreamDist: Map<number, number>
): void {
    const depthToSpineX = new Map<number, number>();
    for (const sid of pathIds) {
        const d = upstreamDist.get(sid);
        if (d === undefined || !Number.isFinite(d)) continue;
        if (!depthToSpineX.has(d)) {
            depthToSpineX.set(d, byId.get(sid)!.x);
        }
    }
    for (const n of list) {
        if (!idSet.has(n.nodeId) || spineSet.has(n.nodeId)) continue;
        if ((laneRank.get(n.nodeId) ?? 0) <= 0) continue;
        const d = upstreamDist.get(n.nodeId);
        if (d === undefined) continue;
        const sx = depthToSpineX.get(d);
        if (sx !== undefined) n.x = sx;
    }
}

/**
 * **与画布 `addChildNodeUnder` 一致的几何常量**：`gapX = width+150`、`siblingStepY = 50`、
 * 同一套外包盒避让（`mindMapChildPlacement.resolveNonCollidingChildCenterLikeAddChild`）。
 *
 * **多父汇入**（如 30→27 且 34→27）：锚父取 **落在更长流程序列上的那个前驱**——与
 * `longestChainPathIds` 一致：先到根的最长链长优先，平局再比该前驱的下游最远叶，再平局比表次序。
 * 不再取「最靠右 x 最大」的前驱。
 *
 * 同父兄弟阶梯：画布子 nodeId 递增，此处同父结点按 **`nodeId` 升序**。
 */
export function applyIncrementalMindMapLayout(
    nodes: any[],
    opts: LayoutOptions
): void {
    const list = nodes;
    if (!list.length) return;

    const idSet = new Set(list.map((n) => n.nodeId));
    const byId = nodeByIdMap(list);

    const nodeOrderRow = buildListOrderIndex(list);

    const nw = NODE_RECT_LAYOUT.width;
    const nh = NODE_RECT_LAYOUT.height;

    const gapX = DEFAULT_MIND_MAP_CHILD_GAP_FROM_PARENT;
    const siblingStepY = DEFAULT_MIND_MAP_SIBLING_STEP_Y;

    const geom = {
        nodeWidth: nw,
        nodeHeight: nh,
        collisionPadding: 14,
        lateralStepX: Math.max(Math.floor(nw * 0.45), 96),
        gapX,
        siblingStepY,
        maxVerticalScanSteps: 72,
        maxLateralEscalations: 12
    };

    const isPlaced = (nn: any) =>
        Number.isFinite(nn.x) && Number.isFinite(nn.y);
    const placedColliders = (): any[] => list.filter(isPlaced);

    for (const n of list) {
        n.x = NaN;
        n.y = NaN;
    }

    const topo = topologicalSortNodes(list, idSet, nodeOrderRow);
    const downLen = longestDownLen(list, idSet, nodeOrderRow);
    const upstreamDist = upstreamLongestEdgeLenByTopoOrder(topo, idSet);

    const roots = topo.filter(
        (n) => !(n.prevNodes ?? []).some((pid: number) => idSet.has(pid))
    );
    roots.sort(
        (a, b) =>
            (nodeOrderRow.get(a.nodeId) ?? 0) -
            (nodeOrderRow.get(b.nodeId) ?? 0)
    );

    roots.forEach((rn, ri) => {
        rn.x = opts.startX + ri * gapX;
        rn.y = opts.startY;
    });

    const halfW = nw / 2;
    const halfH = nh / 2;

    for (const n of topo) {
        if (isPlaced(n)) continue;

        const preds = (n.prevNodes ?? []).filter((pid: number) =>
            idSet.has(pid)
        );
        if (!preds.length) continue;

        const placedPreds = preds.filter((pid: number) =>
            isPlaced(byId.get(pid)!)
        );
        if (!placedPreds.length) continue;

        const anchorPid =
            pickLongestSequencePredecessor(
                placedPreds,
                nodeOrderRow,
                upstreamDist,
                downLen,
                byId
            ) ?? placedPreds[0]!;
        const anchorNode = byId.get(anchorPid)!;

        const siblingsSharedParent = topo
            .filter(
                (c) =>
                    idSet.has(c.nodeId) &&
                    (c.prevNodes ?? []).some((p: number) => p === anchorPid)
            )
            .sort((a, b) => a.nodeId - b.nodeId);

        const siblingIndex = Math.max(
            0,
            siblingsSharedParent.findIndex((c) => c.nodeId === n.nodeId)
        );

        const preferredX = anchorNode.x + gapX;
        const baseY =
            anchorNode.y +
            alternatingSiblingBaseYOffset(siblingIndex, siblingStepY);

        const { x: nx, y: ny } = resolveNonCollidingChildCenterLikeAddChild(
            placedColliders(),
            preferredX,
            baseY,
            halfW,
            halfH,
            geom
        );
        n.x = nx;
        n.y = ny;
    }

    /** 拓扑环或孤立 unreachable：任一仍 NaN 的节点压回起点网格，避免 Konva NaN */
    let orphan = 0;
    for (const n of list) {
        if (isPlaced(n)) continue;
        n.x = opts.startX + (orphan % 12) * (gapX * 0.25);
        n.y = opts.startY + Math.floor(orphan / 12) * siblingStepY;
        orphan++;
    }
}

function layoutMindMapNodeHalfExtentsForOverlap(n: any): {
    hw: number;
    hh: number;
} {
    const w = Number(n.rectConf?.width ?? NODE_RECT_LAYOUT.width);
    const h = Number(n.rectConf?.height ?? NODE_RECT_LAYOUT.height);
    return { hw: w * 0.5, hh: h * 0.5 };
}

type MindMapOverlapItem = {
    n: any;
    hw: number;
    hh: number;
};

function mindMapLayoutNodePairOverlaps2D(
    a: MindMapOverlapItem,
    b: MindMapOverlapItem,
    pad: number
): boolean {
    if (a.n.nodeId === b.n.nodeId) return false;
    const dx = Math.abs(a.n.x - b.n.x);
    const dy = Math.abs(a.n.y - b.n.y);
    return dx < a.hw + b.hw + pad && dy < a.hh + b.hh + pad;
}

function mindMapLayoutNodeRectsOverlap2D(a: any, b: any, pad: number): boolean {
    if (a.nodeId === b.nodeId) return false;
    const A = layoutMindMapNodeHalfExtentsForOverlap(a);
    const B = layoutMindMapNodeHalfExtentsForOverlap(b);
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    return dx < A.hw + B.hw + pad && dy < A.hh + B.hh + pad;
}

/** 同父且同泳道秩的多个子节点：在统一 y 之后按 0/+1/−1 阶梯错开，避免同列完全重合 */
function staggerSameParentLaneRankSiblings(
    list: any[],
    idSet: Set<number>,
    byId: Map<number, any>,
    laneRank: Map<number, number>,
    centerY: number,
    yNudge: number,
    layerStepY: number
): void {
    const parentChildren = new Map<number, number[]>();
    for (const n of list) {
        if (!idSet.has(n.nodeId)) continue;
        for (const p of n.prevNodes ?? []) {
            if (!idSet.has(p)) continue;
            const arr = parentChildren.get(p) ?? [];
            arr.push(n.nodeId);
            parentChildren.set(p, arr);
        }
    }
    for (const childIds of parentChildren.values()) {
        const byLr = new Map<number, number[]>();
        for (const cid of childIds) {
            if (!idSet.has(cid)) continue;
            const lr = laneRank.get(cid) ?? 0;
            const bucket = byLr.get(lr) ?? [];
            bucket.push(cid);
            byLr.set(lr, bucket);
        }
        for (const [lr, ids] of byLr) {
            if (ids.length <= 1) continue;
            ids.sort((a, b) => a - b);
            const baseY = centerY + yNudge + lr * layerStepY;
            for (let i = 0; i < ids.length; i++) {
                const cn = byId.get(ids[i]!)!;
                cn.y = baseY + alternatingSiblingBaseYOffset(i, layerStepY);
            }
        }
    }
}

function mindMapLayoutNodeCanMoveForOverlap(
    nodeId: number,
    spineSet: Set<number>
): boolean {
    return !spineSet.has(nodeId);
}

/** 定稿主轴 x；y 固定为中轨线 {@link middleRailY}（含 yNudge），与 lr=0 侧轨同高。 */
function reapplySpineNodeGridPositions(
    pathIds: number[],
    byId: Map<number, any>,
    centerX: number,
    middleRailY: number,
    layerStepX: number
): void {
    for (let i = 0; i < pathIds.length; i++) {
        const n = byId.get(pathIds[i]!);
        if (!n) continue;
        n.x = centerX + i * layerStepX;
        n.y = middleRailY;
    }
}

/**
 * 同列同泳道内按相邻列结点 y 重心交替排序（Sugiyama 层内启发），降低折线交叉；不修改连线逻辑。
 */
function reorderMindMapColumnsByBarycenter(
    list: any[],
    idSet: Set<number>,
    byId: Map<number, any>,
    spineSet: Set<number>,
    centerX: number,
    centerY: number,
    yNudge: number,
    opts: LayoutOptions,
    laneRank: Map<number, number>
): void {
    const { layerStepX, layerStepY } = opts;
    const colOf = (n: any) => Math.round((n.x - centerX) / layerStepX);

    const buckets = new Map<string, any[]>();
    for (const n of list) {
        if (!idSet.has(n.nodeId) || spineSet.has(n.nodeId)) continue;
        /** 中轨结点（含 7→9 汇入）保持泳道网格 y，勿按邻接重心漂移 */
        if ((laneRank.get(n.nodeId) ?? 0) === 0) continue;
        const key = `${colOf(n)}:${laneRank.get(n.nodeId) ?? 0}`;
        const arr = buckets.get(key) ?? [];
        arr.push(n);
        buckets.set(key, arr);
    }

    const colKeys = [
        ...new Set([...buckets.keys()].map((k) => Number(k.split(':')[0]!)))
    ].sort((a, b) => a - b);
    if (colKeys.length < 2) return;

    const passes = Math.min(6, Math.max(4, colKeys.length + 1));
    const rowStep = Math.max(NODE_RECT_LAYOUT.height + 52, layerStepY * 0.92);

    for (let pass = 0; pass < passes; pass++) {
        const leftToRight = pass % 2 === 0;
        const orderedCols = leftToRight ? colKeys : [...colKeys].reverse();
        const useSuccessors = !leftToRight;

        for (const col of orderedCols) {
            for (const [key, group] of buckets) {
                const parts = key.split(':');
                const colNum = Number(parts[0]);
                const lr = Number(parts[1]);
                if (colNum !== col || group.length < 2) continue;

                const score = (n: any) => {
                    const ids = useSuccessors
                        ? (n.nextNodes ?? []).filter((id: number) =>
                              idSet.has(id)
                          )
                        : (n.prevNodes ?? []).filter((id: number) =>
                              idSet.has(id)
                          );
                    if (!ids.length) return n.y;
                    let s = 0;
                    let c = 0;
                    for (const id of ids) {
                        const o = byId.get(id);
                        if (!o) continue;
                        s += o.y;
                        c++;
                    }
                    return c > 0 ? s / c : n.y;
                };

                group.sort((a, b) => {
                    const d = score(a) - score(b);
                    return Math.abs(d) > 2 ? d : a.nodeId - b.nodeId;
                });

                const baseY = centerY + yNudge + lr * layerStepY;
                const span = (group.length - 1) * rowStep;
                let y0 = baseY - span / 2;
                for (let i = 0; i < group.length; i++) {
                    group[i]!.y = y0 + i * rowStep;
                }
            }
        }
    }
}

/**
 * 同一竖列内保证结点中心间距 ≥ 卡片高度 + 留白（如 14/15 被汇入 snap 拉到同列后的兜底）。
 */
function enforceMindMapColumnVerticalSpacing(
    list: any[],
    idSet: Set<number>,
    spineSet: Set<number>,
    opts: LayoutOptions
): void {
    const colEps = Math.min(52, opts.layerStepX * 0.12);
    const minDy = Math.max(
        NODE_RECT_LAYOUT.height + 60,
        Math.round(opts.layerStepY * 0.9)
    );
    const nodes = list
        .filter((n) => idSet.has(n.nodeId))
        .sort((a, b) => a.x - b.x || a.y - b.y || a.nodeId - b.nodeId);

    let i = 0;
    while (i < nodes.length) {
        let j = i + 1;
        while (
            j < nodes.length &&
            Math.abs(nodes[j]!.x - nodes[i]!.x) <= colEps
        ) {
            j++;
        }
        const cluster = nodes.slice(i, j);
        if (cluster.length >= 2) {
            cluster.sort((a, b) => a.y - b.y || a.nodeId - b.nodeId);
            for (let k = 1; k < cluster.length; k++) {
                const prev = cluster[k - 1]!;
                const cur = cluster[k]!;
                const prevHh = layoutMindMapNodeHalfExtentsForOverlap(prev).hh;
                const curHh = layoutMindMapNodeHalfExtentsForOverlap(cur).hh;
                const colPad = Math.max(60, minDy - NODE_RECT_LAYOUT.height);
                const floorY = prev.y + prevHh + curHh + colPad;
                if (cur.y < floorY - 1) {
                    /** 主轴锚定 y，同列避让只推开侧轨，避免 0/9 等主链结点被挤离中轨 */
                    if (spineSet.has(cur.nodeId)) continue;
                    cur.y = floorY;
                }
            }
        }
        i = j;
    }
}

/**
 * 同列（x 接近）且外包盒重叠时强制拉开纵向间距；优先移动侧轨，主轴仅在 x 已对齐后仍重叠时微调 y。
 */
function resolveMindMapLayoutSameColumnOverlaps(
    list: any[],
    idSet: Set<number>,
    spineSet: Set<number>,
    opts: LayoutOptions
): void {
    const colEps = Math.min(40, opts.layerStepX * 0.09);
    const pad = 20;
    const nodes = list.filter((n) => idSet.has(n.nodeId));
    if (nodes.length < 2) return;

    nodes.sort((a, b) => a.x - b.x || a.y - b.y || a.nodeId - b.nodeId);
    let i = 0;
    while (i < nodes.length) {
        let j = i + 1;
        while (
            j < nodes.length &&
            Math.abs(nodes[j]!.x - nodes[i]!.x) <= colEps
        ) {
            j++;
        }
        const cluster = nodes
            .slice(i, j)
            .sort((a, b) => a.y - b.y || a.nodeId - b.nodeId);
        for (let k = 0; k < cluster.length; k++) {
            for (let m = k + 1; m < cluster.length; m++) {
                let top = cluster[k]!;
                let bot = cluster[m]!;
                if (!mindMapLayoutNodeRectsOverlap2D(top, bot, pad)) continue;
                if (top.y > bot.y) {
                    const t = top;
                    top = bot;
                    bot = t;
                }
                const ht = layoutMindMapNodeHalfExtentsForOverlap(top);
                const hb = layoutMindMapNodeHalfExtentsForOverlap(bot);
                const targetY = top.y + ht.hh + hb.hh + pad;
                if (bot.y >= targetY - 2) continue;

                if (!spineSet.has(bot.nodeId)) {
                    bot.y = targetY;
                } else if (!spineSet.has(top.nodeId)) {
                    top.y = bot.y - ht.hh - hb.hh - pad;
                }
            }
        }
        i = j;
    }
}

/**
 * 泳道定稿后消除节点重叠；主轴锚定，侧轨可横/纵推开。
 */
function relaxMindMapLayoutNodeOverlaps(
    list: any[],
    idSet: Set<number>,
    spineSet: Set<number>
): void {
    const pad = 16;
    /** 同列（x 接近）时只纵向推开，避免侧轨被横向挤成锯齿 */
    const sameColumnEps = Math.min(28, NODE_RECT_LAYOUT.width * 0.1);
    const cellSize = Math.max(
        NODE_RECT_LAYOUT.width + pad * 2,
        NODE_RECT_LAYOUT.height + pad * 2
    );
    const items: MindMapOverlapItem[] = list
        .filter((n) => idSet.has(n.nodeId))
        .map((n) => {
            const { hw, hh } = layoutMindMapNodeHalfExtentsForOverlap(n);
            return { n, hw, hh };
        });
    if (items.length < 2) return;

    /** 原 maxIter = max(96, n²) 在 93 节点时约 8649 轮 × O(n²) 配对，是加载 50s 的主因 */
    const maxIter = Math.min(64, Math.max(20, items.length + 12));

    const pushVertical = (
        top: MindMapOverlapItem,
        bot: MindMapOverlapItem
    ): boolean => {
        const needSep = top.hh + bot.hh + pad;
        const newY = top.n.y + needSep;
        if (newY <= bot.n.y + 1e-6) return false;
        if (mindMapLayoutNodeCanMoveForOverlap(bot.n.nodeId, spineSet)) {
            bot.n.y = newY;
            return true;
        }
        if (mindMapLayoutNodeCanMoveForOverlap(top.n.nodeId, spineSet)) {
            top.n.y = bot.n.y - needSep;
            return true;
        }
        return false;
    };

    const pushHorizontal = (
        left: MindMapOverlapItem,
        right: MindMapOverlapItem
    ): boolean => {
        const needSep = left.hw + right.hw + pad;
        const newX = left.n.x + needSep;
        if (newX <= right.n.x + 1e-6) return false;
        if (mindMapLayoutNodeCanMoveForOverlap(right.n.nodeId, spineSet)) {
            right.n.x = newX;
            return true;
        }
        if (mindMapLayoutNodeCanMoveForOverlap(left.n.nodeId, spineSet)) {
            left.n.x = right.n.x - needSep;
            return true;
        }
        return false;
    };

    for (let iter = 0; iter < maxIter; iter++) {
        let moved = false;
        const grid = new Map<string, number[]>();
        for (let idx = 0; idx < items.length; idx++) {
            const { n } = items[idx]!;
            const cx = Math.floor(n.x / cellSize);
            const cy = Math.floor(n.y / cellSize);
            const key = `${cx},${cy}`;
            const bucket = grid.get(key) ?? [];
            bucket.push(idx);
            grid.set(key, bucket);
        }

        const pairSeen = new Set<string>();
        for (let gi = 0; gi < items.length; gi++) {
            const ai = items[gi]!;
            const cx = Math.floor(ai.n.x / cellSize);
            const cy = Math.floor(ai.n.y / cellSize);

            for (let di = -1; di <= 1; di++) {
                for (let dj = -1; dj <= 1; dj++) {
                    const bucket = grid.get(`${cx + di},${cy + dj}`);
                    if (!bucket) continue;
                    for (const gj of bucket) {
                        if (gj <= gi) continue;
                        const pairKey = `${gi}|${gj}`;
                        if (pairSeen.has(pairKey)) continue;
                        pairSeen.add(pairKey);

                        const a = items[gi]!;
                        const b = items[gj]!;
                        if (!mindMapLayoutNodePairOverlaps2D(a, b, pad))
                            continue;

                        const adx = Math.abs(a.n.x - b.n.x);
                        const ady = Math.abs(a.n.y - b.n.y);
                        const overlapX = a.hw + b.hw + pad - adx;
                        const overlapY = a.hh + b.hh + pad - ady;
                        if (overlapX <= 0 || overlapY <= 0) continue;

                        const preferVertical =
                            adx < sameColumnEps ||
                            overlapY <= overlapX ||
                            adx < Math.min(a.hw, b.hw) * 0.42;

                        if (preferVertical) {
                            let top = a;
                            let bot = b;
                            if (
                                a.n.y > b.n.y ||
                                (a.n.y === b.n.y && a.n.nodeId > b.n.nodeId)
                            ) {
                                top = b;
                                bot = a;
                            }
                            if (pushVertical(top, bot)) moved = true;
                        } else {
                            let left = a;
                            let right = b;
                            if (
                                a.n.x > b.n.x ||
                                (a.n.x === b.n.x && a.n.nodeId > b.n.nodeId)
                            ) {
                                left = b;
                                right = a;
                            }
                            if (pushHorizontal(left, right)) moved = true;
                        }
                    }
                }
            }
        }
        if (!moved) break;
    }
}

function computeMindMapSpinePathIds(list: any[], idSet: Set<number>): number[] {
    const byId = nodeByIdMap(list);
    const nodeOrder = buildListOrderIndex(list);
    let pathIds = longestChainPathIds(list, idSet, nodeOrder);
    pathIds = repairSpineChainToCanvasForwardEdges(
        pathIds,
        byId,
        nodeOrder,
        idSet
    );
    pathIds = shortenSpineWhereDirectArcSkipsMiddle(
        pathIds,
        byId,
        nodeOrder,
        idSet
    );
    pathIds = shortenSpineThroughStubRelayNodes(
        pathIds,
        byId,
        nodeOrder,
        idSet
    );
    pathIds = rebuildSpineByShortestGreedyToEnd(
        pathIds,
        list,
        idSet,
        nodeOrder,
        byId
    );
    return pathIds;
}

/**
 * 节点卡片因内容撑高后，按实际外包盒推开重叠结点（主轴锚定，侧轨可动）。
 * 不重置整张图布局，仅做局部避让。
 */
export function resolveMindMapLayoutOverlapsAfterNodeResize(
    nodes: any[],
    opts?: Pick<LayoutOptions, 'layerStepX' | 'layerStepY'>
): void {
    const list = nodes;
    if (list.length < 2) return;

    const idSet = new Set(list.map((n) => n.nodeId));
    const spineSet = new Set(computeMindMapSpinePathIds(list, idSet));
    const layoutOpts = {
        ...buildMindMapLayoutOptions(list.length),
        ...opts
    };

    resolveMindMapLayoutSameColumnOverlaps(list, idSet, spineSet, layoutOpts);
    relaxMindMapLayoutNodeOverlaps(list, idSet, spineSet);
    resolveMindMapLayoutSameColumnOverlaps(list, idSet, spineSet, layoutOpts);
    relaxMindMapLayoutNodeOverlaps(list, idSet, spineSet);
}

/**
 * 泳道布局：**全局 DAG 最长链**作主横轴（中轨 `lr=0`），与起始入口同一水平线铺满；
 * 其余序列按 −1,+1,−2,+2…「收拢发散」排泳道秩。任一父结点分叉：子边先按「到下一个多父汇入前的最长铺垫」，
 * 平局再按到叶的最长链；**胜者**与父同泳道直行（如 30→43→…→33 同源一行），较短者向远离中轨方向逐档偏移；
 * `{@link unifySiblingColumnsByParent}` 再对齐同列。「中段硬拼主轴」已由纯最长链规则替代，
 * 避免出现 29→34→42 主轴被 30→27 挤出中轨的问题。
 */
export function applyLayerLayout(nodes: any[], opts: LayoutOptions) {
    const list = nodes;
    if (!list.length) return;

    /** 阶段概览：主轴 path → 泳道 lr → 拓扑定 x/y → 汇入拉拽 → 下轨栅格 sweep → 二次列收紧。 */

    const idSet = new Set(list.map((n) => n.nodeId));
    const byId = nodeByIdMap(list);
    const nodeOrder = buildListOrderIndex(list);
    const pathIds = computeMindMapSpinePathIds(list, idSet);
    const spineSet = new Set(pathIds);
    const spineIndex = new Map<number, number>();
    pathIds.forEach((id, i) => spineIndex.set(id, i));

    const downLen = longestDownLen(list, idSet, nodeOrder);
    const mergeIds = buildMergeNodeIdSet(list, idSet);
    const edgesUntilMerge = precomputeLongestEdgesUntilMerge(
        list,
        idSet,
        mergeIds,
        nodeOrder
    );

    const cmpForkChild = createForkEdgeComparator(
        edgesUntilMerge,
        downLen,
        nodeOrder
    );

    const centerX = opts.startX;
    const centerY = opts.startY;

    for (let i = 0; i < pathIds.length; i++) {
        const n = byId.get(pathIds[i])!;
        n.x = centerX + i * opts.layerStepX;
        n.y = centerY;
    }

    const laneRank = new Map<number, number>();
    pathIds.forEach((id) => laneRank.set(id, 0));

    /** 在主轴前驱中取 spineIndex 最小者，用于判断是否应由更近分叉父分配泳道而非沿链继承 */
    function minSpinePredId(nodeId: number): number | null {
        const preds = (byId.get(nodeId)?.prevNodes ?? []).filter((p: number) =>
            idSet.has(p)
        );
        let best: number | null = null;
        let bestSi = Infinity;
        for (const p of preds) {
            if (!spineSet.has(p)) continue;
            const si = spineIndex.get(p) ?? Infinity;
            if (si < bestSi) {
                bestSi = si;
                best = p;
            }
        }
        return best;
    }

    /** 主轴下一环 spineNext=A，侧轨直指主轴汇合点 M，且 M 在 pathIds 上恰为 A 的下一格（菱形两线并排汇入，如 36→37 与 38→37）。 */
    /** 不可用 iM>iA：下轨 26→31 主轴为 27→28→…→31，会误判并让 26 吃到 lr=−2。 */
    function diamondMergeRailToLaterSpine(
        spineDirectNext: number,
        railChildId: number
    ): boolean {
        const r = byId.get(railChildId);
        if (!r) return false;
        const iA = spineIndex.get(spineDirectNext) ?? -1;
        if (iA < 0 || iA + 1 >= pathIds.length) return false;
        const mergeImmediate = pathIds[iA + 1]!;
        const outs = normalizeLinkArray(r.nextNodes, nodeOrder).filter(
            (t: number) => idSet.has(t) && spineSet.has(t)
        );
        return outs.some(
            (tid: number) =>
                tid === mergeImmediate || spineIndex.get(tid) === iA + 1
        );
    }

    /** 分叉：沿侧轨前移，汇入主轴的点不进入泳道映射（由主轴占位） */
    function walkAssignLane(uid: number, lr: number, force = false) {
        if (spineSet.has(uid)) return;
        if (!idSet.has(uid)) return;
        if (!force && laneRank.has(uid)) {
            const ex = laneRank.get(uid) ?? 0;
            if (ex !== 0) return;
        }
        laneRank.set(uid, lr);
        const un = byId.get(uid)!;
        const outs = normalizeLinkArray(un.nextNodes, nodeOrder).filter(
            (x: number) => idSet.has(x)
        );
        for (const nx of outs) {
            if (spineSet.has(nx)) continue;
            const forkSp = minSpinePredId(nx);
            if (forkSp !== null && forkSp !== uid) continue;
            walkAssignLane(nx, lr, false);
        }
    }

    /**
     * 首站主轴多分叉：侧轨按 +1/−1/+2/−2… 扩档（勿反复 +1/−1 导致同泳道 y 重合）。
     * 后续主轴站的单叉见 `off.length===1` 内「上/下轨已有秩」规则。
     */
    for (let i = 0; i < pathIds.length; i++) {
        const sid = pathIds[i];
        const spineNext = pathIds[i + 1];
        const sn = byId.get(sid)!;
        const outs = normalizeLinkArray(sn.nextNodes, nodeOrder).filter(
            (c: number) => idSet.has(c)
        );
        const off = outs.filter((c: number) => c !== spineNext);
        if (!off.length) continue;

        off.sort(cmpForkChild);

        const isStartSpineNode = i === 0;

        if (
            isStartSpineNode &&
            spineNext !== undefined &&
            outs.includes(spineNext)
        ) {
            /** 序位 0 = 主轴下一站；侧枝序位顺延，避免第一条侧轨吃掉 lr=0 */
            const ordered = [spineNext, ...off];
            let rootSideJ = 0;
            ordered.forEach((bid: number) => {
                if (spineSet.has(bid)) return;
                const railOnlyCnt = off.filter(
                    (c: number) => !spineSet.has(c)
                ).length;

                const isDiamondRail =
                    spineNext !== undefined &&
                    railOnlyCnt === 1 &&
                    diamondMergeRailToLaterSpine(spineNext, bid);
                let rank: number;
                if (isDiamondRail) {
                    rank = -2;
                } else {
                    const mag = Math.floor(rootSideJ / 2) + 1;
                    const sign = rootSideJ % 2 === 0 ? 1 : -1;
                    rank = sign * mag;
                    rootSideJ++;
                }
                walkAssignLane(bid, rank);
            });
            continue;
        }

        off.forEach((bid: number, j: number) => {
            if (spineSet.has(bid)) return;
            /** 本条 off 只有这一枝真正走侧轨时，才把菱形侧轨压在 −2（双侧轨并排另走 mag/sign） */
            const railOnlyCnt = off.filter(
                (c: number) => !spineSet.has(c)
            ).length;

            let rank: number;
            const isDiamondRail =
                spineNext !== undefined &&
                railOnlyCnt === 1 &&
                diamondMergeRailToLaterSpine(spineNext, bid);
            if (isDiamondRail) {
                rank = -2;
            } else if (off.length === 1) {
                /** 非首站：已有上轨则用下轨 +1，已有下轨则用上轨 −1；双侧都有时取 +1；皆无则默认 −1 */
                const anyUpper = list.some(
                    (nn) =>
                        idSet.has(nn.nodeId) &&
                        !spineSet.has(nn.nodeId) &&
                        (laneRank.get(nn.nodeId) ?? 0) < 0
                );
                const anyLower = list.some(
                    (nn) =>
                        idSet.has(nn.nodeId) &&
                        !spineSet.has(nn.nodeId) &&
                        (laneRank.get(nn.nodeId) ?? 0) > 0
                );
                if (anyUpper && !anyLower) rank = 1;
                else if (anyLower && !anyUpper) rank = -1;
                else if (anyUpper && anyLower) rank = 1;
                else rank = -1;
            } else if (off.length === 2) {
                rank = j === 0 ? -1 : -2;
            } else {
                const mag = Math.floor(j / 2) + 1;
                const sign = j % 2 === 0 ? 1 : -1;
                rank = sign * mag;
            }
            walkAssignLane(bid, rank);
        });
    }

    /**
     * 非主轴结点已具备父泳道后：多子边按下游最长链排序，最长与父同秩直行，其余沿「远离中轨」方向逐档偏移；
     * 需 `force` 覆盖第一站 walk 已写死的同秩递归，才能把短枝（如 26）改到更外档。
     */
    for (const sn of list) {
        if (spineSet.has(sn.nodeId)) continue;
        const outs = normalizeLinkArray(sn.nextNodes, nodeOrder).filter(
            (c: number) => idSet.has(c)
        );
        const railOuts = outs.filter((c: number) => !spineSet.has(c));
        if (railOuts.length < 2) continue;
        railOuts.sort(cmpForkChild);
        const lpRail = laneRank.get(sn.nodeId);
        if (lpRail === undefined) continue;

        railOuts.forEach((bid: number, j: number) => {
            if (spineSet.has(bid)) return;
            const rank = j <= 0 ? lpRail : lpRail + (lpRail <= 0 ? -j : +j);
            walkAssignLane(bid, rank, true);
        });
    }

    const sourcesNoPred = [...list]
        .filter(
            (nn) =>
                !(nn.prevNodes ?? []).filter((p: number) => idSet.has(p)).length
        )
        .sort(
            (a, b) =>
                (nodeOrder.get(a.nodeId) ?? 0) - (nodeOrder.get(b.nodeId) ?? 0)
        );

    sourcesNoPred.forEach((rn, ri) => {
        if (!laneRank.has(rn.nodeId)) {
            laneRank.set(rn.nodeId, ri % 2 === 0 ? -1 : 1);
        }
    });

    snapLinearMiddleLaneDownChain(list, idSet, byId, laneRank, nodeOrder);

    const topo = topologicalSortNodes(list, idSet, nodeOrder);
    const upstreamMergeDist = upstreamLongestEdgeLenByTopoOrder(topo, idSet);

    snapLaneRanksStrictNoForkSameRow(
        list,
        idSet,
        byId,
        nodeOrder,
        laneRank,
        edgesUntilMerge,
        downLen,
        upstreamMergeDist
    );

    const topoOrd = new Map<number, number>();
    topo.forEach((n, idx) => topoOrd.set(n.nodeId, idx));
    /** 仅当「同一主轴父节点 + 同一泳道秩」下才水平错开，避免 35 的多子（如 36/38）被排成前后阶梯 */
    const spineForkSlot = new Map<string, number>();
    const railStagger = Math.min(54, NODE_RECT_LAYOUT.width * 0.17);
    const forkSlotKey = (spineParentId: number, laneRank: number) =>
        `${spineParentId}:${laneRank}`;

    /** 同父同列 + 汇入修正 + 多父顺延；拓扑定列后与下轨 sweep 后各执行一次 */
    const alignSiblingMergedColumns = () => {
        unifySiblingColumnsByParent(
            list,
            idSet,
            spineSet,
            spineIndex,
            pathIds,
            byId,
            opts,
            nodeOrder,
            laneRank
        );
        snapMergeNodesAfterSiblingColumnUnify(list, idSet, byId, opts);
        snapMultiPredMergeNodesToMaxPredColumn(
            list,
            idSet,
            spineSet,
            spineIndex,
            byId,
            opts,
            upstreamMergeDist
        );
    };

    for (const n of topo) {
        if (spineSet.has(n.nodeId)) continue;

        const predsRaw = (n.prevNodes ?? []).filter((pid: number) =>
            idSet.has(pid)
        );
        const preds = collapseConsecutiveSpinePredecessorsForLayout(
            predsRaw,
            spineSet,
            spineIndex,
            pathIds
        );
        if (!preds.length) {
            const lr =
                laneRank.get(n.nodeId) ??
                ((topoOrd.get(n.nodeId) ?? 0) % 2 === 0 ? 1 : -1);
            laneRank.set(n.nodeId, lr);
            /** 多入口与主轴第一站保持同一竖线对齐，去掉阶梯偏移，便于读图与连线 */
            n.x = centerX;
            n.y = centerY + lr * opts.layerStepY;
            continue;
        }

        let anchorSpine: any | null = null;
        let bestSpi = -1;
        let bestSpiOrd = Infinity;
        for (const pid of preds) {
            if (!spineSet.has(pid)) continue;
            const si = spineIndex.get(pid) ?? -1;
            const po = nodeOrder.get(pid) ?? Infinity;
            if (si > bestSpi || (si === bestSpi && po < bestSpiOrd)) {
                bestSpi = si;
                bestSpiOrd = po;
                anchorSpine = byId.get(pid)!;
            }
        }

        let anchor = anchorSpine;
        if (!anchor) {
            anchor = preds
                .map((pid: number) => byId.get(pid)!)
                .sort((a: any, b: any) =>
                    b.x === a.x
                        ? (topoOrd.get(a.nodeId) ?? 0) -
                          (topoOrd.get(b.nodeId) ?? 0)
                        : b.x - a.x
                )[0];
        }

        let lr = laneRank.get(n.nodeId);
        if (lr === undefined) {
            lr = laneRank.get(anchor.nodeId) ?? 0;
            laneRank.set(n.nodeId, lr);
        }

        n.y = centerY + lr * opts.layerStepY;

        const singlePredFromSpine =
            preds.length === 1 && spineSet.has(preds[0]);

        if (anchorSpine && singlePredFromSpine) {
            const sid = preds[0];
            const si = spineIndex.get(sid) ?? -1;
            const spineNextId =
                si >= 0 && si + 1 < pathIds.length ? pathIds[si + 1] : null;
            const spineNextSn =
                spineNextId != null && spineNextId !== n.nodeId
                    ? byId.get(spineNextId)!
                    : null;
            const parentOut = normalizeLinkArray(
                byId.get(sid)!.nextNodes,
                nodeOrder
            ).filter((tid: number) => idSet.has(tid));
            const siblingForkOnSpine =
                spineNextSn != null &&
                spineNextId != null &&
                parentOut.includes(spineNextId) &&
                parentOut.includes(n.nodeId);
            /** 真分叉与同列主轴后继对齐；链式顺延下一竖列（避免误判对齐到末端主轴环） */
            const baseX = siblingForkOnSpine
                ? spineNextSn.x
                : anchorSpine.x + opts.layerStepX;

            const fk = forkSlotKey(sid, lr);
            const cnt = spineForkSlot.get(fk) ?? 0;
            spineForkSlot.set(fk, cnt + 1);
            n.x = baseX + cnt * railStagger;
        } else if (preds.every((pid: number) => !spineSet.has(pid))) {
            /** 仅在侧轨延续 */
            let mx = -1e9;
            for (const pid of preds) {
                const pn = byId.get(pid)!;
                mx = Math.max(mx, pn.x);
            }
            n.x = mx + opts.layerStepX;
        } else {
            const spinePredsOnly = preds.filter((pid: number) =>
                spineSet.has(pid)
            );
            const railPredsOnly = preds.filter(
                (pid: number) => !spineSet.has(pid)
            );
            if (
                spinePredsOnly.length === 1 &&
                railPredsOnly.length >= 1 &&
                anchorSpine
            ) {
                n.x = anchorSpine.x + opts.layerStepX;
            } else {
                let mx = -1e9;
                for (const pid of preds) {
                    const pn = byId.get(pid)!;
                    mx = Math.max(
                        mx,
                        pn.x + (spineSet.has(pid) ? 0 : opts.layerStepX * 0.12)
                    );
                }
                n.x = mx + opts.layerStepX * 0.92;
            }
        }
    }

    snapSinglePredOffSpineChainColumn(
        list,
        idSet,
        spineSet,
        byId,
        opts,
        topoOrd
    );
    alignSiblingMergedColumns();

    /** 下一跳即汇入主轴（如 25→31）：把 x 往汇入点拉一段，避免横穿半张画布（仅中轨侧枝，勿拉扯上下轨） */
    for (const bn of list) {
        if (spineSet.has(bn.nodeId)) continue;
        if ((laneRank.get(bn.nodeId) ?? 0) !== 0) continue;
        const outs = normalizeLinkArray(bn.nextNodes, nodeOrder).filter(
            (tid: number) => idSet.has(tid)
        );
        const spineOut = outs.filter((tid) => spineSet.has(tid));
        if (!spineOut.length) continue;

        const mergeId = spineOut.reduce((best, tid) => {
            const ia = spineIndex.get(tid) ?? 9999;
            const ib = spineIndex.get(best) ?? 9999;
            if (ia !== ib) return ia < ib ? tid : best;
            return (nodeOrder.get(tid) ?? 0) < (nodeOrder.get(best) ?? 0)
                ? tid
                : best;
        }, spineOut[0]);
        const M = byId.get(mergeId)!;
        let floorX = bn.x;
        const prevForFloor = collapseConsecutiveSpinePredecessorsForLayout(
            (bn.prevNodes ?? []).filter((q: number) => idSet.has(q)),
            spineSet,
            spineIndex,
            pathIds
        );
        for (const pid of prevForFloor) {
            floorX = Math.max(
                floorX,
                byId.get(pid)!.x + opts.layerStepX * 0.32
            );
        }

        const slack = M.x - bn.x;
        if (slack <= opts.layerStepX * 2.1) continue;
        const pulled = bn.x + slack * 0.5;
        bn.x = Math.min(
            Math.max(floorX + opts.layerStepX * 0.22, pulled),
            M.x - NODE_RECT_LAYOUT.width * 0.55 - opts.layerStepX * 0.15
        );
    }

    /** 上轨/下轨栅格 sweep 会把并行支路（如 2→18→19 与 1→3→5）压进同一竖列，复杂图禁用。 */
    alignSiblingMergedColumns();
    snapSinglePredOffSpineChainColumn(
        list,
        idSet,
        spineSet,
        byId,
        opts,
        topoOrd
    );

    /** 按泳道秩统一 y（含上轨负秩 / 主轴 0 / 下轨正秩），杜绝累计误差导致「波形」 */
    let aboveN = 0;
    let belowN = 0;
    for (const nn of list) {
        if (spineSet.has(nn.nodeId)) continue;
        const lr0 = laneRank.get(nn.nodeId) ?? 0;
        if (lr0 < 0) aboveN++;
        else if (lr0 > 0) belowN++;
    }
    const imb = aboveN - belowN;
    const yNudge =
        Math.abs(imb) >= 3
            ? Math.sign(imb) * Math.min(opts.layerStepY * 0.42, 118)
            : 0;
    const middleRailY = centerY + yNudge;

    reapplySpineNodeGridPositions(
        pathIds,
        byId,
        centerX,
        middleRailY,
        opts.layerStepX
    );

    for (const nn of list) {
        if (!spineSet.has(nn.nodeId) && nn.x === 0 && nn.y === 0) {
            nn.x = opts.startX;
            nn.y =
                middleRailY + (laneRank.get(nn.nodeId) ?? 0) * opts.layerStepY;
        }
    }
    for (const nn of list) {
        if (spineSet.has(nn.nodeId)) continue;
        const lr = laneRank.get(nn.nodeId) ?? 0;
        nn.y = middleRailY + lr * opts.layerStepY;
    }

    staggerSameParentLaneRankSiblings(
        list,
        idSet,
        byId,
        laneRank,
        centerY,
        yNudge,
        opts.layerStepY
    );

    reorderMindMapColumnsByBarycenter(
        list,
        idSet,
        byId,
        spineSet,
        centerX,
        centerY,
        yNudge,
        opts,
        laneRank
    );

    reapplySpineNodeGridPositions(
        pathIds,
        byId,
        centerX,
        middleRailY,
        opts.layerStepX
    );

    enforceMindMapColumnVerticalSpacing(list, idSet, spineSet, opts);

    resolveMindMapLayoutSameColumnOverlaps(list, idSet, spineSet, opts);
    relaxMindMapLayoutNodeOverlaps(list, idSet, spineSet);
    enforceMindMapColumnVerticalSpacing(list, idSet, spineSet, opts);
    resolveMindMapLayoutSameColumnOverlaps(list, idSet, spineSet, opts);

    reapplySpineNodeGridPositions(
        pathIds,
        byId,
        centerX,
        middleRailY,
        opts.layerStepX
    );

    shiftMindMapNodesLeftToStartX(list, opts.startX);
}

/** 将节点整体平移，使最左缘对齐到 startX（画布左留白） */
function shiftMindMapNodesLeftToStartX(
    nodes: readonly any[],
    startX: number
): void {
    const bb = mindMapNodesContentAabb(nodes);
    if (!bb) return;
    const dx = startX - bb.minX;
    if (Math.abs(dx) < 0.5) return;
    for (const n of nodes) n.x += dx;
}

/** 相邻序列块背景与块之间的留白（画布坐标）；与 `{@link computeMindMapSequenceBlockBackdropRects}` 默认内边一致 */
export const MIND_MAP_SEQUENCE_BLOCK_BACKDROP_PAD = 34;
/** 组框内：折线/圆角走线相对边框额外留白，避免贴边或视觉重叠 */
export const MIND_MAP_SEQUENCE_BLOCK_EDGE_LINE_GAP = 18;

export function mindMapNodesContentAabb(nodes: readonly any[]): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
} | null {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
        const w = Number(n.rectConf?.width ?? NODE_RECT_LAYOUT.width);
        const h = Number(n.rectConf?.height ?? NODE_RECT_LAYOUT.height);
        minX = Math.min(minX, n.x - w / 2);
        maxX = Math.max(maxX, n.x + w / 2);
        minY = Math.min(minY, n.y - h / 2);
        maxY = Math.max(maxY, n.y + h / 2);
    }
    return Number.isFinite(minX) ? { minX, maxX, minY, maxY } : null;
}

/** 组框包络：折线顶点 + 圆角/箭头留白 */
export type MindMapSequenceBlockEdgePolyline = {
    linePts: readonly number[];
    cornerR?: number;
};

export type ResolveMindMapSequenceBlockEdgePolylines = (
    componentNodes: readonly any[],
    componentNodeIds: ReadonlySet<number>
) => readonly MindMapSequenceBlockEdgePolyline[];

/** 折线外包盒并入已有 AABB（含圆角外扩、线宽与边框间距） */
export function expandMindMapAabbWithEdgePolylines(
    bb: { minX: number; maxX: number; minY: number; maxY: number },
    polylines: readonly MindMapSequenceBlockEdgePolyline[],
    extraPad = 0
): void {
    for (const { linePts, cornerR } of polylines) {
        const pad =
            extraPad +
            (cornerR ?? 8) +
            12 +
            MIND_MAP_SEQUENCE_BLOCK_EDGE_LINE_GAP;
        for (let i = 0; i + 1 < linePts.length; i += 2) {
            const x = linePts[i]!;
            const y = linePts[i + 1]!;
            bb.minX = Math.min(bb.minX, x - pad);
            bb.maxX = Math.max(bb.maxX, x + pad);
            bb.minY = Math.min(bb.minY, y - pad);
            bb.maxY = Math.max(bb.maxY, y + pad);
        }
    }
}

/**
 * 多块无连结子图时：对每块分别 `{@link applyLayerLayout}`，再从上到下堆叠并对各块左对齐 startX，
 * 避免与「整块图一条最长主轴」混在一起后互相压盖。**单连结分量时**与直接调用 `applyLayerLayout` 等价。
 */
export function applyLayerLayoutWithSeparatedComponents(
    nodes: any[],
    opts: LayoutOptions
): void {
    const list = nodes;
    if (!list.length) return;
    const comps = partitionMindMapWeakComponents(list);
    if (comps.length <= 1) {
        applyLayerLayout(list, opts);
        return;
    }

    let nextTop = 72;
    /** 须 ≥ 约 2*backdropPad，否则带包络背景的相邻块会像叠在一起 */
    const gapY = 116;

    for (const idArr of comps) {
        const idSetComp = new Set(idArr);
        const subStable = list.filter((n) => idSetComp.has(n.nodeId));
        if (!subStable.length) continue;
        applyLayerLayout(subStable, opts);
        const bb = mindMapNodesContentAabb(subStable);
        if (!bb) continue;
        const dy = nextTop - bb.minY;
        for (const n of subStable) {
            n.y += dy;
        }
        nextTop = bb.maxY + dy + gapY;
    }
}

/**
 * 弱连通分量序列背景：几何 + 块内节点 id（画布点击整块选中）。
 * 单分组、多分组均生成包络边框。
 */
export type MindMapSequenceBlockBackdropItem = {
    x: number;
    y: number;
    width: number;
    height: number;
    nodeIds: number[];
};

/** 弱连通划分只依赖拓扑，与节点 x/y 无关；同一 nodeList 引用下复用 */
let sequenceBlockWeakCompCache: {
    nodesRef: readonly any[];
    comps: number[][];
} | null = null;

export function invalidateMindMapSequenceBlockWeakCompCache(): void {
    sequenceBlockWeakCompCache = null;
}

function weakComponentsForSequenceBlockBackdrop(
    nodes: readonly any[]
): number[][] {
    if (
        sequenceBlockWeakCompCache?.nodesRef === nodes &&
        sequenceBlockWeakCompCache.comps.length
    ) {
        return sequenceBlockWeakCompCache.comps;
    }
    const comps = partitionMindMapWeakComponents(nodes);
    sequenceBlockWeakCompCache = { nodesRef: nodes, comps };
    return comps;
}

export function computeMindMapSequenceBlockBackdropItems(
    nodes: readonly any[],
    pad = MIND_MAP_SEQUENCE_BLOCK_BACKDROP_PAD,
    resolveComponentEdgePolylines?: ResolveMindMapSequenceBlockEdgePolylines
): MindMapSequenceBlockBackdropItem[] {
    if (!nodes.length) return [];
    const comps = weakComponentsForSequenceBlockBackdrop(nodes);
    if (!comps.length) return [];

    const out: MindMapSequenceBlockBackdropItem[] = [];
    for (const ids of comps) {
        const idSet = new Set(ids);
        const sub = nodes.filter((n) => idSet.has(n.nodeId));
        const bb = mindMapNodesContentAabb(sub);
        if (!bb) continue;
        if (resolveComponentEdgePolylines) {
            expandMindMapAabbWithEdgePolylines(
                bb,
                resolveComponentEdgePolylines(sub, idSet)
            );
        }
        out.push({
            x: bb.minX - pad,
            y: bb.minY - pad,
            width: bb.maxX - bb.minX + 2 * pad,
            height: bb.maxY - bb.minY + 2 * pad,
            nodeIds: ids.slice()
        });
    }
    return out;
}

/**
 * 按弱连通分量为每块生成包络矩形（画布坐标）；仅一个分组时同样返回该块边框。
 */
export function computeMindMapSequenceBlockBackdropRects(
    nodes: readonly any[],
    pad = MIND_MAP_SEQUENCE_BLOCK_BACKDROP_PAD
): { x: number; y: number; width: number; height: number }[] {
    return computeMindMapSequenceBlockBackdropItems(nodes, pad).map(
        ({ x, y, width, height }) => ({ x, y, width, height })
    );
}

export interface TableRowsToMindMapNodesOptions {
    /**
     * 为 true 时：即使 JSON 里是完整画布快照，仍强制跑一次泳道自动布局。
     * 默认 false：**全部节点均有 mindMapCanvasX/Y 时使用保存坐标且不跑算法**；
     * 任一节点缺坐标则用自动布局填满整张图。
     */
    forceAutoLayout?: boolean;
    /**
     * 为 true 时使用「主轴 DP + 泳道 lr」布局；多块无连结子图时自动分块纵向堆叠（`applyLayerLayoutWithSeparatedComponents`）。
     * 默认 false：与画布 `addChildNodeUnder` **同源几何**的全图落点（`applyIncrementalMindMapLayout`）。
     */
    useSpineSwimlaneLayout?: boolean;
}

/**
 * 将接口/老编辑器 JSON 数组转为脑图节点列表（含 guide 与布局）
 */
export function tableRowsToMindMapNodes(
    rows: Record<string, unknown>[],
    layout: LayoutOptions,
    canvasOpts?: TableRowsToMindMapNodesOptions
): any[] {
    if (!rows.length) return [];

    const validIds = new Set(
        rows.map((r) => toNumericNodeId(r.nodeID)).filter((id) => id >= 0)
    );

    const nodeOrder = new Map<number, number>();
    for (let i = 0; i < rows.length; i++) {
        const nid = toNumericNodeId(rows[i].nodeID);
        if (nid >= 0 && !nodeOrder.has(nid)) nodeOrder.set(nid, i);
    }

    const nodes: any[] = [];

    for (const row of rows) {
        const nodeId = toNumericNodeId(row.nodeID);
        if (nodeId < 0) continue;
        const guide = extractGuideFromRow(row);
        const prev = normalizeLinkArray(row.prevNodeIDs, nodeOrder).filter(
            (id) => validIds.has(id)
        );
        const next = normalizeLinkArray(row.nextNodeIDs, nodeOrder).filter(
            (id) => validIds.has(id)
        );

        nodes.push(
            createMindMapNode({
                nodeId,
                x: 0,
                y: 0,
                prevNodes: prev.length ? prev : null,
                nextNodes: next.length ? next : null,
                guide
            })
        );
    }

    const snapshotOk = mindMapCanvasSnapshotCompleteForAllNodes(rows, validIds);
    const useSavedCanvas = snapshotOk && canvasOpts?.forceAutoLayout !== true;

    if (useSavedCanvas) {
        const byId = nodeByIdMap(nodes);
        for (const row of rows) {
            const nodeId = toNumericNodeId(row.nodeID);
            if (nodeId < 0 || !byId.has(nodeId)) continue;
            const pos = parseMindMapRowCanvasPosition(row);
            if (!pos) continue;
            const n = byId.get(nodeId)!;
            n.x = pos.x;
            n.y = pos.y;
        }
    } else if (canvasOpts?.useSpineSwimlaneLayout === true) {
        applyLayerLayoutWithSeparatedComponents(nodes, layout);
    } else {
        applyIncrementalMindMapLayout(nodes, layout);
    }

    reconcileMindMapNodeTopology(nodes);

    return nodes.sort((a, b) => a.nodeId - b.nodeId);
}

/**
 * 导出为与 saveOperation / medicineOperateGuide 一致的行业务 JSON 行数组
 */
export function mindMapNodesToTableRows(
    nodes: any[]
): MedicineOperateTableRow[] {
    reconcileMindMapNodeTopology(nodes);
    const linkOrder = buildListOrderIndex(nodes);
    /** 保持 nodeList 当前顺序写入 JSON，不按 nodeId 重排 */
    return nodes.map((n) => {
        const guide = deepClone(
            n.guide && typeof n.guide === 'object'
                ? n.guide
                : createEmptyGuidePayload()
        ) as GuidePayload;
        return {
            nodeID: String(n.nodeId),
            prevNodeIDs: toLinkIdStringArray(
                n.prevNodes ?? n.prevNodeIDs,
                linkOrder
            ),
            nextNodeIDs: toLinkIdStringArray(
                n.nextNodes ?? n.nextNodeIDs,
                linkOrder
            ),
            ...guide,
            [MEDICINE_OPERATE_MIND_MAP_CANVAS_X]: n.x,
            [MEDICINE_OPERATE_MIND_MAP_CANVAS_Y]: n.y
        };
    });
}

/** 与 nodeEditor.vue 中 `column` / supportJson 默认结构一致 */
export const DEFAULT_SUPPORT_COLUMNS = [
    { id: 'prevNodeIDs', name: '上一节点ID', width: 150, type: 'prev' },
    { id: 'nodeID', name: '节点ID', width: 150, type: 'currentNode' },
    { id: 'nextNodeIDs', name: '下一节点ID', width: 150, type: 'next' },
    { id: 'operationDesc', name: '操作描述', width: 350, type: 'textarea' },
    { id: 'operationTypes', name: '操作素材编号', width: 180, type: 'video' },
    { id: 'targetDesc', name: '目标描述', width: 200, type: 'textarea' },
    { id: 'targetDiagram', name: '目标参考图', width: 150, type: 'image' },
    { id: 'targetFailed', name: '监控要点', width: 350, type: 'textarea' },
    {
        id: 'monitoringDiagram',
        name: '监控要点未达成',
        width: 150,
        type: 'image'
    },
    { id: 'abnormalDesc', name: '异常描述', width: 350, type: 'textarea' },
    { id: 'abnormalDiagram', name: '异常参考图', width: 150, type: 'image' }
] as const;

export function getDefaultSupportJson(): string {
    return JSON.stringify(DEFAULT_SUPPORT_COLUMNS);
}

export function safeParseMedicineOperateGuideRows(
    raw: unknown
): Record<string, unknown>[] {
    if (!raw || typeof raw !== 'string' || !raw.trim()) return [];
    try {
        const v = JSON.parse(raw);
        return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
    } catch {
        return [];
    }
}

/**
 * 与 nodeEditor.vue 中 firstReportClinicalInfo.clinicalInfo 转表行逻辑一致
 */
export function clinicalInfoToOperateTableRows(
    clinicalInfo: any[] | undefined
): Record<string, unknown>[] {
    if (!clinicalInfo?.length) return [];
    return clinicalInfo.map((item: any) => {
        const mapped: Record<string, unknown> = {
            ...item,
            abnormalDiagram: (item.abnormalDiagramUrl ?? []).map((it: any) => ({
                url: it,
                name: String(it).split('/').pop()
            })),
            targetDiagram: (item.targetDiagramUrl ?? []).map((it: any) => ({
                url: it,
                name: String(it).split('/').pop()
            }))
        };
        for (const key in mapped) {
            if (typeof mapped[key] === 'string') {
                let str = mapped[key];
                if (str.startsWith('#')) {
                    str = str.slice(1);
                }
                mapped[key] = str.replace(/([^#])#([^#])/g, '$1\n$2');
            }
        }
        return mapped;
    });
}

export function buildMindMapLayoutOptions(_rowCount: number): LayoutOptions {
    const h = typeof window !== 'undefined' ? window.innerHeight : 800;
    return {
        startX: 72,
        startY: Math.floor(h / 2),
        layerStepX: 440,
        /** 须大于节点高度，轨间留白才够走线；132 时两行几乎贴住 */
        layerStepY: Math.round(
            NODE_RECT_LAYOUT.height + MIND_MAP_LAYOUT_LANE_Y_GAP
        )
    };
}
