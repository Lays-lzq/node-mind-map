/**
 * nodeMindMap 画布连线：默认右出/左入口径、启发式折线与强制避障编排。
 * 底层网格/抛光避障见 {@link ./obstacleRoute.ts}。
 */

import {
    ROUTE_MULTI_FANOUT_CLOSE_HORIZ_GAP,
    ROUTE_OBSTACLE_PAD,
    clampStub,
    createMindMapObstacleRouter,
    defaultPortHorizEndpointsOk,
    defaultPortMatchedHorizStub,
    mindMapRouteLayoutDigest,
    upwardLeftPortEndpointsOk,
    buildMultiFanoutDownwardToLeftPortPath,
    buildRouteObstacleRectsForEdge,
    buildSiblingRowCorridorToLeftPort,
    buildUpwardLeftPortObstacleCorridorPath,
    endpointInteriorExtraForDefaultPortEdge,
    expandRouteRect,
    getNodeBounds,
    isCloseDefaultPortHorizGap,
    isMultiFanoutEastRailStemPath,
    isMultiFanoutWestJogCorridorPath,
    orthoSegmentHitsRect,
    polylineHitsEndpointNodeInteriors,
    tryMultiFanoutSimpleStemToLeftPort,
    westRailXForLeftPortEntry,
    type CreateMindMapObstacleRouterOptions,
    type GenerateObstaclePathOptions,
    type MindMapObstacleRouterApi,
    type MindMapRouteGeometry,
    type MindMapRouteNode,
    type RouteRect
} from './obstacleRoute';
import {
    nodeCountsAsRouteObstacle,
    routeObstacleComponentNodeIds
} from './mindMapWeakComponents';
import { LINK_DRAG_TARGET_PHANTOM_ID } from './mindMapNodeOps';

/** 默认右出 / 左入端口坐标 */
export type MindMapEdgePorts = {
    sx: number;
    sy: number;
    ex: number;
    ey: number;
};

/** 连线策略链各阶段的名称（供调试报告统计） */
export type MindMapEdgeRouteStrategy =
    | 'tryMultiFanoutSimpleStemToLeftPort'
    | 'tryHorizontalLeadOrthoToLeftPort'
    | 'tryNorthClearanceDetourToLeftPort'
    | 'generateObstacleAvoidancePath'
    | 'generateObstacleAvoidancePath_pierceFallback'
    | 'unresolved';

export type MindMapEdgeRouteResolveMeta = {
    strategy: MindMapEdgeRouteStrategy;
    raw: number[] | null;
    /** 首条命中策略的路径是否仍穿 from/to 盒体 */
    initialPierced?: boolean;
    initialStrategy?: MindMapEdgeRouteStrategy;
};

/** 画布组件使用的连线路由 API（避障 + 默认端口策略） */
export type MindMapEdgeRouterApi = MindMapObstacleRouterApi & {
    edgePorts: (
        from: MindMapRouteNode,
        to: MindMapRouteNode
    ) => MindMapEdgePorts;
    /** 单条有向边的最终折点（含强制避障、应急避障、箭杆缩短） */
    resolveLinePointsForEdge: (
        from: MindMapRouteNode,
        to: MindMapRouteNode
    ) => { linePts: number[]; ports: MindMapEdgePorts; cornerR: number } | null;
    /** 拖动预览：仅默认端口 L 折线，不做避障（毫秒级） */
    resolveLinePointsForEdgeLite: (
        from: MindMapRouteNode,
        to: MindMapRouteNode
    ) => { linePts: number[]; ports: MindMapEdgePorts; cornerR: number } | null;
    resolveLinePointsAtPorts: (
        from: MindMapRouteNode,
        to: MindMapRouteNode,
        sx: number,
        sy: number,
        ex: number,
        ey: number,
        options?: { trimStem?: boolean }
    ) => { linePts: number[]; cornerR: number } | null;
    /** 拖线虚线：仅走避障（与实线策略链分离） */
    resolveLinkDragPreviewAtPorts: (
        from: MindMapRouteNode,
        to: MindMapRouteNode,
        sx: number,
        sy: number,
        ex: number,
        ey: number,
        options?: { trimStem?: boolean }
    ) => { linePts: number[]; cornerR: number } | null;
    buildRouteDebugReport: (ctx: {
        selectedEdge: { fromId: number; toId: number } | null;
        generateRoundedPath: (points: number[], radius: number) => string;
    }) => {
        edges: Record<string, unknown>[];
        strategySummary: Record<string, number>;
    };
};

export type CreateMindMapEdgeRouterOptions =
    CreateMindMapObstacleRouterOptions & {
        /** 节点数达到该值时正式连线走快速避障（跳过重策略链） */
        largeGraphNodeThreshold?: number;
    };

/** 与 rectConf 一致：单节点在画布上的半宽/半高 */
function nodeRectHalfExtents(
    n: MindMapRouteNode,
    fallbackHalfW: number,
    fallbackHalfH: number
): { hw: number; hh: number } {
    const nAny = n as MindMapRouteNode & {
        rectConf?: { width?: number; height?: number };
    };
    const w = Number(nAny.rectConf?.width);
    const h = Number(nAny.rectConf?.height);
    return {
        hw: Number.isFinite(w) && w > 0 ? w / 2 : fallbackHalfW,
        hh: Number.isFinite(h) && h > 0 ? h / 2 : fallbackHalfH
    };
}

