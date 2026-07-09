/**
 * nodeMindMap 连线避障：在起点/终点端口之间生成正交折线路径，
 * 避免线段穿过其它节点矩形（障碍物）。
 *
 * 障碍范围：仅起点所在弱连通分量（画布分组）内的节点；其它分组节点不参与避障。
 *
 * 流程概览：
 * 1. **buildObstacleAvoidancePathRaw** — 按端口几何关系生成初稿（L 形、行缝中缝、绕顶等）。
 * 2. **polishRouteAgainstNodes** — 腰轨汇入、中缝穿越、HV 正交、东侧 stem、廊道、网格 BFS 抛光。
 * 画布连线策略（北绕 / 横出 / 强制避障）见 {@link ./mindMapEdgeRoute.ts}。
 */

import {
    nodeCountsAsRouteObstacle,
    routeObstacleComponentNodeIds
} from './mindMapWeakComponents';

/** 画布上与节点中心 (x,y) 对齐；`prevNodes`/`nextNodes` 供汇入腰轨等拓扑判定 */
export type MindMapRouteNode = {
    nodeId: number;
    x: number;
    y: number;
    prevNodes?: number[] | null;
    nextNodes?: number[] | null;
};

/** 障碍检测用的轴对齐矩形（已含外包 padding） */
export type RouteRect = {
    left: number;
    right: number;
    top: number;
    bottom: number;
};

export type MindMapRouteGeometry = {
    width: number;
    height: number;
};

export const ROUTE_OBSTACLE_PAD = 12;
/** 西侧竖起轨距目标节点左缘留白（与 routeStub 量级同步，不宜过大以免左口前横段过长） */
const ROUTE_WEST_RAIL_INSET = 10;

function westPortHorizontalLeadCap(routeStub: number): number {
    return routeStub * 1.68 + 22;
}

/** 默认右口横出与左口横入对齐用的参考长度（避障时可缩短，不设硬下限） */
export function defaultPortMatchedHorizStub(routeStub: number): number {
    return westPortHorizontalLeadCap(routeStub);
}

/** 终点盒子左缘外侧、尽量靠右的竖起轨 x（更大利短左口前横段） */
function westRailXEastOfTargetLeft(toLeft: number): number {
    return toLeft - ROUTE_OBSTACLE_PAD - ROUTE_WEST_RAIL_INSET - 4;
}

/**
 * 绕顶/绕底进左口：西廊 + 端口列竖落，入户仅短横 stub（不贴边、不横穿目标盒）。
 */
function leftPortBypassIngressCoords(
    toB: ReturnType<typeof getNodeBounds>,
    endX: number,
    routeStub: number
): { westX: number; spineX: number; entryX: number } {
    const entryStub = Math.max(
        12,
        Math.min(defaultPortMatchedHorizStub(routeStub) * 0.55, 28)
    );
    const leftClear =
        toB.left - ROUTE_OBSTACLE_PAD - ROUTE_WEST_RAIL_INSET - 10;
    const westHi = westRailXEastOfTargetLeft(toB.left);
    const spineX = Math.min(westHi, endX - entryStub, leftClear);
    const westX = Math.min(westHi, spineX - 6);
    const entryX = Math.max(spineX, Math.min(endX - 4, endX - entryStub));
    return { westX, spineX, entryX };
}

/** 西侧竖轨：优先落在目标左缘外；入户横段参考 defaultPortMatchedHorizStub */
export function westRailXForLeftPortEntry(
    toB: ReturnType<typeof getNodeBounds>,
    endX: number,
    routeStub: number
): number {
    const entryStub = defaultPortMatchedHorizStub(routeStub);
    const westHi = westRailXEastOfTargetLeft(toB.left);
    const westLo = endX - entryStub;
    return westHi < westLo ? westHi : westLo;
}

/** 行缝中缝西轨：优先落在目标左缘外，避免 `ex-stub` 与东竖轨挤在一起导致建路失败 */
function westRailXForInterRowLeftPort(
    toB: ReturnType<typeof getNodeBounds>,
    endX: number,
    routeStub: number
): number {
    const westHi = westRailXEastOfTargetLeft(toB.left);
    const westLo = endX - defaultPortMatchedHorizStub(routeStub);
    if (westHi <= westLo - 8) return westHi;
    return westLo - 8;
}

const ROUTE_CORRIDOR_CLEAR = 44;
const ROUTE_GRID_MARGIN_BASE = 128;
const ROUTE_GRID_CELL = 22;
const ROUTE_GRID_MAX_CELLS = 15500;
const ROUTING_SAME_ROW_TOL = 28;
/**
 * 多扇出默认右口→左口：盒缘净距或端口横距不超过该值时走中缝/绕顶/绕底（与 index 强制避障阈值一致）。
 * 略大于常见贴缝 40–44px，避免布局取整后刚好 41 而漏判。
 */
export const ROUTE_MULTI_FANOUT_CLOSE_HORIZ_GAP = 52;

/** 默认右口→左口：横向净距或端口横距任一侧贴缝即视为 close pair */
export function isCloseDefaultPortHorizGap(
    horizBoxGap: number,
    portSpan: number
): boolean {
    const g = ROUTE_MULTI_FANOUT_CLOSE_HORIZ_GAP;
    return (
        (horizBoxGap > 0 && horizBoxGap <= g) ||
        (portSpan > 0 && portSpan <= g) ||
        (horizBoxGap >= 0 && horizBoxGap <= g && Math.abs(portSpan) <= 14)
    );
}

/** 远距跨列才走北/南廊；贴缝多扇出（22→23）用简单 L 茎 */
function isSiblingRowCorridorHorizSpan(sx: number, ex: number): boolean {
    return ex - sx > ROUTE_MULTI_FANOUT_CLOSE_HORIZ_GAP + 8;
}
/** 近距离对：from/to 障碍盒仅左右各扩（纵向不变），逼走中缝/绕顶且避免贴竖轨 */
const ROUTE_MULTI_FANOUT_CLOSE_HORIZ_OBSTACLE_EXTRA = 20;

const INBOUND_WEST_SPINE_EPS_ROUTE = 12;

/** 与 index.vue 「左翼腰汇入」：32→33 等；放宽 y / 校验 next directed edge */
function findLeftWaistBuddyForMerge(
    to: MindMapRouteNode,
    fromId: number,
    nodes: readonly MindMapRouteNode[],
    halfW: number,
    nodeHeight: number,
    nodeById?: ReadonlyMap<number, MindMapRouteNode>
): MindMapRouteNode | null {
    const preds = to.prevNodes;
    if (!preds?.length) return null;
    const ySlack = Math.max(nodeHeight * 1.75, 156);
    for (const pid of preds) {
        if (pid === fromId) continue;
        const p = nodeById?.get(pid) ?? nodes.find((n) => n.nodeId === pid);
        if (!p) continue;
        const nexts = p.nextNodes ?? [];
        if (nexts.length && !nexts.includes(to.nodeId)) continue;
        if (Math.abs(p.y - to.y) > ySlack) continue;
        const pR = p.x + halfW;
        const tL = to.x - halfW;
        if (pR > tL + 8) continue;
        return p;
    }
    return null;
}

/**
 * 43→33 一类：先到腰轨横向段内某点下落再沿腰线进左端口，分叉与汇入形态一致；
 * spineJoinX 取 左翼—目标左缘 中段时与 51→汇入48-49、43→汇入32-33 的 T 一致。
 */
function tryWaistMergeHorizFirstOrthogonal(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    rects: RouteRect[],
    opts?: { spineJoinX?: number }
): number[] | null {
    if (ex <= sx + 8) return null;

    const ok = (pts: number[]) => !polylineHitsObstacles(pts, rects);

    const j0 = opts?.spineJoinX;
    if (j0 != null && Number.isFinite(j0)) {
        if (j0 > sx + 10 && j0 < ex - 10) {
            const c0 = [sx, sy, j0, sy, j0, ey, ex, ey];
            if (ok(c0)) return c0;
        }
        for (const δ of [20, -20, 40, -40, 62, -62]) {
            const j = j0 + δ;
            if (j <= sx + 8 || j >= ex - 8) continue;
            const cδ = [sx, sy, j, sy, j, ey, ex, ey];
            if (ok(cδ)) return cδ;
        }
    }

    const hvFlat = [sx, sy, ex, sy, ex, ey];
    if (ok(hvFlat)) return hvFlat;

    /** 拐点尽量靠右（近汇入列），或扫全距找避障位 */
    const fracs = [
        0.94, 0.9, 0.85, 0.8, 0.74, 0.68, 0.62, 0.55, 0.48, 0.42, 0.36, 0.3,
        0.24, 0.18
    ];
    const dx = ex - sx;
    for (const f of fracs) {
        const midX = sx + dx * f;
        if (midX <= sx + 6 || midX >= ex - 6) continue;
        const cand = buildOrthoLPath(sx, sy, ex, ey, midX);
        if (ok(cand)) return cand;
    }
    return null;
}

/** 开阔区两行正交：仅左右口时只接受先横后竖 hv（禁止 vh 竖出） */
function tryOrthoHVOrVHPreferEndpointSafe(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    rects: RouteRect[],
    fromNode: MindMapRouteNode,
    toNode: MindMapRouteNode,
    halfW: number,
    halfH: number,
    routeStub: number
): number[] | null {
    const hv = [sx, sy, ex, sy, ex, ey];
    const hvOk = !polylineHitsObstacles(hv, rects);
    const okEndpt = (p: number[]) =>
        !polylineHitsEndpointNodeInteriors(p, fromNode, toNode, halfW, halfH);
    const lrPortsOk = (p: number[]) =>
        defaultPortHorizEndpointsOk(p, sx, sy, ex, ey, routeStub);

    if (hvOk && okEndpt(hv) && lrPortsOk(hv)) return hv;
    return null;
}

/** 水平线段 y 上，将竖轨推到障碍矩形右侧之外 */
function eastRailPastHorizAtY(
    rects: RouteRect[],
    y: number,
    xStart: number,
    xEnd: number,
    minRail: number,
    pad: number
): number {
    let rail = minRail;
    const xa = Math.min(xStart, xEnd);
    const xb = Math.max(xStart, xEnd);
    for (const r of rects) {
        if (y < r.top || y > r.bottom) continue;
        if (xb > r.left && xa < r.right) {
            rail = Math.max(rail, r.right + pad);
        }
    }
    return rail;
}

/** 顶廊 y：保证 [xLo,xHi] 上的横段不切入障碍 */
function crestYClearForHorizSpan(
    rects: RouteRect[],
    xLo: number,
    xHi: number,
    initialCrest: number,
    pad: number
): number {
    let crest = initialCrest;
    for (const r of rects) {
        if (xHi <= r.left || xLo >= r.right) continue;
        crest = Math.min(crest, r.top - pad);
    }
    return crest;
}

/** 抬升行 y：在 departX~railX 横移前，竖轨须越过该带内障碍顶缘 */
function northLiftRowYForEastSpan(
    rects: RouteRect[],
    departX: number,
    railX: number,
    sy: number,
    crestY: number,
    pad: number
): number {
    let lift = sy - Math.max(18, pad);
    const xa = Math.min(departX, railX);
    const xb = Math.max(departX, railX);
    for (const r of rects) {
        if (xb <= r.left || xa >= r.right) continue;
        if (lift >= r.top - pad && lift <= r.bottom + pad) {
            if (r.bottom + pad < sy - 8) {
                lift = Math.max(lift, r.bottom + pad);
            } else {
                lift = Math.min(lift, r.top - pad);
            }
        }
    }
    return Math.min(lift, crestY - 6);
}

/** 端口竖直下沉（首段在 sx 上向南），用于绕开 startY 长横穿列 */
function defaultPortPathHasVertDownDepart(
    points: number[],
    sx: number,
    sy: number
): boolean {
    if (points.length < 6) return false;
    const x0 = points[0]!;
    const y0 = points[1]!;
    const x1 = points[2]!;
    const y1 = points[3]!;
    return (
        Math.abs(x0 - sx) < 6 &&
        Math.abs(x1 - x0) < 6 &&
        y1 - y0 > 12 &&
        Math.abs(y0 - sy) < 6
    );
}

export function upwardLeftPortEndpointsOk(
    points: number[],
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    routeStub: number
): boolean {
    return (
        (defaultPortPathHasHorizExit(points, sx, routeStub) ||
            defaultPortPathHasVertDownDepart(points, sx, sy)) &&
        defaultPortPathHasHorizEntry(points, ex, ey, routeStub)
    );
}

/** 底廊 y：在 x∈[xLo,xHi] 且低于端点底缘的障碍之下留走廊 */
function corridorFloorYBelowBand(
    rects: RouteRect[],
    xLo: number,
    xHi: number,
    endpointBottomMax: number,
    sy: number,
    ey: number
): number {
    const pad = ROUTE_OBSTACLE_PAD + 12;
    const xa = Math.min(xLo, xHi) - pad;
    const xb = Math.max(xLo, xHi) + pad;
    const belowEndpointsTol = endpointBottomMax + ROUTE_OBSTACLE_PAD + 8;
    let floor = -Infinity;
    for (const r of rects) {
        if (r.right < xa || r.left > xb) continue;
        if (r.top > belowEndpointsTol) continue;
        floor = Math.max(floor, r.bottom);
    }
    const targetYBase =
        floor === -Infinity
            ? Math.max(sy, ey) + ROUTE_CORRIDOR_CLEAR
            : floor + ROUTE_CORRIDOR_CLEAR;
    return Math.max(
        targetYBase,
        endpointBottomMax + ROUTE_CORRIDOR_CLEAR * 0.55,
        Math.max(sy, ey) + 16
    );
}

/**
 * 底廊 y：x 带内**全部**障碍底缘之下（含 7 等高于端点底缘的列内节点，5→10 底廊横段用）。
 */
function corridorFloorYBelowAllInSpan(
    rects: RouteRect[],
    xLo: number,
    xHi: number,
    sy: number,
    ey: number
): number {
    const pad = ROUTE_OBSTACLE_PAD + 12;
    const xa = Math.min(xLo, xHi) - pad;
    const xb = Math.max(xLo, xHi) + pad;
    let floor = -Infinity;
    for (const r of rects) {
        if (r.right < xa || r.left > xb) continue;
        floor = Math.max(floor, r.bottom);
    }
    const targetYBase =
        floor === -Infinity
            ? Math.max(sy, ey) + ROUTE_CORRIDOR_CLEAR
            : floor + ROUTE_CORRIDOR_CLEAR;
    return Math.max(targetYBase, Math.max(sy, ey) + 16);
}

/** 顶廊 y：x 带内全部障碍顶缘之上（5→10 目标在起点上方时走北廊） */
function corridorCrestYAboveAllInSpan(
    rects: RouteRect[],
    xLo: number,
    xHi: number,
    sy: number,
    ey: number
): number {
    const pad = ROUTE_OBSTACLE_PAD + 12;
    const xa = Math.min(xLo, xHi) - pad;
    const xb = Math.max(xLo, xHi) + pad;
    let crest = Infinity;
    for (const r of rects) {
        if (r.right < xa || r.left > xb) continue;
        crest = Math.min(crest, r.top);
    }
    const targetYBase =
        crest === Infinity
            ? Math.min(sy, ey) - ROUTE_CORRIDOR_CLEAR
            : crest - ROUTE_CORRIDOR_CLEAR;
    return Math.min(targetYBase, Math.min(sy, ey) - 16);
}

function orthoRouteManhattanLength(points: number[]): number {
    let len = 0;
    for (let i = 2; i < points.length; i += 2) {
        len +=
            Math.abs(points[i]! - points[i - 2]!) +
            Math.abs(points[i + 1]! - points[i - 1]!);
    }
    return len;
}

function siblingRowCorridorPortKick(routeStub: number): number {
    return Math.min(
        defaultPortMatchedHorizStub(routeStub) * 0.42,
        Math.max(14, routeStub * 0.55)
    );
}

/** 廊道在入户前向西折回（22→23 贴缝误套北/南廊） */
function pathHasIngressWestRailBacktrack(
    points: number[],
    sx: number
): boolean {
    for (let i = 4; i < points.length - 4; i += 2) {
        const y0 = points[i + 1]!;
        const y1 = points[i + 3]!;
        if (Math.abs(y0 - y1) > 2) continue;
        const x0 = points[i]!;
        const x1 = points[i + 2]!;
        if (x0 > x1 + 10 && x1 < sx - 4) return true;
    }
    return false;
}

function siblingRowCorridorWestIngressOk(
    westX: number,
    sx: number,
    kickX: number,
    ex: number
): boolean {
    return (
        westX >= Math.min(sx, kickX) - 4 &&
        westX <= ex + ROUTE_OBSTACLE_PAD + 36
    );
}

function siblingRowCorridorIngressOk(
    pts: number[],
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    routeStub: number,
    rects: RouteRect[]
): boolean {
    return (
        upwardLeftPortEndpointsOk(pts, sx, sy, ex, ey, routeStub) &&
        !polylineHitsObstacles(pts, rects) &&
        !pathHasNearRowEastWestJog(pts) &&
        !pathHasIngressWestRailBacktrack(pts, sx)
    );
}

/**
 * 廊道 y 与左口 ey 接近时，将横廊抬/落到 ey，避免汇入前西轨短垂落（5→10 与 7→10 齐平）。
 */
function corridorRailYSnappedToEntry(
    railY: number,
    ey: number,
    kickX: number,
    westX: number,
    ex: number,
    toB: ReturnType<typeof getNodeBounds>,
    rects: RouteRect[]
): number {
    const snapTol = ROUTE_CORRIDOR_CLEAR + 10;
    if (Math.abs(railY - ey) > snapTol) return railY;
    const xa = Math.min(kickX, westX);
    const xb = Math.max(kickX, westX);
    if (horizAtYHitsObstacles(rects, ey, xa, xb)) return railY;
    if (horizSegCrossesBoxAtY(ey, westX, ex, toB, ROUTE_OBSTACLE_PAD + 4)) {
        return railY;
    }
    return ey;
}

function appendSiblingRowCorridorWestIngress(
    pts: number[],
    westX: number,
    railY: number,
    ey: number,
    entryX: number,
    ex: number
): void {
    const n = pts.length;
    const endsAtWestRail =
        n >= 2 &&
        Math.abs(pts[n - 2]! - westX) < 6 &&
        Math.abs(pts[n - 1]! - railY) < 6;
    if (!endsAtWestRail) {
        pts.push(westX, railY);
    }
    if (Math.abs(railY - ey) >= 2) {
        pts.push(westX, ey);
    }
    pts.push(entryX, ey, ex, ey);
}

/**
 * 底廊绕行：端口列先竖落底廊（不在 startY 长横穿兄弟）→ 底廊东/西 → 西轨抬降至左口。
 * 5→10 穿 6、9→10 穿 7 等同排/跨列多扇出共用。
 */
function buildSouthFloorEastThenNorthToLeftPort(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    fromB: ReturnType<typeof getNodeBounds>,
    toB: ReturnType<typeof getNodeBounds>,
    routeStub: number,
    rects: RouteRect[]
): number[] | null {
    if (ex <= sx + 16) return null;
    const { westX, entryX } = leftPortBypassIngressCoords(toB, ex, routeStub);
    const kickX = sx + siblingRowCorridorPortKick(routeStub);
    if (!siblingRowCorridorWestIngressOk(westX, sx, kickX, ex)) return null;

    const floorSpanHi = Math.max(ex, westX);
    let bypassY = corridorFloorYBelowAllInSpan(rects, sx, floorSpanHi, sy, ey);
    const pad = ROUTE_OBSTACLE_PAD + 10;
    bypassY = corridorRailYSnappedToEntry(
        bypassY,
        ey,
        kickX,
        westX,
        ex,
        toB,
        rects
    );
    const pts: number[] = [sx, sy, kickX, sy, kickX, bypassY];
    if (horizAtYHitsObstacles(rects, bypassY, kickX, westX)) {
        const floorEastX = eastRailPastHorizAtY(
            rects,
            bypassY,
            kickX,
            westX,
            kickX + 14,
            pad
        );
        if (floorEastX > westX + 6) {
            pts.push(floorEastX, bypassY, westX, bypassY);
        } else {
            pts.push(westX, bypassY);
        }
    } else {
        pts.push(westX, bypassY);
    }
    appendSiblingRowCorridorWestIngress(pts, westX, bypassY, ey, entryX, ex);
    if (!siblingRowCorridorIngressOk(pts, sx, sy, ex, ey, routeStub, rects)) {
        return null;
    }
    return pts;
}

/**
 * 列内行缝中缝 y（如 12 与 6 之间）；优先贴近 sy/ey，避免一律绕到全列最顶/最底。
 */
