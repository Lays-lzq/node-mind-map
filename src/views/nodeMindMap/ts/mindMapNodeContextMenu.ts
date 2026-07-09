/**
 * nodeMindMap 画布「节点右键」上下文菜单逻辑（不包含样式；DOM class 名称与 Vue 模板需一致）。
 */

import type { MindMapCanvasNode } from './mindMapNodeOps';
import { reactive, ref, type Ref } from 'vue';

/** Vue 模板中菜单面板根节点 class（与 document 兜底关闭同源） */
export const MIND_MAP_NODE_CTX_MENU_CLASS = 'node-mind-map-context-menu';
/** Vue 模板中半透明遮罩 class */
export const MIND_MAP_NODE_CTX_DISMISS_CLASS = 'node-mind-map-ctx-dismiss';

export const SELECTOR_MIND_MAP_NODE_CTX_MENU =
    '.' + MIND_MAP_NODE_CTX_MENU_CLASS;
export const SELECTOR_MIND_MAP_NODE_CTX_DISMISS =
    '.' + MIND_MAP_NODE_CTX_DISMISS_CLASS;

/** Vue Transition 的 name（仅作文档，需在 SFC 中同名） */
export const MIND_MAP_NODE_CTX_TRANSITION_NAME = 'node-mm-ctx';

export const DEFAULT_NODE_CTX_MENU_WIDTH = 168;
export const DEFAULT_NODE_CTX_MENU_HEIGHT = 160;
/** 仅「删除」时的菜单高度（单行按钮 + 边距） */
export const DEFAULT_EDGE_CTX_MENU_HEIGHT = 64;

/** 正式连线 Path / Arrow 的 Konva attrs，与 index.vue arrowLines 配置一致 */
export const MIND_MAP_KONVA_EDGE_FROM_ID_ATTR = 'mindMapEdgeFromId';
export const MIND_MAP_KONVA_EDGE_TO_ID_ATTR = 'mindMapEdgeToId';

export type MindMapCtxMenuKind = 'node' | 'edge';

function readKonvaAttr(
    target: unknown,
    key: string
): number | undefined {
    const t = target as
        | { getAttr?: (k: string) => unknown; attrs?: Record<string, unknown> }
        | undefined;
    if (!t) return undefined;
    const raw =
        typeof t.getAttr === 'function' ? t.getAttr(key) : t.attrs?.[key];
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? n : undefined;
}

/** 从 Konva 事件 target 读取有向边（需在 path/arrow config 上写入上述 attrs） */
export function readMindMapEdgeHitFromKonvaTarget(
    target: unknown
): { fromId: number; toId: number } | null {
    const fromId = readKonvaAttr(target, MIND_MAP_KONVA_EDGE_FROM_ID_ATTR);
    const toId = readKonvaAttr(target, MIND_MAP_KONVA_EDGE_TO_ID_ATTR);
    if (fromId === undefined || toId === undefined) return null;
    return { fromId, toId };
}

export type CanvasPointFn = (
    stage: unknown
) => { x: number; y: number } | null;

export type PickNodeAtCanvasFn = (
    nodes: readonly MindMapCanvasNode[],
    px: number,
    py: number,
    excludeId: number
) => MindMapCanvasNode | null;

export type PrepareOpenMindMapCtxContext =
    | { kind: 'node'; node: MindMapCanvasNode }
    | { kind: 'edge'; fromId: number; toId: number };

export interface CreateMindMapNodeContextMenuControllerOptions {
    /** 右键菜单占位宽高（视口卡边） */
    menuApproxWidth?: number;
    menuApproxHeight?: number;
    /** 仅删除连线时的占位高度（单行） */
    menuApproxHeightEdge?: number;
    /** 当前画布节点列表 */
    getNodeList: () => readonly MindMapCanvasNode[];
    /** `pickNodeAtCanvasPoint` 第四个参数排除 id（如幻影节点） */
    pickExcludeNodeId: number;
    canvasPointFromStage: CanvasPointFn;
    pickNodeAtCanvasPoint: PickNodeAtCanvasFn;
    /** 打开菜单前避免出现「紧随其后 stage click」清空选中 */
    markSuppressNextStageClearClick: () => void;
    /** 按节点 / 连线分别准备画布选中态并关抽屉等 */
    prepareOpenContext: (ctx: PrepareOpenMindMapCtxContext) => void;
    /** 将命中节点设为「主选中」（描边、接续圆点） */
    applyPrimarySelection: (node: MindMapCanvasNode) => void;
    /**
     * 返回 true 时跳过 applyPrimarySelection（多选/框选已对命中节点勾选时右键，保留选中集合）。
     */
    shouldSkipApplyPrimarySelection?: (node: MindMapCanvasNode) => boolean;
    /** 右键菜单「编辑」（节点） */
    openEditorForNode: (node: unknown) => void;
    /** 右键菜单「AI 展开」（节点） */
    onAiExpandRequest?: (node: MindMapCanvasNode) => void;
    /** 节点：打开与键盘 Delete 相同的删除确认弹窗 */
    openDeleteConfirmation: () => void;
    /** 连线：与键盘 Delete 一致，立刻删边（含 undo 栈） */
    deleteEdgeImmediate: (fromId: number, toId: number) => void;
}

