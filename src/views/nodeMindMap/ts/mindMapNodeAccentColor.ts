/** 脑图节点区分色：按拓扑层级着色，与 Python StepAction 拓扑图 palette 一致 */
export const MIND_MAP_NODE_ACCENT_PALETTE = [
    '#E41A1C',  // 红 - 层级0
    '#377EB8',  // 蓝 - 层级1
    '#4DAF4A',  // 绿 - 层级2
    '#984EA3',  // 紫 - 层级3
    '#FF7F00',  // 橙 - 层级4
    '#C9C200',  // 黄 - 层级5（柔和柠檬黄，与橙/棕区分）
    '#A65628',  // 棕 - 层级6
    '#F781BF',  // 粉 - 层级7
    '#999999',  // 灰 - 层级8
    '#000000',  // 黑 - 层级9
    '#00CED1',  // 深青 - 层级10
    '#FFD700',  // 金色 - 层级11
    '#8A2BE2',  // 蓝紫 - 层级12
    '#DC143C',  // 深红 - 层级13
    '#228B22',  // 森林绿 - 层级14
] as const;

/** 超出预定义 palette 时的灰度备用色（与 Python 脚本 fallback 一致） */
function mindMapAccentFallbackGray(levelIndex: number): string {
    const v = Math.min(255, 128 + levelIndex * 10);
    const hex = v.toString(16).padStart(2, '0');
    return `#${hex}${hex}${hex}`;
}

/** 按拓扑层级取区分色 */
export function getMindMapNodeAccentColorByLevel(level: number): string {
    const idx = Math.max(0, Math.floor(Number(level)));
    if (!Number.isFinite(idx)) return MIND_MAP_NODE_ACCENT_PALETTE[0];
    if (idx < MIND_MAP_NODE_ACCENT_PALETTE.length) {
        return MIND_MAP_NODE_ACCENT_PALETTE[idx]!;
    }
    return mindMapAccentFallbackGray(idx);
}

/** 由 nodeId + 层级表解析区分色 */
export function resolveMindMapNodeAccentColor(
    nodeId: number,
    levels: ReadonlyMap<number, number>
): string {
    return getMindMapNodeAccentColorByLevel(levels.get(nodeId) ?? 0);
}

function hexChannelPair(hex: string, from: number): number {
    return parseInt(hex.slice(from, from + 2), 16);
}

/** #RRGGBB → rgba，供 Konva 描边使用 */
export function mindMapAccentHexToRgba(hex: string, alpha: number): string {
    const h = String(hex ?? '').trim();
    if (!/^#[0-9A-Fa-f]{6}$/.test(h)) {
        return `rgba(26, 85, 233, ${alpha})`;
    }
    const r = hexChannelPair(h, 1);
    const g = hexChannelPair(h, 3);
    const b = hexChannelPair(h, 5);
    const a = Math.min(1, Math.max(0, alpha));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** 节点卡片描边：与层级区分色同色系半透明 */
export function getMindMapNodeAccentBorderStroke(
    level: number,
    options?: { alpha?: number }
): string {
    const alpha = options?.alpha ?? 0.38;
    return mindMapAccentHexToRgba(getMindMapNodeAccentColorByLevel(level), alpha);
}

export const MIND_MAP_NODE_BORDER_ALPHA = {
    default: 0.38,
    highlighted: 0.88
} as const;
