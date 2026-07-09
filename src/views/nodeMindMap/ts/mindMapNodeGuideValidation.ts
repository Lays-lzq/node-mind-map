import {
    getMindMapNodeAccentBorderStroke,
    MIND_MAP_NODE_BORDER_ALPHA
} from './mindMapNodeAccentColor';

/** 画布节点右上角「!」角标背景色（操作描述为空时显示） */
export const NODE_GUIDE_VALIDATION_BADGE_FILL = '#FF4D4F';

/** 与 NodeMindMapKonvaNode 角标绘制一致 */
export const MIND_MAP_VALIDATION_BADGE_R = 9;
export const MIND_MAP_VALIDATION_BADGE_INSET_X = 14;
export const MIND_MAP_VALIDATION_BADGE_INSET_Y = 12;

/** 「!」角标圆心：节点 group 局部坐标（卡片左上角为原点） */
export function mindMapValidationBadgeCenterLocal(cardWidth: number): {
    cx: number;
    cy: number;
} {
    return {
        cx:
            cardWidth -
            MIND_MAP_VALIDATION_BADGE_R -
            MIND_MAP_VALIDATION_BADGE_INSET_X,
        cy: MIND_MAP_VALIDATION_BADGE_R + MIND_MAP_VALIDATION_BADGE_INSET_Y
    };
}

/** 「!」角标圆心：画布 scene 坐标（与 Konva group x/y + offset 一致） */
export function mindMapValidationBadgeCenterScene(
    node: {
        x: number;
        y: number;
        rectConf?: { width?: number; height?: number };
    },
    defaultWidth: number,
    defaultHeight: number
): { x: number; y: number } {
    const rw = Number(node.rectConf?.width);
    const rh = Number(node.rectConf?.height);
    const w = Number.isFinite(rw) && rw > 0 ? rw : defaultWidth;
    const h = Number.isFinite(rh) && rh > 0 ? rh : defaultHeight;
    const { cx, cy } = mindMapValidationBadgeCenterLocal(w);
    return {
        x: node.x + cx - w / 2,
        y: node.y + cy - h / 2
    };
}

export interface NodeGuideValidation {
    operationDescEmpty: boolean;
    hasError: boolean;
    tooltipMessage: string | null;
}

export function isGuideFieldEmpty(value: unknown): boolean {
    return !String(value ?? '').trim();
}

export function getNodeGuideValidation(
    guide: Record<string, unknown> | null | undefined
): NodeGuideValidation {
    const operationDescEmpty = isGuideFieldEmpty(guide?.operationDesc);
    const hasError = operationDescEmpty;

    const tooltipMessage = operationDescEmpty ? '操作描述不能为空' : null;

    return {
        operationDescEmpty,
        hasError,
        tooltipMessage
    };
}

/** 画布节点描边色：选中/框选高亮 > 层级区分色半透明描边 */
export function resolveMindMapNodeStroke(
    _guide: Record<string, unknown> | null | undefined,
    highlighted: boolean,
    nodeLevel?: number
): string {
    const level = Number.isFinite(Number(nodeLevel))
        ? Math.max(0, Math.floor(Number(nodeLevel)))
        : null;
    if (highlighted && level != null) {
        return getMindMapNodeAccentBorderStroke(level, {
            alpha: MIND_MAP_NODE_BORDER_ALPHA.highlighted
        });
    }
    if (highlighted) return '#1A55E9';
    if (level != null) {
        return getMindMapNodeAccentBorderStroke(level, {
            alpha: MIND_MAP_NODE_BORDER_ALPHA.default
        });
    }
    return '#E4E3F0';
}