/**
 * 避障路由器 + 默认右出/左入口径、横出/北绕启发式与多扇出强制避障。
 * 单条边的解析顺序见 {@link resolveLinePointsForEdge}。
 */
export function createMindMapEdgeRouter(
    geometry: MindMapRouteGeometry,
    getNodes: () => readonly MindMapRouteNode[],
    options?: CreateMindMapEdgeRouterOptions
): MindMapEdgeRouterApi {
    const obstacle = createMindMapObstacleRouter(geometry, getNodes, options);
    const routeStub = clampStub(geometry.width);
    const halfW = geometry.width / 2;
    const halfH = geometry.height / 2;
    const defaultHorizStub = defaultPortMatchedHorizStub(routeStub);
    const largeGraphNodeThreshold = options?.largeGraphNodeThreshold ?? 36;
    let edgeResolveDigest = 0;
    const edgeResolveCache = new Map<
        string,
        { linePts: number[]; ports: MindMapEdgePorts; cornerR: number } | null
    >();
    const halfOf = (n: MindMapRouteNode) =>
        nodeRectHalfExtents(n, halfW, halfH);

    /** 拖动/分帧首帧：右出→横→竖→左入，不算避障 */
    function buildInteractionLiteOrthoPath(
        sx: number,
        sy: number,
        ex: number,
        ey: number
    ): number[] {
        if (Math.abs(ey - sy) <= 6 && ex >= sx - 4) {
            return [sx, sy, ex, sy];
        }
        const portSpan = Math.max(0, ex - sx);
        const stub = Math.min(defaultHorizStub, Math.max(14, portSpan * 0.45));
        const railX = Math.max(
            sx + 14,
            Math.min(sx + stub, ex > sx + 20 ? ex - 14 : sx + stub)
        );
        return [sx, sy, railX, sy, railX, ey, ex, ey];
    }

    function resolveLinePointsForEdgeLite(
        from: MindMapRouteNode,
        to: MindMapRouteNode
    ): { linePts: number[]; ports: MindMapEdgePorts; cornerR: number } | null {
        const ports = edgePorts(from, to);
        const linePts = buildInteractionLiteOrthoPath(
            ports.sx,
            ports.sy,
            ports.ex,
            ports.ey
        );
        if (linePts.length < 4) return null;
        trimArrowStem(linePts);
        return { linePts, ports, cornerR: 8 };
    }

    function isCloseMultiFanoutCorridorPath(
        pts: number[] | null,
        from: MindMapRouteNode,
        to: MindMapRouteNode,
        sx: number,
        sy: number,
        ex: number,
        ey: number
    ): boolean {
        if (!pts || pts.length < 8) return false;
        if ((from.nextNodes?.length ?? 0) < 2) return false;
        if (
            !isCloseDefaultPortHorizGap(horizBoxGapBetween(from, to), ex - sx)
        ) {
            return false;
        }
        return (
            isMultiFanoutWestJogCorridorPath(pts, sx, sy, ex, ey) ||
            isMultiFanoutEastRailStemPath(pts, sx, sy, ex, ey)
        );
    }

    const polylinePiercesFromOrToInterior = (
        pts: number[],
        from: MindMapRouteNode,
        to: MindMapRouteNode,
        sx?: number,
        sy?: number,
        ex?: number,
        ey?: number
    ) => {
        if (
            sx != null &&
            sy != null &&
            ex != null &&
            ey != null &&
            isCloseMultiFanoutCorridorPath(pts, from, to, sx, sy, ex, ey)
        ) {
            return false;
        }
        const f = halfOf(from);
        const t = halfOf(to);
        const extra =
            sx != null && sy != null && ex != null && ey != null
                ? endpointInteriorExtraForDefaultPortEdge(
                      pts,
                      sx,
                      sy,
                      ex,
                      ey,
                      from,
                      to,
                      f.hw,
                      f.hh
                  )
                : 0;
        if (
            polylineHitsEndpointNodeInteriors(
                pts,
                from,
                to,
                Math.max(f.hw, t.hw),
                Math.max(f.hh, t.hh),
                extra
            )
        ) {
            return true;
        }
        return polylineHitsForeignNodes(pts, from, to);
    };

    const portAccept = (
        from: MindMapRouteNode,
        to: MindMapRouteNode,
        sx: number,
        sy: number,
        ex: number,
        ey: number,
        raw: number[] | null
    ) =>
        !!raw &&
        raw.length >= 4 &&
        (defaultPortHorizEndpointsOk(raw, sx, sy, ex, ey, routeStub) ||
            (ex > sx + 12 &&
                upwardLeftPortEndpointsOk(raw, sx, sy, ex, ey, routeStub)));

    /** 带 padding 的节点外包盒，供启发式路径与 foreign 障碍检测复用 */
    function paddedNodeRect(n: MindMapRouteNode, pad: number): RouteRect {
        const { hw, hh } = halfOf(n);
        return expandRouteRect(getNodeBounds(n, hw, hh), pad);
    }

    function segHitsPaddedNode(
        ax: number,
        ay: number,
        bx: number,
        by: number,
        n: MindMapRouteNode,
        pad: number
    ): boolean {
        return orthoSegmentHitsRect(ax, ay, bx, by, paddedNodeRect(n, pad));
    }

    /** 终点 to 的碰撞盒略放大，避免布局 half 小于实绘导致竖穿漏判 */
    function segHitsTargetNode(
        ax: number,
        ay: number,
        bx: number,
        by: number,
        to: MindMapRouteNode,
        basePad: number
    ): boolean {
        const { hw, hh } = halfOf(to);
        const slack = Math.max(18, hw * 0.15, hh * 0.15);
        return segHitsPaddedNode(ax, ay, bx, by, to, basePad + slack);
    }

    function polylineHitsPaddedNode(
        pts: number[],
        n: MindMapRouteNode,
        pad: number
    ): boolean {
        for (let i = 2; i < pts.length; i += 2) {
            if (
                segHitsPaddedNode(
                    pts[i - 2]!,
                    pts[i - 1]!,
                    pts[i]!,
                    pts[i + 1]!,
                    n,
                    pad
                )
            ) {
                return true;
            }
        }
        return false;
    }

    function polylineHitsForeignNodes(
        pts: number[],
        from: MindMapRouteNode,
        to: MindMapRouteNode
    ): boolean {
        const all = getNodes();
        const scope = routeObstacleComponentNodeIds(all, from.nodeId);
        for (let i = 2; i < pts.length; i += 2) {
            const ax = pts[i - 2]!;
            const ay = pts[i - 1]!;
            const bx = pts[i]!;
            const by = pts[i + 1]!;
            for (const n of all) {
                if (
                    !nodeCountsAsRouteObstacle(
                        n.nodeId,
                        from.nodeId,
                        to.nodeId,
                        scope
                    )
                ) {
                    continue;
                }
                if (
                    orthoSegmentHitsRect(
                        ax,
                        ay,
                        bx,
                        by,
                        paddedNodeRect(n, ROUTE_OBSTACLE_PAD)
                    )
                ) {
                    return true;
                }
            }
        }
        return false;
    }

    function edgePorts(
        from: MindMapRouteNode,
        to: MindMapRouteNode
    ): MindMapEdgePorts {
        const f = halfOf(from);
        const t = halfOf(to);
        return {
            sx: from.x + f.hw,
            sy: from.y,
            ex: to.x - t.hw,
            ey: to.y
        };
    }

    function horizBoxGapBetween(
        from: MindMapRouteNode,
        to: MindMapRouteNode
    ): number {
        const f = halfOf(from);
        const t = halfOf(to);
        return (
            getNodeBounds(to, t.hw, t.hh).left -
            getNodeBounds(from, f.hw, f.hh).right
        );
    }

    /**
     * 多扇出或斜向连线：盒缘净距/端口横距过小时不走简单折线，改走横出或完整避障。
     */
    function preferDefaultPortObstacle(
        from: MindMapRouteNode,
        to: MindMapRouteNode,
        startX: number,
        _startY: number,
        ex: number,
        _ey: number
    ): boolean {
        if (Math.abs(to.y - from.y) <= 6) return false;
        const horizGap = horizBoxGapBetween(from, to);
        const portSpan = ex - startX;
        const multi = (from.nextNodes?.length ?? 0) >= 2;
        const diagonal = Math.abs(to.y - from.y) > 8;
        if (!multi && !diagonal) return false;
        const overlapBoxes = horizGap < 0 || portSpan < 0;
        if (multi && diagonal && overlapBoxes) return false;
        /** 多扇出+跨行：仅净距/端口横距过近时强制避障 */
        return (
            horizGap <= ROUTE_MULTI_FANOUT_CLOSE_HORIZ_GAP ||
            (portSpan > 0 && portSpan <= ROUTE_MULTI_FANOUT_CLOSE_HORIZ_GAP)
        );
    }

    /** 默认右口→左口：先横出、再竖、再横进（禁止首段竖贴 from 侧缘） */
    function tryHorizontalLeadOrthoToLeftPort(
        from: MindMapRouteNode,
        to: MindMapRouteNode,
        sx: number,
        sy: number,
        ex: number,
        ey: number
    ): number[] | null {
        if (Math.abs(ey - sy) < 8) return null;

        const pad = 14;
        const padSelf = Math.max(pad, 16);
        const portSpan = Math.max(0, ex - sx);
        const stub = Math.min(defaultHorizStub, Math.max(14, portSpan * 0.92));

        const minInbound = 12;
        const multiFanout = (from.nextNodes?.length ?? 0) >= 2;
        const cands: number[][] = [];
        const pushIfLeftInbound = (pts: number[]) => {
            if (pts.length < 8) return;
            const preX = pts[pts.length - 4]!;
            if (ex < sx - 4) {
                if (preX <= ex + 6) return;
            } else if (preX >= ex - 6) {
                return;
            }
            cands.push(pts);
        };

        if (multiFanout && ey > sy + 8) {
            const { hw, hh } = halfOf(from);
            const fan = buildMultiFanoutDownwardToLeftPortPath(
                sx,
                sy,
                ex,
                ey,
                from,
                to,
                getNodes(),
                hw,
                hh
            );
            if (fan) pushIfLeftInbound(fan);
        } else if (multiFanout && ey < sy - 8) {
            const { hw, hh } = halfOf(from);
            const fanUp = tryMultiFanoutSimpleStemToLeftPort(
                sx,
                sy,
                ex,
                ey,
                from,
                to,
                getNodes(),
                hw,
                hh,
                routeStub
            );
            if (fanUp) pushIfLeftInbound(fanUp);
        } else if (ex < sx - 4) {
            const { hw, hh } = halfOf(from);
            const overlap = buildMultiFanoutDownwardToLeftPortPath(
                sx,
                sy,
                ex,
                ey,
                from,
                to,
                getNodes(),
                hw,
                hh
            );
            if (overlap) pushIfLeftInbound(overlap);
        } else {
            const shortKick = Math.min(26, Math.max(14, portSpan * 0.32));
            if (sx + shortKick < ex - minInbound) {
                pushIfLeftInbound([
                    sx,
                    sy,
                    sx + shortKick,
                    sy,
                    sx + shortKick,
                    ey,
                    ex,
                    ey
                ]);
            }
            const approachStub = Math.min(
                stub,
                Math.max(minInbound, portSpan * 0.42)
            );
            const dropX = ex - approachStub;
            if (dropX > sx + minInbound) {
                pushIfLeftInbound([sx, sy, dropX, sy, dropX, ey, ex, ey]);
            }
        }

        if (!multiFanout) {
            const westRailX =
                ex - Math.min(stub, Math.max(minInbound, ex - sx - minInbound));
            if (westRailX > sx + minInbound) {
                pushIfLeftInbound([
                    sx,
                    sy,
                    westRailX,
                    sy,
                    westRailX,
                    ey,
                    ex,
                    ey
                ]);
            }
            if (sx + stub < ex - minInbound) {
                pushIfLeftInbound([
                    sx,
                    sy,
                    sx + stub,
                    sy,
                    sx + stub,
                    ey,
                    ex,
                    ey
                ]);
            }
            const midX = sx + (ex - sx) * 0.55;
            if (midX > sx + minInbound && midX < ex - minInbound) {
                pushIfLeftInbound([sx, sy, midX, sy, midX, ey, ex, ey]);
            }
        }

        for (const pts of cands) {
            if (!portAccept(from, to, sx, sy, ex, ey, pts)) continue;
            if (polylineHitsPaddedNode(pts, from, padSelf)) continue;
            if (polylineHitsForeignNodes(pts, from, to)) continue;
            if (polylinePiercesFromOrToInterior(pts, from, to)) continue;
            return pts;
        }
        return null;
    }

    /**
     * 自下而上进左口且竖线会穿过终点盒：绕到盒顶外，西侧竖轨下落再水平入户。
     */
    function tryNorthClearanceDetourToLeftPort(
        from: MindMapRouteNode,
        to: MindMapRouteNode,
        sx: number,
        sy: number,
        ex: number,
        ey: number
    ): number[] | null {
        if (ey >= sy - 6) return null;

        const { hw: hwT, hh: hhT } = halfOf(to);
        const pad = 16;
        const tLeft = to.x - hwT;
        const hitSlack = Math.max(14, hwT * 0.12, hhT * 0.12);

        if (Math.abs(ex - tLeft) > 10 || Math.abs(ey - to.y) > hhT * 0.95) {
            return null;
        }

        const L = to.x - hwT - pad - hitSlack;
        const R = to.x + hwT + pad + hitSlack;
        const T = to.y - hhT - pad - hitSlack;
        const B = to.y + hhT + pad + hitSlack;

        const ySegLo = Math.min(sy, ey);
        const ySegHi = Math.max(sy, ey);
        const vertHitsTo = sx >= L && sx <= R && !(ySegHi < T || ySegLo > B);
        const horizHitsTo = segHitsTargetNode(sx, ey, ex, ey, to, pad);
        if (!vertHitsTo && !horizHitsTo) return null;

        const yAbove = T - Math.max(18, 14);
        const nodeLeft = to.x - hwT;
        const westOfTo = nodeLeft - Math.max(16, hwT * 0.08);
        const fromLeftLimit = from.x - halfOf(from).hw - pad;

        const clampWestRail = (candidate: number): number | null => {
            let xWest = candidate;
            if (xWest > westOfTo) {
                if (fromLeftLimit > westOfTo - 2) return null;
                xWest = westOfTo;
            }
            return xWest;
        };

        let xWest: number | null;
        const multiFanOut = (from.nextNodes?.length ?? 0) >= 2;
        if (multiFanOut) {
            const toB = getNodeBounds(to, hwT, hhT);
            xWest = Math.min(
                westRailXForLeftPortEntry(toB, ex, routeStub),
                westOfTo
            );
            const padSelfProbe = Math.max(pad, 18);
            const northPath = (xw: number) =>
                [sx, sy, xw, sy, xw, yAbove, xw, ey, ex, ey] as number[];
            let ptsProbe = northPath(xWest);
            let guard = 0;
            while (
                polylineHitsPaddedNode(ptsProbe, from, padSelfProbe) &&
                xWest < sx - 8 &&
                guard < 48
            ) {
                xWest += 6;
                xWest = Math.min(xWest, westOfTo);
                ptsProbe = northPath(xWest);
                guard++;
            }
            if (polylineHitsPaddedNode(ptsProbe, from, padSelfProbe)) {
                xWest = clampWestRail(L - Math.max(28, hwT * 0.22)) ?? null;
                if (xWest != null) xWest = Math.max(xWest, fromLeftLimit);
            }
        } else {
            xWest = clampWestRail(
                Math.max(L - Math.max(28, hwT * 0.22), fromLeftLimit)
            );
        }
        if (xWest == null) return null;

        if (yAbove >= sy - 4 || ey <= yAbove + 2) return null;
        if (xWest >= ex - 6 || xWest >= sx - 6) return null;
        if (segHitsTargetNode(sx, sy, xWest, sy, to, pad)) return null;

        const pts = [sx, sy, xWest, sy, xWest, yAbove, xWest, ey, ex, ey];
        const padSelf = Math.max(pad, 18);
        if (segHitsTargetNode(xWest, sy, xWest, yAbove, to, pad)) return null;
        if (segHitsTargetNode(xWest, yAbove, xWest, ey, to, pad)) return null;
        if (polylineHitsPaddedNode(pts, from, padSelf)) return null;
        if (polylineHitsForeignNodes(pts, from, to)) return null;

        for (let i = 2; i < pts.length - 2; i += 2) {
            if (
                segHitsTargetNode(
                    pts[i - 2]!,
                    pts[i - 1]!,
                    pts[i]!,
                    pts[i + 1]!,
                    to,
                    pad
                )
            ) {
                return null;
            }
        }

        return pts;
    }

    /**
     * 实线策略链：北绕 → 横出 → 避障；首条通过端口校验者胜出。
     * 穿体时按同序回退下一策略。
     */
    function resolveRawPathWithMeta(
        from: MindMapRouteNode,
        to: MindMapRouteNode,
        sx: number,
        sy: number,
        ex: number,
        ey: number
    ): MindMapEdgeRouteResolveMeta {
        const genObs = () =>
            obstacle.generateObstacleAvoidancePath(sx, sy, ex, ey, from, to);

        const multiCrossRow =
            (from.nextNodes?.length ?? 0) >= 2 && Math.abs(to.y - from.y) > 8;
        const portSpanMeta = ex - sx;
        const boxGapMeta = horizBoxGapBetween(from, to);
        const multiCrossRowClose =
            multiCrossRow &&
            boxGapMeta <= ROUTE_MULTI_FANOUT_CLOSE_HORIZ_GAP &&
            portSpanMeta > 0 &&
            portSpanMeta <= ROUTE_MULTI_FANOUT_CLOSE_HORIZ_GAP;
        const northStep = {
            strategy: 'tryNorthClearanceDetourToLeftPort' as const,
            compute: () =>
                tryNorthClearanceDetourToLeftPort(from, to, sx, sy, ex, ey)
        };
        const horizStep = {
            strategy: 'tryHorizontalLeadOrthoToLeftPort' as const,
            compute: () =>
                tryHorizontalLeadOrthoToLeftPort(from, to, sx, sy, ex, ey)
        };
        const obsStep = {
            strategy: 'generateObstacleAvoidancePath' as const,
            compute: genObs
        };
        const chain: {
            strategy: MindMapEdgeRouteStrategy;
            compute: () => number[] | null;
        }[] = multiCrossRowClose
            ? [obsStep, northStep, horizStep]
            : [northStep, horizStep, obsStep];

        let hit: MindMapEdgeRouteResolveMeta | null = null;
        for (const step of chain) {
            const raw = step.compute();
            if (portAccept(from, to, sx, sy, ex, ey, raw)) {
                hit = { strategy: step.strategy, raw };
                break;
            }
        }
        if (!hit) {
            const stub = Math.min(
                defaultHorizStub,
                Math.max(14, (ex - sx) * 0.45)
            );
            const railX = Math.max(sx + 14, Math.min(sx + stub, ex - 14));
            const simple: number[] = [sx, sy, railX, sy, railX, ey, ex, ey];
            if (portAccept(from, to, sx, sy, ex, ey, simple)) {
                hit = {
                    strategy: 'tryHorizontalLeadOrthoToLeftPort',
                    raw: simple
                };
            }
        }
        if (!hit) {
            return { strategy: 'unresolved', raw: null };
        }

        if (
            polylinePiercesFromOrToInterior(hit.raw!, from, to, sx, sy, ex, ey)
        ) {
            if (
                isCloseMultiFanoutCorridorPath(
                    hit.raw!,
                    from,
                    to,
                    sx,
                    sy,
                    ex,
                    ey
                )
            ) {
                return {
                    ...hit,
                    initialPierced: true,
                    initialStrategy: hit.strategy
                };
            }
            for (const step of chain) {
                if (step.strategy === hit.strategy) continue;
                const fb = step.compute();
                if (
                    portAccept(from, to, sx, sy, ex, ey, fb) &&
                    !polylinePiercesFromOrToInterior(
                        fb!,
                        from,
                        to,
                        sx,
                        sy,
                        ex,
                        ey
                    )
                ) {
                    return {
                        strategy:
                            step.strategy === 'generateObstacleAvoidancePath'
                                ? 'generateObstacleAvoidancePath_pierceFallback'
                                : step.strategy,
                        raw: fb,
                        initialPierced: true,
                        initialStrategy: hit.strategy
                    };
                }
            }
            return {
                ...hit,
                initialPierced: true,
                initialStrategy: hit.strategy
            };
        }
        return hit;
    }

    function resolveWithForcedObstacle(
        from: MindMapRouteNode,
        to: MindMapRouteNode,
        startX: number,
        startY: number,
        endX: number,
        endY: number,
        raw: number[] | null
    ): number[] | null {
        if (
            raw &&
            raw.length >= 4 &&
            portAccept(from, to, startX, startY, endX, endY, raw) &&
            !polylinePiercesFromOrToInterior(
                raw,
                from,
                to,
                startX,
                startY,
                endX,
                endY
            )
        ) {
            return raw;
        }
        if (!preferDefaultPortObstacle(from, to, startX, startY, endX, endY)) {
            return raw;
        }
        if (
            isCloseMultiFanoutCorridorPath(
                raw,
                from,
                to,
                startX,
                startY,
                endX,
                endY
            )
        ) {
            return raw;
        }
        const horiz = tryHorizontalLeadOrthoToLeftPort(
            from,
            to,
            startX,
            startY,
            endX,
            endY
        );
        if (
            horiz &&
            portAccept(from, to, startX, startY, endX, endY, horiz) &&
            !polylinePiercesFromOrToInterior(
                horiz,
                from,
                to,
                startX,
                startY,
                endX,
                endY
            )
        ) {
            return horiz;
        }
        const obs = obstacle.generateObstacleAvoidancePath(
            startX,
            startY,
            endX,
            endY,
            from,
            to
        );
        if (
            portAccept(from, to, startX, startY, endX, endY, obs) &&
            !polylinePiercesFromOrToInterior(
                obs,
                from,
                to,
                startX,
                startY,
                endX,
                endY
            )
        ) {
            return obs;
        }
        if (
            (from.nextNodes?.length ?? 0) >= 2 &&
            Math.abs(endY - startY) > 22
        ) {
            const { hw, hh } = halfOf(from);
            const stem = tryMultiFanoutSimpleStemToLeftPort(
                startX,
                startY,
                endX,
                endY,
                from,
                to,
                getNodes(),
                hw,
                hh,
                routeStub
            );
            if (
                stem &&
                portAccept(from, to, startX, startY, endX, endY, stem) &&
                !polylinePiercesFromOrToInterior(
                    stem,
                    from,
                    to,
                    startX,
                    startY,
                    endX,
                    endY
                )
            ) {
                return stem;
            }
        }
        /** 避障未通过端口校验时，仍退回横出折线（优于穿体或空路径） */
        if (
            horiz &&
            horiz.length >= 4 &&
            portAccept(from, to, startX, startY, endX, endY, horiz)
        ) {
            return horiz;
        }
        return obs.length >= 4 ? obs : raw;
    }

    type EdgePathStages = {
        ports: MindMapEdgePorts;
        sx: number;
        sy: number;
        ex: number;
        ey: number;
        defaultResolve: MindMapEdgeRouteResolveMeta;
        forceDefaultPortObstacle: boolean;
        routeExtras: {
            horizBoxGap: number;
            portHorizSpan: number;
            forceDefaultPortObstacle: boolean;
        };
        raw: number[] | null;
    };

    /** 默认策略链 + 多扇出强制避障，供正式绘制与调试报告共用 */
    function resolveEdgePathStagesAtPorts(
        from: MindMapRouteNode,
        to: MindMapRouteNode,
        sx: number,
        sy: number,
        ex: number,
        ey: number
    ): EdgePathStages {
        const ports = edgePorts(from, to);
        const defaultResolve = resolveRawPathWithMeta(from, to, sx, sy, ex, ey);
        const forceDefaultPortObstacle = preferDefaultPortObstacle(
            from,
            to,
            sx,
            sy,
            ex,
            ey
        );
        const raw = resolveWithForcedObstacle(
            from,
            to,
            sx,
            sy,
            ex,
            ey,
            defaultResolve.raw
        );
        return {
            ports,
            sx,
            sy,
            ex,
            ey,
            defaultResolve,
            forceDefaultPortObstacle,
            routeExtras: {
                horizBoxGap: horizBoxGapBetween(from, to),
                portHorizSpan: ex - sx,
                forceDefaultPortObstacle
            },
            raw
        };
    }

    function resolveEdgePathStages(
        from: MindMapRouteNode,
        to: MindMapRouteNode
    ): EdgePathStages {
        const ports = edgePorts(from, to);
        return resolveEdgePathStagesAtPorts(
            from,
            to,
            ports.sx,
            ports.sy,
            ports.ex,
            ports.ey
        );
    }

    function trimArrowStem(linePts: number[]) {
        if (linePts.length < 4) return;
        const lastIdx = linePts.length - 2;
        const secondLastIdx = linePts.length - 4;
        const dx = linePts[lastIdx]! - linePts[secondLastIdx]!;
        const dy = linePts[lastIdx + 1]! - linePts[secondLastIdx + 1]!;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
            linePts[lastIdx] -= (dx / len) * 5;
            linePts[lastIdx + 1] -= (dy / len) * 5;
        }
    }

    function applyEmergencyObstacle(
        linePts: number[],
        from: MindMapRouteNode,
        to: MindMapRouteNode,
        startX: number,
        startY: number,
        endX: number,
        endY: number
    ): boolean {
        const sx0 = linePts[0]!;
        const sy0 = linePts[1]!;
        if (
            !polylinePiercesFromOrToInterior(
                linePts,
                from,
                to,
                sx0,
                sy0,
                endX,
                endY
            )
        ) {
            return false;
        }

        const f = halfOf(from);
        const t = halfOf(to);
        const fromB = getNodeBounds(from, f.hw, f.hh);
        const toB = getNodeBounds(to, t.hw, t.hh);
        const rects = buildRouteObstacleRectsForEdge(
            getNodes(),
            from,
            to,
            f.hw,
            f.hh
        );
        const corridor =
            buildSiblingRowCorridorToLeftPort(
                sx0,
                sy0,
                endX,
                endY,
                fromB,
                toB,
                routeStub,
                rects
            ) ??
            buildUpwardLeftPortObstacleCorridorPath(
                sx0,
                sy0,
                endX,
                endY,
                fromB,
                toB,
                routeStub,
                rects
            );
        if (
            corridor &&
            corridor.length >= 4 &&
            portAccept(from, to, sx0, sy0, endX, endY, corridor) &&
            !polylinePiercesFromOrToInterior(
                corridor,
                from,
                to,
                sx0,
                sy0,
                endX,
                endY
            )
        ) {
            linePts.length = 0;
            linePts.push(...corridor);
            return true;
        }

        const emergency = obstacle.generateObstacleAvoidancePath(
            sx0,
            sy0,
            endX,
            endY,
            from,
            to
        );
        if (
            emergency.length >= 4 &&
            portAccept(from, to, sx0, sy0, endX, endY, emergency) &&
            !polylinePiercesFromOrToInterior(
                emergency,
                from,
                to,
                sx0,
                sy0,
                endX,
                endY
            )
        ) {
            linePts.length = 0;
            linePts.push(...emergency);
            return true;
        }
        return false;
    }

    function resolveLinePointsAtPorts(
        from: MindMapRouteNode,
        to: MindMapRouteNode,
        sx: number,
        sy: number,
        ex: number,
        ey: number,
        options?: { trimStem?: boolean; lite?: boolean }
    ): { linePts: number[]; cornerR: number } | null {
        if (options?.lite) {
            const linePts = buildInteractionLiteOrthoPath(sx, sy, ex, ey);
            if (linePts.length < 4) return null;
            if (options.trimStem !== false) trimArrowStem(linePts);
            return { linePts, cornerR: 8 };
        }
        const staged = resolveEdgePathStagesAtPorts(from, to, sx, sy, ex, ey);
        if (!staged.raw || staged.raw.length < 4) return null;

        const cornerR = staged.raw.length >= 8 ? 12 : 8;
        const linePts = staged.raw.slice();
        applyEmergencyObstacle(linePts, from, to, sx, sy, ex, ey);
        if (linePts.length < 4) return null;
        if (options?.trimStem !== false) {
            trimArrowStem(linePts);
        }
        return { linePts, cornerR };
    }

    function resolveLinkDragPreviewAtPorts(
        from: MindMapRouteNode,
        to: MindMapRouteNode,
        sx: number,
        sy: number,
        ex: number,
        ey: number,
        options?: { trimStem?: boolean }
    ): { linePts: number[]; cornerR: number } | null {
        const pathOpts: GenerateObstaclePathOptions | undefined =
            to.nodeId === LINK_DRAG_TARGET_PHANTOM_ID
                ? { freeEndPoint: true }
                : undefined;

        const raw = obstacle.generateObstacleAvoidancePath(
            sx,
            sy,
            ex,
            ey,
            from,
            to,
            pathOpts
        );
        if (!raw || raw.length < 4) return null;

        const cornerR = raw.length >= 6 ? 8 : 6;
        const linePts = raw.slice();
        if (options?.trimStem !== false) {
            trimArrowStem(linePts);
        }
        return { linePts, cornerR };
    }

    /** 大图：dense 快速避障，跳过重策略链 */
    function resolveLinePointsForEdgeFast(
        from: MindMapRouteNode,
        to: MindMapRouteNode
    ): { linePts: number[]; ports: MindMapEdgePorts; cornerR: number } | null {
        const digest = mindMapRouteLayoutDigest(getNodes());
        if (digest !== edgeResolveDigest) {
            edgeResolveDigest = digest;
            edgeResolveCache.clear();
        }
        const key = `${from.nodeId}|${to.nodeId}|fast`;
        if (edgeResolveCache.has(key)) {
            return edgeResolveCache.get(key)!;
        }
        const ports = edgePorts(from, to);
        const linePts = obstacle.generateObstacleAvoidancePath(
            ports.sx,
            ports.sy,
            ports.ex,
            ports.ey,
            from,
            to
        );
        if (linePts.length < 4) return null;
        trimArrowStem(linePts);
        const cornerR = linePts.length >= 8 ? 12 : 8;
        const out = { linePts, ports, cornerR };
        edgeResolveCache.set(key, out);
        return out;
    }

    function resolveLinePointsForEdge(
        from: MindMapRouteNode,
        to: MindMapRouteNode
    ): { linePts: number[]; ports: MindMapEdgePorts; cornerR: number } | null {
        if (getNodes().length >= largeGraphNodeThreshold) {
            return resolveLinePointsForEdgeFast(from, to);
        }
        const digest = mindMapRouteLayoutDigest(getNodes());
        if (digest !== edgeResolveDigest) {
            edgeResolveDigest = digest;
            edgeResolveCache.clear();
        }
        const key = `${from.nodeId}|${to.nodeId}`;
        if (edgeResolveCache.has(key)) {
            return edgeResolveCache.get(key)!;
        }
        const ports = edgePorts(from, to);
        const resolved = resolveLinePointsAtPorts(
            from,
            to,
            ports.sx,
            ports.sy,
            ports.ex,
            ports.ey
        );
        const out = resolved ? { ...resolved, ports } : null;
        edgeResolveCache.set(key, out);
        return out;
    }

    function edgeFinalStrategyLabel(
        defaultResolve: MindMapEdgeRouteResolveMeta,
        forceDefaultPortObstacle: boolean
    ): MindMapEdgeRouteStrategy | string {
        if (forceDefaultPortObstacle) {
            return 'generateObstacleAvoidancePath';
        }
        return defaultResolve.strategy;
    }

    function buildRouteDebugReport(ctx: {
        selectedEdge: { fromId: number; toId: number } | null;
        generateRoundedPath: (points: number[], radius: number) => string;
    }) {
        const sel = ctx.selectedEdge;
        const edges: Record<string, unknown>[] = [];

        for (const node of getNodes()) {
            if (!node.nextNodes?.length) continue;
            for (const nextNodeId of node.nextNodes) {
                const nextNode = getNodes().find(
                    (n) => n.nodeId === nextNodeId
                );
                if (!nextNode) continue;

                const staged = resolveEdgePathStages(node, nextNode);
                const { defaultResolve, routeExtras, ports } = staged;
                const postProcess: string[] = [];

                if (!staged.raw || staged.raw.length < 4) {
                    edges.push({
                        edge: `${node.nodeId}->${nextNodeId}`,
                        fromId: node.nodeId,
                        toId: nextNodeId,
                        ports,
                        defaultResolve: {
                            strategy: defaultResolve.strategy,
                            initialStrategy:
                                defaultResolve.initialStrategy ?? null,
                            initialPierced:
                                defaultResolve.initialPierced ?? false,
                            raw: defaultResolve.raw
                        },
                        routeExtras,
                        postProcess,
                        finalLinePts: null,
                        pathData: null,
                        skipped: 'no_valid_raw'
                    });
                    continue;
                }

                const cornerR = staged.raw.length >= 8 ? 12 : 8;
                const linePts = staged.raw.slice();

                if (
                    applyEmergencyObstacle(
                        linePts,
                        node,
                        nextNode,
                        staged.sx,
                        staged.sy,
                        staged.ex,
                        staged.ey
                    )
                ) {
                    postProcess.push('emergencyObstacleAvoidance');
                } else if (
                    polylinePiercesFromOrToInterior(
                        linePts,
                        node,
                        nextNode,
                        staged.sx,
                        staged.sy,
                        staged.ex,
                        staged.ey
                    )
                ) {
                    postProcess.push('emergencyObstacle_failed');
                }

                if (linePts.length >= 4) {
                    trimArrowStem(linePts);
                    postProcess.push('arrowStemTrim');
                }

                edges.push({
                    edge: `${node.nodeId}->${nextNodeId}`,
                    fromId: node.nodeId,
                    toId: nextNodeId,
                    selected:
                        sel?.fromId === node.nodeId && sel?.toId === nextNodeId,
                    ports: {
                        sx: staged.sx,
                        sy: staged.sy,
                        ex: staged.ex,
                        ey: staged.ey
                    },
                    defaultPorts: ports,
                    defaultResolve: {
                        strategy: defaultResolve.strategy,
                        initialStrategy: defaultResolve.initialStrategy ?? null,
                        initialPierced: defaultResolve.initialPierced ?? false,
                        raw: defaultResolve.raw
                    },
                    routeExtras,
                    finalStrategy: edgeFinalStrategyLabel(
                        defaultResolve,
                        staged.forceDefaultPortObstacle
                    ),
                    postProcess,
                    finalLinePts: [...linePts],
                    pathData: ctx.generateRoundedPath(linePts, cornerR),
                    vertexCount: linePts.length / 2
                });
            }
        }

        const strategySummary: Record<string, number> = {};
        for (const e of edges) {
            const row = e as {
                finalStrategy?: string;
                skipped?: string;
                defaultResolve?: { strategy?: string };
            };
            const key = String(
                row.finalStrategy ??
                    row.skipped ??
                    row.defaultResolve?.strategy ??
                    'unknown'
            );
            strategySummary[key] = (strategySummary[key] ?? 0) + 1;
        }

        return { edges, strategySummary };
    }

    return {
        generateObstacleAvoidancePath: obstacle.generateObstacleAvoidancePath,
        edgePorts,
        resolveLinePointsForEdge,
        resolveLinePointsForEdgeLite,
        resolveLinePointsAtPorts,
        resolveLinkDragPreviewAtPorts,
        buildRouteDebugReport
    };
}