function interRowSeamYForColumnCorridor(
    rects: RouteRect[],
    kickX: number,
    westX: number,
    ex: number,
    sy: number,
    ey: number
): number | null {
    const pad = ROUTE_OBSTACLE_PAD + 8;
    const xLo = kickX;
    const xHi = Math.max(ex, westX);
    let yMin = Math.min(sy, ey) - ROUTE_CORRIDOR_CLEAR;
    let yMax = Math.max(sy, ey) + ROUTE_CORRIDOR_CLEAR;
    for (const r of rects) {
        if (r.right < xLo - pad || r.left > xHi + pad) continue;
        yMin = Math.min(yMin, r.top - ROUTE_CORRIDOR_CLEAR * 0.5);
        yMax = Math.max(yMax, r.bottom + ROUTE_CORRIDOR_CLEAR * 0.5);
    }
    if (yMax <= yMin + 10) return null;
    const preferY = (sy + ey) / 2;
    return findBestRowCorridorY(rects, xLo, xHi, yMin, yMax, preferY);
}

/**
 * 行缝中缝廊道：短横出 → 竖到列内缝 → 横穿至西轨 → 竖落/抬进左口（5→10 穿 12/6 缝）。
 */
function buildInterRowSeamCorridorToLeftPort(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    fromB: ReturnType<typeof getNodeBounds>,
    toB: ReturnType<typeof getNodeBounds>,
    routeStub: number,
    rects: RouteRect[]
): number[] | null {
    if (ex <= sx + 16) return null;
    const { westX, entryX } = leftPortBypassIngressCoords(toB, ex, routeStub);
    const kickX = sx + siblingRowCorridorPortKick(routeStub);
    if (!siblingRowCorridorWestIngressOk(westX, sx, kickX, ex)) return null;

    let seamY = interRowSeamYForColumnCorridor(rects, kickX, westX, ex, sy, ey);
    if (seamY == null) return null;

    const pad = ROUTE_OBSTACLE_PAD + 10;
    seamY = corridorRailYSnappedToEntry(
        seamY,
        ey,
        kickX,
        westX,
        ex,
        toB,
        rects
    );
    const pts: number[] = [sx, sy, kickX, sy, kickX, seamY];
    if (horizAtYHitsObstacles(rects, seamY, kickX, westX)) {
        const seamEastX = eastRailPastHorizAtY(
            rects,
            seamY,
            kickX,
            westX,
            kickX + 14,
            pad
        );
        if (seamEastX > westX + 6) {
            pts.push(seamEastX, seamY, westX, seamY);
        } else {
            pts.push(westX, seamY);
        }
    } else {
        pts.push(westX, seamY);
    }
    appendSiblingRowCorridorWestIngress(pts, westX, seamY, ey, entryX, ex);
    if (!siblingRowCorridorIngressOk(pts, sx, sy, ex, ey, routeStub, rects)) {
        return null;
    }
    return pts;
}

/**
 * 顶廊绕行：短横出 → 竖抬顶廊 → 顶廊向西 → 西轨南落进左口（目标在起点上方，如 5→10）。
 */
function buildNorthCrestEastThenSouthToLeftPort(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    fromB: ReturnType<typeof getNodeBounds>,
    toB: ReturnType<typeof getNodeBounds>,
    routeStub: number,
    rects: RouteRect[]
): number[] | null {
    if (ex <= sx + 16) return null;
    const { westX, entryX } = leftPortBypassIngressCoords(toB, ex, routeStub);
    const kickX = sx + siblingRowCorridorPortKick(routeStub);
    if (!siblingRowCorridorWestIngressOk(westX, sx, kickX, ex)) return null;

    const crestSpanHi = Math.max(ex, westX);
    let crestY = corridorCrestYAboveAllInSpan(rects, sx, crestSpanHi, sy, ey);
    if (crestY >= sy - 8) return null;

    const pad = ROUTE_OBSTACLE_PAD + 10;
    crestY = corridorRailYSnappedToEntry(
        crestY,
        ey,
        kickX,
        westX,
        ex,
        toB,
        rects
    );
    const pts: number[] = [sx, sy, kickX, sy, kickX, crestY];
    if (horizAtYHitsObstacles(rects, crestY, kickX, westX)) {
        const crestEastX = eastRailPastHorizAtY(
            rects,
            crestY,
            kickX,
            westX,
            kickX + 14,
            pad
        );
        if (crestEastX > westX + 6) {
            pts.push(crestEastX, crestY, westX, crestY);
        } else {
            pts.push(westX, crestY);
        }
    } else {
        pts.push(westX, crestY);
    }
    appendSiblingRowCorridorWestIngress(pts, westX, crestY, ey, entryX, ex);
    if (!siblingRowCorridorIngressOk(pts, sx, sy, ex, ey, routeStub, rects)) {
        return null;
    }
    return pts;
}

/**
 * 同排多扇出右出→左进：行缝中缝 / 北廊 / 南廊三候选，取曼哈顿更短者。
 */
export function buildSiblingRowCorridorToLeftPort(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    fromB: ReturnType<typeof getNodeBounds>,
    toB: ReturnType<typeof getNodeBounds>,
    routeStub: number,
    rects: RouteRect[]
): number[] | null {
    if (!isSiblingRowCorridorHorizSpan(sx, ex)) return null;

    const candidates: number[][] = [];
    const seam = buildInterRowSeamCorridorToLeftPort(
        sx,
        sy,
        ex,
        ey,
        fromB,
        toB,
        routeStub,
        rects
    );
    if (seam) candidates.push(seam);
    const north = buildNorthCrestEastThenSouthToLeftPort(
        sx,
        sy,
        ex,
        ey,
        fromB,
        toB,
        routeStub,
        rects
    );
    if (north) candidates.push(north);
    const south = buildSouthFloorEastThenNorthToLeftPort(
        sx,
        sy,
        ex,
        ey,
        fromB,
        toB,
        routeStub,
        rects
    );
    if (south) candidates.push(south);

    if (candidates.length === 0) return null;
    let best = candidates[0]!;
    let bestLen = orthoRouteManhattanLength(best);
    for (let i = 1; i < candidates.length; i++) {
        const c = candidates[i]!;
        const len = orthoRouteManhattanLength(c);
        if (len < bestLen) {
            best = c;
            bestLen = len;
        }
    }
    return best;
}

/** 顶廊/抬升行上先东后西（入口前 U 形折返，如 5→10） */
function pathHasNearRowEastWestJog(points: number[]): boolean {
    for (let i = 0; i < points.length - 8; i += 2) {
        const y0 = points[i + 1]!;
        const y1 = points[i + 3]!;
        if (Math.abs(y0 - y1) > 2) continue;
        const x0 = points[i]!;
        const x1 = points[i + 2]!;
        if (x1 <= x0 + 12) continue;
        const y2 = points[i + 5]!;
        const y3 = points[i + 7]!;
        if (Math.abs(y1 - y3) > 22) continue;
        const x2 = points[i + 4]!;
        const x3 = points[i + 6]!;
        if (Math.abs(y2 - y3) > 2) continue;
        const y4 = points[i + 9]!;
        if (Math.abs(y3 - y4) > 2) continue;
        const x4 = points[i + 8]!;
        if (x3 > x4 + 12) return true;
    }
    return false;
}

/** startY 上 sx→x1 横段是否切入任一障碍 */
function horizAtYHitsObstacles(
    rects: RouteRect[],
    y: number,
    x0: number,
    x1: number
): boolean {
    const xa = Math.min(x0, x1);
    const xb = Math.max(x0, x1);
    for (const r of rects) {
        if (y < r.top || y > r.bottom) continue;
        if (xb > r.left && xa < r.right) return true;
    }
    return false;
}

/**
 * 右出→左上：按障碍外包盒定东竖轨与绕顶廊（9→10 穿 7 等列间障碍）。
 * 比 {@link lrSidePortEastRailCorridorPath} 多一步障碍感知，供抛光/应急共用。
 */
export function buildUpwardLeftPortObstacleCorridorPath(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    fromB: ReturnType<typeof getNodeBounds>,
    toB: ReturnType<typeof getNodeBounds>,
    routeStub: number,
    rects: RouteRect[]
): number[] | null {
    if (ex <= sx + 20) return null;

    /** 同排/跨列：按 ey↔sy 选北廊/南廊（5→10 等） */
    const corridorFirst = buildSiblingRowCorridorToLeftPort(
        sx,
        sy,
        ex,
        ey,
        fromB,
        toB,
        routeStub,
        rects
    );
    if (corridorFirst) return corridorFirst;

    if (ey >= sy - 6) return null;

    const pad = ROUTE_OBSTACLE_PAD + 10;
    const crestPad = ROUTE_OBSTACLE_PAD + 14;
    const { westX, entryX } = leftPortBypassIngressCoords(toB, ex, routeStub);

    let railX = interRowEastRailX(sx, fromB, toB, 'from');
    railX = eastRailPastHorizAtY(rects, sy, sx, ex, railX, pad);
    if (westX >= railX - 10) {
        railX = Math.max(railX, westX + routeStub + 16);
    }

    let crestY =
        Math.min(fromB.top, toB.top) -
        Math.max(crestPad, ROUTE_CORRIDOR_CLEAR * 0.34);

    for (let iter = 0; iter < 14; iter++) {
        let changed = false;
        const xLo = Math.min(railX, westX);
        const xHi = Math.max(railX, westX);
        const nextCrest = crestYClearForHorizSpan(
            rects,
            xLo,
            xHi,
            crestY,
            crestPad
        );
        if (nextCrest < crestY - 0.5) {
            crestY = nextCrest;
            changed = true;
        }
        for (const r of rects) {
            if (railX <= r.left + 1 || railX >= r.right - 1) continue;
            const yLo = Math.min(sy, crestY);
            const yHi = Math.max(sy, crestY);
            if (yHi <= r.top + 1 || yLo >= r.bottom - 1) continue;
            const raised = r.top - crestPad;
            if (raised < crestY - 1 && raised < sy - 8) {
                crestY = raised;
                changed = true;
            } else {
                const bumped = r.right + pad;
                if (bumped > railX + 0.5) {
                    railX = bumped;
                    changed = true;
                }
            }
        }
        railX = eastRailPastHorizAtY(rects, sy, sx, ex, railX, pad);
        if (!changed) break;
    }

    if (crestY >= sy - 8) return null;

    const portKick = Math.min(
        defaultPortMatchedHorizStub(routeStub) * 0.42,
        Math.max(12, routeStub * 0.55)
    );
    const departX = sx + portKick;
    const needCrest =
        westX >= railX - 10 || horizSegCrossesBoxAtY(ey, railX, westX, toB);

    let pts: number[];
    if (needCrest) {
        const longEastOnStartRow = horizAtYHitsObstacles(
            rects,
            sy,
            departX,
            railX
        );
        if (longEastOnStartRow) {
            const liftY = northLiftRowYForEastSpan(
                rects,
                departX,
                railX,
                sy,
                crestY,
                crestPad
            );
            if (liftY >= sy - 8) return null;
            pts = [
                sx,
                sy,
                departX,
                sy,
                departX,
                liftY,
                railX,
                liftY,
                railX,
                crestY,
                westX,
                crestY,
                westX,
                ey,
                entryX,
                ey,
                ex,
                ey
            ];
        } else {
            pts = [
                sx,
                sy,
                railX,
                sy,
                railX,
                crestY,
                westX,
                crestY,
                westX,
                ey,
                entryX,
                ey,
                ex,
                ey
            ];
        }
    } else {
        pts = [sx, sy, railX, sy, railX, ey, entryX, ey, ex, ey];
    }

    if (
        pathHasNearRowEastWestJog(pts) ||
        !upwardLeftPortEndpointsOk(pts, sx, sy, ex, ey, routeStub) ||
        polylineHitsObstacles(pts, rects)
    ) {
        return buildSiblingRowCorridorToLeftPort(
            sx,
            sy,
            ex,
            ey,
            fromB,
            toB,
            routeStub,
            rects
        );
    }
    return pts;
}

/** 目标行 y 上横段是否切入盒子 */
function horizSegCrossesBoxAtY(
    y: number,
    x1: number,
    x2: number,
    box: ReturnType<typeof getNodeBounds>,
    padY = 4
): boolean {
    if (y < box.top - padY || y > box.bottom + padY) return false;
    const xa = Math.min(x1, x2);
    const xb = Math.max(x1, x2);
    return xa < box.right && xb > box.left;
}

/** 右出→左入：东竖轨 + 绕顶/底廊或短横进左口（禁止在目标行横穿节点宽） */
function lrSidePortEastRailCorridorPath(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    fromB: ReturnType<typeof getNodeBounds>,
    toB: ReturnType<typeof getNodeBounds>,
    routeStub: number
): number[] {
    const pad = ROUTE_OBSTACLE_PAD + 12;
    const fromRail = fromB.right + pad;
    const toRail = toB.right + pad;
    const westX = westRailXForLeftPortEntry(toB, ex, routeStub);

    const entryStub = Math.max(
        12,
        Math.min(defaultPortMatchedHorizStub(routeStub) * 0.55, ex - westX - 6)
    );
    const entryX = Math.max(westX, ex - entryStub);

    if (ey < sy - 4) {
        const gapLoNorth = toB.bottom + ROUTE_OBSTACLE_PAD + 12;
        const gapHiNorth = fromB.top - ROUTE_OBSTACLE_PAD - 10;
        const interRowStyleNorth = gapHiNorth > gapLoNorth + 8;
        /** 北/南出发东竖轨均贴节点 0 右口（与 rawNorthOverTop / 南向绕底对称） */
        let railX = interRowEastRailX(sx, fromB, toB, 'from');
        const needWidenRail = westX >= railX - 10;
        if (needWidenRail && !interRowStyleNorth) {
            railX = Math.max(railX, westX + routeStub + 16);
        }
        const chordThroughTo =
            needWidenRail || horizSegCrossesBoxAtY(ey, railX, westX, toB);
        if (chordThroughTo) {
            const gapLo = gapLoNorth;
            const gapHi = gapHiNorth;
            const crestY =
                gapHi > gapLo + 8
                    ? Math.min(
                          Math.max(gapLo + 4, (gapLo + gapHi) / 2),
                          gapHi - 4
                      )
                    : Math.min(fromB.top, toB.top) -
                      Math.max(
                          ROUTE_OBSTACLE_PAD + 16,
                          ROUTE_CORRIDOR_CLEAR * 0.34
                      );
            return [
                sx,
                sy,
                railX,
                sy,
                railX,
                crestY,
                westX,
                crestY,
                westX,
                ey,
                entryX,
                ey,
                ex,
                ey
            ];
        }
        return [sx, sy, railX, sy, railX, ey, entryX, ey, ex, ey];
    }

    if (ey > sy + 4) {
        const gapLoSouth = fromB.bottom + ROUTE_OBSTACLE_PAD + 12;
        const gapHiSouth = toB.top - ROUTE_OBSTACLE_PAD - 10;
        const interRowStyleSouth = gapHiSouth > gapLoSouth + 8;
        /** 与北向中缝对称：出发东竖轨一律贴节点 0 右口 sx */
        let railX = interRowEastRailX(sx, fromB, toB, 'from');
        const needWidenRail = westX >= railX - 10;
        if (needWidenRail && !interRowStyleSouth) {
            railX = Math.max(railX, westX + routeStub + 16);
        }
        const chordThroughTo =
            needWidenRail ||
            horizSegCrossesBoxAtY(ey, railX, westX, toB) ||
            railX >= ex - 12 ||
            isCloseDefaultPortHorizGap(ex - sx, ex - sx);
        if (chordThroughTo) {
            const gapLo = gapLoSouth;
            const gapHi = gapHiSouth;
            const floorY =
                gapHi > gapLo + 8
                    ? Math.min(
                          Math.max(gapLo + 4, (gapLo + gapHi) / 2),
                          gapHi - 4
                      )
                    : Math.max(fromB.bottom, toB.bottom) +
                      Math.max(
                          ROUTE_OBSTACLE_PAD + 16,
                          ROUTE_CORRIDOR_CLEAR * 0.34
                      );
            return [
                sx,
                sy,
                railX,
                sy,
                railX,
                floorY,
                westX,
                floorY,
                westX,
                ey,
                entryX,
                ey,
                ex,
                ey
            ];
        }
        return [sx, sy, railX, sy, railX, ey, entryX, ey, ex, ey];
    }

    const railX = Math.max(sx + routeStub, fromRail);
    return [sx, sy, railX, sy, railX, ey, entryX, ey, ex, ey];
}

export function clampStub(nodeWidth: number): number {
    return Math.min(92, Math.max(40, Math.round(nodeWidth / 8)));
}

export function expandRouteRect(
    b: {
        left: number;
        right: number;
        top: number;
        bottom: number;
    },
    pad: number
): RouteRect {
    return {
        left: b.left - pad,
        right: b.right + pad,
        top: b.top - pad,
        bottom: b.bottom + pad
    };
}

/** 仅左右扩障（top/bottom 不变） */
function expandRouteRectHorizOnly<
    T extends { left: number; right: number; top: number; bottom: number }
>(b: T, padX: number): T {
    return {
        ...b,
        left: b.left - padX,
        right: b.right + padX
    };
}

/** 默认右口：首段须横向且足够长，禁止端口竖出 */
function defaultPortPathHasHorizExit(
    points: number[],
    sx: number,
    _routeStub: number
): boolean {
    if (points.length < 4) return false;
    const eps = 10;
    const x0 = points[0]!;
    const y0 = points[1]!;
    const x1 = points[2]!;
    const y1 = points[3]!;
    return Math.abs(y1 - y0) < eps && x1 - x0 >= 12 && Math.abs(x0 - sx) < 6;
}

/** 默认左口：末段须横向入户且足够长 */
function defaultPortPathHasHorizEntry(
    points: number[],
    ex: number,
    ey: number,
    _routeStub: number
): boolean {
    if (points.length < 4) return false;
    const eps = 10;
    const n = points.length;
    const x0 = points[n - 4]!;
    const y0 = points[n - 3]!;
    const x1 = points[n - 2]!;
    const y1 = points[n - 1]!;
    return (
        Math.abs(y1 - y0) < eps &&
        Math.abs(x1 - x0) >= 12 &&
        x0 < x1 - 2 &&
        Math.hypot(x1 - ex, y1 - ey) < 14
    );
}

export function defaultPortHorizEndpointsOk(
    points: number[],
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    routeStub: number
): boolean {
    return (
        defaultPortPathHasHorizExit(points, sx, routeStub) &&
        defaultPortPathHasHorizEntry(points, ex, ey, routeStub)
    );
}

/**
 * 多扇出：竖轨 x 须在兄弟节点东侧。
 * 扫障横向带须覆盖父节点全部子节点（非仅当前边 sx~ex），否则北/南会算出不同东竖轨（如 1271 vs 1336）。
 */
export function computeEastRailPastSiblingVerticalBlockers(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    from: MindMapRouteNode,
    to: MindMapRouteNode,
    nodes: readonly MindMapRouteNode[],
    halfW: number,
    halfH: number,
    minInbound = 12,
    obstacleScope: ReadonlySet<number> | null = null
): number | null {
    if (ex < sx - 4) return null;

    let yLo = Math.min(sy, ey);
    let yHi = Math.max(sy, ey);
    let xa = Math.min(sx, ex);
    let xb = Math.max(sx, ex);
    let portSpan = ex - sx;
    /** 多扇出：y 带 + 横向带均按全部子节点展开，共用一根东竖轨 */
    if ((from.nextNodes?.length ?? 0) >= 2) {
        for (const nextId of from.nextNodes ?? []) {
            const sib = nodes.find((n) => n.nodeId === nextId);
            if (!sib) continue;
            const r = getNodeBounds(sib, halfW, halfH);
            yLo = Math.min(yLo, r.top);
            yHi = Math.max(yHi, r.bottom);
            xa = Math.min(xa, r.left - ROUTE_OBSTACLE_PAD);
            xb = Math.max(xb, r.right + ROUTE_OBSTACLE_PAD);
            if (nextId !== to.nodeId) {
                const sibLeft = sib.x - halfW;
                portSpan = Math.max(portSpan, Math.max(0, sibLeft - sx));
            }
        }
        xa = Math.min(xa, sx);
        portSpan = Math.max(portSpan, xb - sx);
    }
    let eastX = sx + Math.min(26, Math.max(14, Math.max(0, portSpan) * 0.32));

    const scope =
        obstacleScope ?? routeObstacleComponentNodeIds(nodes, from.nodeId);
    for (const n of nodes) {
        if (
            !nodeCountsAsRouteObstacle(n.nodeId, from.nodeId, to.nodeId, scope)
        ) {
            continue;
        }
        const r = expandRouteRect(
            getNodeBounds(n, halfW, halfH),
            ROUTE_OBSTACLE_PAD
        );
        if (r.left > xb + 8 || r.right < xa - 8) continue;
        if (yHi < r.top || yLo > r.bottom) continue;
        eastX = Math.max(eastX, r.right + ROUTE_OBSTACLE_PAD + 6);
    }

    if (eastX >= ex - minInbound) return null;
    return eastX;
}

