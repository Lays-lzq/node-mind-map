/**
 * Konva Stage 视口 / 客户端坐标 ↔ 第一层 scene 坐标（与 nodeEditor 一致）。
 */

import { getNodeBounds } from './obstacleRoute';
import {
    getNodeGuideValidation,
    MIND_MAP_VALIDATION_BADGE_R,
    mindMapValidationBadgeCenterScene
} from './mindMapNodeGuideValidation';

export type MindMapCanvasPoint = { x: number; y: number };

/** scene → Stage 内容区局部坐标（与 getPointerPosition 同系） */
export function canvasStageViewportPointFromScene(
    stage: any,
    sceneX: number,
    sceneY: number
): MindMapCanvasPoint | null {
    const layer = stage.children?.[0];
    if (!layer) return null;
    return layer.getAbsoluteTransform().copy().point({ x: sceneX, y: sceneY });
}

/**
 * scene → 浏览器 client（可视区域左上角为原点，与 clientX/clientY 一致）。
 * 自动化/测试用例按「页面左上角」操作时请使用该坐标。
 */
export function canvasClientPointFromScene(
    stage: any,
    sceneX: number,
    sceneY: number
): MindMapCanvasPoint | null {
    const vp = canvasStageViewportPointFromScene(stage, sceneX, sceneY);
    if (!vp) return null;
    const content = stage.content;
    if (!content) return null;
    const rect = content.getBoundingClientRect();
    return { x: rect.left + vp.x, y: rect.top + vp.y };
}

function roundCoord(n: number, decimals = 1): number {
    const f = 10 ** decimals;
    return Math.round(n * f) / f;
}

function roundPoint(p: MindMapCanvasPoint, decimals = 1): MindMapCanvasPoint {
    return { x: roundCoord(p.x, decimals), y: roundCoord(p.y, decimals) };
}

function scenePolylineToClient(
    stage: any,
    pts: number[],
    decimals = 1
): number[] | null {
    if (pts.length < 2 || pts.length % 2 !== 0) return null;
    const out: number[] = [];
    for (let i = 0; i < pts.length; i += 2) {
        const c = canvasClientPointFromScene(stage, pts[i]!, pts[i + 1]!);
        if (!c) return null;
        const r = roundPoint(c, decimals);
        out.push(r.x, r.y);
    }
    return out;
}

export type MindMapClientCoordDebugPayload = {
    /** 坐标原点说明 */
    coordOrigin: 'browser_viewport_top_left';
    /** 与 MouseEvent.clientX/clientY 同系 */
    description: string;
    stageContentRect: {
        left: number;
        top: number;
        width: number;
        height: number;
    };
    nodes: {
        nodeId: number;
        center: MindMapCanvasPoint;
        bounds: {
            left: number;
            top: number;
            right: number;
            bottom: number;
        };
        /** 左入端口（与连线 ex/ey、startCircle 一致） */
        portLeft: MindMapCanvasPoint;
        /** 右出端口（与连线 sx/sy、endCircle 一致） */
        portRight: MindMapCanvasPoint;
        /** 操作描述为空时的右上角「!」角标；无校验错误时为 null */
        validationBadge: {
            /** 角标圆心（client 坐标，与 MouseEvent.clientX/clientY 同系） */
            center: MindMapCanvasPoint;
            radius: number;
        } | null;
    }[];
    edges: {
        edge: string;
        fromId: number;
        toId: number;
        ports: { sx: number; sy: number; ex: number; ey: number };
        finalLinePts: number[];
        defaultResolveRaw: number[] | null;
    }[];
};

