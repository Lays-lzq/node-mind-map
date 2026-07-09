<script setup lang="ts" name="Guide">
import { Check, CircleCheck, VideoCamera } from '@element-plus/icons-vue';
import { Plus, WarningFilled } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import FocusContent from './FocusContent.vue';
import { numberToChinese, parseDentalText } from '@/views/workOrder/common';
import type { DrawerVideoItem } from '../NodeMindMapDrawer.vue';
import { BookIcon, WarnIcon, VectorIcon } from './common/svg';
import optEmpty from '@/assets/cases/OptEmpty.png';
import checkIcon from '@/assets/cases/check.png';

type GuideRow = {
    nodeID: number;
    prevNodeIDs: number[];
    nextNodeIDs: number[];
    operationDesc: string;
    operationTypes: string[];
    targetDesc: string;
    targetDiagram: { url: string; name: string; title?: string }[];
    targetDiagramUrl: { url: string; name: string; title?: string }[];
    monitoringDesc: string;
    monitorUndoneDesc: string;
    abnormalDesc: string;
    abnormalDiagram: { url: string; name: string; title?: string }[];
    abnormalDiagramUrl: { url: string; name: string; title?: string }[];
};

type GuideSection = {
    name: string;
    operations: GuideRow[];
    monitors: GuideRow[];
    tips?: string;
};

type MonitorResult = 'achieved' | 'unachieved';
type GuideNodeStatus = 0 | 1 | 2;
type RuntimeGuideRow = GuideRow & {
    /** 0: 未操作，1: 已达成，2: 未达成 */
    isAchieved: GuideNodeStatus;
    isCompleted: boolean;
};

type GuideDisplayItem =
    | {
          key: string;
          type: 'operation';
          index: number;
          operation: RuntimeGuideRow;
      }
    | {
          key: string;
          type: 'unmet';
          index: number;
          desc: string;
      };

type SectionSnapshot = {
    monitors: RuntimeGuideRow[];
    operations: GuideDisplayItem[];
    tips?: string;
};

type VisitStep = {
    name: string;
    date: string;
    operations: RuntimeGuideRow[];
    monitors: RuntimeGuideRow[];
    tips?: string;
};

const props = withDefaults(
    defineProps<{
        nodes?: any[];
        previewLogKey?: number;
        videoDataList?: DrawerVideoItem[];
        previewType?: 'step' | '';
    }>(),
    {
        nodes: () => [],
        previewLogKey: 0,
        videoDataList: () => [],
        previewType: ''
    }
);

const activeView = ref<'overview' | 'section'>('overview');
const activeSectionIndex = ref(0);
const completedSectionIndexes = ref<Set<number>>(new Set());
const completedOperationKeys = ref<Set<string>>(new Set());
const completedSectionDisplaySnapshots = ref<Map<number, SectionSnapshot>>(
    new Map()
);
// 预览弹窗里的复诊是一次本地模拟流程：runtimeRows 保存节点的临时完成/达成状态，
// 不直接回写到脑图节点数据，关闭或节点变更后会重新从 props.nodes 生成。
const runtimeRows = ref<RuntimeGuideRow[]>([]);
// visitSteps 是用户在预览弹窗中新建出来的复诊记录，和上方 sections 静态概览分开维护。
const visitSteps = ref<VisitStep[]>([]);
const operationConfirmVisible = ref(false);
const isStepPreview = computed(() => props.previewType === 'step');

const videoMap = computed(() => {
    const map = new Map<string, DrawerVideoItem>();
    for (const item of props.videoDataList) map.set(String(item.key), item);
    return map;
});

const normalizeIdArray = (raw: unknown): number[] => {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.map(Number).filter((id) => Number.isFinite(id)))];
};