function horizSegmentHitsSiblingNodes(
    y: number,
    x1: number,
    x2: number,
    from: MindMapRouteNode,
    to: MindMapRouteNode,
    nodes: readonly MindMapRouteNode[],
    halfW: number,
    halfH: number,
    obstacleScope: ReadonlySet<number> | null = null
): boolean {
    const xa = Math.min(x1, x2);
    const xb = Math.max(x1, x2);
    const padY = 4;
    const scope =
        obstacleScope ?? routeObstacleComponentNodeIds(nodes, from.nodeId);
    for (const n of nodes) {
        if (
            !nodeCountsAsRouteObstacle(n.nodeId, from.nodeId, to.nodeId, scope)
        ) {
            continue;
        }
        const r = expandRouteRect(
            getNodeBounds(n, halfW, halfH),
            ROUTE_OBSTACLE_PAD
        );
        if (y < r.top - padY || y > r.bottom + padY) continue;
        if (xa < r.right && xb > r.left) return true;
    }
    return false;
}

/**
 * 多扇出下行 / 目标左口在起点右口左侧（盒重叠）：东绕兄弟 → 必要时南绕底廊 → 左向进左口。
 */
export function buildMultiFanoutDownwardToLeftPortPath(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    from: MindMapRouteNode,
    to: MindMapRouteNode,
    nodes: readonly MindMapRouteNode[],
    halfW: number,
    halfH: number
): number[] | null {
    const dy = ey - sy;
    if (dy <= 8) return null;

    const portSpan = ex - sx;

    /** 20→21 等：盒横向重叠(ex&lt;sx)，右出→下落→在目标行自西侧进左口 */
    if (ex < sx - 4) {
        const kick = Math.min(28, Math.max(14, Math.abs(portSpan) * 0.35));
        const railX = sx + kick;
        const pre = ex - Math.min(14, Math.max(10, Math.abs(portSpan) * 0.32));
        if (railX < sx + 12 || pre >= ex - 4) return null;
        const pts = [sx, sy, railX, sy, railX, ey, pre, ey, ex, ey];
        mergeCollinearOrthoInPlace(pts);
        return pts.length >= 8 ? pts : null;
    }

    if (portSpan < 16) return null;

    const eastX = computeEastRailPastSiblingVerticalBlockers(
        sx,
        sy,
        ex,
        ey,
        from,
        to,
        nodes,
        halfW,
        halfH
    );
    if (eastX == null || eastX <= sx + 10) return null;

    const entryStub = Math.min(40, Math.max(12, Math.abs(portSpan) * 0.42));
    const dropX = Math.max(sx + 14, ex - entryStub);
    if (dropX >= ex - 6) return null;

    const makePts = (floorY: number) => {
        if (Math.abs(floorY - ey) < 6) {
            return [sx, sy, eastX, sy, eastX, ey, dropX, ey, ex, ey];
        }
        return [
            sx,
            sy,
            eastX,
            sy,
            eastX,
            floorY,
            dropX,
            floorY,
            dropX,
            ey,
            ex,
            ey
        ];
    };

    let floorY = ey;
    if (
        horizSegmentHitsSiblingNodes(
            ey,
            eastX,
            dropX,
            from,
            to,
            nodes,
            halfW,
            halfH
        )
    ) {
        const xa = Math.min(sx, ex);
        const xb = Math.max(sx, ex);
        const yLo = Math.min(sy, ey);
        const yHi = Math.max(sy, ey);
        for (const n of nodes) {
            if (n.nodeId === from.nodeId || n.nodeId === to.nodeId) continue;
            const r = expandRouteRect(
                getNodeBounds(n, halfW, halfH),
                ROUTE_OBSTACLE_PAD
            );
            if (r.left > xb + 8 || r.right < xa - 8) continue;
            if (yHi < r.top || yLo > r.bottom) continue;
            floorY = Math.max(floorY, r.bottom + ROUTE_OBSTACLE_PAD + 8);
        }
    }

    const pts = makePts(floorY);
    mergeCollinearOrthoInPlace(pts);
    return pts.length >= 8 ? pts : null;
}

/** 节点外接矩形（以中心为锚点）；若有 `rectConf` 与画布 Konva 一致 */
export function getNodeBounds(
    node: MindMapRouteNode,
    halfW: number,
    halfH: number
) {
    const nAny = node as MindMapRouteNode & {
        rectConf?: { width?: number; height?: number };
    };
    const rw = Number(nAny.rectConf?.width);
    const rh = Number(nAny.rectConf?.height);
    const w = Number.isFinite(rw) && rw > 0 ? rw / 2 : halfW;
    const h = Number.isFinite(rh) && rh > 0 ? rh / 2 : halfH;
    return {
        left: node.x - w,
        right: node.x + w,
        top: node.y - h,
        bottom: node.y + h,
        centerX: node.x,
        centerY: node.y
    };
}

/** 单条边避障矩形：仅起点所在分组内的其它节点 */
export function buildRouteObstacleRectsForEdge(
    allNodes: readonly MindMapRouteNode[],
    from: MindMapRouteNode,
    to: MindMapRouteNode,
    halfW: number,
    halfH: number,
    pad = ROUTE_OBSTACLE_PAD
): RouteRect[] {
    const scope = routeObstacleComponentNodeIds(allNodes, from.nodeId);
    return allNodes
        .filter((n) =>
            nodeCountsAsRouteObstacle(n.nodeId, from.nodeId, to.nodeId, scope)
        )
        .map((n) => expandRouteRect(getNodeBounds(n, halfW, halfH), pad));
}

const MIN_INTER_ROW_VERT = 22;

/** 在 y 带内沿 x 走廊取最宽行缝中心 */
function findBestRowCorridorY(
    rects: RouteRect[],
    xLo: number,
    xHi: number,
    yMin: number,
    yMax: number,
    preferY?: number
): number | null {
    if (yMax <= yMin + 8) return null;
    const xa = Math.min(xLo, xHi);
    const xb = Math.max(xLo, xHi);
    type Interval = { lo: number; hi: number };
    const blocked: Interval[] = [];
    for (const r of rects) {
        if (r.right < xa || r.left > xb) continue;
        blocked.push({ lo: r.top, hi: r.bottom });
    }
    blocked.sort((a, b) => a.lo - b.lo);
    const merged: Interval[] = [];
    for (const b of blocked) {
        const last = merged[merged.length - 1];
        if (!last || b.lo > last.hi + 2) merged.push({ lo: b.lo, hi: b.hi });
        else last.hi = Math.max(last.hi, b.hi);
    }
    const targetY =
        preferY != null && Number.isFinite(preferY)
            ? preferY
            : (yMin + yMax) / 2;
    let bestY: number | null = null;
    let bestScore = -1;
    const consider = (lo: number, hi: number) => {
        if (hi - lo < 10) return;
        const y = Math.max(lo + 4, Math.min(hi - 4, targetY));
        const score = hi - lo - Math.abs(y - targetY) * 0.15;
        if (score > bestScore) {
            bestScore = score;
            bestY = y;
        }
    };
    let cursor = yMin;
    for (const m of merged) {
        consider(cursor, m.lo);
        cursor = Math.max(cursor, m.hi);
    }
    consider(cursor, yMax);
    return bestY;
}

/**
 * 行缝中缝东竖轨：贴端口侧盒缘，不用 kick+大 stub 抬高。
 * 北向中缝 anchor=from → 节点 0 右出口 sx；绕顶模板另见 eastRailXForSouthOrNorthTemplate。
 */
function interRowEastRailX(
    portSx: number,
    fromB: ReturnType<typeof getNodeBounds>,
    toB: ReturnType<typeof getNodeBounds>,
    anchor: 'from' | 'to'
): number {
    const pad = ROUTE_OBSTACLE_PAD + 8;
    if (anchor === 'from') {
        return portSx + pad;
    }
    return toB.right + pad;
}

/**
 * 多扇出：出发东轨 ≥ 节点 0 右口，且须在所有兄弟节点东侧（避免竖线穿节点 1/2）。
 */
function resolveFanoutDepartEastRailX(
    portSx: number,
    sy: number,
    ex: number,
    ey: number,
    fromB: ReturnType<typeof getNodeBounds>,
    toB: ReturnType<typeof getNodeBounds>,
    from: MindMapRouteNode,
    to: MindMapRouteNode,
    nodes: readonly MindMapRouteNode[],
    halfW: number,
    halfH: number,
    anchor: 'from' | 'to' = 'from'
): number {
    let rail = interRowEastRailX(portSx, fromB, toB, anchor);
    const past = computeEastRailPastSiblingVerticalBlockers(
        portSx,
        sy,
        ex,
        ey,
        from,
        to,
        nodes,
        halfW,
        halfH
    );
    if (past != null) {
        rail = Math.max(rail, past);
    }
    return rail;
}

/**
 * 多扇出 6 折点：西拐高度以父出口 sy 为轴对称（北 sy−d、南 sy+d，d 取兄弟行缝较紧一侧）。
 */
function fanoutSharedCorridorBypassY(
    portSy: number,
    yMin: number,
    yMax: number,
    from: MindMapRouteNode,
    ey: number,
    nodes: readonly MindMapRouteNode[],
    halfW: number,
    halfH: number
): number | null {
    if ((from.nextNodes?.length ?? 0) < 2) return null;
    if (yMax <= yMin + 6) return null;

    const fromB = getNodeBounds(from, halfW, halfH);
    let northLimit = fromB.top - ROUTE_OBSTACLE_PAD - 10;
    let southLimit = fromB.bottom + ROUTE_OBSTACLE_PAD + 10;
    for (const nid of from.nextNodes!) {
        const n = nodes.find((x) => x.nodeId === nid);
        if (!n) continue;
        const b = getNodeBounds(n, halfW, halfH);
        if (n.y < from.y - 6) {
            northLimit = Math.min(
                northLimit,
                b.bottom + ROUTE_OBSTACLE_PAD + 10
            );
        }
        if (n.y > from.y + 6) {
            southLimit = Math.max(southLimit, b.top - ROUTE_OBSTACLE_PAD - 10);
        }
    }
    const minD = MIN_INTER_ROW_VERT + 4;
    const dNorth = portSy - northLimit;
    const dSouth = southLimit - portSy;
    let d = Math.min(
        dNorth >= minD ? dNorth : Number.POSITIVE_INFINITY,
        dSouth >= minD ? dSouth : Number.POSITIVE_INFINITY
    );
    if (!Number.isFinite(d)) {
        d = Math.max(minD, (yMax - yMin) * 0.35);
    }
    d = Math.max(
        minD,
        Math.min(d, Math.abs(ey - portSy) * 0.5, (yMax - yMin) * 0.48)
    );
    let bypass = ey < portSy - 4 ? portSy - d : portSy + d;
    bypass = Math.min(Math.max(bypass, yMin + 4), yMax - 4);
    return bypass;
}

/**
 * 中缝穿越折线：右口短横 → 竖进行缝 → 横移 → 西轨竖到目标行 → 进左口。
 * @param eastRailAnchor 东竖轨贴 from 或 to 的右缘（北向中缝用 from，绕顶模板另走 northOverTop）
 * @param siblingClear 多扇出时抬高东轨，竖线走在兄弟外侧而非 kickX 穿节点
 */
function buildVerticalFirstInterRowCorridorPath(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    bypassY: number,
    fromB: ReturnType<typeof getNodeBounds>,
    toB: ReturnType<typeof getNodeBounds>,
    routeStub: number,
    eastRailAnchor: 'from' | 'to' = 'from',
    siblingClear?: {
        from: MindMapRouteNode;
        to: MindMapRouteNode;
        nodes: readonly MindMapRouteNode[];
        halfW: number;
        halfH: number;
    }
): number[] | null {
    if (isSameColumnPortEdge(sx, ex)) {
        return null;
    }
    const portKick = Math.min(
        defaultPortMatchedHorizStub(routeStub) * 0.42,
        Math.max(12, routeStub * 0.55)
    );
    const kickX = sx + portKick;
    const westX = westRailXForInterRowLeftPort(toB, ex, routeStub);
    let railX = siblingClear
        ? resolveFanoutDepartEastRailX(
              sx,
              sy,
              ex,
              ey,
              fromB,
              toB,
              siblingClear.from,
              siblingClear.to,
              siblingClear.nodes,
              siblingClear.halfW,
              siblingClear.halfH,
              eastRailAnchor
          )
        : interRowEastRailX(sx, fromB, toB, eastRailAnchor);
    railX = Math.max(railX, kickX);
    const westRailClear = 12;
    if (westX >= railX - westRailClear) {
        railX = Math.max(railX, kickX, westX + westRailClear);
    }
    if (westX >= railX - westRailClear) return null;
    if (Math.abs(bypassY - sy) < MIN_INTER_ROW_VERT) {
        return cleanOrthoRoutePoints([
            sx,
            sy,
            railX,
            sy,
            westX,
            sy,
            westX,
            ey,
            ex,
            ey
        ]);
    }
    return cleanOrthoRoutePoints([
        sx,
        sy,
        railX,
        sy,
        railX,
        bypassY,
        westX,
        bypassY,
        westX,
        ey,
        ex,
        ey
    ]);
}

/** 自下而上：目标底 ~ 起点顶 行缝中缝 */
function tryNorthInterRowCorridorOrthogonal(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    rects: RouteRect[],
    fromNode: MindMapRouteNode,
    toNode: MindMapRouteNode,
    nodes: readonly MindMapRouteNode[],
    routeStub: number,
    halfW: number,
    halfH: number
): number[] | null {
    if (ey - sy > -28) return null;
    const stem = tryEastRailStemUnlessObstructed(
        sx,
        sy,
        ex,
        ey,
        fromNode,
        toNode,
        nodes,
        halfW,
        halfH,
        routeStub,
        rects
    );
    if (stem) return stem;
    const fromB = getNodeBounds(fromNode, halfW, halfH);
    const toB = getNodeBounds(toNode, halfW, halfH);
    const yMin = toB.bottom + ROUTE_OBSTACLE_PAD + 12;
    const yMax = fromB.top - ROUTE_OBSTACLE_PAD - 10;
    if (yMax <= yMin + 6) return null;
    const kickX =
        sx + Math.min(defaultPortMatchedHorizStub(routeStub) * 0.42, 24);
    const westX = westRailXForLeftPortEntry(toB, ex, routeStub);
    const railGuess = resolveFanoutDepartEastRailX(
        sx,
        sy,
        ex,
        ey,
        fromB,
        toB,
        fromNode,
        toNode,
        nodes,
        halfW,
        halfH,
        'from'
    );
    let bypassY = fanoutSharedCorridorBypassY(
        sy,
        yMin,
        yMax,
        fromNode,
        ey,
        nodes,
        halfW,
        halfH
    );
    if (bypassY == null) {
        bypassY =
            findBestRowCorridorY(
                rects,
                kickX - 8,
                Math.max(railGuess, westX) + 8,
                yMin,
                yMax,
                (fromB.centerY + toB.centerY) / 2
            ) ?? yMin + ROUTE_CORRIDOR_CLEAR * 0.38;
        bypassY = Math.min(Math.max(bypassY, yMin + 4), yMax - 4);
        if (bypassY >= sy - 6) return null;
    }
    const sib = { from: fromNode, to: toNode, nodes, halfW, halfH };
    const pts = buildVerticalFirstInterRowCorridorPath(
        sx,
        sy,
        ex,
        ey,
        bypassY,
        fromB,
        toB,
        routeStub,
        'from',
        sib
    );
    if (!pts || polylineHitsObstacles(pts, rects)) return null;
    return pts;
}

/** 多扇出南向子节点：目标在父节点下方，优先行缝中缝 */
function isMultiFanoutSouthSibling(
    from: MindMapRouteNode,
    to: MindMapRouteNode
): boolean {
    return (from.nextNodes?.length ?? 0) >= 2 && to.y > from.y + 6;
}

/**
 * 南向多扇出：ex 在 sx 东侧（右出→子左/右口）时与北向一致，优先 L 形 stem 而非中缝西拐。
 * 排除竖排左口、同列绕底。
 */
function preferMultiFanoutStemBeforeSouthCorridor(
    sx: number,
    ex: number,
    from: MindMapRouteNode,
    fromB: ReturnType<typeof getNodeBounds>
): boolean {
    return (
        (from.nextNodes?.length ?? 0) >= 2 &&
        ex > sx + 14 &&
        !isVerticalStackLeftPortEntry(ex, fromB) &&
        !isSameColumnPortEdge(sx, ex)
    );
}

/** 竖排右出→左进：目标左口在父盒右缘左侧（horizBoxGap&lt;0） */
function isVerticalStackLeftPortEntry(
    endX: number,
    fromB: ReturnType<typeof getNodeBounds>
): boolean {
    return endX < fromB.right - 4;
}

/** 竖排南向：与北向绕顶对称，走两盒底缘之下绕底廊（不走 0~2 中缝） */
function preferSouthBypassForVerticalStack(
    from: MindMapRouteNode,
    to: MindMapRouteNode,
    endX: number,
    fromB: ReturnType<typeof getNodeBounds>
): boolean {
    return (
        isMultiFanoutSouthSibling(from, to) &&
        isVerticalStackLeftPortEntry(endX, fromB)
    );
}

/** 父子同列端口（portHorizSpan≈0）：右口/同 x 竖落，不走左口西轨折返 */
function isSameColumnPortEdge(sx: number, ex: number): boolean {
    return Math.abs(ex - sx) <= 14;
}

/**
 * 多扇出同列（portHorizSpan≈0）不在此生成路径：北向改走绕顶、南向改走绕底，
 * 避免贴边竖线或目标行横穿穿盒（见 rawSouthOrNorthDy± / buildVerticalFirst…）。
 */
export function tryMultiFanoutSameColumnStem(
    _sx: number,
    _sy: number,
    _ex: number,
    _ey: number,
    _from: MindMapRouteNode,
    _to: MindMapRouteNode,
    _nodes: readonly MindMapRouteNode[],
    _halfW: number,
    _halfH: number,
    _routeStub: number
): number[] | null {
    return null;
}

/** 竖排北向：走顶廊绕顶（不走 0~1 中缝） */
function preferNorthOverTopForVerticalStack(
    from: MindMapRouteNode,
    to: MindMapRouteNode,
    endX: number,
    fromB: ReturnType<typeof getNodeBounds>
): boolean {
    return (
        (from.nextNodes?.length ?? 0) >= 2 &&
        to.y < from.y - 6 &&
        isVerticalStackLeftPortEntry(endX, fromB)
    );
}

/** 自上而下：起点底 ~ 目标顶 行缝中缝 */
function trySouthInterRowCorridorOrthogonal(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    rects: RouteRect[],
    fromNode: MindMapRouteNode,
    toNode: MindMapRouteNode,
    nodes: readonly MindMapRouteNode[],
    routeStub: number,
    halfW: number,
    halfH: number
): number[] | null {
    if (ey - sy < 28) return null;
    const fromBEarly = getNodeBounds(fromNode, halfW, halfH);
    const corridorFirst =
        isMultiFanoutSouthSibling(fromNode, toNode) &&
        !preferMultiFanoutStemBeforeSouthCorridor(sx, ex, fromNode, fromBEarly);
    const tryStem = () =>
        tryEastRailStemUnlessObstructed(
            sx,
            sy,
            ex,
            ey,
            fromNode,
            toNode,
            nodes,
            halfW,
            halfH,
            routeStub,
            rects
        );
    if (!corridorFirst) {
        const stemEarly = tryStem();
        if (stemEarly) return stemEarly;
    }
    const fromB = getNodeBounds(fromNode, halfW, halfH);
    const toB = getNodeBounds(toNode, halfW, halfH);
    const yMin = fromB.bottom + ROUTE_OBSTACLE_PAD + 12;
    const yMax = toB.top - ROUTE_OBSTACLE_PAD - 10;
    if (yMax <= yMin + 6) return null;
    const kickX =
        sx + Math.min(defaultPortMatchedHorizStub(routeStub) * 0.42, 24);
    const westX = westRailXForLeftPortEntry(toB, ex, routeStub);
    const railGuess = resolveFanoutDepartEastRailX(
        sx,
        sy,
        ex,
        ey,
        fromB,
        toB,
        fromNode,
        toNode,
        nodes,
        halfW,
        halfH,
        'from'
    );
    let bypassY = fanoutSharedCorridorBypassY(
        sy,
        yMin,
        yMax,
        fromNode,
        ey,
        nodes,
        halfW,
        halfH
    );
    if (bypassY == null) {
        bypassY =
            findBestRowCorridorY(
                rects,
                kickX - 8,
                Math.max(railGuess, westX) + 8,
                yMin,
                yMax,
                (fromB.centerY + toB.centerY) / 2
            ) ?? yMin + ROUTE_CORRIDOR_CLEAR * 0.38;
        bypassY = Math.min(Math.max(bypassY, yMin + 4), yMax - 4);
        if (bypassY <= sy + 6) return null;
    }
    const sib = { from: fromNode, to: toNode, nodes, halfW, halfH };
    const pts = buildVerticalFirstInterRowCorridorPath(
        sx,
        sy,
        ex,
        ey,
        bypassY,
        fromB,
        toB,
        routeStub,
        'from',
        sib
    );
    if (!pts || polylineHitsObstacles(pts, rects)) return null;
    if (corridorFirst) {
        return pts;
    }
    const stemLate = tryStem();
    if (stemLate) return stemLate;
    return pts;
}