function clampMindMapCtxMenuViewport(
    clientX: number,
    clientY: number,
    pos: { left: number; top: number },
    menuWidth: number,
    menuHeight: number
): void {
    if (typeof window === 'undefined') return;
    const pad = 6;
    const maxL = window.innerWidth - menuWidth - pad;
    const maxT = window.innerHeight - menuHeight - pad;
    pos.left = Math.max(pad, Math.min(clientX, maxL));
    pos.top = Math.max(pad, Math.min(clientY, maxT));
}

export function createMindMapNodeContextMenuController(
    options: CreateMindMapNodeContextMenuControllerOptions
): {
    visible: Ref<boolean>;
    menuKind: Ref<MindMapCtxMenuKind>;
    menuPos: { left: number; top: number };
    close: () => void;
    onDocumentMaybeCloseCtxMenu: (ev: MouseEvent) => void;
    onBackdropMouseDown: (ev?: MouseEvent) => void;
    /** Konva / vue-konva Stage 元素 @contextmenu */
    onKonvaStageContextMenu: (e: unknown) => void;
    handleEditClick: () => void;
    handleAiExpandClick: () => void;
    handleDeleteClick: () => void;
} {
    const w = options.menuApproxWidth ?? DEFAULT_NODE_CTX_MENU_WIDTH;
    const h = options.menuApproxHeight ?? DEFAULT_NODE_CTX_MENU_HEIGHT;
    const hEdge =
        options.menuApproxHeightEdge ?? DEFAULT_EDGE_CTX_MENU_HEIGHT;
    const visible = ref(false);
    const menuKind = ref<MindMapCtxMenuKind>('node');
    const menuPos = reactive({ left: 0, top: 0 });
    /** 右键打开期间暂存的画布节点引用 */
    let targetNode: MindMapCanvasNode | null = null;
    /** 连线右键：待删除的有向边 */
    let targetEdge: { fromId: number; toId: number } | null = null;

    function close(): void {
        visible.value = false;
        targetNode = null;
        targetEdge = null;
        menuKind.value = 'node';
    }

    function onDocumentMaybeCloseCtxMenu(ev: MouseEvent): void {
        if (!visible.value) return;
        const t = ev.target as HTMLElement | null;
        if (!t?.closest) return;
        if (t.closest(SELECTOR_MIND_MAP_NODE_CTX_MENU)) return;
        if (t.closest(SELECTOR_MIND_MAP_NODE_CTX_DISMISS)) return;
        close();
    }

    function onBackdropMouseDown(_ev?: MouseEvent): void {
        close();
    }

    /**
     * 在命中节点后以视口坐标打开菜单（内部会先 prepare + 主选）。
     */
    function openForNodeHit(
        node: MindMapCanvasNode,
        clientX: number,
        clientY: number
    ): void {
        menuKind.value = 'node';
        options.markSuppressNextStageClearClick();
        options.prepareOpenContext({ kind: 'node', node });
        if (!options.shouldSkipApplyPrimarySelection?.(node)) {
            options.applyPrimarySelection(node);
        }
        targetNode = node;
        targetEdge = null;
        clampMindMapCtxMenuViewport(clientX, clientY, menuPos, w, h);
        visible.value = true;
    }

    function openForEdgeHit(
        fromId: number,
        toId: number,
        clientX: number,
        clientY: number
    ): void {
        menuKind.value = 'edge';
        options.markSuppressNextStageClearClick();
        options.prepareOpenContext({ kind: 'edge', fromId, toId });
        targetNode = null;
        targetEdge = { fromId, toId };
        clampMindMapCtxMenuViewport(clientX, clientY, menuPos, w, hEdge);
        visible.value = true;
    }

    function onKonvaStageContextMenu(e: unknown): void {
        const evt = e as {
            evt?: MouseEvent | undefined;
            target?: { getStage?: () => unknown } | undefined;
        } | null;
        evt?.evt?.preventDefault?.();

        const domEvt = evt?.evt;
        const cx =
            typeof domEvt?.clientX === 'number' ? domEvt.clientX : menuPos.left;
        const cy =
            typeof domEvt?.clientY === 'number' ? domEvt.clientY : menuPos.top;

        const edgeHit = readMindMapEdgeHitFromKonvaTarget(evt?.target ?? null);
        if (edgeHit) {
            openForEdgeHit(edgeHit.fromId, edgeHit.toId, cx, cy);
            return;
        }

        const stage = evt?.target?.getStage?.();
        const list = options.getNodeList();

        if (!stage || list.length === 0) {
            close();
            return;
        }

        const pt = options.canvasPointFromStage(stage);
        if (!pt) {
            close();
            return;
        }

        const hit = options.pickNodeAtCanvasPoint(
            list,
            pt.x,
            pt.y,
            options.pickExcludeNodeId
        );

        if (!hit) {
            close();
            return;
        }

        openForNodeHit(hit, cx, cy);
    }

    function handleEditClick(): void {
        const n = targetNode;
        close();
        if (n) options.openEditorForNode(n);
    }

    function handleAiExpandClick(): void {
        const n = targetNode;
        close();
        if (n) options.onAiExpandRequest?.(n);
    }

    function handleDeleteClick(): void {
        const e = targetEdge;
        close();
        if (e) {
            options.deleteEdgeImmediate(e.fromId, e.toId);
            return;
        }
        options.openDeleteConfirmation();
    }

    return {
        visible,
        menuKind,
        menuPos,
        close,
        onDocumentMaybeCloseCtxMenu,
        onBackdropMouseDown,
        onKonvaStageContextMenu,
        handleEditClick,
        handleAiExpandClick,
        handleDeleteClick
    };
}