const stripGuideMark = (value: unknown) =>
    String(value ?? '').replace(/#/g, '');

const normalizeDiagram = (raw: unknown): { url: string; name: string }[] => {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((item: any) => {
            if (typeof item === 'string') {
                return { url: item, name: item.split('/').pop() ?? '' };
            }
            return {
                url: String(item?.url ?? ''),
                name: String(
                    item?.name ?? item?.url?.split?.('/')?.pop?.() ?? ''
                )
            };
        })
        .filter((item) => item.url);
};

const rows = computed<GuideRow[]>(() =>
    props.nodes
        .map((node: any) => {
            const guide =
                node?.guide && typeof node.guide === 'object' ? node.guide : {};
            return {
                nodeID: Number(node?.nodeId ?? node?.nodeID),
                prevNodeIDs: normalizeIdArray(
                    node?.prevNodes ?? node?.prevNodeIDs
                ),
                nextNodeIDs: normalizeIdArray(
                    node?.nextNodes ?? node?.nextNodeIDs
                ),
                operationDesc: stripGuideMark(guide.operationDesc),
                operationTypes: Array.isArray(guide.operationTypes)
                    ? guide.operationTypes.map(String)
                    : [],
                targetDesc: stripGuideMark(guide.targetDesc),
                targetDiagram: normalizeDiagram(guide.targetDiagram),
                targetDiagramUrl: normalizeDiagram(guide.targetDiagramUrl),
                monitoringDesc: stripGuideMark(guide.monitoringDesc),
                monitorUndoneDesc: stripGuideMark(guide.monitorUndoneDesc),
                abnormalDesc: stripGuideMark(guide.abnormalDesc),
                abnormalDiagram: normalizeDiagram(guide.abnormalDiagram),
                abnormalDiagramUrl: normalizeDiagram(guide.abnormalDiagramUrl),
                };
        })
        .filter((row) => Number.isFinite(row.nodeID))
);

const rowMap = computed(
    () => new Map(rows.value.map((row) => [row.nodeID, row]))
);

function isArrayContained(
    smallerArray: number[],
    largerArray: number[]
): boolean {
    const largerSet = new Set(largerArray);
    return smallerArray.every((item) => largerSet.has(item));
}

function compareNodeID(a: number, b: number) {
    return a - b;
}

function sortNodeIDs(ids: Iterable<number>) {
    return Array.from(ids).sort(compareNodeID);
}

function sortGuideRowsByNodeID<T extends GuideRow>(rows: T[]) {
    return rows.sort((a, b) => compareNodeID(a.nodeID, b.nodeID));
}

function getTargetEndNodesById(
    id: number,
    historyArr: number[] = []
): number[] {
    const nodes = new Set<number>();
    const historySet = new Set(historyArr);

    const traverse = (nodeId: number): void => {
        const node = rowMap.value.get(nodeId);
        if (!node) return;
        const { targetDesc, nextNodeIDs, prevNodeIDs } = node;
        if (!isArrayContained(prevNodeIDs, Array.from(historySet))) return;
        nodes.add(nodeId);
        // 没有监控目标的节点是中转节点，概览分组时继续向后找真正需要展示的节点。
        if (!targetDesc) {
            historySet.add(nodeId);
            nextNodeIDs.forEach((nextId) => traverse(nextId));
        }
    };

    const startNode = rowMap.value.get(id);
    if (!startNode) return [];
    if (!startNode.nextNodeIDs.length) return [id];

    traverse(id);
    return sortNodeIDs(nodes);
}

function getOperableNode(): number[][] {
    const visits: number[][] = [];
    const startNodes = rows.value.filter(
        (node) => node.prevNodeIDs.length === 0
    );
    const firstLayerNodes = sortNodeIDs(
        new Set(
            startNodes.flatMap((node) => getTargetEndNodesById(node.nodeID))
        )
    );
    if (!firstLayerNodes.length) return [];

    visits.push(firstLayerNodes);
    const allHistoryNodes = new Set<number>(firstLayerNodes);

    // 静态概览需要按“本次操作 -> 下次监控”拆批次，不依赖用户在预览中的点击状态。
    while (true) {
        const currentVisit = visits[visits.length - 1] ?? [];
        const targetNodes = currentVisit
            .map((id) => rowMap.value.get(id))
            .filter((node): node is GuideRow => !!node?.targetDesc);

        const nextVisit = new Set<number>();
        const nextTargetIds = new Set<number>();
        const nextNoTargetIds = new Set<number>();

        for (const node of targetNodes) {
            node.nextNodeIDs.forEach((id) =>
                rowMap.value.get(id)?.targetDesc
                    ? nextTargetIds.add(id)
                    : nextNoTargetIds.add(id)
            );
        }

        for (const nextId of [
            ...sortNodeIDs(nextNoTargetIds),
            ...sortNodeIDs(nextTargetIds)
        ]) {
            const historyNodeArr = Array.from(allHistoryNodes);
            const nextNode = rowMap.value.get(nextId);
            if (!nextNode) continue;

            // 多父节点必须等前置节点都进入历史批次，避免提前把后续操作放进概览。
            if (isArrayContained(nextNode.prevNodeIDs, historyNodeArr)) {
                if (!nextNode.targetDesc) allHistoryNodes.add(nextId);
            } else {
                continue;
            }

            getTargetEndNodesById(nextId, historyNodeArr).forEach((endNodeId) =>
                nextVisit.add(endNodeId)
            );
        }

        if (nextVisit.size === 0) break;
        const nextVisitArray = sortNodeIDs(nextVisit);
        visits.push(nextVisitArray);
        nextVisitArray.forEach((id) => allHistoryNodes.add(id));
    }

    return visits;
}

const sections = computed<GuideSection[]>(() => {
    const groups = getOperableNode();
    console.log('groups', groups);
    const list = groups.map((group, index) => ({
        name: getVisitName(index),
        operations: group
            .map((id) => rowMap.value.get(id))
            .filter(Boolean) as GuideRow[],
        monitors:
            index === 0
                ? []
                : (groups[index - 1]
                      .map((id) => rowMap.value.get(id))
                      .filter(
                          (row): row is GuideRow => !!row?.targetDesc
                      ) as GuideRow[])
    }));

    const lastMonitors = (groups[groups.length - 1] ?? [])
        .map((id) => rowMap.value.get(id))
        .filter((row): row is GuideRow => !!row?.targetDesc);

    if (lastMonitors.length) {
        list.push({
            name: getVisitName(groups.length),
            operations: [],
            monitors: lastMonitors,
            tips: ''
        });
    } else if (list.length) {
        list[list.length - 1].tips = '';
    }

    return list;
});

const runtimeRowMap = computed(
    () => new Map(runtimeRows.value.map((row) => [row.nodeID, row]))
);

const activeSection = computed(
    () => visitSteps.value[activeSectionIndex.value]
);
const activeSectionMonitors = computed<RuntimeGuideRow[]>(() => {
    const completedSnapshot = completedSectionDisplaySnapshots.value.get(
        activeSectionIndex.value
    );
    // 已完成复诊展示的是完成瞬间的快照，避免后续节点状态变化影响历史记录。
    if (completedSnapshot) return completedSnapshot.monitors;
    return activeSection.value?.monitors ?? [];
});
const activeOperationDisplayItems = computed(() => {
    const completedSnapshot = completedSectionDisplaySnapshots.value.get(
        activeSectionIndex.value
    );
    // 操作列表同样读取历史快照；未完成复诊才根据当前监控结果动态计算。
    if (completedSnapshot) return completedSnapshot.operations;

    let visibleIndex = 0;
    const items: GuideDisplayItem[] = [];
    for (const row of activeSection.value?.operations ?? []) {
        if (!row.operationDesc) continue;
        items.push({
            key: `operation-${row.nodeID}`,
            type: 'operation' as const,
            index: visibleIndex++,
            operation: row
        });
    }
    for (const row of activeSectionMonitors.value) {
        if (row.isAchieved !== 2 || !row.monitorUndoneDesc) continue;
        // 监控未达成时，不解锁后续操作；如果配置了处理说明，就临时作为操作建议显示。
        items.push({
            key: `unmet-${activeSectionIndex.value}-${row.nodeID}`,
            type: 'unmet' as const,
            index: visibleIndex++,
            desc: row.monitorUndoneDesc
        });
    }

    return items;
});
const achievedMonitorItems = computed(() =>
    activeSectionMonitors.value.filter(
        (row) => getMonitorResult(row.nodeID) === 'achieved'
    )
);
const unachievedMonitorItems = computed(() =>
    activeSectionMonitors.value.filter(
        (row) => getMonitorResult(row.nodeID) !== 'achieved'
    )
);
const visibleOperationItems = computed(() =>
    activeOperationDisplayItems.value
        .filter((item) => item.type === 'operation')
        .map((item) => item.operation)
);
const completedOperationItems = computed(() =>
    visibleOperationItems.value.filter((row) =>
        isOperationCompleted(row.nodeID)
    )
);
const uncompletedOperationItems = computed(() =>
    visibleOperationItems.value.filter(
        (row) => !isOperationCompleted(row.nodeID)
    )
);
const isRevisitSection = computed(() => activeSectionIndex.value >= 0);
const shouldShowMonitorCard = computed(
    () => !!activeSectionMonitors.value.length || isRevisitSection.value
);
const shouldShowOperationCard = computed(
    () => !!activeOperationDisplayItems.value.length || isRevisitSection.value
);
const isAllCompleted = computed(
    () =>
        !!visitSteps.value.length &&
        completedSectionIndexes.value.size >= visitSteps.value.length &&
        !canBuildNextVisit.value
);
const completedTimelineSections = computed(() =>
    visitSteps.value
        .map((section, index) => ({ section, index }))
        .filter(({ index }) => completedSectionIndexes.value.has(index))
        .reverse()
);
const hasOpenVisit = computed(() =>
    visitSteps.value.some(
        (_, index) => !completedSectionIndexes.value.has(index)
    )
);
const canBuildNextVisit = computed(() => {
    if (hasOpenVisit.value) return false;
    const candidate = buildVisitCandidate();
    return !!candidate.operations.length || !!candidate.monitors.length;
});
const nextSectionIndex = computed(() => visitSteps.value.length);
const hasNextSection = computed(() => canBuildNextVisit.value);
const isCreatingSection = computed(
    () =>
        activeView.value === 'section' &&
        !!activeSection.value &&
        !completedSectionIndexes.value.has(activeSectionIndex.value)
);
const isCreateSectionDisabled = computed(
    () => !hasNextSection.value && !hasOpenVisit.value
);
const overviewColumns = computed(() => [
    sections.value.filter((_, index) => index % 2 === 0),
    sections.value.filter((_, index) => index % 2 === 1)
]);
const revisitDateLabel = computed(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}/${m}/${day}`;
});

const diagramWithTitle = (
    diagrams: { url: string; name: string; title?: string }[],
    startIndex: number
) =>
    diagrams.map((item, index) => ({
        ...item,
        title: `图片${startIndex + index}`
    }));

const sectionHasContent = (section: GuideSection) =>
    section.monitors.length ||
    section.operations.some((row) => row.operationDesc) ||
    !!section.tips;

function selectOverview() {
    activeView.value = 'overview';
}

function selectSection(index: number) {
    activeSectionIndex.value = index;
    activeView.value = 'section';
}

function createRuntimeRow(row: GuideRow): RuntimeGuideRow {
    return {
        ...row,
        isAchieved: row.targetDesc ? 0 : 1,
        isCompleted: row.operationDesc ? false : true
    };
}

function cloneRuntimeRow(row: RuntimeGuideRow): RuntimeGuideRow {
    return {
        ...row,
        prevNodeIDs: [...row.prevNodeIDs],
        nextNodeIDs: [...row.nextNodeIDs],
        operationTypes: [...row.operationTypes],
        targetDiagram: row.targetDiagram.map((item) => ({ ...item })),
        targetDiagramUrl: row.targetDiagramUrl.map((item) => ({ ...item })),
        abnormalDiagram: row.abnormalDiagram.map((item) => ({ ...item })),
        abnormalDiagramUrl: row.abnormalDiagramUrl.map((item) => ({ ...item }))
    };
}

function isNodePassed(row: RuntimeGuideRow | undefined) {
    // “通过”代表这一步已经做完，并且它的目标在复诊监控中确认达成。
    return !!row && row.isCompleted && row.isAchieved === 1;
}

function addUniqueNode<T extends RuntimeGuideRow>(list: T[], row: T) {
    if (!list.some((item) => item.nodeID === row.nodeID)) {
        list.push(row);
        sortGuideRowsByNodeID(list);
    }
}

function getChildNodeIds(nodeID: number): number[] {
    const row = runtimeRowMap.value.get(nodeID);
    if (!row) return [];

    const result: number[] = [];
    for (const childID of row.nextNodeIDs) {
        result.push(childID);
        result.push(...getChildNodeIds(childID));
    }
    return result;
}

function getPassedNodeIds() {
    return runtimeRows.value
        .filter((row) => isNodePassed(row))
        .map((row) => row.nodeID);
}

function getRuntimeTargetEndNodeIds(
    id: number,
    historyArr: number[] = []
): number[] {
    const ids = new Set<number>();
    const historySet = new Set(historyArr);

    const traverse = (nodeId: number): void => {
        const node = runtimeRowMap.value.get(nodeId);
        if (!node) return;
        if (!isArrayContained(node.prevNodeIDs, Array.from(historySet))) return;
        ids.add(nodeId);
        // 运行时也跳过没有目标的中转节点，把它后面真正可操作的节点归到当前解锁批次。
        if (!node.targetDesc) {
            historySet.add(nodeId);
            node.nextNodeIDs.forEach((nextId) => traverse(nextId));
        }
    };

    const startNode = runtimeRowMap.value.get(id);
    if (!startNode) return [];
    if (!startNode.nextNodeIDs.length) return [id];

    traverse(id);
    return sortNodeIDs(ids);
}

/**
 * 根据运行时状态生成下一次复诊候选：
 * 1. 未完成的节点先作为本次操作要点；
 * 2. 已完成但目标未确认达成的节点作为本次监控要点；
 * 3. 操作完成且监控达成后，才继续向后扫描下一批节点。
 */
function buildVisitCandidate(): Pick<VisitStep, 'operations' | 'monitors'> {
    const operations: RuntimeGuideRow[] = [];
    const monitors: RuntimeGuideRow[] = [];
    const visited = new Set<number>();
    const history = new Set<number>();
    const startNodes = runtimeRows.value.filter(
        (node) => node.prevNodeIDs.length === 0
    );

    const traverse = (nodeId: number): void => {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);

        const node = runtimeRowMap.value.get(nodeId);
        if (!node) return;

        if (!node.isCompleted) {
            if (node.operationDesc) addUniqueNode(operations, node);
            // 有目标的操作需要等下一次复诊监控达成，不能在同一轮继续向后推进。
            if (node.targetDesc) return;
        }

        if (node.isAchieved !== 1) {
            // 做完但未达成/未检查的节点，会变成下一次复诊的监控要点。
            if (node.targetDesc || node.monitoringDesc) {
                addUniqueNode(monitors, node);
            }
            return;
        }

        history.add(nodeId);
        for (const nextId of node.nextNodeIDs) {
            const nextNode = runtimeRowMap.value.get(nextId);
            if (!nextNode) continue;
            // 多父节点必须全部通过，后续操作才算真正解锁。
            const allPrevPassed = nextNode.prevNodeIDs.every((prevId) =>
                history.has(prevId)
            );
            if (allPrevPassed) traverse(nextId);
        }
    };

    startNodes
        .slice()
        .sort((a, b) => compareNodeID(a.nodeID, b.nodeID))
        .forEach((node) => traverse(node.nodeID));
    return {
        operations: sortGuideRowsByNodeID(operations),
        monitors: sortGuideRowsByNodeID(monitors)
    };
}

function getVisitName(index: number) {
    if (isStepPreview.value) {
        return `第${numberToChinese(index + 1)}次复诊`;
    }
    return index === 0 ? '初戴托槽' : `第${numberToChinese(index)}次复诊`;
}

function buildVisitStep(): VisitStep | null {
    const { operations, monitors } = buildVisitCandidate();
    if (!operations.length && !monitors.length) return null;

    // 复诊记录使用创建时的日期，避免历史记录跟随当前日期变化。
    return {
        name: getVisitName(visitSteps.value.length),
        date: revisitDateLabel.value,
        operations,
        monitors
    };
}

function appendNextVisitStep() {
    const step = buildVisitStep();
    if (!step) return false;
    visitSteps.value = [...visitSteps.value, step];
    activeSectionIndex.value = visitSteps.value.length - 1;
    activeView.value = 'section';
    return true;
}

function getDisplayedNodeSnapshot() {
    return {
        sectionIndex: activeSectionIndex.value,
        sectionName: activeSection.value?.name ?? '',
        monitors: activeSectionMonitors.value.map((row) => ({
            nodeID: row.nodeID,
            prevNodeIDs: row.prevNodeIDs,
            nextNodeIDs: row.nextNodeIDs,
            targetDesc: row.targetDesc,
            monitoringDesc: row.monitoringDesc,
            isAchieved: row.isAchieved
        })),
        operations: activeOperationDisplayItems.value.map((item) =>
            item.type === 'operation'
                ? {
                      type: item.type,
                      nodeID: item.operation.nodeID,
                      prevNodeIDs: item.operation.prevNodeIDs,
                      nextNodeIDs: item.operation.nextNodeIDs,
                      operationDesc: item.operation.operationDesc,
                      isCompleted: item.operation.isCompleted
                  }
                : {
                      type: item.type,
                      desc: item.desc
                  }
        )
    };
}

function buildSectionSnapshot(): SectionSnapshot {
    return {
        monitors: activeSectionMonitors.value.map(cloneRuntimeRow),
        operations: activeOperationDisplayItems.value.map((item) =>
            item.type === 'operation'
                ? {
                      key: item.key,
                      type: 'operation' as const,
                      index: item.index,
                      operation: cloneRuntimeRow(item.operation)
                  }
                : {
                      key: item.key,
                      type: 'unmet' as const,
                      index: item.index,
                      desc: item.desc ?? ''
                  }
        ),
        tips: activeSection.value?.tips
    };
}

function getOverviewDisplayedGroups() {
    return sections.value.map((section) => ({
        name: section.name,
        monitors: section.monitors
            .filter((row) => row.targetDesc || row.monitoringDesc)
            .map((row) => row.nodeID),
        operations: section.operations
            .filter((row) => row.operationDesc)
            .map((row) => row.nodeID)
    }));
}

function getOverviewDisplayedNodeGroups() {
    return getOverviewDisplayedGroups().map((section) =>
        sortNodeIDs([...section.monitors, ...section.operations])
    );
}

async function createNextSection() {
    if (isCreatingSection.value) return;

    if (hasOpenVisit.value) {
        // 同一时间只允许存在一个未完成复诊；按钮再次点击时跳回该复诊。
        const openIndex = visitSteps.value.findIndex(
            (_, index) => !completedSectionIndexes.value.has(index)
        );
        if (openIndex !== -1) selectSection(openIndex);
    } else if (hasNextSection.value) {
        appendNextVisitStep();
    } else {
        return;
    }
    await nextTick();
    console.log(
        '[Guide] 新建复诊当前展示节点信息:',
        getDisplayedNodeSnapshot()
    );
}

function getOperationKey(sectionIndex: number, nodeID: number) {
    return `${sectionIndex}-${nodeID}`;
}

function getMonitorResult(nodeID: number) {
    const row =
        activeSectionMonitors.value.find((item) => item.nodeID === nodeID) ??
        runtimeRowMap.value.get(nodeID);
    if (row?.isAchieved === 1) return 'achieved';
    if (row?.isAchieved === 2) return 'unachieved';
    return undefined;
}

function setMonitorResult(nodeID: number, result: MonitorResult) {
    const row = runtimeRowMap.value.get(nodeID);
    const activeVisit = activeSection.value;
    if (!row || !activeVisit) return;

    // 再次点击同一结果会取消选择，方便医生在预览里修正误点。
    const nextValue: GuideNodeStatus =
        row.isAchieved === (result === 'achieved' ? 1 : 2)
            ? 0
            : result === 'achieved'
            ? 1
            : 2;
    row.isAchieved = nextValue;

    const childIds = getChildNodeIds(nodeID);
    if (nextValue !== 1) {
        // 监控未达成或取消达成时，需要撤回由它解锁出来的后续操作。
        activeVisit.operations = activeVisit.operations.filter(
            (operation) => !childIds.includes(operation.nodeID)
        );
        for (const id of childIds) {
            const child = runtimeRowMap.value.get(id);
            if (child?.operationDesc) child.isCompleted = false;
        }
        return;
    }

    const historyIds = getPassedNodeIds();
    for (const nextId of row.nextNodeIDs) {
        const nextNode = runtimeRowMap.value.get(nextId);
        if (!nextNode) continue;
        const allPrevPassed = nextNode.prevNodeIDs.every((prevId) =>
            isNodePassed(runtimeRowMap.value.get(prevId))
        );
        if (!allPrevPassed) continue;

        // 监控达成后，把下游第一个可执行批次即时补进当前复诊的操作要点。
        getRuntimeTargetEndNodeIds(nextId, historyIds).forEach((id) => {
            const operation = runtimeRowMap.value.get(id);
            if (operation?.operationDesc) {
                addUniqueNode(activeVisit.operations, operation);
            }
        });
    }
}

function isOperationCompleted(nodeID: number) {
    const row =
        visibleOperationItems.value.find((item) => item.nodeID === nodeID) ??
        runtimeRowMap.value.get(nodeID);
    return !!row?.isCompleted;
}

function completeOperation(nodeID: number) {
    const row = runtimeRowMap.value.get(nodeID);
    if (!row) return;
    row.isCompleted = !row.isCompleted;

    const key = getOperationKey(activeSectionIndex.value, nodeID);
    const nextCompleted = new Set(completedOperationKeys.value);
    if (row.isCompleted) {
        nextCompleted.add(key);
    } else {
        nextCompleted.delete(key);
    }
    completedOperationKeys.value = nextCompleted;
}

function getOperationSummaryText(row: GuideRow) {
    return row.operationDesc;
}

function getMonitorSummaryText(row: GuideRow) {
    return [row.targetDesc, row.monitoringDesc].filter(Boolean).join('\n');
}

function openOperationConfirm() {
    if (!activeSection.value) return;
    if (completedSectionIndexes.value.has(activeSectionIndex.value)) return;
    operationConfirmVisible.value = true;
}

async function completeCurrentSection() {
    if (!activeSection.value) return;
    if (completedSectionIndexes.value.has(activeSectionIndex.value)) return;
    operationConfirmVisible.value = false;

    // 完成复诊前冻结当前页面内容，保证回看历史时不被后续复诊的点击状态污染。
    const nextSnapshots = new Map(completedSectionDisplaySnapshots.value);
    nextSnapshots.set(activeSectionIndex.value, buildSectionSnapshot());
    completedSectionDisplaySnapshots.value = nextSnapshots;

    const nextCompleted = new Set(completedSectionIndexes.value);
    nextCompleted.add(activeSectionIndex.value);
    completedSectionIndexes.value = nextCompleted;

    activeView.value = 'section';

    ElMessage.success('已完成本次操作');
}

function resetGuideFlow() {
    runtimeRows.value = rows.value.map(createRuntimeRow);
    visitSteps.value = [];
    activeView.value = 'overview';
    activeSectionIndex.value = 0;
    completedSectionIndexes.value = new Set();
    completedOperationKeys.value = new Set();
    completedSectionDisplaySnapshots.value = new Map();
    operationConfirmVisible.value = false;
}

watch(
    rows,
    () => {
        resetGuideFlow();
    },
    { deep: true, immediate: true }
);

watch(
    isStepPreview,
    () => {
        resetGuideFlow();
    }
);

watch(
    () => props.previewLogKey,
    async (key, oldKey) => {
        if (!key || key === oldKey) return;
        await nextTick();
        console.log('previewInfo.data', getOverviewDisplayedNodeGroups());
        console.log('previewInfo.sections', getOverviewDisplayedGroups());
    },
    { immediate: true, flush: 'post' }
);
</script>

<template>
    <div class="guide">
        <aside class="guide-sidebar">
            <div class="guide-sidebar__btn">
                <button
                    type="button"
                    class="btn_style"
                    :class="{ active: activeView === 'overview' }"
                    @click="selectOverview"
                >
                    <span>操作指引概览</span>
                </button>
            </div>
            <div class="guide-sidebar__content">
                <div class="guide-sidebar__head">
                    <h2>复诊记录</h2>
                    <p>共{{ completedTimelineSections.length }}条记录</p>
                </div>
                <div class="guide-timeline">
                    <button
                        type="button"
                        class="guide-add-step"
                        :class="{
                            active: isCreatingSection,
                            'guide-add-step--disabled': isCreateSectionDisabled
                        }"
                        :disabled="isCreateSectionDisabled"
                        @click="createNextSection"
                    >
                        <el-icon size="17"><Plus /></el-icon>
                        <span>新建复诊</span>
                    </button>
                    <button
                        v-for="{ section, index } in completedTimelineSections"
                        :key="section.name + index"
                        type="button"
                        class="guide-step"
                        :class="{
                            'guide-step--active':
                                activeView === 'section' &&
                                activeSectionIndex === index,
                            'guide-step--done':
                                completedSectionIndexes.has(index)
                        }"
                        @click="selectSection(index)"
                    >
                        <span class="guide-step__dot">
                            <span v-if="completedSectionIndexes.has(index)" />
                        </span>
                        <span class="guide-step__card">
                            <span class="guide-step__date">
                                {{ section.date || revisitDateLabel }}
                            </span>
                            <span class="guide-step__text">{{
                                section.name
                            }}</span>
                        </span>
                    </button>
                </div>
            </div>
        </aside>

        <main class="guide-content">
            <el-empty v-if="!sections.length" description="暂无操作指引" />

            <template v-else-if="activeView === 'overview'">
                <div class="guide-overview-grid">
                    <div
                        v-for="(column, columnIndex) in overviewColumns"
                        :key="`overview-column-${columnIndex}`"
                        class="guide-overview-column"
                    >
                        <section
                            v-for="(section, itemIndex) in column"
                            :key="section.name + itemIndex"
                            class="guide-card guide-card--overview"
                        >
                            <h2>{{ section.name }}</h2>

                            <template v-if="section.monitors.length">
                                <h3>监控要点：</h3>
                                <div class="flexColumn">
                                    <div
                                        v-for="(
                                            item, index
                                        ) in section.monitors"
                                        :key="`overview-monitor-${columnIndex}-${itemIndex}-${item.nodeID}`"
                                        class=""
                                    >
                                        <div
                                            v-if="item.targetDesc"
                                            class="guide-line"
                                        >
                                            <span class="guide-line__index">
                                                {{ index + 1 }}、
                                            </span>
                                            <span>
                                                <template
                                                    v-for="textObj in parseDentalText(
                                                        item.targetDesc
                                                    )"
                                                    :key="textObj.text"
                                                >
                                                    {{ textObj.text }}
                                                </template>
                                            </span>
                                        </div>
                                        <div
                                            v-if="item.monitoringDesc"
                                            class="guide-line guide-line--plain"
                                        >
                                            <template
                                                v-for="textObj in parseDentalText(
                                                    item.monitoringDesc
                                                )"
                                                :key="textObj.text"
                                            >
                                                <span>{{ textObj.text }}</span>
                                            </template>
                                        </div>
                                        <div
                                            v-if="
                                                item.abnormalDesc ||
                                                item.abnormalDiagramUrl.length
                                            "
                                        >
                                            <FocusContent
                                                v-if="
                                                    item.abnormalDesc ||
                                                    item.abnormalDiagramUrl
                                                        .length
                                                "
                                                style="margin-top: 10px"
                                                content="Tips：异常提示"
                                                type="abnormal"
                                                :text="item.abnormalDesc"
                                                :img="item.abnormalDiagramUrl"
                                            />
                                        </div>
                                        <div
                                            v-if="item.targetDiagramUrl.length"
                                            class="guide-inline-images"
                                        >
                                            <FocusContent
                                                v-for="{
                                                    url
                                                } in item.targetDiagramUrl"
                                                :key="url"
                                                content=""
                                                type="img"
                                                :width="107"
                                                :height="72"
                                                :src="url"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </template>

                            <template
                                v-if="
                                    section.operations.some(
                                        (row) => row.operationDesc
                                    )
                                "
                            >
                                <h3>操作要点：</h3>
                                <div class="flexColumn">
                                    <div
                                        v-for="(
                                            item, index
                                        ) in section.operations.filter(
                                            (row) => row.operationDesc
                                        )"
                                        :key="`overview-operation-${columnIndex}-${itemIndex}-${item.nodeID}`"
                                        class=""
                                    >
                                        <div class="guide-line">
                                            <span class="guide-line__index">
                                                {{ index + 1 }}、
                                            </span>
                                            <span>
                                                <template
                                                    v-for="textObj in parseDentalText(
                                                        item.operationDesc
                                                    )"
                                                    :key="textObj.text"
                                                >
                                                    {{ textObj.text }}
                                                </template>
                                            </span>
                                            <FocusContent
                                                v-for="videoId in item.operationTypes"
                                                :key="videoId"
                                                content="查看操作视频"
                                                type="video"
                                                :src="
                                                    videoMap.get(videoId)?.value
                                                "
                                                :cover="
                                                    videoMap.get(videoId)?.img
                                                "
                                            />
                                        </div>
                                    </div>
                                </div>
                            </template>

                            <section
                                v-if="!sectionHasContent(section)"
                                class="guide-card-empty-inline"
                            >
                                当前节点没有可展示的操作或监控内容
                            </section>

                            <p v-if="section.tips" class="guide-tips">
                                {{ section.tips }}
                            </p>
                        </section>
                    </div>
                </div>
            </template>

            <template v-else-if="activeSection">
                <section class="guide-detail">
                    <div class="guide-detail__body">
                        <div
                            class="guide-detail__cards"
                            :class="{
                                'guide-detail__cards--revisit': isRevisitSection
                            }"
                        >
                            <section
                                v-if="shouldShowMonitorCard"
                                class="guide-card guide-card--detail"
                            >
                                <h3>监控要点：</h3>
                                <div
                                    v-for="(
                                        item, index
                                    ) in activeSectionMonitors"
                                    :key="`monitor-${item.nodeID}`"
                                    class="guide-block"
                                    :class="{
                                        'guide-block--monitor-achieved':
                                            getMonitorResult(item.nodeID) ===
                                            'achieved',
                                        'guide-block--monitor-unachieved':
                                            getMonitorResult(item.nodeID) ===
                                            'unachieved'
                                    }"
                                >
                                    <div
                                        v-if="item.targetDesc"
                                        class="guide-line"
                                    >
                                        <!-- <span class="guide-line__index">

                                        </span> -->
                                        <span>
                                            <template
                                                v-for="textObj in parseDentalText(
                                                    item.targetDesc
                                                )"
                                                :key="textObj.text"
                                            >
                                                {{ index + 1 }}、{{
                                                    textObj.text
                                                }}
                                            </template>
                                        </span>
                                    </div>
                                    <div
                                        v-if="item.monitoringDesc"
                                        class="guide-line guide-line--plain"
                                    >
                                        <template
                                            v-for="textObj in parseDentalText(
                                                item.monitoringDesc
                                            )"
                                            :key="textObj.text"
                                        >
                                            <span>{{ textObj.text }}</span>
                                        </template>
                                        <br />
                                        <FocusContent
                                            v-if="
                                                item.abnormalDesc ||
                                                item.abnormalDiagramUrl.length
                                            "
                                            content="Tips：异常提示"
                                            type="abnormal"
                                            :text="item.abnormalDesc"
                                            :img="item.abnormalDiagramUrl"
                                        />
                                    </div>
                                    <p
                                        v-if="
                                            item.targetDiagramUrl &&
                                            item.targetDiagramUrl.length
                                        "
                                    >
                                        <br />
                                        <FocusContent
                                            v-for="{
                                                url
                                            } in item.targetDiagramUrl"
                                            :key="url"
                                            content=""
                                            type="img"
                                            :width="107"
                                            :height="72"
                                            :src="url"
                                        />
                                    </p>
                                    <div
                                        v-if="isCreatingSection"
                                        class="guide-block__actions"
                                    >
                                        <el-button
                                            class="guide-monitor-result-btn"
                                            :class="{
                                                'guide-monitor-result-btn--unachieved':
                                                    getMonitorResult(
                                                        item.nodeID
                                                    ) === 'unachieved'
                                            }"
                                            @click="
                                                setMonitorResult(
                                                    item.nodeID,
                                                    'unachieved'
                                                )
                                            "
                                        >
                                            未达成
                                        </el-button>
                                        <el-button
                                            class="guide-monitor-result-btn"
                                            :class="{
                                                'guide-monitor-result-btn--achieved':
                                                    getMonitorResult(
                                                        item.nodeID
                                                    ) === 'achieved'
                                            }"
                                            @click="
                                                setMonitorResult(
                                                    item.nodeID,
                                                    'achieved'
                                                )
                                            "
                                        >
                                            <img
                                                v-if="
                                                    getMonitorResult(
                                                        item.nodeID
                                                    ) === 'achieved'
                                                "
                                                class="guide-btn-check-icon"
                                                :src="checkIcon"
                                                alt=""
                                            />
                                            达成
                                        </el-button>
                                    </div>
                                </div>
                                <div
                                    v-if="!activeSectionMonitors.length"
                                    class="guide-card-placeholder"
                                >
                                    <img :src="optEmpty" alt="" />
                                    <h3>暂无监控要点~</h3>
                                    <h4>完成监控要点后，才能出新的操作要点~</h4>
                                </div>
                            </section>

                            <section
                                v-if="shouldShowOperationCard"
                                class="guide-card guide-card--detail"
                            >
                                <h3>操作要点：</h3>
                                <div
                                    v-for="item in activeOperationDisplayItems"
                                    :key="item.key"
                                    class="guide-block"
                                    :class="{
                                        'guide-block--operation-done':
                                            item.type === 'operation' &&
                                            isOperationCompleted(
                                                item.operation.nodeID
                                            ),
                                        'guide-block--operation-unmet':
                                            item.type === 'unmet'
                                    }"
                                >
                                    <div class="guide-line">
                                        <!-- <span class="guide-line__index">

                                        </span> -->
                                        <span>
                                            <template
                                                v-for="textObj in parseDentalText(
                                                    item.type === 'operation'
                                                        ? item.operation
                                                              .operationDesc
                                                        : item.desc
                                                )"
                                                :key="textObj.text"
                                            >
                                                {{ item.index + 1 }}、{{
                                                    textObj.text
                                                }}
                                            </template>
                                        </span>
                                        <FocusContent
                                            v-for="videoId in item.type ===
                                            'operation'
                                                ? item.operation.operationTypes
                                                : []"
                                            :key="videoId"
                                            content="查看操作视频"
                                            type="video"
                                            :src="videoMap.get(videoId)?.value"
                                            :cover="videoMap.get(videoId)?.img"
                                        />
                                    </div>
                                    <div
                                        v-if="
                                            isCreatingSection &&
                                            item.type === 'operation'
                                        "
                                        class="guide-block__actions"
                                    >
                                        <el-button
                                            class="guide-operation-complete-btn"
                                            :class="{
                                                'guide-operation-complete-btn--done':
                                                    isOperationCompleted(
                                                        item.operation.nodeID
                                                    )
                                            }"
                                            @click="
                                                completeOperation(
                                                    item.operation.nodeID
                                                )
                                            "
                                        >
                                            <img
                                                v-if="
                                                    isOperationCompleted(
                                                        item.operation.nodeID
                                                    )
                                                "
                                                class="guide-btn-check-icon"
                                                :src="checkIcon"
                                                alt=""
                                            />
                                            {{
                                                isOperationCompleted(
                                                    item.operation.nodeID
                                                )
                                                    ? '已完成'
                                                    : '完成操作'
                                            }}
                                        </el-button>
                                    </div>
                                </div>
                                <div
                                    v-if="!activeOperationDisplayItems.length"
                                    class="guide-card-placeholder"
                                >
                                    <img :src="optEmpty" alt="" />
                                    <h3>暂无操作要点~</h3>
                                    <h4>完成监控要点后，才能出新的操作要点~</h4>
                                </div>
                            </section>

                            <section
                                v-if="
                                    !sectionHasContent(activeSection) &&
                                    !shouldShowMonitorCard &&
                                    !shouldShowOperationCard
                                "
                                class="guide-card guide-card--detail guide-card--empty"
                            >
                                <el-icon><VideoCamera /></el-icon>
                                <span>
                                    当前节点没有可展示的操作或监控内容
                                </span>
                            </section>
                        </div>

                        <p v-if="activeSection.tips" class="guide-tips">
                            {{ activeSection.tips }}
                        </p>
                    </div>

                    <footer
                        v-if="isCreatingSection"
                        class="guide-detail__footer"
                    >
                        <el-button
                            type="primary"
                            class="guide-complete-btn"
                            @click="openOperationConfirm"
                        >
                            完成本次操作
                        </el-button>
                    </footer>
                </section>
            </template>
        </main>

        <el-dialog
            v-model="operationConfirmVisible"
            title="操作确认"
            width="652px"
            class="guide-confirm-dialog"
            append-to-body
        >
            <div class="guide-confirm">
                <div
                    class="ft20 fw500"
                    v-if="
                        achievedMonitorItems.length ||
                        unachievedMonitorItems.length
                    "
                >
                    监控要点
                </div>

                <div class="ft20 fw500" v-if="achievedMonitorItems.length">
                    本次监控要点已达成
                </div>
                <div
                    v-if="achievedMonitorItems.length"
                    class="guide-confirm-item guide-confirm-item--success"
                >
                    <span v-html="VectorIcon" class="svg_style"></span>
                    <div class="flexColumn">
                        <div
                            v-for="(item, index) in achievedMonitorItems"
                            :key="`confirm-monitor-achieved-${item.nodeID}`"
                        >
                            <span class="guide-confirm-item__text">
                                {{ index + 1 }}.{{
                                    getMonitorSummaryText(item)
                                }}
                            </span>
                        </div>
                    </div>
                </div>

                <div class="ft20 fw500" v-if="unachievedMonitorItems.length">
                    本次监控要点未达成
                </div>
                <div
                    v-if="unachievedMonitorItems.length"
                    class="guide-confirm-item guide-confirm-item--warning"
                >
                    <span v-html="WarnIcon" class="svg_style"></span>
                    <div class="flexColumn">
                        <div
                            v-for="(item, index) in unachievedMonitorItems"
                            :key="`confirm-monitor-unachieved-${item.nodeID}`"
                        >
                            <span class="guide-confirm-item__text">
                                {{ index + 1 }}.{{
                                    getMonitorSummaryText(item)
                                }}
                            </span>
                        </div>
                    </div>
                </div>

                <div
                    class="ft20 fw500"
                    v-if="
                        completedOperationItems.length ||
                        uncompletedOperationItems.length
                    "
                >
                    操作要点
                </div>

                <div class="ft20 fw500" v-if="completedOperationItems.length">
                    本次操作要点已经完成
                </div>
                <div
                    v-if="completedOperationItems.length"
                    class="guide-confirm-item guide-confirm-item--success"
                >
                    <span v-html="VectorIcon" class="svg_style"></span>
                    <div class="flexColumn">
                        <div
                            v-for="(item, index) in completedOperationItems"
                            :key="`confirm-operation-completed-${item.nodeID}`"
                            class=""
                        >
                            <span class="guide-confirm-item__text">
                                {{ index + 1 }}.{{
                                    getOperationSummaryText(item)
                                }}
                            </span>
                        </div>
                    </div>
                </div>

                <div class="ft20 fw500" v-if="uncompletedOperationItems.length">
                    本次操作要点未完成
                </div>
                <div
                    v-if="uncompletedOperationItems.length"
                    class="guide-confirm-item"
                >
                    <div class="svg_style"></div>
                    <div class="flexColumn">
                        <div
                            v-for="(item, index) in uncompletedOperationItems"
                            :key="`confirm-operation-uncompleted-${item.nodeID}`"
                        >
                            <span class="guide-confirm-item__text">
                                {{ index + 1 }}.{{
                                    getOperationSummaryText(item)
                                }}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <template #footer>
                <el-button @click="operationConfirmVisible = false">
                    取消
                </el-button>
                <el-button type="primary" @click="completeCurrentSection">
                    确认
                </el-button>
            </template>
        </el-dialog>
    </div>
</template>

<style lang="scss" scoped>
.guide {
    display: flex;
    flex: 1;
    min-height: 0;
    color: #202638;
}

.guide-sidebar {
    display: flex;
    flex-direction: column;
    flex: 0 0 300px;
    width: 300px;
    min-height: 0;
    padding: 20px 0px;
    overflow: auto;
    background-color: #fff;
    border-right: 1px solid #d9dfe9;
}

.guide-sidebar__head {
    padding: 0 16px 14px;
    text-align: left;

    h2 {
        margin: 0 0 16px;
        color: #000;
        font-size: 18px;
        line-height: 26px;
        font-weight: 500;
    }

    p {
        margin: 0;
        color: #7c87bd;
        font-size: 15px;
        line-height: 22px;
    }
}

.guide-sidebar__content {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 20px 0;
}
.svg_style {
    padding-top: 3px;
}

.guide-timeline {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 8px 16px 0 36px;

    &::before {
        content: '';
        position: absolute;
        top: 35px;
        bottom: 65px;
        left: 22px;
        width: 1px;
        background: #c8d1ee;
    }
}

.guide-block {
    position: relative;
    background-color: #f7f8fc;
    border: 1px solid #e4e3f0;
    border-radius: 8px;
    padding: 30px;
    margin-top: 20px;
}

.guide-block--operation-done {
    border-color: #1bb88f;
    background-color: #e8f8f4;
}

.guide-block--monitor-achieved {
    border-color: #1bb88f;
    background-color: #e8f8f4;
}

.guide-block--monitor-unachieved {
    border-color: #fa8c16;
    background-color: rgba(250, 140, 22, 0.1);
}

.guide-block--operation-unmet {
    // border-color: #fa8c16;
    // background-color: rgba(250, 140, 22, 0.1);
}

.guide-add-step,
.guide-step {
    position: relative;
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    text-align: left;
}

.guide-add-step {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    min-height: 85px;
    padding: 18px 16px;
    border: 1px solid #1a55e9;
    border-radius: 4px;
    color: #1a55e9;
    font-size: 16px;
    line-height: 18px;
    background-color: rgba(26, 85, 233, 0.06);
    transition: all 0.3s ease;

    &::before {
        content: '';
        position: absolute;
        top: 16px;
        left: -20px;
        z-index: 1;
        width: 14px;
        height: 14px;
        border: 1px solid #9eabd9;
        border-radius: 50%;
        background: #fff;
    }

    &.active {
        border-color: #1a55e9;
        background-color: #1a55e9;
        color: #fff;
        cursor: not-allowed;

        &::before {
            border-color: #1a55e9;
            background-color: #1a55e9;
        }
    }

    &.guide-add-step--disabled,
    &:disabled {
        border-color: #9aa3c6;
        background-color: rgba(154, 163, 198, 0.1);
        color: #9aa3c6;
        cursor: not-allowed;

        &::before {
            border-color: #9aa3c6;
        }
    }
}

.guide-add-step__plus {
    color: inherit;
    font-size: 22px;
    line-height: 22px;
}

.guide-step {
    display: flex;
    align-items: center;
    min-height: 86px;
}

.guide-step__dot {
    position: absolute;
    left: -20px;
    z-index: 1;
    display: flex;
    // align-items: center;
    // justify-content: center;
    top: 14px;
    width: 14px;
    height: 14px;
    border: 1px solid #9eabd9;
    border-radius: 50%;
    background: #fff;

    // span {
    //     width: 8px;
    //     height: 8px;
    //     border-radius: 50%;
    //     // background: #245cf6;
    // }
}

.guide-step__card {
    display: flex;
    flex: 1;
    min-height: 86px;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
    padding: 15px 16px;
    border: 1px solid #dfe4f2;
    border-radius: 4px;
    background: #fff;
    color: #8a93c1;
    transition: all 0.3s ease;
}

.guide-step:not(.guide-step--active):hover .guide-step__card {
    border-color: #1a55e9;
    background-color: rgba(26, 85, 233, 0.06);
}

.guide-step--active {
    .guide-step__dot {
        border-color: #245cf6;
        background: #245cf6;
    }

    .guide-step__card {
        border-color: #245cf6;
        background: #245cf6;
        color: #fff;
    }
}

.guide-step--done:not(.guide-step--active) {
    .guide-step__dot {
        // border-color: #245cf6;
    }
}

.guide-step__date {
    color: #000;
    font-size: 16px;
    line-height: 24px;
}

.guide-step--active .guide-step__date {
    color: #fff;
}

.guide-step__text {
    min-width: 0;
    font-size: 16px;
    line-height: 24px;
    font-weight: 500;
}

.guide-content {
    flex: 1;
    min-width: 0;
    min-height: 0;
    padding: 20px 20px;
    overflow: auto;
    background: #f8f9fd;
}

.guide-overview-grid {
    display: flex;
    gap: 20px;
    align-items: start;
}

.guide-overview-column {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    gap: 20px;
    min-width: 0;
}

.guide-detail {
    display: flex;
    flex-direction: column;
    min-height: 100%;
}

.guide-detail__body {
    flex: 1;
    min-height: 0;
}

.guide-detail__cards {
    display: block;
}

.guide-detail__cards--revisit {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    align-items: flex-start;

    .guide-card--detail {
        flex: 1 1 calc(50% - 10px);
        min-width: 0;
    }
}

.guide-detail__footer {
    position: sticky;
    bottom: -20px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    margin: 0 -20px -20px;
    padding: 16px 20px;
    background: #ffffff;
}

.guide-confirm {
    color: #141923;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.guide-confirm-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.guide-confirm-item {
    display: flex;
    // flex-direction: column;
    align-items: flex-start;
    gap: 16px;
    min-height: 60px;
    padding: 18px 22px;
    border: 1px solid #dfe3ee;
    border-radius: 6px;
    background: #f7f8fc;
    color: #141923;
    font-size: 16px;
    line-height: 32px;
}

.guide-confirm-item--success {
    border-color: #1bb88f;
    background-color: #e8f8f4;

    .guide-confirm-item__icon {
        color: #1bb88f;
    }
}

.guide-confirm-item--warning {
    border-color: #fa8c16;
    background-color: rgba(250, 140, 22, 0.1);

    .guide-confirm-item__icon {
        color: #fa8c16;
    }
}

.guide-confirm-item__icon {
    flex: 0 0 auto;
    min-width: 18px;
    font-size: 22px;
    line-height: 32px;
    text-align: center;
}

.guide-confirm-item__text {
    flex: 1;
    min-width: 0;
    white-space: pre-wrap;
}

.guide-confirm-empty {
    padding: 14px 22px;
    border: 1px solid #dfe3ee;
    border-radius: 6px;
    background: #f7f8fc;
    color: #8a93a6;
    font-size: 15px;
    line-height: 24px;
}

:deep(.guide-confirm-dialog .el-dialog__header) {
    margin-right: 0;
    padding: 20px 40px 0 !important;
}

:deep(.guide-confirm-dialog .el-dialog__title) {
    color: #1f2633;
    font-size: 26px;
    line-height: 36px;
    font-weight: 700;
}

:deep(.guide-confirm-dialog .el-dialog__body) {
    padding: 0 40px 24px !important;
}

:deep(.guide-confirm-dialog .el-dialog__footer) {
    padding: 16px 40px 28px;
}

:deep(.guide-confirm-dialog .el-dialog__footer .el-button) {
    width: 113px;
    height: 40px;
    border-radius: 6px;
}

.guide-complete-btn {
    background-color: #165dff;
    color: #fff;
    width: 160px;
    height: 40px;
    border-radius: 4px;
    font-size: 16px;
}

.guide-card {
    padding: 24px 40px;
    border-radius: 8px;
    background: #fff;
    text-align: left;

    h2 {
        margin: 0 0 22px;
        color: #000;
        font-size: 26px;
        line-height: 36px;
        font-weight: 800;
    }

    h3 {
        margin: 24px 0 18px;
        color: #000;
        font-size: 18px;
        line-height: 26px;
        font-weight: 800;
    }
}

.guide-card--overview {
    min-height: 320px;
}

.guide-card--detail {
    // min-height: 520px;
}

.guide-card--empty,
.guide-card-empty-inline {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 160px;
    color: #8a93a6;
}

.guide-card-placeholder {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 16px;
    padding: 50px 0 40px 0;
    h3 {
        font-size: 20px;
        font-weight: 700;
        color: #13141d;
        margin-top: 18px;
    }
    h4 {
        font-size: 16px;
        color: #9aa3c6;
        font-weight: normal;
    }
}

.guide-block + .guide-block {
    margin-top: 26px;
}

.guide-block__actions {
    display: flex;
    justify-content: flex-end;
    // gap: 12px;
    margin-top: 18px;
}

.guide-monitor-result-btn,
.guide-operation-complete-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: auto;
    height: 39px;
    padding: 8px 16px;
    color: #4b5266;
    border-color: #dcdfe6;
    border-radius: 4px;
    background: none;
    font-size: 14px;
    line-height: normal;
}

.guide-monitor-result-btn--achieved,
.guide-operation-complete-btn--done {
    border-color: #1bb88f;
    background-color: #1bb88f;
    color: #fff;
}

.guide-btn-check-icon {
    width: 14px;
    height: 14px;
    margin-right: 5px;
    object-fit: contain;
}

.guide-monitor-result-btn--unachieved {
    border-color: #fa8c16;
    background-color: #fa8c16;
    color: #fff;
}

.guide-line {
    color: #2f3b58;
    font-size: 16px;
    line-height: 1.45;
    white-space: pre-wrap;

    :deep(.focus.video) {
        margin-left: 10px;
    }

    :deep(.focus.video:first-child) {
        margin-left: 0;
    }
}

.guide-line--plain {
    // padding-left: 26px;
}

.guide-line--unmet {
    margin-top: 10px;
    color: #ad5d08;
}

.guide-line__index {
    color: #2f3b58;
    font-weight: 400;
}

.guide-inline-images {
    display: flex;
    flex-direction: column;
    flex-basis: 100%;
    flex-wrap: wrap;
    gap: 10px;
    // padding-left: 26px;
    margin-top: 10px;
}

.guide-sidebar__btn {
    padding: 0 0 20px 0;
    border-bottom: 1px solid #d9dfe9;
    .btn_style {
        width: 78.5%;
        height: 47px;
        margin: 0 auto;
        border-radius: 4px;
        font-size: 16px;
        border: 1px solid #d9dfe9;
        background: #ffffff;
    }
    .active {
        background-color: #165dff;
        border-color: 0 0 1px #165dff;
        color: #fff;
    }
}

.guide-inline-image {
    width: 107px;
    height: 72px;
    border-radius: 4px;
    object-fit: cover;
    background: #f0f2f7;
}

.guide-tips {
    margin: 28px 0 0;
    color: #773c54;
    font-size: 16px;
    line-height: 26px;
}

.guide-done {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border-radius: 8px;
    background: #eaf8f1;
    color: #15915b;
    font-weight: 700;
}

@media (max-width: 1200px) {
    .guide-overview-grid {
        flex-direction: column;
    }

    .guide-overview-column {
        width: 100%;
    }

    .guide-detail__cards--revisit {
        flex-direction: column;

        .guide-card--detail {
            flex-basis: auto;
            width: 100%;
        }
    }
}

.ft20 {
    font-size: 20px;
}
.fw500 {
    font-weight: 500;
}
:deep(.el-dialog__title) {
}
.flexColumn {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
</style>
