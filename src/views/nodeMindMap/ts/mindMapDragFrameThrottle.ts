/**
 * 节点拖动时合并「坐标/吸附 + 连线重算 + 磁吸预览」到每帧最多一次。
 * onFrame 在拖动中收到 movingIds，宿主可只重算与移动节点相连的边。
 */

export type MindMapDragMoveTask = {
    movingIds: Set<number>;
    origins: Map<number, { x: number; y: number }>;
    dx: number;
    dy: number;
    /** 吸附并写入 nodeList 后同步 Konva（如单节点 drag leader） */
    syncKonvaLeader?: () => void;
};

export interface MindMapDragLayoutScheduler {
    isDragging: () => boolean;
    beginDrag: () => void;
    endDrag: () => void;
    /** 合并多次 dragmove 到下一帧；仅保留最新 delta */
    scheduleDragMove: (task: MindMapDragMoveTask) => void;
    scheduleFrame: (movingIds?: Set<number>) => void;
}

export function createMindMapDragLayoutScheduler(options: {
    /** 拖动中传入 movingIds 供增量重算；松手 flush 时不传，应做全量重算 */
    onFrame: (movingIds?: Set<number>) => void;
    onSnap?: (movingIds: Set<number>) => void;
    /** 每帧最多执行一次：对齐吸附 + 写 nodeList 坐标 */
    onDragMoveApply?: (task: MindMapDragMoveTask) => void;
}): MindMapDragLayoutScheduler {
    let dragDepth = 0;
    let rafId: number | null = null;
    let pendingSnapIds: Set<number> | null = null;
    let pendingDragMove: MindMapDragMoveTask | null = null;

    function runSnap(ids: Set<number> | null | undefined) {
        if (!ids?.size || !options.onSnap) return;
        options.onSnap(ids);
    }

    function flushRafWork() {
        if (rafId != null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        const dragTask = pendingDragMove;
        pendingDragMove = null;
        if (dragTask) {
            options.onDragMoveApply?.(dragTask);
        }
        const snapIds = pendingSnapIds;
        pendingSnapIds = null;
        if (snapIds) runSnap(snapIds);
        options.onFrame(snapIds ?? undefined);
    }

    function scheduleRaf(movingIds?: Set<number>) {
        if (movingIds) pendingSnapIds = movingIds;
        if (rafId != null) return;
        rafId = requestAnimationFrame(() => {
            rafId = null;
            flushRafWork();
        });
    }

    return {
        isDragging: () => dragDepth > 0,
        beginDrag() {
            dragDepth++;
        },
        endDrag() {
            if (dragDepth > 0) dragDepth--;
            /** 松手后不再刷新磁吸预览（宿主已在 commit 前清空；否则仍贴近目标时会误恢复虚线/衔接点） */
            if (rafId != null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
            /** 最后一帧 dragmove 可能还在 pending；须先落盘坐标再全量重算连线 */
            const dragTask = pendingDragMove;
            pendingDragMove = null;
            pendingSnapIds = null;
            if (dragTask) {
                options.onDragMoveApply?.(dragTask);
            }
            options.onFrame(undefined);
        },
        scheduleDragMove(task) {
            pendingDragMove = task;
            scheduleRaf(task.movingIds);
        },
        scheduleFrame(movingIds) {
            scheduleRaf(movingIds);
        }
    };
}