/** 将节点/连线 scene 坐标转为 client，供控制台打印与 UI 自动化对齐 */
export function buildMindMapClientCoordDebugPayload(
    stage: any,
    nodes: readonly {
        nodeId: number;
        x: number;
        y: number;
        rectConf?: { width?: number; height?: number };
        guide?: Record<string, unknown> | null;
    }[],
    routeEdges: readonly Record<string, unknown>[],
    halfW: number,
    halfH: number,
    decimals = 1
): MindMapClientCoordDebugPayload | null {
    const content = stage?.content;
    if (!content) return null;
    const rect = content.getBoundingClientRect();

    const nodesOut: MindMapClientCoordDebugPayload['nodes'] = [];
    const defaultW = halfW * 2;
    const defaultH = halfH * 2;
    for (const node of nodes) {
        const center = canvasClientPointFromScene(stage, node.x, node.y);
        if (!center) return null;
        const b = getNodeBounds(node, halfW, halfH);
        const tl = canvasClientPointFromScene(stage, b.left, b.top);
        const br = canvasClientPointFromScene(stage, b.right, b.bottom);
        const portLeft = canvasClientPointFromScene(stage, b.left, node.y);
        const portRight = canvasClientPointFromScene(stage, b.right, node.y);
        if (!tl || !br || !portLeft || !portRight) return null;

        let validationBadge: MindMapClientCoordDebugPayload['nodes'][number]['validationBadge'] =
            null;
        if (getNodeGuideValidation(node.guide ?? null).hasError) {
            const badgeScene = mindMapValidationBadgeCenterScene(
                node,
                defaultW,
                defaultH
            );
            const badgeClient = canvasClientPointFromScene(
                stage,
                badgeScene.x,
                badgeScene.y
            );
            if (badgeClient) {
                validationBadge = {
                    center: roundPoint(badgeClient, decimals),
                    radius: MIND_MAP_VALIDATION_BADGE_R
                };
            }
        }

        nodesOut.push({
            nodeId: node.nodeId,
            center: roundPoint(center, decimals),
            bounds: {
                left: roundCoord(tl.x, decimals),
                top: roundCoord(tl.y, decimals),
                right: roundCoord(br.x, decimals),
                bottom: roundCoord(br.y, decimals)
            },
            portLeft: roundPoint(portLeft, decimals),
            portRight: roundPoint(portRight, decimals),
            validationBadge
        });
    }

    const edgesOut: MindMapClientCoordDebugPayload['edges'] = [];
    for (const row of routeEdges) {
        const edge = String(row.edge ?? '');
        const fromId = Number(row.fromId);
        const toId = Number(row.toId);
        const ports = row.ports as
            | { sx: number; sy: number; ex: number; ey: number }
            | undefined;
        const finalLinePts = row.finalLinePts as number[] | null | undefined;
        const defaultResolve = row.defaultResolve as
            | { raw?: number[] | null }
            | undefined;

        if (!ports) continue;

        const portsClient = scenePolylineToClient(
            stage,
            [ports.sx, ports.sy, ports.ex, ports.ey],
            decimals
        );
        const finalClient =
            finalLinePts && finalLinePts.length >= 4
                ? scenePolylineToClient(stage, finalLinePts, decimals)
                : null;
        const raw = defaultResolve?.raw;
        const rawClient =
            raw && raw.length >= 4
                ? scenePolylineToClient(stage, raw, decimals)
                : null;

        if (!portsClient) continue;

        edgesOut.push({
            edge,
            fromId,
            toId,
            ports: {
                sx: portsClient[0]!,
                sy: portsClient[1]!,
                ex: portsClient[2]!,
                ey: portsClient[3]!
            },
            finalLinePts: finalClient ?? [],
            defaultResolveRaw: rawClient
        });
    }

    return {
        coordOrigin: 'browser_viewport_top_left',
        description:
            '与浏览器 MouseEvent.clientX/clientY 同系（相对可视区域左上角）。' +
            '若自动化绑定在 Konva canvas 元素上且使用元素内偏移，可用 center/bounds 数值减去 stageContentRect.left/top。',
        stageContentRect: {
            left: roundCoord(rect.left, decimals),
            top: roundCoord(rect.top, decimals),
            width: roundCoord(rect.width, decimals),
            height: roundCoord(rect.height, decimals)
        },
        nodes: nodesOut,
        edges: edgesOut
    };
}

export function canvasScenePointFromStageViewport(
    stage: any,
    vx: number,
    vy: number
): MindMapCanvasPoint | null {
    const layer = stage.children?.[0];
    if (!layer) return null;
    const transform = layer.getAbsoluteTransform().copy().invert();
    return transform.point({ x: vx, y: vy });
}

export function canvasPointFromStage(stage: any): MindMapCanvasPoint | null {
    const pos = stage.getPointerPosition?.();
    if (!pos) return null;
    return canvasScenePointFromStageViewport(stage, pos.x, pos.y);
}

export function canvasScenePointFromStageClientEvent(
    stage: any,
    ev: MouseEvent
): MindMapCanvasPoint | null {
    const content = stage.content;
    if (!content) return null;
    const rect = content.getBoundingClientRect();
    return canvasScenePointFromStageViewport(
        stage,
        ev.clientX - rect.left,
        ev.clientY - rect.top
    );
}
