/**
 * 弱连通序列块底衬：单击仅块焦点、拖动整体平移、双击整块写入框选；
 * document 捕获阶段监听与画布撤销拖拽回调由页面注入。
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue';

import {
    computeMindMapSequenceBlockBackdropItems,
    type MindMapSequenceBlockBackdropItem,
    type ResolveMindMapSequenceBlockEdgePolylines
} from './medicineGuide';
import type { MindMapDragMoveTask } from './mindMapDragFrameThrottle';

export type { MindMapSequenceBlockBackdropItem };

const DRAG_UNDO_MIN_SQ = 7 * 7;

export interface MindMapSequenceBlockBackdropCtlOptions {
    nodeList: any[];
    selectedNodes: Set<number>;
    activeNodes: Set<number>;
    selectedEdge: Ref<{ fromId: number; toId: number } | null>;
    syncNodeOutlineStrokes: () => void;
    closeNodeDrawer: () => void;
    closeNodeCtxMenu: () => void;
    canvasPointFromStage: (stage: any) => { x: number; y: number } | null;
    getStageDraggable: () => boolean;
    mindMapUndoOnDragStart: () => void;
    mindMapUndoOnDragMove: () => void;
    mindMapUndoOnDragEnd: () => void;
    markSuppressNextStageClearClick: () => void;
    /** 块拖动时节流连线重算（与节点 dragmove 共用 rAF） */
    onBlockDragFrame?: (movingIds: Set<number>) => void;
    /** 合并块拖动坐标更新到 rAF（与节点 dragmove 一致） */
    scheduleCoalescedDragMove?: (task: MindMapDragMoveTask) => void;
    onBlockDragBegin?: () => void;
    onBlockDragEnd?: (movingIds: Set<number>) => void;
    /** 块平移 delta 修正（如拖动对齐吸附） */
    transformBlockDragDelta?: (
        movingIds: Set<number>,
        origins: Map<number, { x: number; y: number }>,
        dx: number,
        dy: number
    ) => { dx: number; dy: number };
    /** 组内连线折线，用于组框同时包住避障走线 */
    resolveComponentEdgePolylines?: ResolveMindMapSequenceBlockEdgePolylines;
    /** 拖动中跳过组框按连线扩边（避免每帧全量避障） */
    getIsDragging?: () => boolean;
}

export interface MindMapSequenceBlockBackdropCtl {
    focusedKey: Ref<string | null>;
    backdropItems: ComputedRef<MindMapSequenceBlockBackdropItem[]>;
    clearFocus: () => void;
    tryHandleEscape: () => boolean;
    isNodeLockedBySequenceBackdropBlock: (node: any) => boolean;
    onBackdropPointerDown: (
        e: any,
        block: MindMapSequenceBlockBackdropItem
    ) => void;
    onBackdropDoubleClick: (
        e: any,
        block: MindMapSequenceBlockBackdropItem
    ) => void;
    dispose: () => void;
    isBackdropHighlight: (block: MindMapSequenceBlockBackdropItem) => boolean;
    isFocused: (block: MindMapSequenceBlockBackdropItem) => boolean;
    isSelectionActive: (block: MindMapSequenceBlockBackdropItem) => boolean;
    /** 单击底衬未框中任何节点时：仅块焦点（不整组选中） */
    applyBlockFocusOnly: (block: MindMapSequenceBlockBackdropItem) => void;
}

function structuralKey(nodeIds: readonly number[]): string {
    return [...nodeIds].sort((a, b) => a - b).join('|');
}