/** 右出→左入跨行：按 dy 选上/下行缝中缝 */
function tryInterRowCorridorBypassOrthogonal(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    rects: RouteRect[],
    fromNode: MindMapRouteNode,
    toNode: MindMapRouteNode,
    nodes: readonly MindMapRouteNode[],
    routeStub: number,
    halfW: number,
    halfH: number
): number[] | null {
    if (ey < sy - 28) {
        return tryNorthInterRowCorridorOrthogonal(
            sx,
            sy,
            ex,
            ey,
            rects,
            fromNode,
            toNode,
            nodes,
            routeStub,
            halfW,
            halfH
        );
    }
    if (ey > sy + 28) {
        return trySouthInterRowCorridorOrthogonal(
            sx,
            sy,
            ex,
            ey,
            rects,
            fromNode,
            toNode,
            nodes,
            routeStub,
            halfW,
            halfH
        );
    }
    return null;
}

/**
 * 与 index 腰线 J + 多扇出 + 自下而上进左口一致（如 4→6 在 J 重算后进避障绕顶）。
 * 东轨 `railX` 若纳入 `from.right`，拖父节点时绕顶折线整体平移，而 `westX` 已按 to 左缘计算。
 */
function waistSpineFanoutEastRailOmitsFromRight(
    fromNode: MindMapRouteNode,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    fromB: ReturnType<typeof getNodeBounds>,
    toB: ReturnType<typeof getNodeBounds>,
    routeStub: number
): boolean {
    const nexts = fromNode.nextNodes;
    if (!nexts || nexts.length < 2) return false;
    if (endY >= startY - 6) return false;
    if (Math.abs(startY - fromNode.y) > 28) return false;
    const leftTol = Math.max(12, (toB.right - toB.left) * 0.08);
    if (Math.abs(endX - toB.left) > leftTol + 10) return false;
    /** J 在父行腰线上且不在「父右口 + stub」默认起线上 */
    if (startX > fromB.right + routeStub * 0.32) return true;
    return startX < fromB.right - 10;
}

/**
 * 默认右口 + 自下而上进目标左口（如 4→6）：
 * 与兄弟数量无关；中缝/绕顶东轨 split 仅看几何，删兄弟不应改 4→6。
 */
function defaultPortUpwardLeftEntry(
    fromNode: MindMapRouteNode,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    fromB: ReturnType<typeof getNodeBounds>,
    toB: ReturnType<typeof getNodeBounds>,
    routeStub: number
): boolean {
    if (endY >= startY - 6) return false;
    if (Math.abs(startY - fromNode.y) > 28) return false;
    const leftTol = Math.max(12, (toB.right - toB.left) * 0.08);
    if (Math.abs(endX - toB.left) > leftTol + 10) return false;
    if (startX > fromB.right + routeStub * 0.32) return false;
    if (startX < fromB.right - 10) return false;
    return true;
}

/** 默认右口 + 自上而下进目标左口（如 3→8，与 4→6 对称） */
function defaultPortDownwardLeftEntry(
    fromNode: MindMapRouteNode,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    fromB: ReturnType<typeof getNodeBounds>,
    toB: ReturnType<typeof getNodeBounds>,
    routeStub: number
): boolean {
    if (endY <= startY + 6) return false;
    if (Math.abs(startY - fromNode.y) > 28) return false;
    const leftTol = Math.max(12, (toB.right - toB.left) * 0.08);
    if (Math.abs(endX - toB.left) > leftTol + 10) return false;
    if (startX > fromB.right + routeStub * 0.32) return false;
    if (startX < fromB.right - 10) return false;
    return true;
}

function eastRailXForSouthOrNorthTemplate(
    startX: number,
    fromB: ReturnType<typeof getNodeBounds>,
    toB: ReturnType<typeof getNodeBounds>,
    routeStub: number,
    omitFromRight: boolean,
    multiFanoutSplit: boolean,
    template: 'southBelow' | 'northOverTop',
    fanoutStripeDx = 0
): number {
    const kickS = startX + routeStub;
    const toRail = toB.right + ROUTE_OBSTACLE_PAD + 12;
    const fromRail = fromB.right + ROUTE_OBSTACLE_PAD + 12;
    let rail: number;
    if (omitFromRight) {
        rail = Math.max(kickS, toRail);
    } else if (template === 'southBelow') {
        /** 绕底：东竖轨由终点 to 右缘决定（与绕顶对称） */
        rail = toRail;
    } else if (template === 'northOverTop') {
        /** 绕顶：东竖轨由终点 to（子节点 1）右缘决定，不用 startX+stub 抬高 */
        rail = toRail;
    } else {
        rail = Math.max(kickS, toRail, fromB.right + ROUTE_OBSTACLE_PAD + 2);
    }
    return rail + fanoutStripeDx;
}

function routingStripeDx(
    fromId: number,
    toId: number,
    routeStub: number
): number {
    return Math.round(
        ((((fromId * 92821) ^ (toId * 48271)) % 241) / 241 - 0.5) *
            routeStub *
            0.55
    );
}

function rectHorizOverlap(r: RouteRect, x1: number, x2: number): boolean {
    const xa = Math.min(x1, x2);
    const xb = Math.max(x1, x2);
    return !(r.right < xa || r.left > xb);
}

function rectVertOverlap(r: RouteRect, y1: number, y2: number): boolean {
    const ya = Math.min(y1, y2);
    const yb = Math.max(y1, y2);
    return !(r.bottom < ya || r.top > yb);
}

/** 与矩形相交，矩形四边各向内收缩 inset（用于判别是否切入节点「内部」而非贴边走线） */
function orthoSegmentHitsRectInset(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    r: RouteRect,
    inset: number
): boolean {
    const ri: RouteRect = {
        left: r.left + inset,
        right: r.right - inset,
        top: r.top + inset,
        bottom: r.bottom - inset
    };
    if (ri.left >= ri.right || ri.top >= ri.bottom) {
        return orthoSegmentHitsRect(ax, ay, bx, by, r);
    }
    return orthoSegmentHitsRect(ax, ay, bx, by, ri);
}

/** 线段与矩形相交（假定多为水平/垂直正交线段） */
export function orthoSegmentHitsRect(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    r: RouteRect
): boolean {
    const eps = 3;
    if (Math.abs(ay - by) < eps) {
        if (ay < r.top || ay > r.bottom) return false;
        return rectHorizOverlap(r, ax, bx);
    }
    if (Math.abs(ax - bx) < eps) {
        if (ax < r.left || ax > r.right) return false;
        return rectVertOverlap(r, ay, by);
    }
    const n = 8;
    for (let i = 0; i <= n; i++) {
        const px = ax + ((bx - ax) * i) / n;
        const py = ay + ((by - ay) * i) / n;
        if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom)
            return true;
    }
    return false;
}

/** 线段 AABB 与矩形是否相交（cheap reject） */
function segmentAabbOverlapsRect(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    r: RouteRect
): boolean {
    const minX = Math.min(ax, bx);
    const maxX = Math.max(ax, bx);
    const minY = Math.min(ay, by);
    const maxY = Math.max(ay, by);
    return (
        maxX >= r.left && minX <= r.right && maxY >= r.top && minY <= r.bottom
    );
}

function polylineHitsObstacles(points: number[], rects: RouteRect[]): boolean {
    for (let i = 2; i < points.length; i += 2) {
        const ax = points[i - 2]!;
        const ay = points[i - 1]!;
        const bx = points[i]!;
        const by = points[i + 1]!;
        for (const r of rects) {
            if (!segmentAabbOverlapsRect(ax, ay, bx, by, r)) continue;
            if (orthoSegmentHitsRect(ax, ay, bx, by, r)) return true;
        }
    }
    return false;
}

/**
 * 除「其它节点」外，折线是否穿过连线自身的 from / to 矩形内部。
 * 首段允许从 from 边界出发；末段仅允许「短接管」贴终点外包盒接到端口——
 * 长的末段若贯穿终点矩形（典型为先横后竖 HV 时末竖段整块穿过节点）须判为穿体以便抛光改道。
 */
export function polylineHitsEndpointNodeInteriors(
    points: number[],
    from: MindMapRouteNode,
    to: MindMapRouteNode,
    halfW: number,
    halfH: number,
    horizEndpointExtra = 0
): boolean {
    const epsAxis = 3;
    const pad = ROUTE_OBSTACLE_PAD + Math.max(10, halfW * 0.1, halfH * 0.1);
    let fromR = expandRouteRect(getNodeBounds(from, halfW, halfH), pad);
    let toR = expandRouteRect(getNodeBounds(to, halfW, halfH), pad);
    if (horizEndpointExtra > 0) {
        fromR = expandRouteRectHorizOnly(fromR, horizEndpointExtra);
        toR = expandRouteRectHorizOnly(toR, horizEndpointExtra);
    }
    const fromCore = getNodeBounds(from, halfW, halfH);
    const toCore = getNodeBounds(to, halfW, halfH);
    const numVerts = points.length / 2;
    const numSeg = numVerts - 1;
    if (numSeg < 1) return false;

    const stubApproachMaxLen = Math.max(52, Math.max(halfW, halfH) + pad * 2);
    /** 末段水平入户：收缩盒避免误判；末段竖线若用收缩盒会漏掉「沿左缘整块贯穿」的 HV */
    const toInteriorInset = Math.max(12, Math.min(halfW, halfH) * 0.28);
    const fromInteriorInset = Math.max(12, Math.min(halfW, halfH) * 0.28);

    const lex = points[numVerts * 2 - 2]!;
    const ley = points[numVerts * 2 - 1]!;
    const portTol = 12;

    for (let s = 0; s < numSeg; s++) {
        const ax = points[s * 2]!;
        const ay = points[s * 2 + 1]!;
        const bx = points[(s + 1) * 2]!;
        const by = points[(s + 1) * 2 + 1]!;
        const segLen = Math.hypot(bx - ax, by - ay);
        const isLastSeg = s === numSeg - 1;

        /** 首段：允许端口旁短 stub，但若去掉 stub 后仍切入 from 内部（典型 HV 沿 sy 横穿起点盒），须判穿体 */
        if (s === 0 && segLen > 16) {
            const ux = (bx - ax) / segLen;
            const uy = (by - ay) / segLen;
            const stubClip = Math.min(
                stubApproachMaxLen * 0.55,
                Math.max(22, segLen * 0.22)
            );
            const cx = ax + ux * stubClip;
            const cy = ay + uy * stubClip;
            if (
                orthoSegmentHitsRectInset(
                    cx,
                    cy,
                    bx,
                    by,
                    fromCore,
                    fromInteriorInset
                )
            ) {
                return true;
            }
        }

        if (s >= 1) {
            if (Math.abs(ax - bx) < epsAxis) {
                if (orthoSegmentHitsRect(ax, ay, bx, by, fromCore)) {
                    return true;
                }
            } else if (orthoSegmentHitsRect(ax, ay, bx, by, fromR)) {
                return true;
            }
        }

        if (isLastSeg) {
            if (segLen <= stubApproachMaxLen) continue;
            if (Math.abs(ax - bx) < epsAxis) {
                if (orthoSegmentHitsRect(ax, ay, bx, by, toCore)) {
                    return true;
                }
            } else if (Math.abs(ay - by) < epsAxis) {
                const innerX =
                    Math.abs(ax - lex) < portTol && Math.abs(ay - ley) < portTol
                        ? bx
                        : Math.abs(bx - lex) < portTol &&
                            Math.abs(by - ley) < portTol
                          ? ax
                          : NaN;
                const eastRailIntoLeftPort =
                    Number.isFinite(innerX) &&
                    lex <= toCore.left + portTol &&
                    innerX >= toCore.right - ROUTE_OBSTACLE_PAD - 8 &&
                    innerX > lex + 12;
                /** 沿终点下走廊再上拐：自西侧水平向东接入左口 */
                const westRailIntoLeftPort =
                    Number.isFinite(innerX) &&
                    lex <= toCore.left + portTol &&
                    innerX < toCore.left - ROUTE_OBSTACLE_PAD - 4 &&
                    lex > innerX + 12;
                /** 东/西轨接入左口：仅当末段水平不经节点内部（如沿底缘外侧横移）；此前一律豁免会把 stemUp 在 ey 高度横穿盒体误判为合法 */
                if (eastRailIntoLeftPort || westRailIntoLeftPort) {
                    if (
                        !orthoSegmentHitsRectInset(
                            ax,
                            ay,
                            bx,
                            by,
                            toCore,
                            toInteriorInset
                        )
                    ) {
                        continue;
                    }
                }
                if (
                    orthoSegmentHitsRectInset(
                        ax,
                        ay,
                        bx,
                        by,
                        toCore,
                        toInteriorInset
                    )
                ) {
                    return true;
                }
            } else if (
                orthoSegmentHitsRectInset(
                    ax,
                    ay,
                    bx,
                    by,
                    toCore,
                    toInteriorInset
                )
            ) {
                return true;
            }
        } else if (orthoSegmentHitsRect(ax, ay, bx, by, toR)) {
            return true;
        }
    }
    return false;
}

function buildOrthoLPath(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    midX: number
): number[] {
    return [sx, sy, midX, sy, midX, ey, ex, ey];
}

/** L 拐点横坐标在区间内扫描，打散相近边共享同一拐点导致的叠线 */
function tryLSweepAgainstObstacles(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    rects: RouteRect[],
    stripeDx: number
): number[] | null {
    const fracs = [
        0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.22, 0.78, 0.18, 0.82, 0.14,
        0.86, 0.3, 0.7, 0.38, 0.62, 0.46, 0.54
    ];
    const dx = ex - sx;
    const span = Math.max(Math.abs(dx), 80);
    const stripeNorm = stripeDx / span;
    const tried = new Set<number>();
    for (const f of fracs) {
        for (const adj of [
            0,
            stripeNorm * 0.45,
            -stripeNorm * 0.45,
            stripeNorm,
            -stripeNorm
        ]) {
            const frac = Math.min(0.92, Math.max(0.08, f + adj));
            const key = Math.round(frac * 1000);
            if (tried.has(key)) continue;
            tried.add(key);
            const midX = sx + dx * frac;
            const cand = buildOrthoLPath(sx, sy, ex, ey, midX);
            if (!polylineHitsObstacles(cand, rects)) return cand;
        }
    }
    return null;
}

/**
 * mindmap 经典侧口（起点在节点右侧、终点在左侧）：stub 恒向外（右缘往东、左缘往西）。
 * 若用 `Math.sign(ex-sx)`，在 ex<sx 横向重叠时会把 kick 折回矩形内，竖段贯穿端点节点。
 */
function outwardMindmapSideKickXs(
    sx: number,
    ex: number,
    routeStub: number
): { kickS: number; kickE: number } {
    return {
        kickS: sx + routeStub,
        kickE: ex - routeStub
    };
}

/**
 * 贯通廊道开在障碍带下方：右 stub → 竖至廊道高度 → 节点下方横穿 → 竖至端口高度 → 水平进左口。
 * `endpointBottomMax`：两端节点外包盒底缘的较大值；顶缘严格在该值之下的障碍（如竖列里更靠下的兄弟节点）不参与抬升地板，否则会误以为整条走廊必须低于整摞节点。
 */
function corridorBelowPath(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    rects: RouteRect[],
    routeStub: number,
    liftExtra: number,
    endpointBottomMax?: number
): number[] {
    const { kickS, kickE } = outwardMindmapSideKickXs(sx, ex, routeStub);
    const xMin = Math.min(kickS, kickE) - routeStub;
    const xMax = Math.max(kickS, kickE) + routeStub;
    let floor = -Infinity;
    const belowEndpointsTol =
        endpointBottomMax !== undefined
            ? endpointBottomMax + ROUTE_OBSTACLE_PAD + 8
            : null;
    for (const r of rects) {
        if (r.right < xMin || r.left > xMax) continue;
        if (belowEndpointsTol != null && r.top > belowEndpointsTol) {
            continue;
        }
        floor = Math.max(floor, r.bottom);
    }
    const targetYBase =
        floor === -Infinity
            ? Math.max(sy, ey) + ROUTE_CORRIDOR_CLEAR
            : floor + ROUTE_CORRIDOR_CLEAR + liftExtra;
    const bypassY = Math.max(targetYBase, Math.max(sy, ey) + 16);
    return [
        sx,
        sy,
        kickS,
        sy,
        kickS,
        bypassY,
        kickE,
        bypassY,
        kickE,
        ey,
        ex,
        ey
    ];
}

function markGridCellsBlockedByRects(
    blocked: Uint8Array,
    minX: number,
    minY: number,
    cellSize: number,
    cols: number,
    rows: number,
    rects: RouteRect[],
    idx: (i: number, j: number) => number
): void {
    for (const r of rects) {
        const i0 = Math.max(0, Math.floor((r.left - minX) / cellSize));
        const i1 = Math.min(cols - 1, Math.floor((r.right - minX) / cellSize));
        const j0 = Math.max(0, Math.floor((r.top - minY) / cellSize));
        const j1 = Math.min(rows - 1, Math.floor((r.bottom - minY) / cellSize));
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                blocked[idx(i, j)] = 1;
            }
        }
    }
}

/** 网格 BFS 抛光用的 margin boost 阶梯（原 35 次 → 6 次） */
const GRID_ROUTE_BOOST_STEPS = [0, 220, 660, 1320, 2200, 3300] as const;
/** 障碍较多时缩短网格搜索 */
const GRID_ROUTE_BOOST_STEPS_DENSE = [0, 660, 1760] as const;
/** 障碍数超过该阈值时跳过重抛光分支，走快速通道 */
const ROUTE_DENSE_OBSTACLE_FAST_PATH = 20;

