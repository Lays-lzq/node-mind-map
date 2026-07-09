/**
 * 思维导图画布「整表快照」撤销：每项为操作前 nodeList 的深拷贝，步数上限可配。
 */

import { ElMessage } from 'element-plus';
import { computed, reactive } from 'vue';

export const DEFAULT_MIND_MAP_UNDO_MAX = 10;

export interface CreateMindMapUndoControllerOptions {
    /** 与页面 reactive 共用的画布节点数组 */
    getNodeList: () => any[];
    /** 与业务侧 deepClone 一致（如 @/utils/other） */
    deepClone: (source: any) => any;
    /** 恢复快照后重置选中描边、关抽屉等 */
    onAfterRestore: () => void;
    maxSteps?: number;
}

export function createMindMapUndoController(
    options: CreateMindMapUndoControllerOptions
) {
    const maxSteps = options.maxSteps ?? DEFAULT_MIND_MAP_UNDO_MAX;
    const stack = reactive<any[][]>([]);

    function pushSnapshotFromCurrentNodes() {
        stack.push(options.deepClone(options.getNodeList()) as any[]);
        while (stack.length > maxSteps) {
            stack.shift();
        }
    }

    function discardLastSnapshot() {
        stack.pop();
    }

    function clear() {
        stack.splice(0, stack.length);
    }

    function undo() {
        if (!stack.length) {
            ElMessage.info('没有可撤销的操作');
            return;
        }
        const prev = stack.pop()!;
        const list = options.getNodeList();
        list.splice(
            0,
            list.length,
            ...(options.deepClone(prev) as any[])
        );
        options.onAfterRestore();
    }

    let pendingDragSnapshot: any[] | null = null;
    let dragSessionDidMove = false;

    function onDragStart() {
        pendingDragSnapshot = options.deepClone(
            options.getNodeList()
        ) as any[];
        dragSessionDidMove = false;
    }

    function onDragMove() {
        dragSessionDidMove = true;
    }

    function onDragEnd() {
        if (dragSessionDidMove && pendingDragSnapshot) {
            stack.push(pendingDragSnapshot);
            while (stack.length > maxSteps) {
                stack.shift();
            }
        }
        pendingDragSnapshot = null;
        dragSessionDidMove = false;
    }

    const canUndo = computed(() => stack.length > 0);

    return {
        pushSnapshotFromCurrentNodes,
        discardLastSnapshot,
        clear,
        undo,
        onDragStart,
        onDragMove,
        onDragEnd,
        canUndo
    };
}