export function createMindMapSequenceBlockBackdropCtl(
    opts: MindMapSequenceBlockBackdropCtlOptions
): MindMapSequenceBlockBackdropCtl {
    const focusedKey = ref<string | null>(null);

    const backdropItems = computed(() =>
        computeMindMapSequenceBlockBackdropItems(
            opts.nodeList,
            undefined,
            opts.getIsDragging?.()
                ? undefined
                : opts.resolveComponentEdgePolylines
        )
    );

    let dragSession: {
        stage: any;
        ids: Set<number>;
        origins: Map<number, { x: number; y: number }>;
        anchorCanvasX: number;
        anchorCanvasY: number;
        dragStartCanvasX: number;
        dragStartCanvasY: number;
        undoStarted: boolean;
    } | null = null;

    function clearFocus() {
        focusedKey.value = null;
    }

    function isSelectionActive(
        block: MindMapSequenceBlockBackdropItem
    ): boolean {
        if (opts.selectedNodes.size !== block.nodeIds.length) return false;
        for (const id of block.nodeIds) {
            if (!opts.selectedNodes.has(id)) return false;
        }
        return true;
    }

    function isFocused(block: MindMapSequenceBlockBackdropItem): boolean {
        const k = focusedKey.value;
        return k !== null && structuralKey(block.nodeIds) === k;
    }

    function assignFocusOnly(block: MindMapSequenceBlockBackdropItem) {
        opts.closeNodeCtxMenu();
        opts.closeNodeDrawer();
        opts.selectedEdge.value = null;
        opts.activeNodes.clear();
        opts.selectedNodes.clear();
        focusedKey.value = structuralKey(block.nodeIds);
        opts.syncNodeOutlineStrokes();
    }

    function applyFullBlockSelection(block: MindMapSequenceBlockBackdropItem) {
        opts.closeNodeCtxMenu();
        opts.closeNodeDrawer();
        opts.selectedEdge.value = null;
        opts.activeNodes.clear();
        opts.selectedNodes.clear();
        const ids = [...block.nodeIds].sort((a, b) => a - b);
        for (const id of ids) opts.selectedNodes.add(id);
        if (ids.length) opts.activeNodes.add(ids[0]!);
        focusedKey.value = structuralKey(block.nodeIds);
        opts.syncNodeOutlineStrokes();
    }

    function unlinkDragListeners() {
        document.removeEventListener('mousemove', onDragDocumentMove, true);
        document.removeEventListener('mouseup', onDragDocumentFinish, true);
        document.removeEventListener('pointerup', onDragDocumentFinish, true);
        document.removeEventListener(
            'pointercancel',
            onDragDocumentFinish,
            true
        );
    }

    function onDragDocumentMove() {
        const sess = dragSession;
        if (!sess) return;
        const cur = opts.canvasPointFromStage(sess.stage);
        if (!cur) return;

        const ddx = cur.x - sess.dragStartCanvasX;
        const ddy = cur.y - sess.dragStartCanvasY;
        if (!sess.undoStarted) {
            if (ddx * ddx + ddy * ddy < DRAG_UNDO_MIN_SQ) {
                return;
            }
            opts.mindMapUndoOnDragStart();
            opts.onBlockDragBegin?.();
            sess.undoStarted = true;
        }

        const dx = cur.x - sess.anchorCanvasX;
        const dy = cur.y - sess.anchorCanvasY;
        if (opts.scheduleCoalescedDragMove) {
            opts.scheduleCoalescedDragMove({
                movingIds: sess.ids,
                origins: sess.origins,
                dx,
                dy
            });
            return;
        }

        opts.mindMapUndoOnDragMove();
        const transformed = opts.transformBlockDragDelta?.(
            sess.ids,
            sess.origins,
            dx,
            dy
        );
        const appliedDx = transformed?.dx ?? dx;
        const appliedDy = transformed?.dy ?? dy;
        for (const n of opts.nodeList) {
            if (!sess.ids.has(n.nodeId)) continue;
            const o = sess.origins.get(n.nodeId);
            if (!o) continue;
            n.x = o.x + appliedDx;
            n.y = o.y + appliedDy;
        }
        opts.onBlockDragFrame?.(sess.ids);
    }

    function onDragDocumentFinish() {
        unlinkDragListeners();
        const sess = dragSession;
        dragSession = null;
        if (sess?.undoStarted) {
            opts.mindMapUndoOnDragEnd();
            opts.onBlockDragEnd?.(sess.ids);
        }
        opts.markSuppressNextStageClearClick();
    }

    function beginDrag(e: any, block: MindMapSequenceBlockBackdropItem) {
        /** 空格/「视角」平移时 Stage 可拖：禁止拦冒泡，否则 Konva 收不到 mousedown，无法在底衬上拖动画布 */
        if (opts.getStageDraggable()) return;

        e.cancelBubble = true;
        e.evt?.preventDefault?.();
        e.evt?.stopPropagation?.();

        const stage = e.target?.getStage?.();
        if (!stage) return;
        const pt = opts.canvasPointFromStage(stage);
        if (!pt) return;

        if (dragSession) {
            unlinkDragListeners();
            const prev = dragSession;
            if (prev?.undoStarted) {
                opts.mindMapUndoOnDragEnd();
            }
            dragSession = null;
        }

        const origins = new Map<number, { x: number; y: number }>();
        const idSet = new Set(block.nodeIds);
        for (const n of opts.nodeList) {
            if (idSet.has(n.nodeId)) {
                origins.set(n.nodeId, { x: n.x, y: n.y });
            }
        }
        dragSession = {
            stage,
            ids: idSet,
            origins,
            anchorCanvasX: pt.x,
            anchorCanvasY: pt.y,
            dragStartCanvasX: pt.x,
            dragStartCanvasY: pt.y,
            undoStarted: false
        };
        document.addEventListener('mousemove', onDragDocumentMove, true);
        document.addEventListener('mouseup', onDragDocumentFinish, true);
        document.addEventListener('pointerup', onDragDocumentFinish, true);
        document.addEventListener('pointercancel', onDragDocumentFinish, true);
    }

    function onBackdropPointerDown(
        e: any,
        block: MindMapSequenceBlockBackdropItem
    ) {
        if (opts.getStageDraggable()) return;

        opts.markSuppressNextStageClearClick();
        if (!isSelectionActive(block)) {
            assignFocusOnly(block);
        }
        beginDrag(e, block);
    }

    function onBackdropDoubleClick(
        e: any,
        block: MindMapSequenceBlockBackdropItem
    ) {
        if (opts.getStageDraggable()) return;

        e.cancelBubble = true;
        e.evt?.preventDefault?.();
        e.evt?.stopPropagation?.();
        unlinkDragListeners();
        const dragSess = dragSession;
        dragSession = null;
        if (dragSess?.undoStarted) {
            opts.mindMapUndoOnDragEnd();
        }
        opts.markSuppressNextStageClearClick();
        applyFullBlockSelection(block);
    }

    function isNodeLockedBySequenceBackdropBlock(node: any): boolean {
        if (!backdropItems.value.length) return false;
        const nid = node.nodeId;
        for (const blk of backdropItems.value) {
            if (!blk.nodeIds.includes(nid)) continue;
            if (isSelectionActive(blk)) continue;
            if (!isFocused(blk)) continue;
            /** 组内已框选/多选部分节点时，允许单独拖动选中子集 */
            if (opts.selectedNodes.has(nid)) return false;
            return true;
        }
        return false;
    }

    function tryHandleEscape(): boolean {
        if (opts.selectedEdge.value) return false;
        for (const blk of backdropItems.value) {
            if (isSelectionActive(blk)) {
                opts.selectedNodes.clear();
                opts.activeNodes.clear();
                focusedKey.value = null;
                opts.syncNodeOutlineStrokes();
                return true;
            }
        }
        if (focusedKey.value) {
            focusedKey.value = null;
            return true;
        }
        return false;
    }

    function dispose() {
        unlinkDragListeners();
        if (dragSession) {
            if (dragSession.undoStarted) {
                opts.mindMapUndoOnDragEnd();
            }
            dragSession = null;
        }
    }

    function isBackdropHighlight(
        block: MindMapSequenceBlockBackdropItem
    ): boolean {
        return isFocused(block) || isSelectionActive(block);
    }

    const api: MindMapSequenceBlockBackdropCtl = {
        focusedKey,
        backdropItems,
        clearFocus,
        tryHandleEscape,
        isNodeLockedBySequenceBackdropBlock,
        onBackdropPointerDown,
        onBackdropDoubleClick,
        dispose,
        isBackdropHighlight,
        isFocused,
        isSelectionActive,
        applyBlockFocusOnly: assignFocusOnly
    };
    return api;
}