/** 节点布局摘要：同一帧内位置/高度变化时使路由缓存失效 */
export function mindMapRouteLayoutDigest(
    nodes: readonly {
        nodeId: number;
        x: number;
        y: number;
        rectConf?: { height?: number };
    }[]
): number {
    let h = 2166136261;
    for (const n of nodes) {
        h ^= n.nodeId;
        h = Math.imul(h, 16777619);
        h ^= n.x | 0;
        h = Math.imul(h, 16777619);
        h ^= n.y | 0;
        h = Math.imul(h, 16777619);
        h ^= Number(n.rectConf?.height ?? 0) | 0;
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function gridBoostStepsForObstacleCount(count: number): readonly number[] {
    return count > ROUTE_DENSE_OBSTACLE_FAST_PATH
        ? GRID_ROUTE_BOOST_STEPS_DENSE
        : GRID_ROUTE_BOOST_STEPS;
}

/** 格网过粗则放大 cell，控制 BFS 节点规模 */
function computeGridDims(
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    obstacleCount = 0
): { cellSize: number; cols: number; rows: number } {
    let cellSize = ROUTE_GRID_CELL;
    let maxCells = ROUTE_GRID_MAX_CELLS;
    if (obstacleCount > ROUTE_DENSE_OBSTACLE_FAST_PATH) {
        cellSize = 28;
        maxCells = 8000;
    }
    let cols = 1;
    let rows = 1;
    for (let s = 0; s < 12; s++) {
        cols = Math.max(
            1,
            Math.ceil((maxX - minX) / cellSize + Number.EPSILON)
        );
        rows = Math.max(
            1,
            Math.ceil((maxY - minY) / cellSize + Number.EPSILON)
        );
        if (cols * rows <= maxCells) break;
        cellSize += 8;
    }
    return { cellSize, cols, rows };
}

function worldToGridCell(
    x: number,
    y: number,
    minX: number,
    minY: number,
    cellSize: number,
    cols: number,
    rows: number
): [number, number] {
    let i = Math.floor((x - minX) / cellSize);
    let j = Math.floor((y - minY) / cellSize);
    i = Math.max(0, Math.min(cols - 1, i));
    j = Math.max(0, Math.min(rows - 1, j));
    return [i, j];
}

function cellCenter(
    i: number,
    j: number,
    minX: number,
    minY: number,
    cellSize: number
): [number, number] {
    return [
        minX + i * cellSize + cellSize / 2,
        minY + j * cellSize + cellSize / 2
    ];
}

/** 四邻接 BFS，blocked 中与起终点重合的格子会短暂解禁以便起步/到站 */
function bfsOrthoGridRoute(
    cols: number,
    rows: number,
    blocked: Uint8Array,
    si: number,
    sj: number,
    gi: number,
    gj: number,
    idx: (i: number, j: number) => number
): number[] | null {
    const si0 = idx(si, sj);
    const goal = idx(gi, gj);
    if (blocked[si0] && si0 !== goal) return null;

    const qCap = cols * rows;
    const qx = new Int16Array(qCap);
    const qy = new Int16Array(qCap);
    let qh = 0;
    let qt = 0;
    const parent = new Int32Array(cols * rows);
    parent.fill(-1);
    const seen = new Uint8Array(cols * rows);

    qx[qt] = si;
    qy[qt] = sj;
    qt++;
    seen[si0] = 1;
    parent[si0] = si0;

    const di = [1, -1, 0, 0];
    const dj = [0, 0, 1, -1];

    while (qh < qt) {
        const ci = qx[qh];
        const cj = qy[qh];
        qh++;
        const cur = idx(ci, cj);
        if (cur === goal) {
            const pathRev: number[] = [];
            let p = goal;
            while (true) {
                pathRev.push(p);
                if (p === parent[p]) break;
                p = parent[p];
            }
            pathRev.reverse();
            return pathRev;
        }

        for (let d = 0; d < 4; d++) {
            const ni = ci + di[d];
            const nj = cj + dj[d];
            if (ni < 0 || ni >= cols || nj < 0 || nj >= rows) continue;
            const nidx = idx(ni, nj);
            if (seen[nidx]) continue;
            if (blocked[nidx] && nidx !== goal && nidx !== si0) continue;
            seen[nidx] = 1;
            parent[nidx] = cur;
            if (qt >= qCap) return null;
            qx[qt] = ni;
            qy[qt] = nj;
            qt++;
        }
    }
    return null;
}

/** 同轴三连点中间点若折返（如 1272→1271 在同一 y），去掉中间点以免多余线断、圆角失效 */
function removeOrthoSameAxisBacktrackInPlace(pts: number[]): void {
    for (let guard = 0; guard < 48 && pts.length >= 6; guard++) {
        let changed = false;
        for (let i = 4; i < pts.length - 2; i += 2) {
            const x0 = pts[i - 4]!;
            const y0 = pts[i - 3]!;
            const x1 = pts[i - 2]!;
            const y1 = pts[i - 1]!;
            const x2 = pts[i]!;
            const y2 = pts[i + 1]!;
            if (Math.abs(y0 - y1) < 0.6 && Math.abs(y1 - y2) < 0.6) {
                if ((x1 - x0) * (x2 - x1) < -0.5) {
                    pts.splice(i - 2, 2);
                    changed = true;
                    break;
                }
            }
            if (Math.abs(x0 - x1) < 0.6 && Math.abs(x1 - x2) < 0.6) {
                if ((y1 - y0) * (y2 - y1) < -0.5) {
                    pts.splice(i - 2, 2);
                    changed = true;
                    break;
                }
            }
        }
        if (!changed) break;
    }
}

function cleanOrthoRoutePoints(pts: number[]): number[] {
    const out = pts.slice();
    if (out.length < 4) return out;
    mergeCollinearOrthoInPlace(out);
    removeOrthoSameAxisBacktrackInPlace(out);
    mergeCollinearOrthoInPlace(out);
    return out;
}

function mergeCollinearOrthoInPlace(pts: number[]): void {
    if (pts.length < 4) return;
    for (let guard = 0; guard < 80; guard++) {
        let changed = false;
        const next: number[] = [pts[0], pts[1]];
        for (let i = 2; i < pts.length; i += 2) {
            const x = pts[i];
            const y = pts[i + 1];
            while (next.length >= 6) {
                const x0 = next[next.length - 4];
                const y0 = next[next.length - 3];
                const x1 = next[next.length - 2];
                const y1 = next[next.length - 1];
                const vx = x1 - x0;
                const vy = y1 - y0;
                const wx = x - x1;
                const wy = y - y1;
                const cross = Math.abs(vx * wy - vy * wx);
                if (cross > 1e-3) break;
                next.pop();
                next.pop();
                changed = true;
            }
            next.push(x, y);
        }
        pts.length = 0;
        pts.push(...next);
        if (!changed) break;
    }
}

/** 将格点序列转成世界坐标下的正交折线，并与真实起终点锚定 */
function gridIndicesToOrthoPolyline(
    pathIndices: number[],
    cols: number,
    cellSize: number,
    minX: number,
    minY: number,
    sx: number,
    sy: number,
    ex: number,
    ey: number
): number[] {
    const pts: number[] = [sx, sy];
    let px = sx;
    let py = sy;

    const idxToIJ = (linear: number) => {
        const j = Math.floor(linear / cols);
        const i = linear - j * cols;
        return [i, j] as const;
    };

    for (const linear of pathIndices) {
        const [i, j] = idxToIJ(linear);
        const [cx, cy] = cellCenter(i, j, minX, minY, cellSize);
        if (Math.abs(cx - px) < 0.5 && Math.abs(cy - py) < 0.5) continue;

        if (Math.abs(cx - px) < 0.5) {
            pts.push(cx, cy);
        } else if (Math.abs(cy - py) < 0.5) {
            pts.push(cx, cy);
        } else {
            pts.push(px, cy, cx, cy);
        }
        px = cx;
        py = cy;
    }

    if (Math.abs(ex - px) > 0.5 || Math.abs(ey - py) > 0.5) {
        if (Math.abs(ex - px) < 0.5) {
            pts.push(ex, ey);
        } else if (Math.abs(ey - py) < 0.5) {
            pts.push(ex, ey);
        } else {
            pts.push(px, ey, ex, ey);
        }
    } else if (pts.length === 2) {
        pts.push(ex, ey);
    }

    mergeCollinearOrthoInPlace(pts);
    if (pts.length >= 4) {
        pts[0] = sx;
        pts[1] = sy;
        pts[pts.length - 2] = ex;
        pts[pts.length - 1] = ey;
    }
    return pts;
}

function tryGridManhattanOrthogonalRoute(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    rects: RouteRect[],
    routeMarginBoost: number
): number[] | null {
    if (!rects.length) return null;

    const margin = ROUTE_GRID_MARGIN_BASE + routeMarginBoost;
    let minX = Math.min(sx, ex);
    let maxX = Math.max(sx, ex);
    let minY = Math.min(sy, ey);
    let maxY = Math.max(sy, ey);

    for (const r of rects) {
        minX = Math.min(minX, r.left);
        maxX = Math.max(maxX, r.right);
        minY = Math.min(minY, r.top);
        maxY = Math.max(maxY, r.bottom);
    }
    minX -= margin;
    maxX += margin;
    minY -= margin;
    maxY += margin;

    const { cellSize, cols, rows } = computeGridDims(
        minX,
        maxX,
        minY,
        maxY,
        rects.length
    );
    const W = cols;
    const H = rows;

    const idx = (i: number, j: number) => j * W + i;
    const blocked = new Uint8Array(W * H);

    markGridCellsBlockedByRects(
        blocked,
        minX,
        minY,
        cellSize,
        W,
        H,
        rects,
        idx
    );

    const [si, sj] = worldToGridCell(sx, sy, minX, minY, cellSize, W, H);
    const [gi, gj] = worldToGridCell(ex, ey, minX, minY, cellSize, W, H);
    blocked[idx(si, sj)] = 0;
    blocked[idx(gi, gj)] = 0;

    const pathLin = bfsOrthoGridRoute(W, H, blocked, si, sj, gi, gj, idx);
    if (!pathLin) return null;

    const pts = gridIndicesToOrthoPolyline(
        pathLin,
        W,
        cellSize,
        minX,
        minY,
        sx,
        sy,
        ex,
        ey
    );
    if (pts.length < 4) return null;
    return pts;
}

function tryGridRouteWithBoostSteps(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    rects: RouteRect[],
    boosts: readonly number[],
    accept: (path: number[]) => boolean
): number[] | null {
    for (const boost of boosts) {
        const grid = tryGridManhattanOrthogonalRoute(
            sx,
            sy,
            ex,
            ey,
            rects,
            boost
        );
        if (grid && grid.length >= 4 && accept(grid)) return grid;
    }
    return null;
}

/** 贴缝多扇出：右出 → 东轨 → 行缝西拐 → 西轨 → 进左口（6 顶点 / 12 坐标） */
export function isMultiFanoutWestJogCorridorPath(
    path: number[],
    sx: number,
    sy: number,
    ex: number,
    ey: number
): boolean {
    if (path.length !== 12) return false;
    const rx = path[4]!;
    const yBypass = path[5]!;
    const wx = path[8]!;
    return (
        Math.abs(path[0]! - sx) < 2 &&
        Math.abs(path[1]! - sy) < 2 &&
        Math.abs(path[2]! - rx) < 2 &&
        Math.abs(path[3]! - sy) < 2 &&
        Math.abs(path[6]! - wx) < 2 &&
        Math.abs(path[7]! - yBypass) < 2 &&
        Math.abs(path[10]! - ex) < 3 &&
        Math.abs(path[11]! - ey) < 2 &&
        rx > sx + 8 &&
        wx < rx - 8 &&
        Math.abs(yBypass - sy) >= MIN_INTER_ROW_VERT
    );
}

/** close pair 穿体检测：6 折点西拐 / 东竖轨不叠加横向扩盒 */
export function endpointInteriorExtraForDefaultPortEdge(
    path: number[],
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    from: MindMapRouteNode,
    to: MindMapRouteNode,
    halfW: number,
    halfH: number
): number {
    const horizGap =
        getNodeBounds(to, halfW, halfH).left -
        getNodeBounds(from, halfW, halfH).right;
    const portSpan = ex - sx;
    if (!isCloseDefaultPortHorizGap(horizGap, portSpan)) return 0;
    if (
        isMultiFanoutEastRailStemPath(path, sx, sy, ex, ey) ||
        isMultiFanoutWestJogCorridorPath(path, sx, sy, ex, ey)
    ) {
        return 0;
    }
    return ROUTE_MULTI_FANOUT_CLOSE_HORIZ_OBSTACLE_EXTRA;
}

export function isMultiFanoutEastRailStemPath(
    path: number[],
    sx: number,
    sy: number,
    ex: number,
    ey: number
): boolean {
    if (path.length !== 8) return false;
    const x1 = path[2]!;
    const y1 = path[3]!;
    const x2 = path[4]!;
    const y2 = path[5]!;
    const x3 = path[6]!;
    const y3 = path[7]!;
    return (
        Math.abs(path[0]! - sx) < 2 &&
        Math.abs(path[1]! - sy) < 2 &&
        Math.abs(x1 - x2) < 2 &&
        Math.abs(y1 - sy) < 2 &&
        Math.abs(y2 - ey) < 2 &&
        Math.abs(y3 - ey) < 2 &&
        Math.abs(x3 - ex) < 2 &&
        x1 > sx + 8 &&
        x2 > sx + 8
    );
}

/**
 * 无障碍时：右出 → 东竖轨 → 进左口（L 形 / 4 折点）。仅多扇出或横向未超宽时使用。
 */
export function tryMultiFanoutSimpleStemToLeftPort(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    from: MindMapRouteNode,
    to: MindMapRouteNode,
    nodes: readonly MindMapRouteNode[],
    halfW: number,
    halfH: number,
    routeStub: number
): number[] | null {
    const portSpan = ex - sx;
    if (portSpan <= 0) {
        return tryMultiFanoutSameColumnStem(
            sx,
            sy,
            ex,
            ey,
            from,
            to,
            nodes,
            halfW,
            halfH,
            routeStub
        );
    }
    const multiFanout = (from.nextNodes?.length ?? 0) >= 2;
    if (!multiFanout && portSpan > ROUTE_MULTI_FANOUT_CLOSE_HORIZ_GAP + 168) {
        return null;
    }
    if (Math.abs(ey - sy) < MIN_INTER_ROW_VERT) return null;
    const fromB = getNodeBounds(from, halfW, halfH);
    const toB = getNodeBounds(to, halfW, halfH);
    const closeFan =
        (from.nextNodes?.length ?? 0) >= 2 &&
        portSpan <= ROUTE_MULTI_FANOUT_CLOSE_HORIZ_GAP + 8;
    /** 贴缝横距 ≤52 时 portSpan 常 26~40，kick 须 ≥12 才过 defaultPortPathHasHorizExit */
    const portKick = closeFan
        ? Math.max(
              12,
              Math.min(
                  defaultPortMatchedHorizStub(routeStub) * 0.42,
                  portSpan * 0.5
              )
          )
        : Math.min(
              defaultPortMatchedHorizStub(routeStub) * 0.42,
              Math.max(12, routeStub * 0.55)
          );
    const kickX = sx + portKick;
    /** 多扇出 L 形：北/南共用父侧东轨 + 兄弟外侧（与绕顶/绕底 to 锚定区分） */
    let railX = multiFanout
        ? resolveFanoutDepartEastRailX(
              sx,
              sy,
              ex,
              ey,
              fromB,
              toB,
              from,
              to,
              nodes,
              halfW,
              halfH,
              'from'
          )
        : interRowEastRailX(sx, fromB, toB, 'from');
    railX = Math.max(railX, kickX);
    const inboundSlack = closeFan ? 6 : 12;
    if (railX >= ex - inboundSlack) return null;
    const pts = cleanOrthoRoutePoints([sx, sy, railX, sy, railX, ey, ex, ey]);
    if (pts.length < 8) return null;
    if (multiFanout) {
        const scope = routeObstacleComponentNodeIds(nodes, from.nodeId);
        if (
            horizSegmentHitsSiblingNodes(
                sy,
                sx,
                railX,
                from,
                to,
                nodes,
                halfW,
                halfH,
                scope
            )
        ) {
            return null;
        }
    }
    return pts;
}

/** 东竖轨 L 形可用且不穿障/不穿 from·to 盒体时返回，否则 null 改走 6 折点中缝 */
function tryEastRailStemUnlessObstructed(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    from: MindMapRouteNode,
    to: MindMapRouteNode,
    nodes: readonly MindMapRouteNode[],
    halfW: number,
    halfH: number,
    routeStub: number,
    rects: RouteRect[],
    horizEndpointExtra = 0
): number[] | null {
    const stem = tryMultiFanoutSimpleStemToLeftPort(
        sx,
        sy,
        ex,
        ey,
        from,
        to,
        nodes,
        halfW,
        halfH,
        routeStub
    );
    if (!stem) return null;
    const endpointExtra =
        horizEndpointExtra > 0 &&
        isMultiFanoutEastRailStemPath(stem, sx, sy, ex, ey)
            ? 0
            : horizEndpointExtra;
    if (
        polylineHitsEndpointNodeInteriors(
            stem,
            from,
            to,
            halfW,
            halfH,
            endpointExtra
        )
    ) {
        return null;
    }
    if (rects.length && polylineHitsObstacles(stem, rects)) {
        return null;
    }
    return stem;
}

/**
 * 多扇出、目标在起点右下方：右出短横 → 竖落 → 左向进左口（替代 dx&lt;100 绕底大折）。
 */
function tryMultiFanoutDownwardStemToLeftPort(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    from: MindMapRouteNode,
    to: MindMapRouteNode,
    nodes: readonly MindMapRouteNode[],
    halfW: number,
    halfH: number
): number[] | null {
    const portSpan = ex - sx;
    if (portSpan > 220) return null;
    return buildMultiFanoutDownwardToLeftPortPath(
        sx,
        sy,
        ex,
        ey,
        from,
        to,
        nodes,
        halfW,
        halfH
    );
}

/**
 * 同行右出→左入：直横、端口横入折线，或仅贴挡障顶/底短绕（避免网格大 U）。
 */
function tryCompactSameRowOrthogonal(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    rects: RouteRect[],
    routeStub: number
): number[] | null {
    if (Math.abs(ey - sy) > ROUTING_SAME_ROW_TOL || ex <= sx + 20) {
        return null;
    }

    const portSpan = ex - sx;
    const stub = Math.min(
        defaultPortMatchedHorizStub(routeStub),
        Math.max(14, portSpan * 0.38)
    );
    const xa = Math.min(sx, ex);
    const xb = Math.max(sx, ex);

    let crestTop: number | null = null;
    let floorBottom: number | null = null;
    for (const r of rects) {
        if (sy < r.top || sy > r.bottom) continue;
        if (xa >= r.right || xb <= r.left) continue;
        crestTop = crestTop == null ? r.top : Math.min(crestTop, r.top);
        floorBottom =
            floorBottom == null ? r.bottom : Math.max(floorBottom, r.bottom);
    }

    const cands: number[][] = [];
    const straight = [sx, sy, ex, ey];
    if (!polylineHitsObstacles(straight, rects)) {
        cands.push(straight);
    }
    if (ex > sx + stub + 12) {
        cands.push([sx, sy, ex - stub, sy, ex - stub, ey, ex, ey]);
    }

    const pushCorridor = (bypassY: number) => {
        const eastX = Math.min(sx + stub, ex - stub - 8);
        const westX = Math.max(ex - stub, eastX + 12);
        if (eastX < sx + 12 || westX < eastX + 8) return;
        cands.push([
            sx,
            sy,
            eastX,
            sy,
            eastX,
            bypassY,
            westX,
            bypassY,
            westX,
            ey,
            ex,
            ey
        ]);
    };

    const crestY = crestTop != null ? crestTop - ROUTE_OBSTACLE_PAD - 6 : null;
    const floorY =
        floorBottom != null ? floorBottom + ROUTE_OBSTACLE_PAD + 6 : null;
    if (crestY != null && crestY < sy - 6) {
        pushCorridor(crestY);
    }
    if (floorY != null && floorY > sy + 6) {
        pushCorridor(floorY);
    }

    for (const p of cands) {
        if (!polylineHitsObstacles(p, rects)) {
            mergeCollinearOrthoInPlace(p);
            return p;
        }
    }
    return null;
}

/**
 * 自下而上接终点左口：沿终点矩形 **底边以下** 拉一条水平走廊横穿（不绕到节点上方），
 * 在西侧竖直上升到 ey 再接入端口。满足「从下面绕」的走向偏好。
 */
function trySouthBypassUnderTargetOrthogonal(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    rects: RouteRect[],
    fromNode: MindMapRouteNode,
    toNode: MindMapRouteNode,
    routeStub: number,
    halfW: number,
    halfH: number
): number[] | null {
    const dy = ey - sy;
    if (dy > -28) return null;

    const toB = getNodeBounds(toNode, halfW, halfH);
    const fromB = getNodeBounds(fromNode, halfW, halfH);

    const bypassY =
        Math.max(toB.bottom, fromB.bottom) +
        ROUTE_OBSTACLE_PAD * 2 +
        Math.max(20, ROUTE_CORRIDOR_CLEAR * 0.4);

    const padX = ROUTE_OBSTACLE_PAD + 14;
    const rxEast = Math.max(
        sx + routeStub * 2,
        toB.right + padX,
        ex + routeStub
    );
    /** 南侧绕行：竖起轨应贴 **终点(to)** 左缘外，勿与 min(..., from.left) 取更左值否则会沿节点 4 左缘拉起 */
    const westHi = westRailXEastOfTargetLeft(toB.left);
    const westLo = ex - westPortHorizontalLeadCap(routeStub);
    let wxWest = westHi >= westLo ? westHi : westLo;
    if (!(wxWest + 18 < rxEast)) return null;

    const pts: number[] = [
        sx,
        sy,
        rxEast,
        sy,
        rxEast,
        bypassY,
        wxWest,
        bypassY,
        wxWest,
        ey,
        ex,
        ey
    ];
    mergeCollinearOrthoInPlace(pts);
    if (polylineHitsObstacles(pts, rects)) return null;
    return pts;
}

/**
 * 子在父下方且终点在起点左侧：先试沿起点外翻（右 stub）再垂直落到终点高度，
 * 避免 L 形竖段横穿兄弟节点矩形。
 */
function tryStemAlongStartRightThenDown(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    rects: RouteRect[],
    fromNode: MindMapRouteNode | undefined,
    forbidVerticalStart: boolean,
    nodeWidth: number,
    routeStub: number,
    halfH: number
): number[] | null {
    if (forbidVerticalStart && fromNode) {
        const by = Math.abs(sy - (fromNode.y + halfH));
        const ty = Math.abs(sy - (fromNode.y - halfH));
        if (by < 24 || ty < 24) return null;
    }
    const dx = ex - sx;
    const dy = ey - sy;
    if (dy < 42) return null;
    if (dx > -20) return null;
    if (dx < -(nodeWidth * 3)) return null;

    const halfW = nodeWidth / 2;
    const bumps = [
        routeStub + 12,
        routeStub,
        routeStub + 40,
        Math.max(48, halfW * 0.95),
        routeStub + 72,
        halfW + 58
    ];
    const tried = new Set<number>();
    for (const bump of bumps) {
        const rx = sx + bump;
        const key = Math.round(rx * 4);
        if (rx <= sx + 8 || tried.has(key)) continue;
        tried.add(key);
        const cand = [sx, sy, rx, sy, rx, ey, ex, ey];
        if (!polylineHitsObstacles(cand, rects)) return cand;
    }
    return null;
}

/**
 * 终点在起点左上方且端口横向重叠（sx > ex）：先沿起点向右外翻，竖轨取在终点矩形**东侧**，
 * 再水平接入左端口；不改变端口语义，仅替代 tryLSweep 在 sx>ex 时 midX 卡在重叠带内的问题。
 * 与 {@link tryStemAlongStartRightThenDown} 对称。
 */
function tryStemAlongStartRightThenUp(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    rects: RouteRect[],
    fromNode: MindMapRouteNode | undefined,
    toNode: MindMapRouteNode,
    forbidVerticalStart: boolean,
    nodeWidth: number,
    routeStub: number,
    halfH: number,
    halfW: number
): number[] | null {
    if (forbidVerticalStart && fromNode) {
        const by = Math.abs(sy - (fromNode.y + halfH));
        const ty = Math.abs(sy - (fromNode.y - halfH));
        if (by < 24 || ty < 24) return null;
    }
    const dx = ex - sx;
    const dy = ey - sy;
    if (dy > -42) return null;
    if (dx > -8) return null;
    if (dx < -(nodeWidth * 3)) return null;

    const halfWN = nodeWidth / 2;
    const toB = getNodeBounds(toNode, halfW, halfH);
    const fromB = fromNode
        ? getNodeBounds(fromNode, halfW, halfH)
        : { left: sx, right: sx, top: sy, bottom: sy };
    const minStemX = Math.max(fromB.right, toB.right) + ROUTE_OBSTACLE_PAD + 14;
    const minBump = Math.max(10, minStemX - sx);

    const bumps = [
        Math.max(minBump, routeStub + 12),
        Math.max(minBump, routeStub),
        Math.max(minBump, routeStub + 40),
        Math.max(minBump, Math.max(48, halfWN * 0.95)),
        Math.max(minBump, routeStub + 72),
        Math.max(minBump, halfWN + 58),
        minBump + routeStub,
        minBump + 38
    ];
    const tried = new Set<number>();
    for (const bump of bumps) {
        const rx = sx + bump;
        const key = Math.round(rx * 4);
        if (rx <= sx + 8 || tried.has(key)) continue;
        tried.add(key);
        const cand = [sx, sy, rx, sy, rx, ey, ex, ey];
        if (!polylineHitsObstacles(cand, rects)) return cand;
    }
    return null;
}

/** @see buildUpwardLeftPortObstacleCorridorPath */
function tryUpwardLeftPortMidlineObstacleBypass(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    fromB: ReturnType<typeof getNodeBounds>,
    toB: ReturnType<typeof getNodeBounds>,
    routeStub: number,
    rects: RouteRect[]
): number[] | null {
    return buildUpwardLeftPortObstacleCorridorPath(
        sx,
        sy,
        ex,
        ey,
        fromB,
        toB,
        routeStub,
        rects
    );
}

/** 竖向位移明显大于横向时，优先少折的「先横后竖 / 先竖后横 / 中轨」样板 */
function tryVerticalFlowOrthoShortcuts(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    rects: RouteRect[],
    routeStub: number
): number[] | null {
    const adx = Math.abs(ex - sx);
    const ady = Math.abs(ey - sy);
    if (ady < 52 && adx < 52) return null;
    if (adx > ady * 1.12) return null;

    const midY = sy + (ey - sy) / 2;
    const midX = sx + (ex - sx) / 2;

    const cands: number[][] = [
        [sx, sy, ex, sy, ex, ey],
        [sx, sy, midX, sy, midX, ey, ex, ey],
        [sx, sy, sx, midY, ex, midY, ex, ey]
    ];
    for (const p of cands) {
        if (!defaultPortPathHasHorizExit(p, sx, routeStub)) continue;
        if (!polylineHitsObstacles(p, rects)) return p;
    }
    return null;
}

export type GenerateObstaclePathOptions = {
    /**
     * 拖线终点为光标自由点（非目标左口）：跳过上进左口/中缝/绕顶等 raw 模板，
     * 避免把光标位置当成一整块节点盒而产生怪异折线。
     */
    freeEndPoint?: boolean;
};

export type MindMapObstacleRouterApi = {
    /** [x0,y0, x1,y1, ...] 世界坐标下的正交折线顶点序列 */
    generateObstacleAvoidancePath: (
        startX: number,
        startY: number,
        endX: number,
        endY: number,
        fromNode: MindMapRouteNode,
        toNode: MindMapRouteNode,
        options?: GenerateObstaclePathOptions
    ) => number[];
};

export type CreateMindMapObstacleRouterOptions = {
    /**
     * 拖动等高频交互：抛光阶段跳过多级网格 BFS（单次仍会做启发式与至多 1 次格网）。
     * 松手后 `getInteractionLite` 为 false 时再走完整避障。
     */
    getInteractionLite?: () => boolean;
};

/**
 * 根据节点尺寸与全图列表构造避障路由器；列表在每次调用时惰性读取，以保证画布拖拽后仍为最新外包盒。
 */
export function createMindMapObstacleRouter(
    geometry: MindMapRouteGeometry,
    getNodes: () => readonly MindMapRouteNode[],
    options?: CreateMindMapObstacleRouterOptions
): MindMapObstacleRouterApi {
    const routeStub = clampStub(geometry.width);
    const halfW = geometry.width / 2;
    const halfH = geometry.height / 2;

    type RouteSessionCache = {
        nodesRef: readonly MindMapRouteNode[];
        layoutDigest: number;
        nodeById: ReadonlyMap<number, MindMapRouteNode>;
        rectsByEdgeKey: Map<string, RouteRect[]>;
    };
    let routeSessionCache: RouteSessionCache | null = null;
    const pathResultCache = new Map<string, number[]>();

    function ensureRouteSessionCache(): RouteSessionCache {
        const nodes = getNodes();
        const layoutDigest = mindMapRouteLayoutDigest(nodes);
        if (
            routeSessionCache?.nodesRef === nodes &&
            routeSessionCache.layoutDigest === layoutDigest
        ) {
            return routeSessionCache;
        }
        pathResultCache.clear();
        routeSessionCache = {
            nodesRef: nodes,
            layoutDigest,
            nodeById: new Map(nodes.map((n) => [n.nodeId, n])),
            rectsByEdgeKey: new Map()
        };
        return routeSessionCache;
    }

    function routeNodes(): readonly MindMapRouteNode[] {
        return ensureRouteSessionCache().nodesRef;
    }

    /** 连线两端以外、且与起点同分组节点的矩形外扩，作为障碍 */
    function routeObstacleRects(
        from: MindMapRouteNode,
        to: MindMapRouteNode
    ): RouteRect[] {
        const cache = ensureRouteSessionCache();
        const key = `${from.nodeId}|${to.nodeId}`;
        let rects = cache.rectsByEdgeKey.get(key);
        if (!rects) {
            rects = buildRouteObstacleRectsForEdge(
                cache.nodesRef,
                from,
                to,
                halfW,
                halfH
            );
            cache.rectsByEdgeKey.set(key, rects);
        }
        return rects;
    }

    function buildQuickDefaultPortPath(
        sx: number,
        sy: number,
        ex: number,
        ey: number
    ): number[] {
        if (Math.abs(ey - sy) <= ROUTING_SAME_ROW_TOL && ex >= sx - 4) {
            return [sx, sy, ex, sy];
        }
        const portSpan = Math.max(0, ex - sx);
        const stub = Math.min(
            defaultPortMatchedHorizStub(routeStub),
            Math.max(14, portSpan * 0.45)
        );
        const railX = Math.max(
            sx + 14,
            Math.min(sx + stub, ex > sx + 20 ? ex - 14 : sx + stub)
        );
        return [sx, sy, railX, sy, railX, ey, ex, ey];
    }

    /** 大图：不走 buildObstacleAvoidancePathRaw / 重抛光 / 网格 BFS */
    function generateDenseObstaclePathQuick(
        sx: number,
        sy: number,
        ex: number,
        ey: number,
        fromNode: MindMapRouteNode,
        toNode: MindMapRouteNode,
        rects: RouteRect[]
    ): number[] {
        const okEndpt = (p: number[]) =>
            !polylineHitsEndpointNodeInteriors(
                p,
                fromNode,
                toNode,
                halfW,
                halfH
            );
        const ok = (p: number[]) =>
            (!rects.length || !polylineHitsObstacles(p, rects)) && okEndpt(p);

        const simple = buildQuickDefaultPortPath(sx, sy, ex, ey);
        if (ok(simple)) return simple;

        const hv = [sx, sy, ex, sy, ex, ey];
        if (ok(hv)) return hv;

        const fromB = getNodeBounds(fromNode, halfW, halfH);
        const toB = getNodeBounds(toNode, halfW, halfH);
        const corridor = corridorBelowPath(
            sx,
            sy,
            ex,
            ey,
            rects,
            routeStub,
            0,
            Math.max(fromB.bottom, toB.bottom)
        );
        if (ok(corridor)) return corridor;

        return simple;
    }

    /** 粗糙路径贴障碍时，依次尝试更简单、更可预判的替代路径 */
    function polishRouteAgainstNodes(
        rough: number[],
        sx: number,
        sy: number,
        ex: number,
        ey: number,
        fromNode: MindMapRouteNode,
        toNode: MindMapRouteNode,
        callOpts?: GenerateObstaclePathOptions
    ): number[] {
        if (callOpts?.freeEndPoint) {
            return polishFreeEndDragPreview(
                rough,
                sx,
                sy,
                ex,
                ey,
                fromNode,
                toNode
            );
        }

        ensureRouteSessionCache();
        const rects = routeObstacleRects(fromNode, toNode);
        if (rects.length > ROUTE_DENSE_OBSTACLE_FAST_PATH) {
            return cleanOrthoRoutePoints(
                generateDenseObstaclePathQuick(
                    sx,
                    sy,
                    ex,
                    ey,
                    fromNode,
                    toNode,
                    rects
                )
            );
        }
        const fromBc0 = getNodeBounds(fromNode, halfW, halfH);
        const toBc0 = getNodeBounds(toNode, halfW, halfH);
        const defaultPortUp = defaultPortUpwardLeftEntry(
            fromNode,
            sx,
            sy,
            ex,
            ey,
            fromBc0,
            toBc0,
            routeStub
        );
        const defaultPortDown = defaultPortDownwardLeftEntry(
            fromNode,
            sx,
            sy,
            ex,
            ey,
            fromBc0,
            toBc0,
            routeStub
        );
        const defaultPortLeftEntry = defaultPortUp || defaultPortDown;
        const horizBoxGapPolish = toBc0.left - fromBc0.right;
        const portSpanPolish = ex - sx;
        const closeHorizPair =
            defaultPortLeftEntry &&
            ((defaultPortUp &&
                ey < sy - 6 &&
                isCloseDefaultPortHorizGap(
                    horizBoxGapPolish,
                    portSpanPolish
                )) ||
                (defaultPortDown &&
                    ey > sy + 6 &&
                    isCloseDefaultPortHorizGap(
                        horizBoxGapPolish,
                        portSpanPolish
                    )));
        const horizEndpointExtra = closeHorizPair
            ? ROUTE_MULTI_FANOUT_CLOSE_HORIZ_OBSTACLE_EXTRA
            : 0;

        const lrPortPathOk = (path: number[]): boolean =>
            defaultPortHorizEndpointsOk(path, sx, sy, ex, ey, routeStub) ||
            (ex > sx + 12 &&
                upwardLeftPortEndpointsOk(path, sx, sy, ex, ey, routeStub));

        const routeAcceptable = (path: number[]): boolean => {
            if (!lrPortPathOk(path)) return false;
            const closeFanCorridor =
                closeHorizPair &&
                (isMultiFanoutWestJogCorridorPath(path, sx, sy, ex, ey) ||
                    isMultiFanoutEastRailStemPath(path, sx, sy, ex, ey));
            const endpointExtra =
                horizEndpointExtra > 0 && closeFanCorridor
                    ? 0
                    : horizEndpointExtra;
            if (
                polylineHitsEndpointNodeInteriors(
                    path,
                    fromNode,
                    toNode,
                    halfW,
                    halfH,
                    endpointExtra
                )
            ) {
                return false;
            }
            return !rects.length || !polylineHitsObstacles(path, rects);
        };

        const lastResortUpwardCorridor = (): number[] | null => {
            if (ex <= sx + 12) return null;
            return buildUpwardLeftPortObstacleCorridorPath(
                sx,
                sy,
                ex,
                ey,
                fromBc0,
                toBc0,
                routeStub,
                rects
            );
        };

        const returnRoughWithLastResort = (): number[] => {
            const last = lastResortUpwardCorridor();
            if (last && routeAcceptable(last)) return last;
            return rough;
        };

        let waistMergerPath: number[] | null = null;
        const session = ensureRouteSessionCache();
        const waistBuddy =
            rects.length && ex > sx + 12
                ? findLeftWaistBuddyForMerge(
                      toNode,
                      fromNode.nodeId,
                      session.nodesRef,
                      halfW,
                      geometry.height,
                      session.nodeById
                  )
                : null;
        if (waistBuddy) {
            const waistBand = Math.max(geometry.height * 0.62, 88);
            const isLeftWaistContinuation =
                fromNode.x < toNode.x - INBOUND_WEST_SPINE_EPS_ROUTE &&
                Math.abs(fromNode.y - toNode.y) <= waistBand;
            if (!isLeftWaistContinuation) {
                const buddyR = waistBuddy.x + halfW;
                const toLeft = toNode.x - halfW;
                const spineJoinX =
                    toLeft > buddyR + 10 ? (buddyR + toLeft) / 2 : undefined;
                waistMergerPath = tryWaistMergeHorizFirstOrthogonal(
                    sx,
                    sy,
                    ex,
                    ey,
                    rects,
                    spineJoinX != null ? { spineJoinX } : undefined
                );
            }
        }

        if (
            rects.length &&
            polylineHitsObstacles(rough, rects) &&
            defaultPortLeftEntry &&
            ex > sx + 12
        ) {
            if (
                (fromNode.nextNodes?.length ?? 0) >= 2 &&
                isSiblingRowCorridorHorizSpan(sx, ex)
            ) {
                const floorEarly = buildSiblingRowCorridorToLeftPort(
                    sx,
                    sy,
                    ex,
                    ey,
                    fromBc0,
                    toBc0,
                    routeStub,
                    rects
                );
                if (floorEarly && routeAcceptable(floorEarly)) {
                    return floorEarly;
                }
            }
            if (ey < sy - 8) {
                const uplEarly = tryUpwardLeftPortMidlineObstacleBypass(
                    sx,
                    sy,
                    ex,
                    ey,
                    fromBc0,
                    toBc0,
                    routeStub,
                    rects
                );
                if (uplEarly && routeAcceptable(uplEarly)) return uplEarly;
            }
        }

        /** 无障碍或粗稿已不贴外节点时，仍需避开 from/to 本体；否则继续完整抛光 */
        if (!rects.length || !polylineHitsObstacles(rough, rects)) {
            if (waistMergerPath && routeAcceptable(waistMergerPath)) {
                return waistMergerPath;
            }
            if (routeAcceptable(rough)) {
                return rough;
            }
        }

        if (waistMergerPath && routeAcceptable(waistMergerPath)) {
            return waistMergerPath;
        }

        const orthoHVH = tryOrthoHVOrVHPreferEndpointSafe(
            sx,
            sy,
            ex,
            ey,
            rects,
            fromNode,
            toNode,
            halfW,
            halfH,
            routeStub
        );
        if (orthoHVH && routeAcceptable(orthoHVH)) return orthoHVH;

        const denseObstacles = rects.length > ROUTE_DENSE_OBSTACLE_FAST_PATH;
        if (denseObstacles) {
            if (Math.abs(ey - sy) <= ROUTING_SAME_ROW_TOL) {
                const compactDense = tryCompactSameRowOrthogonal(
                    sx,
                    sy,
                    ex,
                    ey,
                    rects,
                    routeStub
                );
                if (compactDense && routeAcceptable(compactDense)) {
                    return compactDense;
                }
            }
            const fromBcDense = getNodeBounds(fromNode, halfW, halfH);
            const toBcDense = getNodeBounds(toNode, halfW, halfH);
            const corridorDense = corridorBelowPath(
                sx,
                sy,
                ex,
                ey,
                rects,
                routeStub,
                0,
                Math.max(fromBcDense.bottom, toBcDense.bottom)
            );
            if (routeAcceptable(corridorDense)) return corridorDense;
            const gridDense = tryGridRouteWithBoostSteps(
                sx,
                sy,
                ex,
                ey,
                rects,
                gridBoostStepsForObstacleCount(rects.length),
                routeAcceptable
            );
            if (gridDense) return gridDense;
            if (routeAcceptable(rough)) return rough;
            return returnRoughWithLastResort();
        }

        if ((fromNode.nextNodes?.length ?? 0) >= 2 && ex > sx + 12) {
            if (ey > sy + 8) {
                const fanStemDown = tryMultiFanoutDownwardStemToLeftPort(
                    sx,
                    sy,
                    ex,
                    ey,
                    fromNode,
                    toNode,
                    routeNodes(),
                    halfW,
                    halfH
                );
                if (fanStemDown && routeAcceptable(fanStemDown)) {
                    return fanStemDown;
                }
            }
        }

        if (Math.abs(ey - sy) <= ROUTING_SAME_ROW_TOL) {
            const compactEarly = tryCompactSameRowOrthogonal(
                sx,
                sy,
                ex,
                ey,
                rects,
                routeStub
            );
            if (compactEarly && routeAcceptable(compactEarly)) {
                return compactEarly;
            }
        }

        if (defaultPortLeftEntry && Math.abs(ey - sy) > 28) {
            const portSpanPolishInter = ex - sx;
            const horizGapPolishInter =
                getNodeBounds(toNode, halfW, halfH).left -
                getNodeBounds(fromNode, halfW, halfH).right;
            const tightPolish = isCloseDefaultPortHorizGap(
                horizGapPolishInter,
                portSpanPolishInter
            );
            const fromBPolish = getNodeBounds(fromNode, halfW, halfH);
            const southSiblingPolish = isMultiFanoutSouthSibling(
                fromNode,
                toNode
            );
            const southStackBypassPolish = preferSouthBypassForVerticalStack(
                fromNode,
                toNode,
                ex,
                fromBPolish
            );
            const southStemFirstPolish =
                preferMultiFanoutStemBeforeSouthCorridor(
                    sx,
                    ex,
                    fromNode,
                    fromBPolish
                );
            const northStackOverTopPolish = preferNorthOverTopForVerticalStack(
                fromNode,
                toNode,
                ex,
                fromBPolish
            );
            if (ey > sy + 8 && southStemFirstPolish) {
                const stemRightPolish = tryEastRailStemUnlessObstructed(
                    sx,
                    sy,
                    ex,
                    ey,
                    fromNode,
                    toNode,
                    routeNodes(),
                    halfW,
                    halfH,
                    routeStub,
                    rects,
                    horizEndpointExtra
                );
                if (stemRightPolish && routeAcceptable(stemRightPolish)) {
                    return stemRightPolish;
                }
            }
            if (
                ey > sy + 8 &&
                ex > sx + 12 &&
                southSiblingPolish &&
                !southStackBypassPolish &&
                !southStemFirstPolish
            ) {
                const interSouthPolish = trySouthInterRowCorridorOrthogonal(
                    sx,
                    sy,
                    ex,
                    ey,
                    rects,
                    fromNode,
                    toNode,
                    routeNodes(),
                    routeStub,
                    halfW,
                    halfH
                );
                if (interSouthPolish && routeAcceptable(interSouthPolish)) {
                    return interSouthPolish;
                }
            }
            const stemPolish = tryEastRailStemUnlessObstructed(
                sx,
                sy,
                ex,
                ey,
                fromNode,
                toNode,
                routeNodes(),
                halfW,
                halfH,
                routeStub,
                rects,
                horizEndpointExtra
            );
            if (
                stemPolish &&
                routeAcceptable(stemPolish) &&
                !southSiblingPolish &&
                !southStackBypassPolish &&
                !southStemFirstPolish
            ) {
                return stemPolish;
            }
            if (ey < sy - 8 && ex > sx + 12 && !northStackOverTopPolish) {
                const interNorthPolish = tryNorthInterRowCorridorOrthogonal(
                    sx,
                    sy,
                    ex,
                    ey,
                    rects,
                    fromNode,
                    toNode,
                    routeNodes(),
                    routeStub,
                    halfW,
                    halfH
                );
                if (interNorthPolish && routeAcceptable(interNorthPolish)) {
                    return interNorthPolish;
                }
            }
            if (
                ey > sy + 8 &&
                ex > sx + 12 &&
                !southSiblingPolish &&
                !southStackBypassPolish &&
                !southStemFirstPolish
            ) {
                const interSouthPolish = trySouthInterRowCorridorOrthogonal(
                    sx,
                    sy,
                    ex,
                    ey,
                    rects,
                    fromNode,
                    toNode,
                    routeNodes(),
                    routeStub,
                    halfW,
                    halfH
                );
                if (interSouthPolish && routeAcceptable(interSouthPolish)) {
                    return interSouthPolish;
                }
            }
            if (stemPolish && routeAcceptable(stemPolish)) {
                return stemPolish;
            }
            if (
                (fromNode.nextNodes?.length ?? 0) >= 2 &&
                ex > sx + 12 &&
                (ey < sy - 8 || ey > sy + 8)
            ) {
                const stemPolish = tryMultiFanoutSimpleStemToLeftPort(
                    sx,
                    sy,
                    ex,
                    ey,
                    fromNode,
                    toNode,
                    routeNodes(),
                    halfW,
                    halfH,
                    routeStub
                );
                if (stemPolish && routeAcceptable(stemPolish)) {
                    return stemPolish;
                }
            }
            if (
                !tightPolish &&
                portSpanPolishInter > ROUTE_MULTI_FANOUT_CLOSE_HORIZ_GAP + 8
            ) {
                const interRow = tryInterRowCorridorBypassOrthogonal(
                    sx,
                    sy,
                    ex,
                    ey,
                    rects,
                    fromNode,
                    toNode,
                    routeNodes(),
                    routeStub,
                    halfW,
                    halfH
                );
                if (interRow && routeAcceptable(interRow)) return interRow;
            }
        }

        if (!defaultPortUp) {
            const southBypass = trySouthBypassUnderTargetOrthogonal(
                sx,
                sy,
                ex,
                ey,
                rects,
                fromNode,
                toNode,
                routeStub,
                halfW,
                halfH
            );
            if (southBypass && routeAcceptable(southBypass)) return southBypass;
        }

        const stemUp = tryStemAlongStartRightThenUp(
            sx,
            sy,
            ex,
            ey,
            rects,
            fromNode,
            toNode,
            true,
            geometry.width,
            routeStub,
            halfH,
            halfW
        );
        if (stemUp && routeAcceptable(stemUp)) return stemUp;

        if (!closeHorizPair) {
            const vshort = tryVerticalFlowOrthoShortcuts(
                sx,
                sy,
                ex,
                ey,
                rects,
                routeStub
            );
            if (vshort && routeAcceptable(vshort)) return vshort;
        }
        const stem = tryStemAlongStartRightThenDown(
            sx,
            sy,
            ex,
            ey,
            rects,
            fromNode,
            true,
            geometry.width,
            routeStub,
            halfH
        );
        if (stem && routeAcceptable(stem)) return stem;
        const compact = tryCompactSameRowOrthogonal(
            sx,
            sy,
            ex,
            ey,
            rects,
            routeStub
        );
        if (compact && routeAcceptable(compact)) return compact;
        const stripe = routingStripeDx(
            fromNode.nodeId,
            toNode.nodeId,
            routeStub
        );
        const ls = tryLSweepAgainstObstacles(sx, sy, ex, ey, rects, stripe);
        if (ls && routeAcceptable(ls)) return ls;
        const fromBc = getNodeBounds(fromNode, halfW, halfH);
        const toBc = getNodeBounds(toNode, halfW, halfH);
        const corridorEndpointBottomMax = Math.max(fromBc.bottom, toBc.bottom);
        const skipSouthFloorCorridor =
            defaultPortLeftEntry && Math.abs(ey - sy) > 28;
        for (
            let extra = 0;
            !skipSouthFloorCorridor && extra <= 72;
            extra += 24
        ) {
            const corridor = corridorBelowPath(
                sx,
                sy,
                ex,
                ey,
                rects,
                routeStub,
                extra,
                corridorEndpointBottomMax
            );
            if (routeAcceptable(corridor)) return corridor;
        }
        if (options?.getInteractionLite?.()) {
            if (Math.abs(ey - sy) <= ROUTING_SAME_ROW_TOL) {
                const compactLite = tryCompactSameRowOrthogonal(
                    sx,
                    sy,
                    ex,
                    ey,
                    rects,
                    routeStub
                );
                if (compactLite && routeAcceptable(compactLite)) {
                    return compactLite;
                }
            }
            if (routeAcceptable(rough)) return rough;
            const gridLite = tryGridManhattanOrthogonalRoute(
                sx,
                sy,
                ex,
                ey,
                rects,
                0
            );
            if (gridLite && gridLite.length >= 4 && routeAcceptable(gridLite)) {
                return gridLite;
            }
            return rough;
        }
        const gridPolished = tryGridRouteWithBoostSteps(
            sx,
            sy,
            ex,
            ey,
            rects,
            gridBoostStepsForObstacleCount(rects.length),
            routeAcceptable
        );
        if (gridPolished) return gridPolished;
        if (routeAcceptable(rough)) return rough;
        if (lrPortPathOk(rough) && routeAcceptable(rough)) return rough;
        if (defaultPortLeftEntry && ey < sy - 8 && ex > sx + 12) {
            const uplBypass = tryUpwardLeftPortMidlineObstacleBypass(
                sx,
                sy,
                ex,
                ey,
                fromBc0,
                toBc0,
                routeStub,
                rects
            );
            if (uplBypass && routeAcceptable(uplBypass)) return uplBypass;
        }
        const lrCorridor = lrSidePortEastRailCorridorPath(
            sx,
            sy,
            ex,
            ey,
            fromBc0,
            toBc0,
            routeStub
        );
        if (routeAcceptable(lrCorridor)) return lrCorridor;
        if ((fromNode.nextNodes?.length ?? 0) >= 2 && ex > sx + 12) {
            if (ey > sy + 8) {
                const fanStemLateDown = tryMultiFanoutDownwardStemToLeftPort(
                    sx,
                    sy,
                    ex,
                    ey,
                    fromNode,
                    toNode,
                    routeNodes(),
                    halfW,
                    halfH
                );
                if (fanStemLateDown && routeAcceptable(fanStemLateDown)) {
                    return fanStemLateDown;
                }
            }
            if (ey < sy - 8) {
                const fanStemLateUp = tryMultiFanoutSimpleStemToLeftPort(
                    sx,
                    sy,
                    ex,
                    ey,
                    fromNode,
                    toNode,
                    routeNodes(),
                    halfW,
                    halfH,
                    routeStub
                );
                if (fanStemLateUp && routeAcceptable(fanStemLateUp)) {
                    return fanStemLateUp;
                }
            }
        }
        if (lrPortPathOk(rough) && routeAcceptable(rough)) return rough;
        return returnRoughWithLastResort();
    }

    /**
     * 拖线跟光标：简单正交折线 + 障碍检测，不套用默认右口→左口/中缝模板。
     */
    function buildFreeEndDragPreviewRaw(
        startX: number,
        startY: number,
        endX: number,
        endY: number,
        fromNode: MindMapRouteNode,
        toNode: MindMapRouteNode
    ): number[] {
        const rects = routeObstacleRects(fromNode, toNode);
        const span = Math.max(Math.abs(endX - startX), 24);
        const kick = Math.min(routeStub, Math.max(14, span * 0.38));
        const midX = startX + (endX - startX) * 0.5;
        const cands: number[][] = [
            [startX, startY, endX, startY, endX, endY],
            [startX, startY, startX, endY, endX, endY]
        ];
        if (endX > startX + kick + 8) {
            cands.push([
                startX,
                startY,
                startX + kick,
                startY,
                startX + kick,
                endY,
                endX,
                endY
            ]);
        }
        if (Math.abs(endX - startX) > kick * 2.5) {
            cands.push([startX, startY, midX, startY, midX, endY, endX, endY]);
        }
        for (const p of cands) {
            if (!polylineHitsObstacles(p, rects)) return p;
        }
        return cands[0]!;
    }

    /** 拖线自由终点：轻量抛光，不走多扇出中缝/腰轨等重型分支 */
    function polishFreeEndDragPreview(
        rough: number[],
        sx: number,
        sy: number,
        ex: number,
        ey: number,
        fromNode: MindMapRouteNode,
        toNode: MindMapRouteNode
    ): number[] {
        const rects = routeObstacleRects(fromNode, toNode);
        const okEndpt = (p: number[]) =>
            !polylineHitsEndpointNodeInteriors(
                p,
                fromNode,
                toNode,
                halfW,
                halfH
            );
        if (!polylineHitsObstacles(rough, rects) && okEndpt(rough)) {
            return rough;
        }
        const hv = tryOrthoHVOrVHPreferEndpointSafe(
            sx,
            sy,
            ex,
            ey,
            rects,
            fromNode,
            toNode,
            halfW,
            halfH,
            routeStub
        );
        if (hv && !polylineHitsObstacles(hv, rects) && okEndpt(hv)) {
            return hv;
        }
        const grid = tryGridManhattanOrthogonalRoute(sx, sy, ex, ey, rects, 0);
        if (
            grid &&
            grid.length >= 4 &&
            !polylineHitsObstacles(grid, rects) &&
            okEndpt(grid)
        ) {
            return grid;
        }
        return rough;
    }

    /** 不含避障的初稿：按左右/上下关系选 L 形或外翻 bypass */
    function buildObstacleAvoidancePathRaw(
        startX: number,
        startY: number,
        endX: number,
        endY: number,
        fromNode: MindMapRouteNode,
        toNode: MindMapRouteNode,
        callOpts?: GenerateObstaclePathOptions
    ): number[] {
        if (callOpts?.freeEndPoint) {
            return buildFreeEndDragPreviewRaw(
                startX,
                startY,
                endX,
                endY,
                fromNode,
                toNode
            );
        }

        let fromBounds = getNodeBounds(fromNode, halfW, halfH);
        let toBounds = getNodeBounds(toNode, halfW, halfH);

        const dx = endX - startX;
        const dy = endY - startY;

        const bypassOffset = Math.abs(dy) < ROUTING_SAME_ROW_TOL ? 20 : 30;

        const waistSpineEastRail = waistSpineFanoutEastRailOmitsFromRight(
            fromNode,
            startX,
            startY,
            endX,
            endY,
            fromBounds,
            toBounds,
            routeStub
        );
        const defaultPortUpLeft = defaultPortUpwardLeftEntry(
            fromNode,
            startX,
            startY,
            endX,
            endY,
            fromBounds,
            toBounds,
            routeStub
        );
        const defaultPortDownLeft = defaultPortDownwardLeftEntry(
            fromNode,
            startX,
            startY,
            endX,
            endY,
            fromBounds,
            toBounds,
            routeStub
        );
        const horizBoxGapRaw = toBounds.left - fromBounds.right;
        const portSpanRaw = endX - startX;
        const closeHorizPairUp =
            defaultPortUpLeft &&
            dy < 0 &&
            isCloseDefaultPortHorizGap(horizBoxGapRaw, portSpanRaw);
        const closeHorizPairDown =
            defaultPortDownLeft &&
            dy > 0 &&
            isCloseDefaultPortHorizGap(horizBoxGapRaw, portSpanRaw);
        const closeHorizPair = closeHorizPairUp || closeHorizPairDown;
        if (closeHorizPair) {
            fromBounds = expandRouteRectHorizOnly(
                fromBounds,
                ROUTE_MULTI_FANOUT_CLOSE_HORIZ_OBSTACLE_EXTRA
            );
            toBounds = expandRouteRectHorizOnly(
                toBounds,
                ROUTE_MULTI_FANOUT_CLOSE_HORIZ_OBSTACLE_EXTRA
            );
        }
        /** 自下而上绕顶：顶廊高度须大于 endpoint 扩垫，否则水平段仍判穿 to；竖轨须在目标左缘外下落，避免 endX−stub 落在盒宽内贯穿节点 */
        /** 绕顶顶廊：两盒顶缘之上横穿，东竖轨贴终点(to)右缘（竖排多扇出北向子节点） */
        const rawNorthOverTopCrestOnly = (
            startX: number,
            startY: number,
            endX: number,
            endY: number,
            fromB: ReturnType<typeof getNodeBounds>,
            toB: ReturnType<typeof getNodeBounds>,
            off: number
        ): number[] => {
            const endpointPad =
                ROUTE_OBSTACLE_PAD + Math.max(10, halfW * 0.1, halfH * 0.1);
            const crestPad = Math.max(
                off,
                ROUTE_CORRIDOR_CLEAR,
                endpointPad + ROUTE_OBSTACLE_PAD + 6
            );
            const crestY = Math.min(fromB.top, toB.top) - crestPad;
            let railX =
                (fromNode.nextNodes?.length ?? 0) >= 2
                    ? resolveFanoutDepartEastRailX(
                          startX,
                          startY,
                          endX,
                          endY,
                          fromB,
                          toB,
                          fromNode,
                          toNode,
                          routeNodes(),
                          halfW,
                          halfH,
                          'to'
                      )
                    : interRowEastRailX(startX, fromB, toB, 'to');
            const portKick = Math.min(
                defaultPortMatchedHorizStub(routeStub) * 0.42,
                Math.max(12, routeStub * 0.55)
            );
            railX = Math.max(railX, startX + portKick);
            const { westX, spineX, entryX } = leftPortBypassIngressCoords(
                toB,
                endX,
                routeStub
            );
            const pts: number[] = [
                startX,
                startY,
                railX,
                startY,
                railX,
                crestY,
                westX,
                crestY
            ];
            if (Math.abs(spineX - westX) > 4) {
                pts.push(spineX, crestY);
            }
            pts.push(spineX, endY, entryX, endY, endX, endY);
            return cleanOrthoRoutePoints(pts);
        };

        const rawNorthOverTopEastRailWestDrop = (
            startX: number,
            startY: number,
            endX: number,
            endY: number,
            fromB: ReturnType<typeof getNodeBounds>,
            toB: ReturnType<typeof getNodeBounds>,
            off: number
        ): number[] => {
            const gapLo = toB.bottom + ROUTE_OBSTACLE_PAD + 12;
            const gapHi = fromB.top - ROUTE_OBSTACLE_PAD - 10;
            if (gapHi > gapLo + 8) {
                let bypassY = gapLo + ROUTE_CORRIDOR_CLEAR * 0.38;
                bypassY = Math.min(Math.max(bypassY, gapLo + 4), gapHi - 4);
                const interOver = buildVerticalFirstInterRowCorridorPath(
                    startX,
                    startY,
                    endX,
                    endY,
                    bypassY,
                    fromB,
                    toB,
                    routeStub,
                    'from',
                    {
                        from: fromNode,
                        to: toNode,
                        nodes: routeNodes(),
                        halfW,
                        halfH
                    }
                );
                if (interOver) return interOver;
            }
            return rawNorthOverTopCrestOnly(
                startX,
                startY,
                endX,
                endY,
                fromB,
                toB,
                off
            );
        };

        /** 自上而下：优先在「起点盒底缘之下、目标顶缘之上」的缝里横穿（3→8 中缝），再走西侧竖起接左口 */
        const rawInterGapFromBottomToTopEastRailWestDrop = (
            startX: number,
            startY: number,
            endX: number,
            endY: number,
            fromB: ReturnType<typeof getNodeBounds>,
            toB: ReturnType<typeof getNodeBounds>,
            off: number
        ): number[] | null => {
            if (isSameColumnPortEdge(startX, endX)) {
                return rawSouthBypassBothEastRailWestRise(
                    startX,
                    startY,
                    endX,
                    endY,
                    fromB,
                    toB,
                    off
                );
            }

            const rectsSouth = routeObstacleRects(fromNode, toNode);
            const corridorFirst =
                isMultiFanoutSouthSibling(fromNode, toNode) &&
                !preferMultiFanoutStemBeforeSouthCorridor(
                    startX,
                    endX,
                    fromNode,
                    fromB
                );
            const tryStemSouth = () =>
                tryEastRailStemUnlessObstructed(
                    startX,
                    startY,
                    endX,
                    endY,
                    fromNode,
                    toNode,
                    routeNodes(),
                    halfW,
                    halfH,
                    routeStub,
                    rectsSouth
                );
            const corridorFloor =
                fromB.bottom +
                Math.max(
                    ROUTE_OBSTACLE_PAD + 12,
                    off * 0.35 + ROUTE_OBSTACLE_PAD + 4
                );
            const gapCeiling = toB.top - ROUTE_OBSTACLE_PAD - 10;
            const multiFanoutGap = (fromNode.nextNodes?.length ?? 0) >= 2;
            const sibCtx = {
                from: fromNode,
                to: toNode,
                nodes: routeNodes(),
                halfW,
                halfH
            };
            const trySouthInterRowVf = (): number[] | null => {
                if (gapCeiling <= corridorFloor + 6) {
                    if (!multiFanoutGap) return null;
                    const bypassTight =
                        corridorFloor + ROUTE_CORRIDOR_CLEAR * 0.38;
                    return buildVerticalFirstInterRowCorridorPath(
                        startX,
                        startY,
                        endX,
                        endY,
                        bypassTight,
                        fromB,
                        toB,
                        routeStub,
                        'from',
                        sibCtx
                    );
                }
                let bypassY = fanoutSharedCorridorBypassY(
                    startY,
                    corridorFloor,
                    gapCeiling,
                    fromNode,
                    endY,
                    routeNodes(),
                    halfW,
                    halfH
                );
                if (bypassY == null) {
                    bypassY = corridorFloor + ROUTE_CORRIDOR_CLEAR * 0.38;
                    bypassY = Math.min(bypassY, gapCeiling);
                    bypassY = Math.max(bypassY, corridorFloor);
                }
                const vf = buildVerticalFirstInterRowCorridorPath(
                    startX,
                    startY,
                    endX,
                    endY,
                    bypassY,
                    fromB,
                    toB,
                    routeStub,
                    'from',
                    sibCtx
                );
                if (vf) return vf;
                const bypassMid = (corridorFloor + gapCeiling) / 2;
                return buildVerticalFirstInterRowCorridorPath(
                    startX,
                    startY,
                    endX,
                    endY,
                    bypassMid,
                    fromB,
                    toB,
                    routeStub,
                    'from',
                    sibCtx
                );
            };
            if (
                preferMultiFanoutStemBeforeSouthCorridor(
                    startX,
                    endX,
                    fromNode,
                    fromB
                )
            ) {
                const stemFirst = tryStemSouth();
                if (stemFirst) return stemFirst;
            }
            if (corridorFirst) {
                const corridor = trySouthInterRowVf();
                if (corridor) return corridor;
            } else {
                const stemEarly = tryStemSouth();
                if (stemEarly) return stemEarly;
            }
            const corridorLate = trySouthInterRowVf();
            if (corridorLate) return corridorLate;
            const stemLate = tryStemSouth();
            if (stemLate) return stemLate;
            return null;
        };

        /** 自上而下绕底：两盒底缘之下横穿；东竖轨贴终点(to)右缘（与绕顶对称） */
        const rawSouthBypassBothEastRailWestRise = (
            startX: number,
            startY: number,
            endX: number,
            endY: number,
            fromB: ReturnType<typeof getNodeBounds>,
            toB: ReturnType<typeof getNodeBounds>,
            off: number
        ): number[] => {
            const endpointPad =
                ROUTE_OBSTACLE_PAD + Math.max(10, halfW * 0.1, halfH * 0.1);
            const floorPad = Math.max(
                off,
                ROUTE_CORRIDOR_CLEAR,
                endpointPad + ROUTE_OBSTACLE_PAD + 6
            );
            const floorY = Math.max(fromB.bottom, toB.bottom) + floorPad;
            let railX =
                (fromNode.nextNodes?.length ?? 0) >= 2
                    ? resolveFanoutDepartEastRailX(
                          startX,
                          startY,
                          endX,
                          endY,
                          fromB,
                          toB,
                          fromNode,
                          toNode,
                          routeNodes(),
                          halfW,
                          halfH,
                          'to'
                      )
                    : interRowEastRailX(startX, fromB, toB, 'to');
            const portKick = Math.min(
                defaultPortMatchedHorizStub(routeStub) * 0.42,
                Math.max(12, routeStub * 0.55)
            );
            railX = Math.max(railX, startX + portKick);
            const { westX, spineX, entryX } = leftPortBypassIngressCoords(
                toB,
                endX,
                routeStub
            );
            const pts: number[] = [
                startX,
                startY,
                railX,
                startY,
                railX,
                floorY,
                westX,
                floorY
            ];
            if (Math.abs(spineX - westX) > 4) {
                pts.push(spineX, floorY);
            }
            pts.push(spineX, endY, entryX, endY, endX, endY);
            return cleanOrthoRoutePoints(pts);
        };

        /** 北向中缝：目标底 ~ 起点顶 行缝，东竖轨贴节点 0 右口 sx */
        const rawNorthInterRowBetweenFromAndTo = (
            startX: number,
            startY: number,
            endX: number,
            endY: number,
            fromB: ReturnType<typeof getNodeBounds>,
            toB: ReturnType<typeof getNodeBounds>
        ): number[] | null => {
            const rectsNorth = routeObstacleRects(fromNode, toNode);
            const stemNorth = tryEastRailStemUnlessObstructed(
                startX,
                startY,
                endX,
                endY,
                fromNode,
                toNode,
                routeNodes(),
                halfW,
                halfH,
                routeStub,
                rectsNorth
            );
            if (stemNorth) return stemNorth;
            const yMin = toB.bottom + ROUTE_OBSTACLE_PAD + 12;
            const yMax = fromB.top - ROUTE_OBSTACLE_PAD - 10;
            if (yMax <= yMin + 6) return null;
            let bypassY = fanoutSharedCorridorBypassY(
                startY,
                yMin,
                yMax,
                fromNode,
                endY,
                routeNodes(),
                halfW,
                halfH
            );
            if (bypassY == null) {
                bypassY = yMin + ROUTE_CORRIDOR_CLEAR * 0.38;
                bypassY = Math.min(Math.max(bypassY, yMin + 4), yMax - 4);
                if (bypassY >= startY - 6) return null;
            }
            return buildVerticalFirstInterRowCorridorPath(
                startX,
                startY,
                endX,
                endY,
                bypassY,
                fromB,
                toB,
                routeStub,
                'from',
                {
                    from: fromNode,
                    to: toNode,
                    nodes: routeNodes(),
                    halfW,
                    halfH
                }
            );
        };

        /** 自下而上：优先在「目标底缘之下、起点盒顶缘之上」的缝里横穿（节点 6 下方），再走西侧竖起接左口；无缝则返回 null 改走绕顶 */
        const rawSouthBelowTargetEastRailWestRise = (
            startX: number,
            startY: number,
            endX: number,
            endY: number,
            fromB: ReturnType<typeof getNodeBounds>,
            toB: ReturnType<typeof getNodeBounds>,
            off: number
        ): number[] | null => {
            const southFloor =
                toB.bottom +
                Math.max(
                    ROUTE_OBSTACLE_PAD + 12,
                    off * 0.35 + ROUTE_OBSTACLE_PAD + 4
                );
            const gapCeiling = fromB.top - ROUTE_OBSTACLE_PAD - 10;
            if (gapCeiling <= southFloor + 6) {
                return null;
            }
            let bypassY = southFloor + ROUTE_CORRIDOR_CLEAR * 0.38;
            bypassY = Math.min(bypassY, gapCeiling);
            bypassY = Math.max(bypassY, southFloor);

            const vf = buildVerticalFirstInterRowCorridorPath(
                startX,
                startY,
                endX,
                endY,
                bypassY,
                fromB,
                toB,
                routeStub,
                'from',
                {
                    from: fromNode,
                    to: toNode,
                    nodes: routeNodes(),
                    halfW,
                    halfH
                }
            );
            return vf;
        };

        const rawSouthOrNorthDyNegative = (
            startX: number,
            startY: number,
            endX: number,
            endY: number,
            fromB: ReturnType<typeof getNodeBounds>,
            toB: ReturnType<typeof getNodeBounds>,
            off: number
        ): number[] => {
            if (
                isSameColumnPortEdge(startX, endX) ||
                preferNorthOverTopForVerticalStack(
                    fromNode,
                    toNode,
                    endX,
                    fromB
                )
            ) {
                return rawNorthOverTopCrestOnly(
                    startX,
                    startY,
                    endX,
                    endY,
                    fromB,
                    toB,
                    off
                );
            }
            const interNorth = rawNorthInterRowBetweenFromAndTo(
                startX,
                startY,
                endX,
                endY,
                fromB,
                toB
            );
            if (interNorth) return interNorth;
            const south = rawSouthBelowTargetEastRailWestRise(
                startX,
                startY,
                endX,
                endY,
                fromB,
                toB,
                off
            );
            if (south) {
                return south;
            }
            return rawNorthOverTopEastRailWestDrop(
                startX,
                startY,
                endX,
                endY,
                fromB,
                toB,
                off
            );
        };

        const rawSouthOrNorthDyPositive = (
            startX: number,
            startY: number,
            endX: number,
            endY: number,
            fromB: ReturnType<typeof getNodeBounds>,
            toB: ReturnType<typeof getNodeBounds>,
            off: number
        ): number[] => {
            if (isSameColumnPortEdge(startX, endX)) {
                return rawSouthBypassBothEastRailWestRise(
                    startX,
                    startY,
                    endX,
                    endY,
                    fromB,
                    toB,
                    off
                );
            }

            if (
                preferMultiFanoutStemBeforeSouthCorridor(
                    startX,
                    endX,
                    fromNode,
                    fromB
                )
            ) {
                const rectsStem = routeObstacleRects(fromNode, toNode);
                const stemFirst = tryEastRailStemUnlessObstructed(
                    startX,
                    startY,
                    endX,
                    endY,
                    fromNode,
                    toNode,
                    routeNodes(),
                    halfW,
                    halfH,
                    routeStub,
                    rectsStem
                );
                if (stemFirst) return stemFirst;
            }

            if (
                preferSouthBypassForVerticalStack(fromNode, toNode, endX, fromB)
            ) {
                return rawSouthBypassBothEastRailWestRise(
                    startX,
                    startY,
                    endX,
                    endY,
                    fromB,
                    toB,
                    off
                );
            }
            const interSouth = rawInterGapFromBottomToTopEastRailWestDrop(
                startX,
                startY,
                endX,
                endY,
                fromB,
                toB,
                off
            );
            if (interSouth) {
                return interSouth;
            }
            const gapFloor = fromB.bottom + ROUTE_OBSTACLE_PAD + 12;
            const gapTop = toB.top - ROUTE_OBSTACLE_PAD - 10;
            if (gapTop > gapFloor + 6) {
                const sibCtx = {
                    from: fromNode,
                    to: toNode,
                    nodes: routeNodes(),
                    halfW,
                    halfH
                };
                const midGap = (gapFloor + gapTop) / 2;
                const lastGap = buildVerticalFirstInterRowCorridorPath(
                    startX,
                    startY,
                    endX,
                    endY,
                    midGap,
                    fromB,
                    toB,
                    routeStub,
                    'from',
                    sibCtx
                );
                if (lastGap) return lastGap;
            }
            return rawSouthBypassBothEastRailWestRise(
                startX,
                startY,
                endX,
                endY,
                fromB,
                toB,
                off
            );
        };

        const isAbove = endY < fromBounds.top;
        const isBelow = endY > fromBounds.bottom;
        const isLeft = endX < fromBounds.right;
        const hasVerticalOverlap = !(isAbove || isBelow);

        if (Math.abs(dy) < 5) {
            return [startX, startY, endX, endY];
        }

        const multiFanout = (fromNode.nextNodes?.length ?? 0) >= 2;
        const preferInterRowCorridor =
            (defaultPortUpLeft || defaultPortDownLeft) &&
            Math.abs(dy) > 28 &&
            endX < fromBounds.right + 40;

        /** 同列多扇出：北绕顶 / 南绕底（禁止贴边竖线、禁止目标行横穿） */
        if (
            multiFanout &&
            isSameColumnPortEdge(startX, endX) &&
            Math.abs(dy) > 28
        ) {
            if (dy < -8) {
                return rawNorthOverTopCrestOnly(
                    startX,
                    startY,
                    endX,
                    endY,
                    fromBounds,
                    toBounds,
                    bypassOffset
                );
            }
            if (dy > 8) {
                return rawSouthBypassBothEastRailWestRise(
                    startX,
                    startY,
                    endX,
                    endY,
                    fromBounds,
                    toBounds,
                    bypassOffset
                );
            }
        }

        /**
         * 4→6 / 3→7 等：盒缘净距 < 40px 或多扇出跨行时走中缝/绕顶；
         * 净距大且非多扇出时走常规 midX 或横出兜底。
         */
        if (closeHorizPairUp) {
            return rawSouthOrNorthDyNegative(
                startX,
                startY,
                endX,
                endY,
                fromBounds,
                toBounds,
                bypassOffset
            );
        }
        if (closeHorizPairDown) {
            return rawSouthOrNorthDyPositive(
                startX,
                startY,
                endX,
                endY,
                fromBounds,
                toBounds,
                bypassOffset
            );
        }

        if (isLeft) {
            if (dy < 0) {
                return rawSouthOrNorthDyNegative(
                    startX,
                    startY,
                    endX,
                    endY,
                    fromBounds,
                    toBounds,
                    bypassOffset
                );
            }
            /** 竖排右出→左进：南向优先 0 底~子顶 中缝，失败再绕底 */
            if (dy > 8) {
                const southLeft = rawSouthOrNorthDyPositive(
                    startX,
                    startY,
                    endX,
                    endY,
                    fromBounds,
                    toBounds,
                    bypassOffset
                );
                return southLeft;
            }
            const bypassY =
                Math.max(fromBounds.bottom, toBounds.bottom) + bypassOffset;
            return [
                startX,
                startY,
                startX + 30,
                startY,
                startX + 30,
                bypassY,
                endX - 30,
                bypassY,
                endX - 30,
                endY,
                endX,
                endY
            ];
        }

        if (!hasVerticalOverlap) {
            const tightPair = isCloseDefaultPortHorizGap(
                horizBoxGapRaw,
                portSpanRaw
            );
            if (dy < -8 && dx > 0) {
                const interNorthRaw = rawNorthInterRowBetweenFromAndTo(
                    startX,
                    startY,
                    endX,
                    endY,
                    fromBounds,
                    toBounds
                );
                if (interNorthRaw) return interNorthRaw;
            }
            if (
                dy > 8 &&
                (dx > 0 ||
                    ((fromNode.nextNodes?.length ?? 0) >= 2 &&
                        endY > startY + 8))
            ) {
                const interSouthRaw =
                    rawInterGapFromBottomToTopEastRailWestDrop(
                        startX,
                        startY,
                        endX,
                        endY,
                        fromBounds,
                        toBounds,
                        bypassOffset
                    );
                if (interSouthRaw) return interSouthRaw;
            }
            if (multiFanout && Math.abs(dy) > 8 && dx > 0) {
                const stem = tryMultiFanoutSimpleStemToLeftPort(
                    startX,
                    startY,
                    endX,
                    endY,
                    fromNode,
                    toNode,
                    routeNodes(),
                    halfW,
                    halfH,
                    routeStub
                );
                if (stem) return stem;
            }
            if (
                preferInterRowCorridor &&
                (closeHorizPair || multiFanout) &&
                !tightPair
            ) {
                const rects = routeObstacleRects(fromNode, toNode);
                const inter = tryInterRowCorridorBypassOrthogonal(
                    startX,
                    startY,
                    endX,
                    endY,
                    rects,
                    fromNode,
                    toNode,
                    routeNodes(),
                    routeStub,
                    halfW,
                    halfH
                );
                if (inter) {
                    return inter;
                }
            }
            const descendLeftCol =
                dy > 42 && dx < -26 && dx > -(geometry.width * 2.85);
            if (descendLeftCol) {
                const stemX = startX + routeStub + 18;
                return [startX, startY, stemX, startY, stemX, endY, endX, endY];
            }
            const midX = startX + dx / 2;
            return [startX, startY, midX, startY, midX, endY, endX, endY];
        }

        const midX = startX + dx / 2;
        const willCrossParent =
            midX >= fromBounds.left && midX <= fromBounds.right;
        const willCrossChild = midX >= toBounds.left && midX <= toBounds.right;

        if (!willCrossParent && !willCrossChild) {
            const midCand = [
                startX,
                startY,
                midX,
                startY,
                midX,
                endY,
                endX,
                endY
            ];
            const rectsMid = routeObstacleRects(fromNode, toNode);
            if (!polylineHitsObstacles(midCand, rectsMid)) {
                return midCand;
            }
            if (isSiblingRowCorridorHorizSpan(startX, endX)) {
                const floorBypass = buildSiblingRowCorridorToLeftPort(
                    startX,
                    startY,
                    endX,
                    endY,
                    fromBounds,
                    toBounds,
                    routeStub,
                    rectsMid
                );
                if (floorBypass) return floorBypass;
            }
            if (endY < startY - 6 && endX > startX + 20) {
                const uplBypass = tryUpwardLeftPortMidlineObstacleBypass(
                    startX,
                    startY,
                    endX,
                    endY,
                    fromBounds,
                    toBounds,
                    routeStub,
                    rectsMid
                );
                if (uplBypass) return uplBypass;
            }
        }

        const overlapDescendStem =
            dy > 42 && dx < -22 && dx > -(geometry.width * 2.98);
        if (overlapDescendStem) {
            const stemX = startX + routeStub + 22;
            return [startX, startY, stemX, startY, stemX, endY, endX, endY];
        }

        if (dy < 0) {
            if (
                (fromNode.nextNodes?.length ?? 0) >= 2 &&
                dx > 0 &&
                isSiblingRowCorridorHorizSpan(startX, endX)
            ) {
                const rectsUpFan = routeObstacleRects(fromNode, toNode);
                const floorUp = buildSiblingRowCorridorToLeftPort(
                    startX,
                    startY,
                    endX,
                    endY,
                    fromBounds,
                    toBounds,
                    routeStub,
                    rectsUpFan
                );
                if (floorUp) return floorUp;
            }
            if (
                (fromNode.nextNodes?.length ?? 0) >= 2 &&
                dx > 0 &&
                dx <= ROUTE_MULTI_FANOUT_CLOSE_HORIZ_GAP + 168
            ) {
                const stemUp = tryEastRailStemUnlessObstructed(
                    startX,
                    startY,
                    endX,
                    endY,
                    fromNode,
                    toNode,
                    routeNodes(),
                    halfW,
                    halfH,
                    routeStub,
                    routeObstacleRects(fromNode, toNode)
                );
                if (stemUp) return stemUp;
            }
            return rawSouthOrNorthDyNegative(
                startX,
                startY,
                endX,
                endY,
                fromBounds,
                toBounds,
                bypassOffset
            );
        }

        if (
            (fromNode.nextNodes?.length ?? 0) >= 2 &&
            dy > 8 &&
            dx > 0 &&
            isSiblingRowCorridorHorizSpan(startX, endX)
        ) {
            const rectsFan = routeObstacleRects(fromNode, toNode);
            const floorFan = buildSiblingRowCorridorToLeftPort(
                startX,
                startY,
                endX,
                endY,
                fromBounds,
                toBounds,
                routeStub,
                rectsFan
            );
            if (floorFan) return floorFan;
            const fanStemSimple = tryEastRailStemUnlessObstructed(
                startX,
                startY,
                endX,
                endY,
                fromNode,
                toNode,
                routeNodes(),
                halfW,
                halfH,
                routeStub,
                rectsFan
            );
            if (fanStemSimple) return fanStemSimple;
            const fanStem = tryMultiFanoutDownwardStemToLeftPort(
                startX,
                startY,
                endX,
                endY,
                fromNode,
                toNode,
                routeNodes(),
                halfW,
                halfH
            );
            if (fanStem) return fanStem;
        }

        if (
            (fromNode.nextNodes?.length ?? 0) >= 2 &&
            dy > 8 &&
            dx > 0 &&
            !isSiblingRowCorridorHorizSpan(startX, endX)
        ) {
            const rectsClose = routeObstacleRects(fromNode, toNode);
            const closeStem = tryEastRailStemUnlessObstructed(
                startX,
                startY,
                endX,
                endY,
                fromNode,
                toNode,
                routeNodes(),
                halfW,
                halfH,
                routeStub,
                rectsClose
            );
            if (closeStem) return closeStem;
        }

        const bypassY =
            Math.max(fromBounds.bottom, toBounds.bottom) + bypassOffset;

        if (dx < 100 && dx > 0) {
            return [
                startX,
                startY,
                startX + 30,
                startY,
                startX + 30,
                bypassY,
                endX,
                bypassY,
                endX,
                endY
            ];
        }

        return [
            startX,
            startY,
            startX + 30,
            startY,
            startX + 30,
            bypassY,
            endX - 30,
            bypassY,
            endX - 30,
            endY,
            endX,
            endY
        ];
    }

    function generateObstacleAvoidancePath(
        startX: number,
        startY: number,
        endX: number,
        endY: number,
        fromNode: MindMapRouteNode,
        toNode: MindMapRouteNode,
        callOpts?: GenerateObstaclePathOptions
    ): number[] {
        ensureRouteSessionCache();
        const pathKey = `${fromNode.nodeId}|${toNode.nodeId}|${startX}|${startY}|${endX}|${endY}|${callOpts?.freeEndPoint ? 1 : 0}`;
        const cachedPath = pathResultCache.get(pathKey);
        if (cachedPath) return cachedPath;
        const finishPath = (pts: number[]): number[] => {
            pathResultCache.set(pathKey, pts);
            return pts;
        };

        if (options?.getInteractionLite?.()) {
            return finishPath(
                cleanOrthoRoutePoints(
                    buildQuickDefaultPortPath(startX, startY, endX, endY)
                )
            );
        }

        const rectsEarly = routeObstacleRects(fromNode, toNode);
        if (
            !callOpts?.freeEndPoint &&
            rectsEarly.length > ROUTE_DENSE_OBSTACLE_FAST_PATH
        ) {
            return finishPath(
                cleanOrthoRoutePoints(
                    generateDenseObstaclePathQuick(
                        startX,
                        startY,
                        endX,
                        endY,
                        fromNode,
                        toNode,
                        rectsEarly
                    )
                )
            );
        }

        const raw = buildObstacleAvoidancePathRaw(
            startX,
            startY,
            endX,
            endY,
            fromNode,
            toNode,
            callOpts
        );
        const polished = cleanOrthoRoutePoints(
            polishRouteAgainstNodes(
                raw,
                startX,
                startY,
                endX,
                endY,
                fromNode,
                toNode,
                callOpts
            )
        );
        if (callOpts?.freeEndPoint) return finishPath(polished);

        const rectsFinal = routeObstacleRects(fromNode, toNode);
        const upwardDetour = endY < startY - 8 && endX > startX + 20;
        const siblingCorridorSpan = isSiblingRowCorridorHorizSpan(startX, endX);
        const polishedBad =
            rectsFinal.length &&
            (polylineHitsObstacles(polished, rectsFinal) ||
                pathHasNearRowEastWestJog(polished) ||
                pathHasIngressWestRailBacktrack(polished, startX) ||
                (upwardDetour && polished.length > 10) ||
                (siblingCorridorSpan &&
                    (fromNode.nextNodes?.length ?? 0) >= 2 &&
                    horizAtYHitsObstacles(
                        rectsFinal,
                        startY,
                        startX,
                        startX + Math.max(routeStub, 48)
                    )));
        if (polishedBad && siblingCorridorSpan) {
            const fromBf = getNodeBounds(fromNode, halfW, halfH);
            const toBf = getNodeBounds(toNode, halfW, halfH);
            const upl =
                buildSiblingRowCorridorToLeftPort(
                    startX,
                    startY,
                    endX,
                    endY,
                    fromBf,
                    toBf,
                    routeStub,
                    rectsFinal
                ) ??
                buildUpwardLeftPortObstacleCorridorPath(
                    startX,
                    startY,
                    endX,
                    endY,
                    fromBf,
                    toBf,
                    routeStub,
                    rectsFinal
                );
            if (upl && !polylineHitsObstacles(upl, rectsFinal)) {
                return finishPath(cleanOrthoRoutePoints(upl));
            }
        }
        return finishPath(polished);
    }

    return { generateObstacleAvoidancePath };
}
