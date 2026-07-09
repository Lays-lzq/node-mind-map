<script setup lang="ts" name="NodeMindMap">
    import { useWheel } from '@/hooks/useWheelFn';
    import type Konva from 'konva';
    import { deepClone } from '@/utils/other';
    import { ElMessage } from 'element-plus';
    import StyledConfirmDialog from './components/StyledConfirmDialog.vue';
    import NodeMindMapEditorHeader from './components/NodeMindMapEditorHeader.vue';
    import NodeMindMapDrawer from './components/NodeMindMapDrawer.vue';
    import NodeMindMapPreviewDialog from './components/NodeMindMapPreviewDialog.vue';
    import NodeMindMapKonvaNode from './components/NodeMindMapKonvaNode.vue';
    import AiGenerateDialog from './components/AiGenerateDialog.vue';
    import { generateMindMap, expandMindMapNode } from '@/api/ai';
    import {
        applyAiMindMapTree,
        applyAiExpandChildren,
        buildMindMapContextSummary,
        getNodeTitle
    } from './ts/aiMindMapTree';
    import type { DrawerVideoItem } from './components/NodeMindMapDrawer.vue';
    import {
        NODE_RECT_LAYOUT,
        NODE_CIRCLE_LAYOUT,
        applyLayerLayoutWithSeparatedComponents,
        buildMindMapLayoutOptions,
        computeMindMapNodeLevels,
        mindMapNodesContentAabb,
        resolveMindMapLayoutOverlapsAfterNodeResize,
        createEmptyGuidePayload,
        ensureGuideCollectionsFor,
        extractGuideFromRow,
        reconcileMindMapNodeTopology,
        getDefaultSupportJson,
        mindMapNodesToTableRows,
        normalizeLinkArray,
        MIND_MAP_SEQUENCE_BLOCK_BACKDROP_PAD,
        invalidateMindMapSequenceBlockWeakCompCache
    } from './ts/medicineGuide';
    import { invalidateMindMapRouteComponentIndexCache } from './ts/mindMapWeakComponents';
    import {
        NODE_GUIDE_VALIDATION_BADGE_FILL,
        resolveMindMapNodeStroke
    } from './ts/mindMapNodeGuideValidation';

    const nodeGuideValidationTipBg = NODE_GUIDE_VALIDATION_BADGE_FILL;
    import { getMindMapNodeAccentColorByLevel } from './ts/mindMapNodeAccentColor';
    import {
        LINK_DRAG_TARGET_PHANTOM_ID,
        addChildNodeUnder as appendMindMapChildUnder,
        appendStandaloneMindMapNode,
        establishMindMapLink,
        mindMapNodeIdsThatCanReachTarget,
        maxNodeIdInList,
        removeMindMapDirectedEdge,
        getMindMapNodeAxisBounds,
        pickNodeAtCanvasPoint as pickMindMapNodeAtCanvasPoint,
        removeMindMapNodesById
    } from './ts/mindMapNodeOps';
    import {
        buildDragBundleSnapPreviewPathConfig,
        buildMindMapDashedPreviewPathKonvaConfig,
        commitMindMapDragBundleSnap,
        computeMindMapDragBundleSnapPreview,
        mindMapArrowEdgeHiddenDuringBoxSnapPreview,
        type MindMapDragBundleSnapPreview
    } from './ts/mindMapDragBundleSnap';
    import {
        buildMindMapDragAlignGuideLineConfig,
        computeMindMapDragAlignSnap,
        createMindMapDragAlignSnapSession,
        type MindMapDragAlignGuide
    } from './ts/mindMapDragAlignSnap';
    import {
        buildMultiSelectHullHandleCircles,
        buildMultiSelectHullRect,
        isScenePointInsideMultiSelectHull,
        type MultiSelectHullRect
    } from './ts/mindMapMultiSelectHull';
    import { createMindMapEdgeRouter } from './ts/mindMapEdgeRoute';
    import {
        createMindMapNodeContextMenuController,
        MIND_MAP_KONVA_EDGE_FROM_ID_ATTR,
        MIND_MAP_KONVA_EDGE_TO_ID_ATTR
    } from './ts/mindMapNodeContextMenu';
    import { createMindMapUndoController } from './ts/mindMapUndo';
    import {
        createMindMapSequenceBlockBackdropCtl,
        type MindMapSequenceBlockBackdropCtl,
        type MindMapSequenceBlockBackdropItem
    } from './ts/mindMapSequenceBlockBackdrop';
    import { createMindMapDragLayoutScheduler } from './ts/mindMapDragFrameThrottle';
    import type { MindMapDragMoveTask } from './ts/mindMapDragFrameThrottle';
    import {
        arrowPointsFromPolylineEnd,
        generateRoundedPath
    } from './ts/mindMapPathGeometry';
    import {
        buildMindMapClientCoordDebugPayload,
        canvasPointFromStage,
        canvasScenePointFromStageClientEvent,
        canvasScenePointFromStageViewport
    } from './ts/mindMapCanvasCoords';
    import {
        MEDICINE_OPERATE_ADD_NODE_TEMPLATES,
        medicineAddSeedToGuide
    } from '@/views/workOrder/addNodeTemplates';

    /** 画布用 Konva 配置（可改描边等），几何尺寸与工单节点一致 */
    const nodeRectTemp = deepClone({ ...NODE_RECT_LAYOUT });

    const route = useRoute();
    const previewVisible = ref(false);
    const previewNodes = ref<any[]>([]);
    const previewLogKey = ref(0);
    const isStepPreview = computed(() => {
        const typeQ = route.query.type;
        return (
            typeQ !== undefined &&
            typeQ !== null &&
            `${typeQ}` !== '' &&
            +typeQ === 1
        );
    });
    const previewType = computed<'step' | ''>(() =>
        isStepPreview.value ? 'step' : ''
    );

    /** 当前选中的有向连线 from → to（仅高亮 / Delete 删除此边） */
    const selectedEdge = ref<{ fromId: number; toId: number } | null>(null);

    let seqBackdrop: MindMapSequenceBlockBackdropCtl | null = null;

    /** closeNodeCtxMenu 在右键菜单 ctl 之后才可用，_bridge 在安装阶段赋值 */
    const closeNodeCtxMenuBridge = {
        fn: (): void => undefined
    };
    const aiExpandNodeRef: { fn: ((node: any) => void) | null } = { fn: null };

    /** 与 nodeEditor 一致的 Dialog 二次确认删除节点 */
    const deleteNodesConfirmVisible = ref(false);

    /** 抽屉「删除」等场景指定待删 id，覆盖 getDeleteTargetIds */
    const pendingDeleteIdsOverride = ref<Set<number> | null>(null);

    /** createMindMapUndoController 初始化后覆盖为真实 clear */
    let clearMindMapUndoStack = () => {};

    const resetNodesVisualState = () => {
        deleteNodesConfirmVisible.value = false;
        pendingDeleteIdsOverride.value = null;
        selectedNodes.clear();
        activeNodes.clear();
        selectedEdge.value = null;
        hoveredNodeId.value = null;
        seqBackdrop?.clearFocus();
        syncNodeOutlineStrokes();
    };

    const handleExportJson = () => {
        const rows = mindMapNodesToTableRows(nodeList as any[]);
        const payload = {
            medicineOperateGuide: rows,
            supportJson: getDefaultSupportJson()
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], {
            type: 'application/json'
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `mind-map-${Date.now()}.json`;
        link.click();
        URL.revokeObjectURL(url);
        ElMessage.success('已导出 JSON');
    };

    const handleOpenPreview = () => {
        // 预览弹窗内部会模拟复诊完成/达成状态，使用快照避免这些本地状态影响编辑画布。
        previewNodes.value = deepClone(nodeList as any[]);
        previewLogKey.value += 1;
        previewVisible.value = true;
    };
    const onDrawerGuideBlur = () => {
        syncNodeOutlineStrokes();
    };

    const nodeValidationTip = ref<{
        message: string;
        left: number;
        top: number;
    } | null>(null);

    function onNodeValidationTipShow(payload: {
        message: string;
        left: number;
        top: number;
    }) {
        nodeValidationTip.value = {
            message: payload.message,
            left: payload.left,
            top: payload.top
        };
    }

    function onNodeValidationTipHide() {
        nodeValidationTip.value = null;
    }

    const stageDom = ref<HTMLCanvasElement>();
    /** vue-konva Stage 包装；平移开关直接调 Konva，避免改 stageConf.draggable 触发整表重绑导致视角跳变 */
    const mindMapStageRef = ref<{ getStage: () => Konva.Stage } | null>(null);
    const mindMapCanvasElRef = ref<HTMLElement | null>(null);
    const layerConf = reactive<Konva.LayerConfig>({
        draggable: false
    });
    const MM_STAGE_ZOOM_SCALE_BY = 1.1;
    const MM_STAGE_ZOOM_MIN = 0.2;
    const MM_STAGE_ZOOM_MAX = 4;
    const NODE_DETAIL_PANEL_WIDTH = 360;

    const stageConf = reactive<Konva.StageConfig>({
        width: Math.max(320, window.innerWidth - NODE_DETAIL_PANEL_WIDTH),
        height: window.innerHeight,
        x: 0,
        y: 0,
        scale: {
            x: 1,
            y: 1
        }
    });

    function getMindMapKonvaStage(): Konva.Stage | null {
        return mindMapStageRef.value?.getStage?.() ?? null;
    }

    /** 画布可见区域（header 下方 flex 区域，非 window 全高） */
    function measureMindMapStageViewport() {
        const el = mindMapCanvasElRef.value;
        if (el && el.clientWidth > 0 && el.clientHeight > 0) {
            return { width: el.clientWidth, height: el.clientHeight };
        }
        return {
            width: Math.max(320, window.innerWidth - NODE_DETAIL_PANEL_WIDTH),
            height: window.innerHeight
        };
    }

    function snapMindMapStageScale(scale: number) {
        const s = Math.min(
            MM_STAGE_ZOOM_MAX,
            Math.max(MM_STAGE_ZOOM_MIN, scale)
        );
        if (Math.abs(s - MM_STAGE_ZOOM_MIN) < 0.004) return MM_STAGE_ZOOM_MIN;
        if (Math.abs(s - 1) < 0.004) return 1;
        return s;
    }

    /** 将 scene 坐标点对准视口正中心，并同步 Konva（避免 stageConf 与实例漂移） */
    function applyMindMapStageViewAtSceneCenter(
        sceneX: number,
        sceneY: number,
        scale: number
    ) {
        const snapped = snapMindMapStageScale(scale);
        const { width: stageW, height: stageH } = measureMindMapStageViewport();
        stageConf.width = stageW;
        stageConf.height = stageH;
        const x = stageW / 2 - sceneX * snapped;
        const y = stageH / 2 - sceneY * snapped;
        stageConf.scale = { x: snapped, y: snapped };
        stageConf.x = x;
        stageConf.y = y;
        const stage = getMindMapKonvaStage();
        if (stage) {
            stage.scale({ x: snapped, y: snapped });
            stage.position({ x, y });
        }
    }

    /** 工具栏「视角」：仅开关画布平移；与 Ctrl/Cmd 临时平移共用，不写 stageConf.draggable */
    const stickyPanMode = ref(false);
    const ctrlPanActive = ref(false);

    const mindMapStagePanEnabled = computed(
        () => stickyPanMode.value || ctrlPanActive.value
    );

    /** 临时抓手：Windows/Linux Ctrl、macOS Command（⌘）；不含其它修饰键 */
    function isPanModifierKey(code: string) {
        return (
            code === 'ControlLeft' ||
            code === 'ControlRight' ||
            code === 'MetaLeft' ||
            code === 'MetaRight'
        );
    }

    function isPanModifierHeld(e: KeyboardEvent) {
        return e.ctrlKey || e.metaKey;
    }

    function applyMindMapStageDraggable() {
        getMindMapKonvaStage()?.draggable(mindMapStagePanEnabled.value);
    }

    /** 缩放按钮用：优先读 Konva 实时平移，避免拖画布后 stageConf.x/y 未同步 */
    function mindMapStageTransformForZoom() {
        const stage = getMindMapKonvaStage();
        if (stage) {
            return {
                x: stage.x(),
                y: stage.y(),
                scale: stage.scaleX()
            };
        }
        return {
            x: stageConf.x ?? 0,
            y: stageConf.y ?? 0,
            scale: stageConf.scale?.x ?? 1
        };
    }

    const mindMapZoomPercent = computed(() =>
        Math.round((stageConf.scale?.x ?? 1) * 100)
    );

    function adjustMindMapZoom(direction: 1 | -1) {
        const {
            x: mx,
            y: my,
            scale: oldScale
        } = mindMapStageTransformForZoom();
        const newScale =
            direction > 0
                ? Math.min(oldScale * MM_STAGE_ZOOM_SCALE_BY, MM_STAGE_ZOOM_MAX)
                : Math.max(
                      oldScale / MM_STAGE_ZOOM_SCALE_BY,
                      MM_STAGE_ZOOM_MIN
                  );
        if (Math.abs(newScale - oldScale) < 1e-9) return;
        const { width: stageW, height: stageH } = measureMindMapStageViewport();
        const cx = stageW / 2;
        const cy = stageH / 2;
        const scenePoint = {
            x: (cx - mx) / oldScale,
            y: (cy - my) / oldScale
        };
        stageConf.scale = { x: newScale, y: newScale };
        stageConf.x = cx - scenePoint.x * newScale;
        stageConf.y = cy - scenePoint.y * newScale;
        const stage = getMindMapKonvaStage();
        if (stage) {
            stage.scale({ x: newScale, y: newScale });
            stage.position({ x: stageConf.x, y: stageConf.y });
        }
    }

    function resetMindMapView() {
        updateMindMapStageSize();
        stageConf.scale = { x: 1, y: 1 };
        stageConf.x = 0;
        stageConf.y = 0;
        const stage = getMindMapKonvaStage();
        if (stage) {
            stage.scale({ x: 1, y: 1 });
            stage.position({ x: 0, y: 0 });
        }
    }

    const MIND_MAP_INITIAL_FIT_PAD = 56;
    let initialMindMapViewFitted = false;

    /** 按当前节点外包盒缩放并居中，使整图落在一屏内（仅首次进入画布时自动调用） */
    function fitMindMapViewToAllNodes() {
        if (!nodeList.length) return;
        const bb = mindMapNodesContentAabb(nodeList);
        if (!bb) return;

        const { width: stageW, height: stageH } = measureMindMapStageViewport();
        const innerW = Math.max(1, stageW - MIND_MAP_INITIAL_FIT_PAD * 2);
        const innerH = Math.max(1, stageH - MIND_MAP_INITIAL_FIT_PAD * 2);
        const contentW = Math.max(1, bb.maxX - bb.minX);
        const contentH = Math.max(1, bb.maxY - bb.minY);

        const fitScale = Math.min(innerW / contentW, innerH / contentH);
        /** 仅缩小以容纳全图；计算结果 >100% 时保持 100%，不自动放大 */
        const clamped = Math.min(1, Math.max(fitScale, MM_STAGE_ZOOM_MIN));

        applyMindMapStageViewAtSceneCenter(
            (bb.minX + bb.maxX) / 2,
            (bb.minY + bb.maxY) / 2,
            clamped
        );
    }

    type MindMapViewportPanOptions = {
        horizontalAlign?: 'center' | 'left';
        /** 为 true 时缩放至整图落在可见区内（与 fitMindMapViewToAllNodes 一致） */
        fitToView?: boolean;
    };

    /** 平移视口（必要时略缩小）使节点外包盒落在当前画布可见区域内 */
    function panMindMapViewToNodesInViewport(
        nodes: readonly any[],
        options: MindMapViewportPanOptions = {}
    ) {
        const horizontalAlign = options.horizontalAlign ?? 'center';
        const bb = mindMapNodesContentAabb(nodes);
        if (!bb) return;

        updateMindMapStageSize();
        const { width: stageW, height: stageH } = measureMindMapStageViewport();
        const innerW = Math.max(1, stageW - MIND_MAP_INITIAL_FIT_PAD * 2);
        const innerH = Math.max(1, stageH - MIND_MAP_INITIAL_FIT_PAD * 2);
        const contentW = Math.max(1, bb.maxX - bb.minX);
        const contentH = Math.max(1, bb.maxY - bb.minY);
        const cx = (bb.minX + bb.maxX) / 2;
        const cy = (bb.minY + bb.maxY) / 2;

        const fitScale = Math.min(innerW / contentW, innerH / contentH);
        const fitClamped = Math.min(1, Math.max(fitScale, MM_STAGE_ZOOM_MIN));

        let scale: number;
        if (options.fitToView) {
            scale = fitClamped;
        } else {
            scale = snapMindMapStageScale(mindMapStageTransformForZoom().scale);
            if (contentW * scale > innerW || contentH * scale > innerH) {
                scale = snapMindMapStageScale(Math.min(scale, fitClamped));
            }
        }

        const snapped = snapMindMapStageScale(scale);

        if (horizontalAlign === 'left') {
            stageConf.width = stageW;
            stageConf.height = stageH;
            const x = MIND_MAP_INITIAL_FIT_PAD - bb.minX * snapped;
            const y = stageH / 2 - cy * snapped;
            stageConf.scale = { x: snapped, y: snapped };
            stageConf.x = x;
            stageConf.y = y;
            const stage = getMindMapKonvaStage();
            if (stage) {
                stage.scale({ x: snapped, y: snapped });
                stage.position({ x, y });
            }
            return;
        }

        applyMindMapStageViewAtSceneCenter(cx, cy, snapped);
    }

    function scheduleInitialMindMapFitToContent() {
        if (initialMindMapViewFitted || !nodeList.length) return;
        nextTick(() => {
            requestAnimationFrame(() => {
                if (initialMindMapViewFitted || !nodeList.length) return;
                updateMindMapStageSize();
                fitMindMapViewToAllNodes();
                initialMindMapViewFitted = true;
            });
        });
    }

    function toggleMindMapPanEdit() {
        stickyPanMode.value = !stickyPanMode.value;
        if (stickyPanMode.value) {
            closeNodeCtxMenu();
        }
        applyMindMapStageDraggable();
        if (stageDom.value) {
            stageDom.value.style.cursor = stickyPanMode.value
                ? 'grab'
                : 'default';
        }
    }
    const nodeList = reactive<any[]>([]);

    /** 拓扑层级：无入边为 0，多前驱取 max+1（与 Python StepAction 拓扑图一致） */
    const mindMapNodeLevels = computed(() =>
        computeMindMapNodeLevels(nodeList)
    );

    function mindMapNodeLevel(nodeId: number): number {
        return mindMapNodeLevels.value.get(nodeId) ?? 0;
    }

    /** 画布拓扑双向绑定：prev/next 与 prevNodeIDs/nextNodeIDs 统一，并剔除指向不存在节点的边 */
    function syncMindMapTopologyBinding() {
        reconcileMindMapNodeTopology(nodeList);
    }

    /** 侧栏展示：与画布当前单选节点同步（直接读 nodeList，不单独维护一份 ref） */
    function resolveDrawerNodeFromSelection(): any | null {
        if (activeNodes.size === 1 && selectedNodes.size === 0) {
            const id = [...activeNodes][0]!;
            return nodeList.find((n) => n.nodeId === id) ?? null;
        }
        if (selectedNodes.size === 1) {
            const id = [...selectedNodes][0]!;
            return nodeList.find((n) => n.nodeId === id) ?? null;
        }
        return null;
    }

    /** 选中边阴影色（与节点区分色无关） */
    const MIND_MAP_EDGE_SELECTION_SHADOW = '#1A55E9';

    const drawerNode = computed(() => resolveDrawerNodeFromSelection());

    function clearDrawerNode() {
        /* 侧栏由 activeNodes/selectedNodes 驱动，保留空函数供原 closeNodeDrawer 调用 */
    }

    function closeNodeDrawer() {
        clearDrawerNode();
    }

    function bindDrawerToNode(node: any) {
        if (!node.guide || typeof node.guide !== 'object') {
            node.guide = extractGuideFromRow(node);
        }
        ensureGuideCollectionsFor(node.guide);
        syncMindMapTopologyBinding();
    }

    function syncDrawerFromSelection() {
        const node = resolveDrawerNodeFromSelection();
        if (node) bindDrawerToNode(node);
    }

    function updateMindMapStageSize() {
        const { width, height } = measureMindMapStageViewport();
        stageConf.width = width;
        stageConf.height = height;
    }

    const mindMapUndoCtrl = createMindMapUndoController({
        getNodeList: () => nodeList,
        deepClone,
        onAfterRestore: () => {
            resetNodesVisualState();
            closeNodeDrawer();
            rebuildMindMapArrowLines();
        }
    });
    clearMindMapUndoStack = mindMapUndoCtrl.clear;
    const pushMindMapUndoSnapshot =
        mindMapUndoCtrl.pushSnapshotFromCurrentNodes;
    const discardLastMindMapUndoSnapshot = mindMapUndoCtrl.discardLastSnapshot;
    const performMindMapUndo = mindMapUndoCtrl.undo;
    const mindMapUndoOnDragStart = mindMapUndoCtrl.onDragStart;
    const mindMapUndoOnDragMove = mindMapUndoCtrl.onDragMove;
    const mindMapUndoOnDragEnd = mindMapUndoCtrl.onDragEnd;
    const canUndoMindMap = mindMapUndoCtrl.canUndo;

    /** 按泳道主轴算法重排当前画布节点（最长链中轨 + 收拢发散，与工单缺省自动布局一致） */
    function handleAutoLayout() {
        if (!nodeList.length) {
            ElMessage.info('画布上没有节点');
            return;
        }
        pushMindMapUndoSnapshot();
        applyLayerLayoutWithSeparatedComponents(nodeList as any[], {
            ...buildMindMapLayoutOptions(nodeList.length)
        });
        nextTick(() => {
            requestAnimationFrame(() => {
                panMindMapViewToNodesInViewport(nodeList, {
                    horizontalAlign: 'left',
                    fitToView: true
                });
                syncNodeOutlineStrokes();
                rebuildMindMapArrowLines();
            });
        });
        ElMessage.success('已自动布局');
    }

    const videoDataList = ref<DrawerVideoItem[]>([]);

    // 框选相关状态
    const selectionBox = reactive({
        visible: false,
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0
    });

    //选中节点（框选，可多选）
    const selectedNodes = new Set<number>();
    /** 非响应式 Set 变更时仍能驱动「多选外包框」computed 重算 */
    const multiSelectHullRevision = ref(0);
    const isSelecting = ref(false);
    /** 分组底衬上框选时：只计入该弱连通块内的节点 */
    let marqueeRestrictNodeIds: Set<number> | null = null;
    /** 分组空白处按下未框中节点时，松手恢复「仅块焦点」 */
    let pendingSequenceBlockFocus: MindMapSequenceBlockBackdropItem | null =
        null;

    /** 拖拽成组磁吸预览（矩形右/左把手 → 最近节点） */
    const dragBundleSnapPreview = ref<MindMapDragBundleSnapPreview | null>(
        null
    );
    /** 当前磁吸预览对应的成组节点 id（与虚线框外包一致） */
    const dragBundleSnapMovingIds = ref<Set<number>>(new Set());
    /** 拖动对齐辅助线（边/中心吸附） */
    const dragAlignGuides = ref<MindMapDragAlignGuide[]>([]);
    let dragAlignSnapSession = createMindMapDragAlignSnapSession();
    /** 单节点拖动起点（多选时用 multiDragSession.origins） */
    let dragAlignOrigins = new Map<number, { x: number; y: number }>();
    /** 单选拖节点时记录被拖 id，用于松手磁吸 */
    const lastDraggedSingletonId = ref<number | null>(null);

    /** 框选结束的 mouseup 之后，画布仍会收到一次 click；若照常走 onStageClick 会清空刚写入的 selectedNodes */
    let suppressNextStageClearClick = false;

    /** 框选多节点时，以当前拖动的节点为Leader，整组随其位移一起平移 */
    let multiDragSession: {
        leaderId: number;
        originLeaderX: number;
        originLeaderY: number;
        origins: Map<number, { x: number; y: number }>;
    } | null = null;

    /** 在「多选外包矩形」空白处按下拖移整组（与节点 Leader 拖拽同源位移） */
    let multiHullDragSession: {
        startSceneX: number;
        startSceneY: number;
        origins: Map<number, { x: number; y: number }>;
    } | null = null;
    let multiHullDragStage: any = null;

    /** 单击选中的主节点 id（有序 Set，常规仅 1 个）；用于描边与两侧接续圆点 */
    const activeNodes = reactive<Set<number>>(new Set());

    /** 鼠标悬浮中的节点（用于显示两侧衔接圆点，与 activeNodes 无关） */
    const hoveredNodeId = ref<number | null>(null);

    /** 按 selectedNodes ∪ activeNodes 与 guide 校验刷新节点描边 */
    function syncNodeOutlineStrokes() {
        for (const n of nodeList) {
            const hilite =
                selectedNodes.has(n.nodeId) || activeNodes.has(n.nodeId);
            n.rectConf.stroke = resolveMindMapNodeStroke(
                n.guide,
                hilite,
                mindMapNodeLevel(n.nodeId)
            );
        }
        multiSelectHullRevision.value++;
    }

    /** 侧栏编辑操作描述时，同步画布校验描边 */
    watch(
        () => (drawerNode.value ? drawerNode.value.guide?.operationDesc : null),
        () => syncNodeOutlineStrokes()
    );

    function setPrimaryActiveNode(node: any) {
        selectedNodes.clear();
        activeNodes.clear();
        seqBackdrop?.clearFocus();
        activeNodes.add(node.nodeId);
        syncNodeOutlineStrokes();
        bindDrawerToNode(node);
    }

    /** 右侧衔接圆点按下至 document 松手期间，临时关闭该节点 Konva 拖拽，避免圆点落在 draggable Group 上误启拖拽、松手后仍跟鼠标 */
    const endHandleFreezeNodeId = ref<number | null>(null);

    /** 超过该位移（画布坐标）视为「拖线连边」，否则松开视为在节点上新增子节点 */
    const END_HANDLE_WIRE_DRAG_SCENE = 14;

    let endHandlePointerSession: {
        fromNode: any;
        stage: any;
        canvasStartX: number;
        canvasStartY: number;
    } | null = null;

    /** 本轮右侧圆点手势是否已在 pointerup/mouseup 中收尾（避免 mouseup + pointerup 各执行一次） */
    let endHandleGestureDone = false;

    const linkDrag = reactive({
        active: false,
        fromId: null as number | null,
        cx: 0,
        cy: 0
    });

    let linkDragStage: any = null;

    /** 组框包络：在 mindMapEdgeRouter 初始化后赋值 */
    let resolveSequenceBlockComponentEdgePolylines:
        | ((
              componentNodes: readonly any[],
              componentNodeIds: ReadonlySet<number>
          ) => { linePts: number[]; cornerR?: number }[])
        | null = null;

    seqBackdrop = createMindMapSequenceBlockBackdropCtl({
        nodeList,
        selectedNodes,
        activeNodes,
        selectedEdge,
        syncNodeOutlineStrokes,
        closeNodeDrawer,
        closeNodeCtxMenu: () => closeNodeCtxMenuBridge.fn(),
        canvasPointFromStage,
        getStageDraggable: () => mindMapStagePanEnabled.value,
        mindMapUndoOnDragStart,
        mindMapUndoOnDragMove,
        mindMapUndoOnDragEnd,
        markSuppressNextStageClearClick: () => {
            suppressNextStageClearClick = true;
        },
        getIsDragging: () => mindMapDragLayoutScheduler?.isDragging() ?? false,
        onBlockDragFrame: (movingIds) => {
            mindMapDragLayoutScheduler?.scheduleFrame(movingIds);
        },
        scheduleCoalescedDragMove: (task) => {
            mindMapDragLayoutScheduler?.scheduleDragMove(task);
        },
        onBlockDragBegin: () => {
            resetDragAlignSnap();
            mindMapDragLayoutScheduler?.beginDrag();
        },
        onBlockDragEnd: (movingIds) => {
            clearDragAlignGuides();
            tryCommitDragBundleSnap(movingIds);
            clearDragBundleSnapPreview();
            mindMapDragLayoutScheduler?.endDrag();
        },
        transformBlockDragDelta: (movingIds, origins, dx, dy) =>
            applyDragAlignSnapDelta(movingIds, origins, dx, dy),
        resolveComponentEdgePolylines: (componentNodes, componentNodeIds) =>
            resolveSequenceBlockComponentEdgePolylines?.(
                componentNodes,
                componentNodeIds
            ) ?? []
    });

    const {
        backdropItems: sequenceBlockBackdropItems,
        isBackdropHighlight: isSequenceBlockBackdropBackdropHighlight,
        isFocused: isSequenceBlockBackdropFocused,
        isSelectionActive: isSequenceBlockSelectionActive,
        onBackdropPointerDown: onSequenceBlockBackdropDragPointerDown,
        onBackdropDoubleClick: onSequenceBlockBackdropDoubleClick,
        isNodeLockedBySequenceBackdropBlock,
        applyBlockFocusOnly: applySequenceBlockFocusOnly
    } = seqBackdrop;

    /** 分组已高亮/整组选中：仅拖底衬平移；未介入分组前才允许组内框选 */
    function onSequenceBlockBackdropPointerDown(
        e: any,
        block: MindMapSequenceBlockBackdropItem
    ) {
        if (mindMapStagePanEnabled.value) return;
        const blockEngaged =
            isSequenceBlockSelectionActive(block) ||
            isSequenceBlockBackdropFocused(block);
        if (blockEngaged) {
            pendingSequenceBlockFocus = null;
            onSequenceBlockBackdropDragPointerDown(e, block);
            return;
        }
        e.cancelBubble = true;
        e.evt?.stopPropagation?.();
        pendingSequenceBlockFocus = block;
        beginMarqueeSelection(e, new Set(block.nodeIds));
    }

    function unlinkEndHandleWindowListeners() {
        document.removeEventListener('mousemove', onLinkDragDocumentMove, true);
        document.removeEventListener(
            'mouseup',
            onEndHandleDocumentFinish,
            true
        );
        document.removeEventListener(
            'pointerup',
            onEndHandleDocumentFinish,
            true
        );
        document.removeEventListener(
            'pointercancel',
            onEndHandleDocumentFinish,
            true
        );
    }

    /** 捕获阶段监听 document：move 更新拖线预览；up 时连边或新增子节点 */
    function onLinkDragDocumentMove() {
        const sess = endHandlePointerSession;
        if (!sess || endHandleGestureDone) return;

        const stage = sess.stage;
        const cur = canvasPointFromStage(stage);
        if (!cur) return;

        if (!linkDrag.active) {
            const dx = cur.x - sess.canvasStartX;
            const dy = cur.y - sess.canvasStartY;
            if (
                dx * dx + dy * dy <
                END_HANDLE_WIRE_DRAG_SCENE * END_HANDLE_WIRE_DRAG_SCENE
            ) {
                return;
            }
            const fromNode = sess.fromNode;
            linkDragStage = stage;
            linkDrag.active = true;
            linkDrag.fromId = fromNode.nodeId;
            linkDrag.cx = cur.x;
            linkDrag.cy = cur.y;
            return;
        }

        const pt = canvasPointFromStage(linkDragStage);
        if (!pt) return;
        linkDrag.cx = pt.x;
        linkDrag.cy = pt.y;
    }

    /** 捕获阶段监听 document：避免画布上松手漏收 mouseup */
    function onEndHandleDocumentFinish(ev?: Event) {
        if (endHandleGestureDone) return;
        if (
            ev &&
            'button' in ev &&
            (ev as MouseEvent).button !== undefined &&
            (ev as MouseEvent).button !== 0
        ) {
            return;
        }
        endHandleGestureDone = true;
        runEndHandlePointerRelease(ev);
    }

    function runEndHandlePointerRelease(ev?: Event) {
        const sess = endHandlePointerSession;
        const stageForHitRefine = sess?.stage ?? null;
        endHandlePointerSession = null;

        const wasWire =
            linkDrag.active &&
            linkDrag.fromId !== null &&
            linkDrag.fromId !== undefined;
        const fromId = linkDrag.fromId;
        let hitX = linkDrag.cx;
        let hitY = linkDrag.cy;
        const tapParent = sess?.fromNode ?? null;

        unlinkEndHandleWindowListeners();
        linkDragStage = null;
        endHandleFreezeNodeId.value = null;
        linkDrag.active = false;
        linkDrag.fromId = null;

        suppressNextStageClearClick = true;

        if (wasWire && fromId != null) {
            if (
                ev &&
                'clientX' in ev &&
                stageForHitRefine &&
                typeof (ev as MouseEvent).clientX === 'number'
            ) {
                const refined = canvasScenePointFromStageClientEvent(
                    stageForHitRefine,
                    ev as MouseEvent
                );
                if (refined) {
                    hitX = refined.x;
                    hitY = refined.y;
                }
            }
            const rect = {
                width: nodeRectTemp.width,
                height: nodeRectTemp.height
            };
            const hit = pickMindMapNodeAtCanvasPoint(
                nodeList,
                hitX,
                hitY,
                fromId,
                rect
            );
            if (hit) {
                pushMindMapUndoSnapshot();
                if (establishMindMapLink(nodeList, fromId, hit.nodeId)) {
                    ElMessage.success('已连接节点');
                    markMindMapTopologyChanged();
                } else {
                    discardLastMindMapUndoSnapshot();
                }
            }
            return;
        }

        if (tapParent) {
            pushMindMapUndoSnapshot();
            appendMindMapChildUnder(nodeList, tapParent, {
                nodeWidth: nodeRectTemp.width,
                nodeHeight: nodeRectTemp.height
            });
            markMindMapTopologyChanged();
        }
    }

    function onCircleEndPointerDown(e: any, fromNode: any) {
        if (mindMapStagePanEnabled.value) return;
        e.cancelBubble = true;
        e.evt?.preventDefault?.();
        e.evt?.stopPropagation?.();

        const stage = e.target?.getStage?.();
        if (!stage) return;

        const pt0 = canvasPointFromStage(stage);
        if (!pt0) return;

        endHandleGestureDone = false;

        unlinkEndHandleWindowListeners();

        endHandleFreezeNodeId.value = fromNode.nodeId;

        endHandlePointerSession = {
            fromNode,
            stage,
            canvasStartX: pt0.x,
            canvasStartY: pt0.y
        };

        document.addEventListener('mousemove', onLinkDragDocumentMove, true);
        document.addEventListener('mouseup', onEndHandleDocumentFinish, true);
        document.addEventListener('pointerup', onEndHandleDocumentFinish, true);
        document.addEventListener(
            'pointercancel',
            onEndHandleDocumentFinish,
            true
        );
    }
    /** 节点外包矩形（框选等业务使用；连线避障详见 ts/obstacleRoute.ts） */
    const getNodeBounds = (node: any) => {
        const halfWidth = (node.rectConf?.width ?? nodeRectTemp.width) / 2;
        const halfHeight = (node.rectConf?.height ?? nodeRectTemp.height) / 2;
        return {
            ...getMindMapNodeAxisBounds(node, halfWidth, halfHeight),
            centerX: node.x,
            centerY: node.y
        };
    };

    /** 框选 / Ctrl 多选 ≥2 个节点时：仅包住所选节点卡片的 AABB（画布坐标） */
    const multiSelectHullRect = computed(() => {
        multiSelectHullRevision.value;
        return buildMultiSelectHullRect({
            nodes: nodeList as any,
            selectedIds: selectedNodes,
            halfWidth: nodeRectTemp.width / 2,
            halfHeight: nodeRectTemp.height / 2,
            pad: 8
        });
    });

    /** 多选外包框左右中点：与单节点选中时的衔接圆点样式一致（仅装饰，不参与拖线） */
    const multiSelectHullHandleCircles = computed(() => {
        multiSelectHullRevision.value;
        return buildMultiSelectHullHandleCircles(
            multiSelectHullRect.value,
            NODE_CIRCLE_LAYOUT
        );
    });

    /** 磁吸/预览用外包：优先多选虚线框，其次序列块底衬，否则按序列块 padding 推算 */
    function resolveMindMapDragBundleSnapHull(
        movingIds: ReadonlySet<number>
    ): MultiSelectHullRect | null {
        if (movingIds.size < 2) return null;
        if (
            selectedNodes.size >= 2 &&
            [...movingIds].every((id) => selectedNodes.has(id))
        ) {
            return multiSelectHullRect.value;
        }
        const blk = sequenceBlockMatchingNodeIds(movingIds);
        if (blk) {
            return {
                x: blk.x,
                y: blk.y,
                width: blk.width,
                height: blk.height
            };
        }
        return buildMultiSelectHullRect({
            nodes: nodeList as any,
            selectedIds: movingIds,
            halfWidth: nodeRectTemp.width / 2,
            halfHeight: nodeRectTemp.height / 2,
            pad: MIND_MAP_SEQUENCE_BLOCK_BACKDROP_PAD
        });
    }

    function refreshDragBundleSnapPreview(movingIds: Set<number>) {
        const snapMovingIds =
            selectedNodes.size >= 2 ? new Set(selectedNodes) : movingIds;
        dragBundleSnapMovingIds.value = new Set(snapMovingIds);
        const bundleHull = resolveMindMapDragBundleSnapHull(snapMovingIds);
        dragBundleSnapPreview.value = computeMindMapDragBundleSnapPreview(
            nodeList as any,
            snapMovingIds,
            {
                nodeWidth: nodeRectTemp.width,
                nodeHeight: nodeRectTemp.height,
                boxSelectSnap: snapMovingIds.size >= 2,
                bundleHull
            }
        );
    }

    function resetDragAlignSnap() {
        dragAlignSnapSession = createMindMapDragAlignSnapSession();
        dragAlignGuides.value = [];
        dragAlignOrigins = new Map();
    }

    function clearDragAlignGuides() {
        dragAlignGuides.value = [];
        dragAlignSnapSession = createMindMapDragAlignSnapSession();
    }

    function dragAlignGuidesEqual(
        a: MindMapDragAlignGuide[],
        b: MindMapDragAlignGuide[]
    ): boolean {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            const x = a[i]!;
            const y = b[i]!;
            if (
                x.kind !== y.kind ||
                x.pos !== y.pos ||
                x.start !== y.start ||
                x.end !== y.end
            ) {
                return false;
            }
        }
        return true;
    }

    function applyDragAlignSnapDelta(
        movingIds: Set<number>,
        origins: Map<number, { x: number; y: number }>,
        dx: number,
        dy: number
    ): { dx: number; dy: number } {
        const hw = nodeRectTemp.width / 2;
        const hh = nodeRectTemp.height / 2;
        const out = computeMindMapDragAlignSnap({
            nodes: nodeList as any,
            movingIds,
            origins,
            dx,
            dy,
            session: dragAlignSnapSession,
            halfWidth: hw,
            halfHeight: hh
        });
        dragAlignSnapSession = out.session;
        if (!dragAlignGuidesEqual(dragAlignGuides.value, out.guides)) {
            dragAlignGuides.value = out.guides;
        }
        return { dx: out.dx, dy: out.dy };
    }

    function applyCoalescedDragMove(task: MindMapDragMoveTask) {
        mindMapUndoOnDragMove();
        const snapped = applyDragAlignSnapDelta(
            task.movingIds,
            task.origins,
            task.dx,
            task.dy
        );
        applyDragDeltaToMovingNodes(
            task.movingIds,
            task.origins,
            snapped.dx,
            snapped.dy
        );
        task.syncKonvaLeader?.();
    }

    function applyDragDeltaToMovingNodes(
        movingIds: Set<number>,
        origins: Map<number, { x: number; y: number }>,
        dx: number,
        dy: number
    ) {
        for (const n of nodeList) {
            if (!movingIds.has(n.nodeId)) continue;
            const o = origins.get(n.nodeId);
            if (!o) continue;
            n.x = o.x + dx;
            n.y = o.y + dy;
        }
    }

    type MindMapArrowLineItem = {
        fromId: number;
        toId: number;
        pathConf: Record<string, unknown>;
        arrowConf: Record<string, unknown>;
    };

    /** 由 rebuildMindMapArrowLines 赋值；拓扑变更或拖结束也会刷新 */
    let rebuildMindMapArrowLines: (movingIds?: Set<number>) => void = () => {};
    let mindMapDragLayoutScheduler: ReturnType<
        typeof createMindMapDragLayoutScheduler
    > | null = null;

    function markMindMapTopologyChanged() {
        if (mindMapDragLayoutScheduler?.isDragging()) return;
        invalidateMindMapEdgeTouchIndex();
        invalidateMindMapSequenceBlockWeakCompCache();
        invalidateMindMapRouteComponentIndexCache();
        rebuildMindMapArrowLines();
    }

    function clearDragBundleSnapPreview() {
        dragBundleSnapPreview.value = null;
        dragBundleSnapMovingIds.value = new Set();
    }

    function tryCommitDragBundleSnap(movingIds: Set<number> | null) {
        const snap = dragBundleSnapPreview.value;
        clearDragBundleSnapPreview();
        const committed = commitMindMapDragBundleSnap(nodeList as any, {
            movingIds,
            preview: snap,
            selectedNodeIds: selectedNodes,
            layout: {
                nodeWidth: nodeRectTemp.width,
                nodeHeight: nodeRectTemp.height
            }
        });
        if (committed) {
            resolveMindMapLayoutOverlapsAfterNodeResize(
                nodeList as any[],
                buildMindMapLayoutOptions(nodeList.length)
            );
            rebuildMindMapArrowLines();
            markMindMapTopologyChanged();
        }
    }

    function unlinkMultiHullDragListeners() {
        document.removeEventListener(
            'pointermove',
            onMultiHullDragDocumentMove,
            true
        );
        document.removeEventListener(
            'pointerup',
            onMultiHullDragDocumentUp,
            true
        );
        document.removeEventListener(
            'pointercancel',
            onMultiHullDragDocumentUp,
            true
        );
    }

    function onMultiHullDragDocumentMove(ev: Event) {
        if (!multiHullDragSession || !multiHullDragStage) return;
        const clientEv = ev as PointerEvent;
        if (typeof clientEv.clientX !== 'number') return;
        const pt = canvasScenePointFromStageClientEvent(
            multiHullDragStage,
            clientEv as unknown as MouseEvent
        );
        if (!pt) return;
        const dx = pt.x - multiHullDragSession.startSceneX;
        const dy = pt.y - multiHullDragSession.startSceneY;
        const moving = new Set(selectedNodes);
        mindMapDragLayoutScheduler?.scheduleDragMove({
            movingIds: moving,
            origins: multiHullDragSession.origins,
            dx,
            dy
        });
    }

    function onMultiHullDragDocumentUp() {
        unlinkMultiHullDragListeners();
        if (multiHullDragSession) {
            tryCommitDragBundleSnap(new Set(selectedNodes));
            mindMapUndoOnDragEnd();
            clearDragBundleSnapPreview();
            mindMapDragLayoutScheduler?.endDrag();
        }
        multiHullDragSession = null;
        multiHullDragStage = null;
        clearDragAlignGuides();
        suppressNextStageClearClick = true;
    }

    /** 在外包矩形填充区按下：整组拖动（热区在节点下层，不挡节点点击） */
    function onMultiSelectHullPointerDown(e: any) {
        if (mindMapStagePanEnabled.value) return;
        if (selectedNodes.size < 2) return;
        if (!multiSelectHullRect.value) return;
        const dom = e.evt as MouseEvent | PointerEvent | undefined;
        if (dom && 'button' in dom && (dom as MouseEvent).button !== 0) return;

        e.cancelBubble = true;

        dragBundleSnapPreview.value = null;
        resetDragAlignSnap();

        const stage = e.target?.getStage?.();
        if (!stage) return;
        const pt = dom
            ? canvasScenePointFromStageClientEvent(stage, dom as MouseEvent)
            : canvasPointFromStage(stage);
        if (!pt) return;

        unlinkMultiHullDragListeners();
        if (multiHullDragSession) {
            mindMapUndoOnDragEnd();
            clearDragBundleSnapPreview();
            mindMapDragLayoutScheduler?.endDrag();
        }

        const origins = new Map<number, { x: number; y: number }>();
        for (const n of nodeList) {
            if (selectedNodes.has(n.nodeId)) {
                origins.set(n.nodeId, { x: n.x, y: n.y });
            }
        }
        dragAlignOrigins = origins;
        multiHullDragSession = {
            startSceneX: pt.x,
            startSceneY: pt.y,
            origins
        };
        multiHullDragStage = stage;
        mindMapUndoOnDragStart();
        mindMapDragLayoutScheduler?.beginDrag();

        document.addEventListener(
            'pointermove',
            onMultiHullDragDocumentMove,
            true
        );
        document.addEventListener('pointerup', onMultiHullDragDocumentUp, true);
        document.addEventListener(
            'pointercancel',
            onMultiHullDragDocumentUp,
            true
        );
    }

    /** 画布尺寸变化时刷新避障 stub；路由器实例保持稳定以复用边级缓存 */
    const mindMapEdgeRouter = shallowRef(
        createMindMapEdgeRouter(
            { width: nodeRectTemp.width, height: nodeRectTemp.height },
            () => nodeList,
            {
                getInteractionLite: () =>
                    mindMapDragLayoutScheduler?.isDragging() ?? false,
                largeGraphNodeThreshold: 36
            }
        )
    );
    watch(
        () => [nodeRectTemp.width, nodeRectTemp.height] as const,
        () => {
            mindMapEdgeRouter.value = createMindMapEdgeRouter(
                { width: nodeRectTemp.width, height: nodeRectTemp.height },
                () => nodeList,
                {
                    getInteractionLite: () =>
                        mindMapDragLayoutScheduler?.isDragging() ?? false,
                    largeGraphNodeThreshold: 36
                }
            );
        }
    );

    const generateObstacleAvoidancePath = (
        startX: number,
        startY: number,
        endX: number,
        endY: number,
        fromNode: any,
        toNode: any
    ): number[] => {
        if (mindMapDragLayoutScheduler?.isDragging()) {
            const ports = mindMapEdgePorts(fromNode, toNode);
            const lite = mindMapEdgeRouter.value.resolveLinePointsForEdgeLite(
                fromNode,
                toNode
            );
            return lite?.linePts ?? [ports.sx, ports.sy, endX, endY];
        }
        return mindMapEdgeRouter.value.generateObstacleAvoidancePath(
            startX,
            startY,
            endX,
            endY,
            fromNode,
            toNode
        );
    };

    const mindMapEdgePorts = (from: any, to: any) =>
        mindMapEdgeRouter.value.edgePorts(from, to);

    resolveSequenceBlockComponentEdgePolylines = (
        componentNodes,
        componentNodeIds
    ) => {
        const polylines: { linePts: number[]; cornerR?: number }[] = [];
        const nodeById = new Map<number, any>(
            componentNodes.map((n: any) => [n.nodeId, n])
        );
        for (const node of componentNodes) {
            const nextIds = node.nextNodes as number[] | undefined;
            if (!nextIds?.length) continue;
            for (const nextId of nextIds) {
                if (!componentNodeIds.has(nextId)) continue;
                const nextNode = nodeById.get(nextId);
                if (!nextNode) continue;
                const resolved =
                    mindMapEdgeRouter.value.resolveLinePointsForEdge(
                        node,
                        nextNode
                    );
                const linePts = resolved?.linePts;
                if (linePts && linePts.length >= 4) {
                    polylines.push({
                        linePts,
                        cornerR: resolved.cornerR
                    });
                }
            }
        }
        return polylines;
    };

    /** 单条有向边的 path + Arrow 配置 */
    function buildMindMapArrowLineItem(
        node: any,
        nextNode: any,
        sel: { fromId: number; toId: number } | null,
        opts?: { lite?: boolean }
    ): MindMapArrowLineItem | null {
        const resolved = opts?.lite
            ? mindMapEdgeRouter.value.resolveLinePointsForEdgeLite(
                  node,
                  nextNode
              )
            : mindMapEdgeRouter.value.resolveLinePointsForEdge(node, nextNode);
        if (!resolved) return null;
        const { linePts, cornerR } = resolved;

        const pathData = generateRoundedPath(linePts, cornerR);
        if (!pathData) return null;

        const ap = arrowPointsFromPolylineEnd(linePts);
        if (ap.length < 4) return null;

        const isSel =
            sel?.fromId === node.nodeId && sel?.toId === nextNode.nodeId;
        /** 自当前节点右端口发出的边，颜色与源节点拓扑层级一致 */
        const stroke = getMindMapNodeAccentColorByLevel(
            mindMapNodeLevel(node.nodeId)
        );
        const strokeWidth = 2;
        const selShadow = isSel
            ? {
                  shadowColor: MIND_MAP_EDGE_SELECTION_SHADOW,
                  shadowBlur: 28,
                  shadowOffsetX: 0,
                  shadowOffsetY: 5,
                  shadowOpacity: 0.78
              }
            : {
                  shadowBlur: 0,
                  shadowOffsetX: 0,
                  shadowOffsetY: 0,
                  shadowOpacity: 0
              };

        return {
            fromId: node.nodeId,
            toId: nextNode.nodeId,
            pathConf: {
                data: pathData,
                stroke,
                strokeWidth,
                fill: '',
                lineCap: 'round',
                lineJoin: 'round',
                listening: true,
                hitStrokeWidth: 22,
                perfectDrawEnabled: false,
                [MIND_MAP_KONVA_EDGE_FROM_ID_ATTR]: node.nodeId,
                [MIND_MAP_KONVA_EDGE_TO_ID_ATTR]: nextNode.nodeId,
                ...selShadow
            },
            arrowConf: {
                points: ap,
                stroke,
                strokeWidth,
                pointerLength: 10,
                pointerWidth: 10,
                fill: stroke,
                lineCap: 'round',
                listening: ap.length >= 4,
                [MIND_MAP_KONVA_EDGE_FROM_ID_ATTR]: node.nodeId,
                [MIND_MAP_KONVA_EDGE_TO_ID_ATTR]: nextNode.nodeId,
                ...selShadow
            }
        };
    }

    type MindMapArrowEdgePair = { node: any; nextNode: any };

    let mindMapEdgeTouchIndex: {
        nodeListRef: readonly any[];
        byNodeId: Map<number, MindMapArrowEdgePair[]>;
    } | null = null;

    function invalidateMindMapEdgeTouchIndex(): void {
        mindMapEdgeTouchIndex = null;
    }

    function ensureMindMapEdgeTouchIndex(): Map<
        number,
        MindMapArrowEdgePair[]
    > {
        if (mindMapEdgeTouchIndex?.nodeListRef === nodeList) {
            return mindMapEdgeTouchIndex.byNodeId;
        }
        const byNodeId = new Map<number, MindMapArrowEdgePair[]>();
        const touch = (nodeId: number, pair: MindMapArrowEdgePair) => {
            let list = byNodeId.get(nodeId);
            if (!list) {
                list = [];
                byNodeId.set(nodeId, list);
            }
            list.push(pair);
        };
        for (const pair of collectMindMapArrowEdgePairs()) {
            touch(pair.node.nodeId, pair);
            touch(pair.nextNode.nodeId, pair);
        }
        mindMapEdgeTouchIndex = { nodeListRef: nodeList, byNodeId };
        return byNodeId;
    }

    function collectMindMapArrowEdgesForMovingIds(
        movingIds: Set<number>
    ): MindMapArrowEdgePair[] {
        const byNodeId = ensureMindMapEdgeTouchIndex();
        const seen = new Set<string>();
        const out: MindMapArrowEdgePair[] = [];
        for (const id of movingIds) {
            for (const pair of byNodeId.get(id) ?? []) {
                const key = `${pair.node.nodeId}-${pair.nextNode.nodeId}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(pair);
            }
        }
        return out;
    }

    function patchMindMapArrowLineItemInPlace(
        existing: MindMapArrowLineItem,
        item: MindMapArrowLineItem
    ): boolean {
        let changed = false;
        const nextData = item.pathConf.data as string;
        if (existing.pathConf.data !== nextData) {
            existing.pathConf.data = nextData;
            changed = true;
        }
        const oldPts = existing.arrowConf.points as number[];
        const newPts = item.arrowConf.points as number[];
        if (
            oldPts.length !== newPts.length ||
            oldPts.some((v, i) => v !== newPts[i])
        ) {
            existing.arrowConf.points = newPts.slice();
            changed = true;
        }
        return changed;
    }

    function collectMindMapArrowEdgePairs(): MindMapArrowEdgePair[] {
        const nodeById = new Map<number, any>(
            (nodeList as any[]).map((n) => [n.nodeId, n])
        );
        const pairs: MindMapArrowEdgePair[] = [];
        for (const node of nodeList as any[]) {
            const nextIds = node.nextNodes as number[] | undefined;
            if (!nextIds?.length) continue;
            for (const nextNodeId of nextIds) {
                const nextNode = nodeById.get(nextNodeId);
                if (nextNode) pairs.push({ node, nextNode });
            }
        }
        return pairs;
    }

    function shouldRenderMindMapArrowEdge(
        nodeId: number,
        nextNodeId: number
    ): boolean {
        const snapPreview = dragBundleSnapPreview.value;
        const snapBundleIds =
            snapPreview && dragBundleSnapMovingIds.value.size >= 2
                ? dragBundleSnapMovingIds.value
                : selectedNodes;
        return !mindMapArrowEdgeHiddenDuringBoxSnapPreview(
            snapPreview,
            snapBundleIds,
            nodeId,
            nextNodeId
        );
    }

    function rebuildMindMapArrowLinesInPlace(movingIds: Set<number>) {
        const sel = selectedEdge.value;
        const lines = arrowLines.value;
        const indexByKey = new Map(
            lines.map((line, index) => [`${line.fromId}-${line.toId}`, index])
        );
        let changed = false;
        for (const { node, nextNode } of collectMindMapArrowEdgesForMovingIds(
            movingIds
        )) {
            if (!shouldRenderMindMapArrowEdge(node.nodeId, nextNode.nodeId)) {
                continue;
            }
            const item = buildMindMapArrowLineItem(node, nextNode, sel, {
                lite: true
            });
            if (!item) continue;
            const key = `${node.nodeId}-${nextNode.nodeId}`;
            const at = indexByKey.get(key);
            if (at != null) {
                if (patchMindMapArrowLineItemInPlace(lines[at]!, item)) {
                    changed = true;
                }
            } else {
                indexByKey.set(key, lines.length);
                lines.push(item);
                changed = true;
            }
        }
        /** 框选磁吸预览：须从列表移除应隐藏的边（增量 patch 不会自动删） */
        if (
            dragBundleSnapPreview.value &&
            dragBundleSnapMovingIds.value.size >= 2
        ) {
            for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i]!;
                if (!shouldRenderMindMapArrowEdge(line.fromId, line.toId)) {
                    lines.splice(i, 1);
                    changed = true;
                }
            }
        }
        if (changed) triggerRef(arrowLines);
    }

    function scheduleMindMapArrowLinesFullRebuild() {
        const sel = selectedEdge.value;
        const lines: MindMapArrowLineItem[] = [];
        for (const { node, nextNode } of collectMindMapArrowEdgePairs()) {
            if (!shouldRenderMindMapArrowEdge(node.nodeId, nextNode.nodeId)) {
                continue;
            }
            const item = buildMindMapArrowLineItem(node, nextNode, sel);
            if (item) lines.push(item);
        }
        arrowLines.value = lines;
        invalidateMindMapEdgeTouchIndex();
    }

    const arrowLines = shallowRef<MindMapArrowLineItem[]>([]);

    /** 直接选中的边：画在节点之上，避免阴影被其它卡片盖住 */
    function mindMapArrowLineElevated(
        line: MindMapArrowLineItem,
        sel: { fromId: number; toId: number } | null
    ): boolean {
        return !!(sel && sel.fromId === line.fromId && sel.toId === line.toId);
    }

    const arrowLinesBelowNodes = computed(() => {
        const sel = selectedEdge.value;
        return arrowLines.value.filter(
            (l) => !mindMapArrowLineElevated(l, sel)
        );
    });

    const arrowLinesAboveNodes = computed(() => {
        const sel = selectedEdge.value;
        return arrowLines.value.filter((l) => mindMapArrowLineElevated(l, sel));
    });

    rebuildMindMapArrowLines = (movingIds?: Set<number>) => {
        if (movingIds?.size) {
            rebuildMindMapArrowLinesInPlace(movingIds);
            return;
        }
        scheduleMindMapArrowLinesFullRebuild();
    };

    mindMapDragLayoutScheduler = createMindMapDragLayoutScheduler({
        onDragMoveApply: applyCoalescedDragMove,
        onFrame: (movingIds) => rebuildMindMapArrowLines(movingIds),
        onSnap: (movingIds) => refreshDragBundleSnapPreview(movingIds)
    });

    rebuildMindMapArrowLines();

    let mindMapArrowsLayoutRebuildRaf = 0;
    function scheduleMindMapArrowsRebuild() {
        cancelAnimationFrame(mindMapArrowsLayoutRebuildRaf);
        mindMapArrowsLayoutRebuildRaf = requestAnimationFrame(() => {
            if (mindMapDragLayoutScheduler?.isDragging()) return;
            resolveMindMapLayoutOverlapsAfterNodeResize(
                nodeList as any[],
                buildMindMapLayoutOptions(nodeList.length)
            );
            rebuildMindMapArrowLines();
        });
    }

    /** 节点被内容撑高后 rectConf.height 会变，需重算连线以落在左右端口（水平中线） */
    watch(
        () =>
            (nodeList as any[]).map(
                (n) => `${n.nodeId}:${Number(n.rectConf?.height ?? 0)}`
            ),
        () => scheduleMindMapArrowsRebuild(),
        { flush: 'post' }
    );

    watch(selectedEdge, () => {
        if (mindMapDragLayoutScheduler?.isDragging()) return;
        scheduleMindMapArrowLinesFullRebuild();
    });

    /** 当前拖线起点若连向这些目标会形成有向环——置灰提示（不含起点自身） */
    const linkDragCycleBlockedIds = computed(() => {
        if (!linkDrag.active || linkDrag.fromId == null)
            return new Set<number>();
        const fromId = linkDrag.fromId;
        const reach = mindMapNodeIdsThatCanReachTarget(nodeList as any, fromId);
        const dim = new Set<number>();
        for (const id of reach) {
            if (id !== fromId) dim.add(id);
        }
        return dim;
    });

    /** 拖线预览：光标落在某节点矩形内时，虚线接到该节点端口（不跟鼠标尖）；否则终点跟光标 */
    const linkDragPreviewPathConfig = computed(
        (): Record<string, unknown> | null => {
            if (!linkDrag.active || linkDrag.fromId == null) return null;
            const fromNode = nodeList.find(
                (n: any) => n.nodeId === linkDrag.fromId
            );
            if (!fromNode) return null;

            const rect = {
                width: nodeRectTemp.width,
                height: nodeRectTemp.height
            };
            const blockedIds = linkDragCycleBlockedIds.value;
            const hoverHit = pickMindMapNodeAtCanvasPoint(
                nodeList,
                linkDrag.cx,
                linkDrag.cy,
                linkDrag.fromId,
                rect
            );
            const canSnapToHover =
                hoverHit != null && !blockedIds.has(hoverHit.nodeId);
            const targetIsRealNode = canSnapToHover;
            const toNode = canSnapToHover
                ? hoverHit
                : {
                      nodeId: LINK_DRAG_TARGET_PHANTOM_ID,
                      x: linkDrag.cx,
                      y: linkDrag.cy
                  };

            const edgePorts = mindMapEdgePorts(fromNode, toNode);
            const startX = edgePorts.sx;
            const startY = edgePorts.sy;
            const endX = targetIsRealNode ? edgePorts.ex : linkDrag.cx;
            const endY = targetIsRealNode ? edgePorts.ey : linkDrag.cy;

            const resolved =
                mindMapEdgeRouter.value.resolveLinkDragPreviewAtPorts(
                    fromNode,
                    toNode,
                    startX,
                    startY,
                    endX,
                    endY,
                    { trimStem: targetIsRealNode }
                );

            let pathData = '';
            if (resolved && resolved.linePts.length >= 4) {
                pathData = generateRoundedPath(
                    resolved.linePts,
                    resolved.cornerR
                );
            }
            if (!pathData) {
                pathData = generateRoundedPath([startX, startY, endX, endY], 8);
                if (!pathData) {
                    pathData = `M ${startX} ${startY} L ${endX} ${endY}`;
                }
            }

            return buildMindMapDashedPreviewPathKonvaConfig(pathData, {
                stroke: getMindMapNodeAccentColorByLevel(
                    mindMapNodeLevel(fromNode.nodeId)
                )
            });
        }
    );

    /** 拖拽单选/多选成组时：与磁吸目标之间的虚线预览（极度靠近时出现） */
    const dragBundleSnapPreviewPathConfig = computed(() =>
        buildDragBundleSnapPreviewPathConfig(
            dragBundleSnapPreview.value,
            nodeList as any,
            {
                edgePorts: mindMapEdgePorts,
                obstaclePath: generateObstacleAvoidancePath,
                roundedPath: generateRoundedPath
            },
            {
                bundleHull: resolveMindMapDragBundleSnapHull(
                    dragBundleSnapMovingIds.value
                ),
                sourceNodeLevel: mindMapNodeLevel(
                    dragBundleSnapPreview.value?.mode === 'out'
                        ? dragBundleSnapPreview.value.anchorId
                        : (dragBundleSnapPreview.value?.targetId ?? 0)
                )
            }
        )
    );

    function onMindMapEdgeClick(e: any, fromId: number, toId: number) {
        if (mindMapStagePanEnabled.value) return;
        e.cancelBubble = true;
        closeNodeCtxMenu();
        e.evt?.stopPropagation?.();
        selectedEdge.value = { fromId, toId };
        selectedNodes.clear();
        activeNodes.clear();
        seqBackdrop?.clearFocus();
        closeNodeDrawer();
        suppressNextStageClearClick = true;
        syncNodeOutlineStrokes();
    }

    const handleSoftWheel = useWheel(stageConf, {
        ScaleBy: MM_STAGE_ZOOM_SCALE_BY,
        MinScale: MM_STAGE_ZOOM_MIN,
        MaxScale: MM_STAGE_ZOOM_MAX
    });

    const isKeyboardTargetEditable = (target: EventTarget | null): boolean => {
        if (!target || !(target instanceof HTMLElement)) return false;
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')
            return true;
        return target.isContentEditable;
    };

    /** 优先唯一的框选节点；否则唯一的单击主选 → 与删除目标一致，便于快捷键操作 */
    const getQuickAddChildParentNode = (): any | null => {
        if (selectedNodes.size === 1) {
            const id = selectedNodes.values().next().value as number;
            return nodeList.find((n) => n.nodeId === id) ?? null;
        }
        if (activeNodes.size === 1) {
            const id = activeNodes.values().next().value as number;
            return nodeList.find((n) => n.nodeId === id) ?? null;
        }
        return null;
    };

    /** 优先框选集合；否则删除当前单击选中的主节点（activeNodes） */
    const getDeleteTargetIds = (): Set<number> => {
        if (selectedNodes.size > 0) {
            return new Set(selectedNodes);
        }
        return new Set(activeNodes);
    };

    /** 弹窗打开时按当前选中状态展示文案（与 getDeleteTargetIds 一致） */
    const deleteConfirmTargetCount = computed(() => {
        if (!deleteNodesConfirmVisible.value) return 0;
        if (pendingDeleteIdsOverride.value?.size) {
            return pendingDeleteIdsOverride.value.size;
        }
        return getDeleteTargetIds().size;
    });

    const deleteMindMapNodesSnapshot = (ids: Set<number>) => {
        if (!ids.size) return;

        pushMindMapUndoSnapshot();
        removeMindMapNodesById(nodeList, ids);
        syncMindMapTopologyBinding();
        selectedNodes.clear();
        activeNodes.clear();
        selectedEdge.value = null;
        seqBackdrop?.clearFocus();
        if (drawerNode.value && ids.has(drawerNode.value.nodeId)) {
            closeNodeDrawer();
        }
        syncNodeOutlineStrokes();
        markMindMapTopologyChanged();
    };

    /** 打开删除确认弹窗（与 nodeEditor.vue 同源 Dialog） */
    /** 若有选中节点则打开删除确认弹窗并返回 true */
    function openDeleteNodesConfirm(): boolean {
        if (!getDeleteTargetIds().size) return false;
        pendingDeleteIdsOverride.value = null;
        deleteNodesConfirmVisible.value = true;
        return true;
    }

    function cancelDeleteNodesConfirm() {
        pendingDeleteIdsOverride.value = null;
        deleteNodesConfirmVisible.value = false;
    }

    function confirmDeleteNodesFromDialog() {
        const ids = pendingDeleteIdsOverride.value?.size
            ? new Set(pendingDeleteIdsOverride.value)
            : getDeleteTargetIds();
        pendingDeleteIdsOverride.value = null;
        cancelDeleteNodesConfirm();
        if (!ids.size) return;
        deleteMindMapNodesSnapshot(ids);
    }

    function onMindMapDrawerDeleteNode(nodeId: number) {
        if (nodeId == null || Number.isNaN(nodeId)) return;
        pendingDeleteIdsOverride.value = new Set([nodeId]);
        deleteNodesConfirmVisible.value = true;
    }

    function deleteMindMapEdgeImmediate(fromId: number, toId: number) {
        pushMindMapUndoSnapshot();
        if (removeMindMapDirectedEdge(nodeList, fromId, toId)) {
            syncMindMapTopologyBinding();
            ElMessage.success('已删除连线');
        } else {
            discardLastMindMapUndoSnapshot();
        }
        selectedEdge.value = null;
        markMindMapTopologyChanged();
    }

    const mindMapNodeContextMenuCtl = createMindMapNodeContextMenuController({
        getNodeList: () => nodeList,
        pickExcludeNodeId: LINK_DRAG_TARGET_PHANTOM_ID,
        canvasPointFromStage,
        pickNodeAtCanvasPoint: pickMindMapNodeAtCanvasPoint,
        markSuppressNextStageClearClick: () => {
            suppressNextStageClearClick = true;
        },
        prepareOpenContext: (ctx) => {
            closeNodeDrawer();
            if (ctx.kind === 'node') {
                selectedEdge.value = null;
                seqBackdrop?.clearFocus();
            } else {
                selectedEdge.value = { fromId: ctx.fromId, toId: ctx.toId };
                selectedNodes.clear();
                activeNodes.clear();
                seqBackdrop?.clearFocus();
                syncNodeOutlineStrokes();
            }
        },
        applyPrimarySelection: setPrimaryActiveNode,
        shouldSkipApplyPrimarySelection: (node) =>
            selectedNodes.size > 1 && selectedNodes.has(node.nodeId),
        openEditorForNode: bindDrawerToNode,
        onAiExpandRequest: (node) => aiExpandNodeRef.fn?.(node),
        openDeleteConfirmation: () => openDeleteNodesConfirm(),
        deleteEdgeImmediate: deleteMindMapEdgeImmediate
    });

    const nodeCtxMenuVisible = mindMapNodeContextMenuCtl.visible;
    const nodeCtxMenuKind = mindMapNodeContextMenuCtl.menuKind;
    const nodeCtxMenuPos = mindMapNodeContextMenuCtl.menuPos;
    const closeNodeCtxMenu = mindMapNodeContextMenuCtl.close;
    closeNodeCtxMenuBridge.fn = closeNodeCtxMenu;
    const onDocumentMaybeCloseCtxMenu =
        mindMapNodeContextMenuCtl.onDocumentMaybeCloseCtxMenu;
    const handleNodeCtxBackdropDown =
        mindMapNodeContextMenuCtl.onBackdropMouseDown;
    const onMindMapCanvasContextMenu =
        mindMapNodeContextMenuCtl.onKonvaStageContextMenu;

    function onMindMapCanvasContextMenuGuarded(e: unknown) {
        if (mindMapStagePanEnabled.value) {
            const evt = e as { evt?: MouseEvent } | null;
            evt?.evt?.preventDefault?.();
            return;
        }
        onMindMapCanvasContextMenu(e);
    }
    const handleNodeCtxEdit = mindMapNodeContextMenuCtl.handleEditClick;
    const handleNodeCtxAiExpand = mindMapNodeContextMenuCtl.handleAiExpandClick;
    const handleNodeCtxDelete = mindMapNodeContextMenuCtl.handleDeleteClick;

    const handleKeyDown = (e: KeyboardEvent) => {
        const editable = isKeyboardTargetEditable(e.target);
        if (
            (e.ctrlKey || e.metaKey) &&
            !e.shiftKey &&
            e.code === 'KeyZ' &&
            !e.repeat &&
            !editable
        ) {
            e.preventDefault();
            performMindMapUndo();
            return;
        }
        if (mindMapStagePanEnabled.value && !editable) {
            if (isPanModifierKey(e.code)) {
                e.preventDefault();
            }
            return;
        }
        if (
            (e.code === 'Backspace' || e.code === 'Delete') &&
            !isKeyboardTargetEditable(e.target)
        ) {
            const edge = selectedEdge.value;
            if (edge) {
                deleteMindMapEdgeImmediate(edge.fromId, edge.toId);
                e.preventDefault();
                return;
            }
            if (openDeleteNodesConfirm()) {
                e.preventDefault();
            }
            return;
        }
        if (e.code === 'Escape' && !isKeyboardTargetEditable(e.target)) {
            if (selectedEdge.value) return;
            if (seqBackdrop?.tryHandleEscape()) {
                e.preventDefault();
                return;
            }
        }
        /** 与右侧圆点松开「单击加子」同源：回车快速加子并选中新节点 */
        if (
            (e.code === 'Enter' || e.code === 'NumpadEnter') &&
            !e.shiftKey &&
            !isKeyboardTargetEditable(e.target)
        ) {
            if (selectedEdge.value) return;
            const parent = getQuickAddChildParentNode();
            if (!parent) return;
            e.preventDefault();
            pushMindMapUndoSnapshot();
            appendMindMapChildUnder(nodeList, parent, {
                nodeWidth: nodeRectTemp.width,
                nodeHeight: nodeRectTemp.height
            });
            const nid = maxNodeIdInList(nodeList);
            const child = nodeList.find((n) => n.nodeId === nid);
            if (child) setPrimaryActiveNode(child);
            else syncNodeOutlineStrokes();
            markMindMapTopologyChanged();
            return;
        }
        if (isPanModifierKey(e.code) && !stickyPanMode.value && !editable) {
            e.preventDefault();
            ctrlPanActive.value = true;
            applyMindMapStageDraggable();
            if (stageDom.value) stageDom.value.style.cursor = 'grab';
        }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
        if (isKeyboardTargetEditable(e.target)) return;
        if (!isPanModifierKey(e.code)) return;
        e.preventDefault();
        if (!isPanModifierHeld(e)) {
            ctrlPanActive.value = false;
            applyMindMapStageDraggable();
            if (stageDom.value) {
                stageDom.value.style.cursor = stickyPanMode.value
                    ? 'grab'
                    : 'default';
            }
        }
    };

    const onStageClick = (e: any) => {
        if (mindMapStagePanEnabled.value) return;
        closeNodeCtxMenu();
        if (suppressNextStageClearClick) {
            suppressNextStageClearClick = false;
            return;
        }

        const stage = e.target?.getStage?.();
        if (!stage || e.target !== stage) {
            return;
        }

        if (!nodeList.length) return;

        const stageForHit = e.target?.getStage?.();
        const ptr = stageForHit?.getPointerPosition?.();
        const hull = multiSelectHullRect.value;
        if (stageForHit && ptr && hull && selectedNodes.size >= 2) {
            const pt = canvasScenePointFromStageViewport(
                stageForHit,
                ptr.x,
                ptr.y
            );
            if (pt && isScenePointInsideMultiSelectHull(pt, hull)) {
                return;
            }
        }

        closeNodeDrawer();
        selectedNodes.clear();
        activeNodes.clear();
        selectedEdge.value = null;
        hoveredNodeId.value = null;
        seqBackdrop?.clearFocus();
        syncNodeOutlineStrokes();
    };

    function scenePointFromStagePointer(
        stage: any
    ): { x: number; y: number } | null {
        const layer = stage.children?.[0];
        const pos = stage.getPointerPosition?.();
        if (!layer || !pos) return null;
        const transform = layer.getAbsoluteTransform().copy().invert();
        return transform.point(pos);
    }

    function sequenceBlockMatchingNodeIds(
        ids: ReadonlySet<number>
    ): MindMapSequenceBlockBackdropItem | undefined {
        return sequenceBlockBackdropItems.value.find((blk) => {
            if (blk.nodeIds.length !== ids.size) return false;
            return blk.nodeIds.every((id) => ids.has(id));
        });
    }

    /** 画布 / 分组底衬空白处：启动框选（restrict 时仅选中该集合内节点） */
    function beginMarqueeSelection(
        e: any,
        restrictToNodeIds?: ReadonlySet<number>
    ) {
        if (mindMapStagePanEnabled.value) return;
        const stage = e.target?.getStage?.();
        if (!stage) return;

        if (restrictToNodeIds) {
            const blk = sequenceBlockMatchingNodeIds(restrictToNodeIds);
            if (
                blk &&
                (isSequenceBlockSelectionActive(blk) ||
                    isSequenceBlockBackdropFocused(blk))
            ) {
                return;
            }
        }

        closeNodeCtxMenu();
        if (selectedNodes.size) selectedNodes.clear();
        closeNodeDrawer();
        activeNodes.clear();
        selectedEdge.value = null;
        hoveredNodeId.value = null;
        if (!restrictToNodeIds) {
            pendingSequenceBlockFocus = null;
            seqBackdrop?.clearFocus();
        }
        syncNodeOutlineStrokes();

        const localPos = scenePointFromStagePointer(stage);
        if (!localPos) return;

        marqueeRestrictNodeIds = restrictToNodeIds
            ? new Set(restrictToNodeIds)
            : null;

        isSelecting.value = true;
        selectionBox.startX = localPos.x;
        selectionBox.startY = localPos.y;
        selectionBox.endX = localPos.x;
        selectionBox.endY = localPos.y;
        selectionBox.visible = true;
    }

    // 框选相关函数
    const onStageMouseDown = (e: any) => {
        closeNodeCtxMenu();
        // 如果按住 Ctrl/Cmd 抓手或点击到节点，不启动框选
        if (mindMapStagePanEnabled.value || e.target !== e.target.getStage())
            return;

        beginMarqueeSelection(e);
    };

    const onStageMouseMove = (e: any) => {
        if (!isSelecting.value) return;

        const stage = e.target.getStage();
        const layer = stage.children[0]; // 获取 layer
        const pos = stage.getPointerPosition();

        // 将屏幕坐标转换为画布坐标
        const transform = layer.getAbsoluteTransform().copy().invert();
        const localPos = transform.point(pos);

        selectionBox.endX = localPos.x;
        selectionBox.endY = localPos.y;

        // 实时更新选中的节点
        updateSelectedNodes();
    };

    const onStageMouseUp = () => {
        if (!isSelecting.value) return;

        const focusBlock = pendingSequenceBlockFocus;
        pendingSequenceBlockFocus = null;
        marqueeRestrictNodeIds = null;

        isSelecting.value = false;
        selectionBox.visible = false;
        suppressNextStageClearClick = true;

        if (!selectedNodes.size) {
            if (focusBlock) {
                applySequenceBlockFocusOnly(focusBlock);
            }
            return;
        }
        seqBackdrop?.clearFocus();
        if (selectedNodes.size > 1) {
            clearDrawerNode();
        } else {
            activeNodes.add([...selectedNodes][0]!);
            syncDrawerFromSelection();
        }
        syncNodeOutlineStrokes();
    };

    const updateSelectedNodes = () => {
        activeNodes.clear();
        selectedEdge.value = null;
        const boxBounds = getSelectionBoxBounds();

        selectedNodes.clear();

        for (const node of nodeList) {
            if (
                marqueeRestrictNodeIds &&
                !marqueeRestrictNodeIds.has(node.nodeId)
            ) {
                continue;
            }
            const nodeBounds = getNodeBounds(node);

            // 检查节点是否与框选区域相交
            if (isIntersecting(boxBounds, nodeBounds)) {
                selectedNodes.add(node.nodeId);
            }
        }
        syncNodeOutlineStrokes();
    };

    const getSelectionBoxBounds = () => {
        return {
            left: Math.min(selectionBox.startX, selectionBox.endX),
            right: Math.max(selectionBox.startX, selectionBox.endX),
            top: Math.min(selectionBox.startY, selectionBox.endY),
            bottom: Math.max(selectionBox.startY, selectionBox.endY)
        };
    };

    const isIntersecting = (box1: any, box2: any) => {
        return !(
            box1.right < box2.left ||
            box1.left > box2.right ||
            box1.bottom < box2.top ||
            box1.top > box2.bottom
        );
    };

    /** 单击主选节点并同步右侧编辑面板；Ctrl/Cmd+单击可多选切换 */
    const onNodeClick = (e: any, node: any) => {
        if (mindMapStagePanEnabled.value) return;
        e.cancelBubble = true;
        suppressNextStageClearClick = true;
        closeNodeCtxMenu();
        seqBackdrop?.clearFocus();
        selectedEdge.value = null;
        const ke = e.evt as MouseEvent | PointerEvent | undefined;
        const multiMod = !!(ke && (ke.ctrlKey || ke.metaKey));

        if (multiMod) {
            const id = node.nodeId;
            const inSelected = selectedNodes.has(id);
            const soleActiveOnly =
                activeNodes.size === 1 &&
                selectedNodes.size === 0 &&
                activeNodes.has(id);

            if (inSelected || soleActiveOnly) {
                selectedNodes.delete(id);
                activeNodes.delete(id);
            } else {
                if (selectedNodes.size === 0 && activeNodes.size === 1) {
                    selectedNodes.add([...activeNodes][0]!);
                    activeNodes.clear();
                }
                selectedNodes.add(id);
                activeNodes.clear();
                activeNodes.add(id);
            }
            if (selectedNodes.size && !activeNodes.size) {
                activeNodes.add([...selectedNodes][0]!);
            }
            syncNodeOutlineStrokes();
            syncDrawerFromSelection();
            return;
        }

        nextTick(() => setPrimaryActiveNode(node));
    };

    const onNodeOver = (node: any) => {
        if (mindMapStagePanEnabled.value) return;
        hoveredNodeId.value = node.nodeId;
        if (activeNodes.has(node.nodeId) || selectedNodes.has(node.nodeId))
            return;
        node.rectConf.stroke = resolveMindMapNodeStroke(
            node.guide,
            true,
            mindMapNodeLevel(node.nodeId)
        );
    };

    const onNodeOut = (node: any) => {
        if (mindMapStagePanEnabled.value) return;
        if (hoveredNodeId.value === node.nodeId) {
            hoveredNodeId.value = null;
        }
        if (activeNodes.has(node.nodeId) || selectedNodes.has(node.nodeId))
            return;
        node.rectConf.stroke = resolveMindMapNodeStroke(
            node.guide,
            false,
            mindMapNodeLevel(node.nodeId)
        );
    };

    function nodeShowsConnectionHandles(node: any): boolean {
        if (mindMapStagePanEnabled.value) return false;
        if (activeNodes.has(node.nodeId)) return true;
        if (hoveredNodeId.value === node.nodeId) return true;
        return dragBundleSnapPreview.value?.targetId === node.nodeId;
    }

    const onNodeCircleOver = (e: any) => {
        e.cancelBubble = true;
    };

    const onNodeCircleOut = (e: any) => {
        e.cancelBubble = true;
    };

    function onNodeDragStart(_e: unknown, node: any) {
        if (mindMapStagePanEnabled.value) return;
        const e = _e as {
            target?: {
                getClassName?: () => string;
                getParent?: () => { stopDrag?: () => void };
            };
        };
        const t = e?.target;
        /** 衔接圆点是 draggable Group 的子元素，按下会误启整组拖拽，须立即终止 */
        if (t && t.getClassName?.() === 'Circle') {
            t.getParent?.()?.stopDrag?.();
            return;
        }

        clearDragBundleSnapPreview();
        resetDragAlignSnap();

        mindMapUndoOnDragStart();
        mindMapDragLayoutScheduler?.beginDrag();
        if (selectedNodes.size > 1 && selectedNodes.has(node.nodeId)) {
            const origins = new Map<number, { x: number; y: number }>();
            for (const n of nodeList) {
                if (selectedNodes.has(n.nodeId)) {
                    origins.set(n.nodeId, { x: n.x, y: n.y });
                }
            }
            dragAlignOrigins = origins;
            multiDragSession = {
                leaderId: node.nodeId,
                originLeaderX: node.x,
                originLeaderY: node.y,
                origins
            };
            lastDraggedSingletonId.value = null;
        } else {
            multiDragSession = null;
            dragAlignOrigins = new Map([
                [node.nodeId, { x: node.x, y: node.y }]
            ]);
            lastDraggedSingletonId.value = node.nodeId;
        }
    }

    const onNodeDragMove = (e: any, node: any) => {
        const nx = e.target.x();
        const ny = e.target.y();

        let moving: Set<number>;
        let origins: Map<number, { x: number; y: number }>;
        let dx: number;
        let dy: number;

        if (
            multiDragSession &&
            multiDragSession.leaderId === node.nodeId &&
            selectedNodes.has(node.nodeId)
        ) {
            dx = nx - multiDragSession.originLeaderX;
            dy = ny - multiDragSession.originLeaderY;
            moving = new Set(selectedNodes);
            origins = multiDragSession.origins;
        } else {
            const o = dragAlignOrigins.get(node.nodeId) ?? {
                x: node.x,
                y: node.y
            };
            dx = nx - o.x;
            dy = ny - o.y;
            moving = new Set([node.nodeId]);
            origins = dragAlignOrigins;
        }

        mindMapDragLayoutScheduler?.scheduleDragMove({
            movingIds: moving,
            origins,
            dx,
            dy,
            syncKonvaLeader: () => {
                const leader = nodeList.find(
                    (n: any) => n.nodeId === node.nodeId
                );
                if (leader) {
                    e.target.position({ x: leader.x, y: leader.y });
                }
            }
        });
    };

    function onNodeDragEnd() {
        let moving: Set<number> | null = null;
        if (selectedNodes.size > 1) {
            moving = new Set(selectedNodes);
        } else if (lastDraggedSingletonId.value != null) {
            moving = new Set([lastDraggedSingletonId.value]);
        }
        tryCommitDragBundleSnap(moving);
        lastDraggedSingletonId.value = null;
        mindMapUndoOnDragEnd();
        multiDragSession = null;
        clearDragAlignGuides();
        clearDragBundleSnapPreview();
        mindMapDragLayoutScheduler?.endDrag();
    }

    /** 当前视口中心对应的画布 scene 坐标（读 Konva 实时平移，与缩放按钮一致） */
    const mindMapViewportSceneCenter = () => {
        const { width: stageW, height: stageH } = measureMindMapStageViewport();
        const { x: mx, y: my, scale } = mindMapStageTransformForZoom();
        return {
            x: (stageW / 2 - mx) / scale,
            y: (stageH / 2 - my) / scale
        };
    };

    const standaloneNodeLayout = () => ({
        nodeWidth: nodeRectTemp.width,
        nodeHeight: nodeRectTemp.height
    });

    const onAddInitNode = () => {
        pushMindMapUndoSnapshot();
        appendStandaloneMindMapNode(
            nodeList,
            mindMapViewportSceneCenter(),
            undefined,
            standaloneNodeLayout()
        );
        const nid = maxNodeIdInList(nodeList);
        const added = nodeList.find((n: any) => n.nodeId === nid);
        if (added) setPrimaryActiveNode(added);
        else syncNodeOutlineStrokes();
        markMindMapTopologyChanged();
    };

    const onAddMindMapFromTemplate = (command: number | string) => {
        const idx = Number(command);
        const tpl = MEDICINE_OPERATE_ADD_NODE_TEMPLATES[idx];
        if (!tpl) return;
        pushMindMapUndoSnapshot();
        const guide = medicineAddSeedToGuide(tpl.value);
        appendStandaloneMindMapNode(
            nodeList,
            mindMapViewportSceneCenter(),
            guide,
            standaloneNodeLayout()
        );
        const nid = maxNodeIdInList(nodeList);
        const added = nodeList.find((n: any) => n.nodeId === nid);
        if (added) setPrimaryActiveNode(added);
        else syncNodeOutlineStrokes();
        markMindMapTopologyChanged();
    };

    const aiGenerateDialogVisible = ref(false);
    const aiGenerateDialogRef = ref<InstanceType<typeof AiGenerateDialog> | null>(null);

    function runAiAutoLayout() {
        if (!nodeList.length) return;
        applyLayerLayoutWithSeparatedComponents(nodeList as any[], {
            ...buildMindMapLayoutOptions(nodeList.length)
        });
        nextTick(() => {
            requestAnimationFrame(() => {
                panMindMapViewToNodesInViewport(nodeList, {
                    horizontalAlign: 'left',
                    fitToView: true
                });
                syncNodeOutlineStrokes();
            });
        });
    }

    function openAiGenerateDialog() {
        aiGenerateDialogVisible.value = true;
    }

    async function onAiGenerateConfirm(topic: string) {
        aiGenerateDialogRef.value?.setLoading(true);
        try {
            pushMindMapUndoSnapshot();
            const data = await generateMindMap(topic);
            const root = applyAiMindMapTree(
                nodeList,
                data,
                standaloneNodeLayout(),
                mindMapViewportSceneCenter()
            );
            markMindMapTopologyChanged();
            if (root) {
                runAiAutoLayout();
                setPrimaryActiveNode(root);
                ElMessage.success('脑图生成成功');
            }
            aiGenerateDialogVisible.value = false;
        } catch (e) {
            ElMessage.error((e as Error).message || '生成失败');
        } finally {
            aiGenerateDialogRef.value?.setLoading(false);
        }
    }

    async function onAiExpandNode(node: any) {
        const title = getNodeTitle(node);
        try {
            pushMindMapUndoSnapshot();
            const data = await expandMindMapNode(
                title,
                buildMindMapContextSummary(nodeList)
            );
            const added = applyAiExpandChildren(
                nodeList,
                node,
                data,
                standaloneNodeLayout()
            );
            markMindMapTopologyChanged();
            if (added.length) {
                runAiAutoLayout();
                setPrimaryActiveNode(added[0]);
                ElMessage.success(`已展开 ${added.length} 个子节点`);
            } else {
                ElMessage.warning('AI 未返回子节点');
            }
        } catch (e) {
            ElMessage.error((e as Error).message || '展开失败');
        }
    }

    aiExpandNodeRef.fn = (node) => {
        void onAiExpandNode(node);
    };

    /** 在控制台打印画布快照与 medicineOperateGuide 兼容结构 */
    const printNodeMindMapData = () => {
        const snapshot = deepClone(nodeList);
        const tableRows = mindMapNodesToTableRows(snapshot as any[]);
        const topology = snapshot.map((n: any) => ({
            nodeId: n.nodeId,
            x: n.x,
            y: n.y,
            prevNodes: n.prevNodes,
            nextNodes: n.nextNodes,
            guide: n.guide
        }));
        const routeReport = mindMapEdgeRouter.value.buildRouteDebugReport({
            selectedEdge: selectedEdge.value,
            generateRoundedPath
        });
        const routeTable = routeReport.edges.map((e) => ({
            edge: e.edge,
            finalStrategy:
                e.finalStrategy ?? (e as { skipped?: string }).skipped,
            forceObs: (e.routeExtras as { forceDefaultPortObstacle?: boolean })
                ?.forceDefaultPortObstacle,
            horizGap: (e.routeExtras as { horizBoxGap?: number })?.horizBoxGap,
            portSpan: (e.routeExtras as { portHorizSpan?: number })
                ?.portHorizSpan,
            verts: e.vertexCount,
            post: (e.postProcess as string[])?.join(',') || '-',
            selected: e.selected
        }));

        console.log('[NodeMindMap] editor activeIds:', [...activeNodes]);
        console.log('[NodeMindMap] editor marqueeSelected:', [
            ...selectedNodes
        ]);
        console.log('[NodeMindMap] 连线策略汇总:', routeReport.strategySummary);
        console.table(routeTable);
        console.log(
            '[NodeMindMap] 连线明细（含折点/路径）:',
            routeReport.edges
        );
        console.log('[NodeMindMap] nodeList 画布快照:', snapshot);
        console.log('[NodeMindMap] 拓扑 + guide:', topology);
        // console.log('[NodeMindMap] medicineOperateGuide 兼容行:', tableRows);
        // console.log(
        //     '[NodeMindMap] 连线调试 JSON:\n' +
        //         JSON.stringify(routeReport, null, 2)
        // );
        // console.log('[NodeMindMap] 画布节点 JSON:\n' + JSON.stringify(snapshot, null, 2));
        // console.log('[NodeMindMap] medicineOperateGuide JSON:\n' + JSON.stringify(tableRows, null, 2));

        const stage = getMindMapKonvaStage();
        const clientCoordPayload = stage
            ? buildMindMapClientCoordDebugPayload(
                  stage,
                  snapshot as any[],
                  routeReport.edges,
                  nodeRectTemp.width / 2,
                  nodeRectTemp.height / 2
              )
            : null;
        if (clientCoordPayload) {
            console.log(
                '[NodeMindMap] 页面坐标（client，原点=浏览器可视区域左上角，供自动化/测试）:',
                clientCoordPayload
            );
            // console.log(
            //     '[NodeMindMap] 页面坐标 JSON:\n' +
            //         JSON.stringify(clientCoordPayload, null, 2)
            // );
        } else {
            console.warn(
                '[NodeMindMap] 页面坐标未生成：Konva Stage 未就绪，请先打开脑图画布后再打印'
            );
        }
    };

    onBeforeMount(() => {
        window.nextLoading = false;
        const el = document.querySelector('.loading-next');
        el?.parentNode?.removeChild(el);
    });

    watch(mindMapStageRef, () => nextTick(() => applyMindMapStageDraggable()), {
        flush: 'post'
    });

    watch(mindMapStagePanEnabled, (enabled) => {
        if (enabled) {
            closeNodeCtxMenu();
        }
    });

    onMounted(() => {
        updateMindMapStageSize();
        window.addEventListener('resize', updateMindMapStageSize);
        stageDom.value = document.querySelector('canvas') as HTMLCanvasElement;
        nextTick(() => applyMindMapStageDraggable());
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        document.addEventListener('mousedown', onDocumentMaybeCloseCtxMenu);
    });

    onBeforeUnmount(() => {
        window.removeEventListener('resize', updateMindMapStageSize);
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
        document.removeEventListener('mousedown', onDocumentMaybeCloseCtxMenu);
        unlinkEndHandleWindowListeners();
        seqBackdrop?.dispose();
    });
</script>

<template>
    <div
        class="node-editor"
    >
        <NodeMindMapEditorHeader
            :auto-layout-disabled="!nodeList.length"
            :undo-disabled="!canUndoMindMap"
            :mind-map-zoom-percent="mindMapZoomPercent"
            :sticky-pan-mode="stickyPanMode"
            @add-init-node="onAddInitNode"
            @add-from-template="onAddMindMapFromTemplate"
            @print-to-console="printNodeMindMapData"
            @auto-layout="handleAutoLayout"
            @undo="performMindMapUndo"
            @zoom-adjust="adjustMindMapZoom"
            @reset-view="resetMindMapView"
            @toggle-pan="toggleMindMapPanEdit"
            @preview="handleOpenPreview"
            @export="handleExportJson"
            @ai-generate="openAiGenerateDialog"
        />
        <div class="node-editor__body">
            <div
                class="node-editor__canvas"
                ref="mindMapCanvasElRef"
                :class="{ 'node-editor__canvas--pan': mindMapStagePanEnabled }"
            >
                <v-stage
                    ref="mindMapStageRef"
                    :config="stageConf"
                    @wheel="handleSoftWheel"
                    @click="onStageClick"
                    @contextmenu="onMindMapCanvasContextMenuGuarded"
                    @mousedown="onStageMouseDown"
                    @mousemove="onStageMouseMove"
                    @mouseup="onStageMouseUp"
                >
                    <v-layer :config="layerConf">
                        <v-rect
                            v-for="(blk, bi) in sequenceBlockBackdropItems"
                            :key="`seq-block-bg-${bi}`"
                            :config="{
                                x: blk.x,
                                y: blk.y,
                                width: blk.width,
                                height: blk.height,
                                fill: isSequenceBlockBackdropBackdropHighlight(
                                    blk
                                )
                                    ? 'rgba(26, 85, 233, 0.1)'
                                    : 'rgba(26, 85, 233, 0.01)',
                                stroke: isSequenceBlockBackdropBackdropHighlight(
                                    blk
                                )
                                    ? '#1A55E9'
                                    : 'rgba(26, 85, 233, 0.22)',
                                strokeWidth:
                                    isSequenceBlockBackdropBackdropHighlight(
                                        blk
                                    )
                                        ? 2
                                        : 1,
                                cornerRadius: 22,
                                listening: !mindMapStagePanEnabled,
                                perfectDrawEnabled: false
                            }"
                            @mousedown="
                                (e: any) =>
                                    onSequenceBlockBackdropPointerDown(e, blk)
                            "
                            @dblclick="
                                (e: any) =>
                                    onSequenceBlockBackdropDoubleClick(e, blk)
                            "
                            @dbltap="
                                (e: any) =>
                                    onSequenceBlockBackdropDoubleClick(e, blk)
                            "
                        />
                        <!-- 正式连线（底层）：未选中边在节点之下 -->
                        <v-path
                            v-for="line in arrowLinesBelowNodes"
                            :key="`ln-${line.fromId}-${line.toId}`"
                            :config="{
                                ...line.pathConf,
                                listening: !mindMapStagePanEnabled
                            }"
                            @click="
                                (e: any) =>
                                    onMindMapEdgeClick(
                                        e,
                                        line.fromId,
                                        line.toId
                                    )
                            "
                            @tap="
                                (e: any) =>
                                    onMindMapEdgeClick(
                                        e,
                                        line.fromId,
                                        line.toId
                                    )
                            "
                        />
                        <v-arrow
                            v-for="line in arrowLinesBelowNodes"
                            :key="`ar-${line.fromId}-${line.toId}`"
                            :config="{
                                ...line.arrowConf,
                                listening:
                                    !mindMapStagePanEnabled &&
                                    !!line.arrowConf.listening
                            }"
                            @click="
                                (e: any) =>
                                    onMindMapEdgeClick(
                                        e,
                                        line.fromId,
                                        line.toId
                                    )
                            "
                            @tap="
                                (e: any) =>
                                    onMindMapEdgeClick(
                                        e,
                                        line.fromId,
                                        line.toId
                                    )
                            "
                        />

                        <!-- 绘制框选虚线框 -->
                        <v-rect
                            v-if="selectionBox.visible"
                            :config="{
                                x: Math.min(
                                    selectionBox.startX,
                                    selectionBox.endX
                                ),
                                y: Math.min(
                                    selectionBox.startY,
                                    selectionBox.endY
                                ),
                                width: Math.abs(
                                    selectionBox.endX - selectionBox.startX
                                ),
                                height: Math.abs(
                                    selectionBox.endY - selectionBox.startY
                                ),
                                stroke: '#1A55E9',
                                strokeWidth: 2,
                                dash: [10, 5],
                                fill: 'rgba(26, 85, 233, 0.1)',
                                listening: false
                            }"
                        />

                        <!-- 多选外包「可拖移」热区：在节点下层，空隙处拖整组；节点区域仍响应点击 -->
                        <v-rect
                            v-if="
                                multiSelectHullRect &&
                                !isSelecting &&
                                !mindMapStagePanEnabled
                            "
                            :config="{
                                x: multiSelectHullRect.x,
                                y: multiSelectHullRect.y,
                                width: multiSelectHullRect.width,
                                height: multiSelectHullRect.height,
                                fill: 'rgba(26, 85, 233, 0.07)',
                                strokeWidth: 0,
                                listening: true,
                                cursor: 'grab',
                                perfectDrawEnabled: false
                            }"
                            @pointerdown="onMultiSelectHullPointerDown"
                        />

                        <!-- 选中边（顶层）：阴影不被其它节点遮住 -->
                        <v-path
                            v-for="line in arrowLinesAboveNodes"
                            :key="`ln-top-${line.fromId}-${line.toId}`"
                            :config="{
                                ...line.pathConf,
                                listening: !mindMapStagePanEnabled
                            }"
                            @click="
                                (e: any) =>
                                    onMindMapEdgeClick(
                                        e,
                                        line.fromId,
                                        line.toId
                                    )
                            "
                            @tap="
                                (e: any) =>
                                    onMindMapEdgeClick(
                                        e,
                                        line.fromId,
                                        line.toId
                                    )
                            "
                        />
                        <v-arrow
                            v-for="line in arrowLinesAboveNodes"
                            :key="`ar-top-${line.fromId}-${line.toId}`"
                            :config="{
                                ...line.arrowConf,
                                listening:
                                    !mindMapStagePanEnabled &&
                                    !!line.arrowConf.listening
                            }"
                            @click="
                                (e: any) =>
                                    onMindMapEdgeClick(
                                        e,
                                        line.fromId,
                                        line.toId
                                    )
                            "
                            @tap="
                                (e: any) =>
                                    onMindMapEdgeClick(
                                        e,
                                        line.fromId,
                                        line.toId
                                    )
                            "
                        />

                        <!-- 绘制节点 -->
                        <NodeMindMapKonvaNode
                            v-for="node in nodeList"
                            :key="node.nodeId"
                            :node="node"
                            :node-level="mindMapNodeLevel(node.nodeId)"
                            :draggable="
                                !mindMapStagePanEnabled &&
                                endHandleFreezeNodeId !== node.nodeId &&
                                !isNodeLockedBySequenceBackdropBlock(node)
                            "
                            :listening="!mindMapStagePanEnabled"
                            :wire-drag-cycle-blocked="
                                linkDrag.active &&
                                linkDragCycleBlockedIds.has(node.nodeId)
                            "
                            :show-connection-handles="
                                nodeShowsConnectionHandles(node)
                            "
                            :video-data-list="videoDataList"
                            :default-rect-size="{
                                width: nodeRectTemp.width,
                                height: nodeRectTemp.height
                            }"
                            @mouseover="onNodeOver(node)"
                            @mouseout="onNodeOut(node)"
                            @click="(e: any) => onNodeClick(e, node)"
                            @tap="(e: any) => onNodeClick(e, node)"
                            @dragstart="(e: any) => onNodeDragStart(e, node)"
                            @dragmove="(e: any) => onNodeDragMove(e, node)"
                            @dragend="onNodeDragEnd"
                            @validation-tip-show="onNodeValidationTipShow"
                            @validation-tip-hide="onNodeValidationTipHide"
                            @layout-change="scheduleMindMapArrowsRebuild"
                            @circle-start-over="(e: any) => onNodeCircleOver(e)"
                            @circle-start-out="(e: any) => onNodeCircleOut(e)"
                            @circle-start-pointer-down="
                                (e: any) => onCircleEndPointerDown(e, node)
                            "
                            @circle-end-over="(e: any) => onNodeCircleOver(e)"
                            @circle-end-out="(e: any) => onNodeCircleOut(e)"
                            @circle-end-pointer-down="
                                (e: any) => onCircleEndPointerDown(e, node)
                            "
                        />

                        <!-- 多选外包：描边与两侧圆点仅在节点之上绘制（不抢点击） -->
                        <v-rect
                            v-if="multiSelectHullRect && !isSelecting"
                            :config="{
                                x: multiSelectHullRect.x,
                                y: multiSelectHullRect.y,
                                width: multiSelectHullRect.width,
                                height: multiSelectHullRect.height,
                                stroke: '#1A55E9',
                                strokeWidth: 2,
                                dash: [8, 5],
                                fillEnabled: false,
                                listening: false,
                                perfectDrawEnabled: false
                            }"
                        />
                        <template
                            v-if="multiSelectHullHandleCircles && !isSelecting"
                        >
                            <v-circle
                                :config="multiSelectHullHandleCircles.left"
                            />
                            <v-circle
                                :config="multiSelectHullHandleCircles.right"
                            />
                        </template>

                        <!-- 拖线 / 多选磁吸预览虚线：画在节点之上，避免被卡片白底遮住 -->
                        <v-path
                            v-if="linkDragPreviewPathConfig"
                            :config="linkDragPreviewPathConfig"
                        />
                        <v-path
                            v-if="dragBundleSnapPreviewPathConfig"
                            :config="dragBundleSnapPreviewPathConfig"
                        />
                        <!-- 拖动对齐辅助线 -->
                        <v-line
                            v-for="(g, gi) in dragAlignGuides"
                            :key="`drag-align-${gi}`"
                            :config="buildMindMapDragAlignGuideLineConfig(g)"
                        />

                        <template
                            v-for="(blk, bi) in sequenceBlockBackdropItems"
                            :key="`seq-block-drag-${bi}`"
                        >
                            <v-rect
                                v-if="
                                    isSequenceBlockBackdropFocused(blk) ||
                                    isSequenceBlockSelectionActive(blk)
                                "
                                :config="{
                                    x: blk.x,
                                    y: blk.y,
                                    width: blk.width,
                                    height: blk.height,
                                    fill: 'rgba(26, 85, 233, 0.04)',
                                    stroke: 'transparent',
                                    strokeWidth: 0,
                                    listening: false,
                                    cornerRadius: 22,
                                    perfectDrawEnabled: false
                                }"
                            />
                        </template>
                    </v-layer>
                </v-stage>
            </div>

            <NodeMindMapDrawer
                :key="
                    drawerNode ? `drawer-${drawerNode.nodeId}` : 'drawer-empty'
                "
                :node="drawerNode"
                :video-data-list="videoDataList"
                @delete-node="onMindMapDrawerDeleteNode"
                @blur-save="onDrawerGuideBlur"
            />
        </div>

        <AiGenerateDialog
            ref="aiGenerateDialogRef"
            v-model="aiGenerateDialogVisible"
            @confirm="onAiGenerateConfirm"
        />

        <Teleport to="body">
            <div
                v-if="nodeValidationTip"
                class="node-mm-validation-tip"
                role="tooltip"
                :style="{
                    left: `${nodeValidationTip.left}px`,
                    top: `${nodeValidationTip.top}px`
                }"
            >
                {{ nodeValidationTip.message }}
            </div>
        </Teleport>

        <Teleport to="body">
            <Transition name="node-mm-ctx">
                <div
                    v-if="nodeCtxMenuVisible"
                    key="node-ctx-mount"
                    class="node-mm-ctx-mount"
                >
                    <div
                        class="node-mind-map-ctx-dismiss"
                        aria-hidden="true"
                        role="presentation"
                        @mousedown="handleNodeCtxBackdropDown"
                    />
                    <div
                        class="node-mind-map-context-menu"
                        role="menu"
                        :style="{
                            left: `${nodeCtxMenuPos.left}px`,
                            top: `${nodeCtxMenuPos.top}px`
                        }"
                        @click.stop
                        @mousedown.stop
                        @contextmenu.prevent.stop
                    >
                        <template v-if="nodeCtxMenuKind === 'node'">
                            <button
                                type="button"
                                class="node-mind-map-context-menu__btn"
                                @click="handleNodeCtxEdit"
                            >
                                <span class="node-mind-map-context-menu__label"
                                    >编辑</span
                                >
                            </button>
                            <button
                                type="button"
                                class="node-mind-map-context-menu__btn"
                                @click="handleNodeCtxAiExpand"
                            >
                                <span class="node-mind-map-context-menu__label"
                                    >AI 展开</span
                                >
                            </button>
                            <div
                                class="node-mind-map-context-menu__sep"
                                aria-hidden="true"
                            />
                        </template>
                        <button
                            type="button"
                            class="node-mind-map-context-menu__btn node-mind-map-context-menu__btn--danger"
                            @click="handleNodeCtxDelete"
                        >
                            <span class="node-mind-map-context-menu__label"
                                >删除</span
                            >
                        </button>
                    </div>
                </div>
            </Transition>
        </Teleport>

        <NodeMindMapPreviewDialog
            v-model="previewVisible"
            :nodes="previewNodes"
            :preview-log-key="previewLogKey"
            :video-data-list="videoDataList"
            :preview-type="previewType"
        />

        <StyledConfirmDialog
            v-model="deleteNodesConfirmVisible"
            primary-variant="danger"
            confirm-text="删除"
            @confirm="confirmDeleteNodesFromDialog"
            @cancel="cancelDeleteNodesConfirm"
        >
            <template v-if="deleteConfirmTargetCount === 1">
                您要删除节点？删除后请检查相关前后节点影响
            </template>
            <template v-else>
                您确定要删除选中的 {{ deleteConfirmTargetCount }}
                个节点？删除后请检查相关前后节点影响
            </template>
        </StyledConfirmDialog>
    </div>
</template>

<style lang="scss" scoped>
    .node-editor {
        position: relative;
        display: flex;
        flex-direction: column;
        height: 100vh;
        overflow: hidden;

        &--has-order :deep(.tools) {
            top: 72px;
        }
    }

    .node-editor__body {
        flex: 1;
        display: flex;
        min-height: 0;
        overflow: hidden;
    }

    .node-editor__canvas {
        flex: 1;
        min-width: 0;
        background-color: #f8f9fc;

        /* v-stage 不继承 class，背景需设在包裹层；Konva 画布透明区会透出此色 */
        :deep(> div) {
            width: 100%;
            height: 100%;
        }
    }

    .node-editor__canvas--pan {
        cursor: grab;

        &:active {
            cursor: grabbing;
        }

        :deep(canvas) {
            cursor: grab !important;
        }
    }

    :global(.node-mm-validation-tip) {
        position: fixed;
        z-index: 2147483645;
        max-width: 280px;
        padding: 6px 10px;
        border-radius: 6px;
        background: v-bind(nodeGuideValidationTipBg);
        color: #fff;
        font-size: 12px;
        line-height: 1.45;
        pointer-events: none;
        transform: translate(-50%, calc(-100% - 10px));
        box-shadow: 0 4px 12px rgb(0 0 0 / 0.15);
        white-space: nowrap;
    }

    /** 右键菜单整块挂载层：占位全屏，`pointer-events: none`，子节点再开启交互 */
    :global(.node-mm-ctx-mount) {
        position: fixed;
        inset: 0;
        z-index: 2147483640;
        pointer-events: none;
    }

    :global(.node-mm-ctx-mount .node-mind-map-ctx-dismiss) {
        position: fixed;
        inset: 0;
        background: rgb(14 19 32 / 0.04);
        pointer-events: auto;
    }

    :global(.node-mm-ctx-enter-active),
    :global(.node-mm-ctx-leave-active) {
        transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    :global(.node-mm-ctx-enter-from),
    :global(.node-mm-ctx-leave-to) {
        opacity: 0;
    }

    :global(.node-mm-ctx-enter-active .node-mind-map-context-menu),
    :global(.node-mm-ctx-leave-active .node-mind-map-context-menu) {
        transition:
            opacity 0.22s cubic-bezier(0.33, 1, 0.68, 1),
            transform 0.22s cubic-bezier(0.33, 1, 0.68, 1);
    }

    :global(.node-mm-ctx-enter-from .node-mind-map-context-menu) {
        opacity: 0;
        transform: scale(0.96) translateY(-6px);
    }

    :global(.node-mm-ctx-leave-to .node-mind-map-context-menu) {
        opacity: 0;
        transform: scale(0.97);
    }

    :global(.node-mind-map-context-menu) {
        box-sizing: border-box;
        position: fixed;
        display: flex;
        flex-direction: column;
        min-width: 168px;
        padding: 6px;
        margin: 0;
        border-radius: 10px;
        border: 1px solid rgb(217 217 218);
        box-shadow:
            0 0 0 0.5px rgb(255 255 255 / 0.9) inset,
            0 12px 40px rgb(15 23 42 / 0.16),
            0 4px 12px rgb(15 23 42 / 0.1),
            0 0 1px rgb(15 23 42 / 0.11);
        background: linear-gradient(to bottom, #fefefe 0%, #fafafa 100%);
        font-family:
            system-ui,
            -apple-system,
            'Segoe UI',
            Roboto,
            'PingFang SC',
            'Microsoft YaHei',
            sans-serif;
        user-select: none;
        backdrop-filter: blur(10px);
        transform-origin: left top;
        pointer-events: auto;
    }

    :global(.node-mind-map-context-menu__btn) {
        display: flex;
        align-items: center;
        width: 100%;
        padding: 8px 14px;
        margin: 0;
        border: none;
        border-radius: 6px;
        background: transparent;
        cursor: pointer;
        text-align: left;
    }

    :global(.node-mind-map-context-menu__label) {
        font-size: 13px;
        line-height: 1.38;
        color: rgb(37 43 61);
    }

    :global(.node-mind-map-context-menu__btn:hover) {
        background: rgb(239 239 241);
    }

    :global(.node-mind-map-context-menu__sep) {
        height: 1px;
        margin: 6px 4px;
        background: rgb(229 229 231);
    }

    :global(
        .node-mind-map-context-menu__btn--danger
            .node-mind-map-context-menu__label
    ) {
        color: rgb(217 62 71);
    }

    :global(.node-mind-map-context-menu__btn--danger:hover) {
        background: rgb(255 240 239);
    }

    :global(.node-mind-map-context-menu__btn:focus-visible) {
        outline: 2px solid rgb(26 85 233 / 0.45);
        outline-offset: 1px;
    }
    :deep(.el-button--large) {
        padding: 10px 19px;
    }
</style>
