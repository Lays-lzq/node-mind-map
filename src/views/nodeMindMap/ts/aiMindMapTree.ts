import {
    addChildNodeUnder,
    appendStandaloneMindMapNode,
    maxNodeIdInList,
    type MindMapCanvasNode
} from './mindMapNodeOps';
import {
    createEmptyGuidePayload,
    type GuidePayload
} from './medicineGuide';
import type { AiMindMapNode, AiMindMapResponse } from '@/types/ai';

export interface MindMapLayoutSize {
    nodeWidth: number;
    nodeHeight: number;
}

function makeGuide(title: string): GuidePayload {
    const guide = createEmptyGuidePayload();
    guide.operationDesc = title;
    return guide;
}

function setNodeTitle(node: MindMapCanvasNode, title: string) {
    const guide = node.guide as GuidePayload | undefined;
    if (guide) {
        guide.operationDesc = title;
    }
}

function applySubtree(
    nodeList: MindMapCanvasNode[],
    parent: MindMapCanvasNode,
    tree: AiMindMapNode,
    layout: MindMapLayoutSize
) {
    addChildNodeUnder(nodeList, parent, layout);
    const child = nodeList.find((n) => n.nodeId === maxNodeIdInList(nodeList));
    if (!child) return;

    setNodeTitle(child, tree.title);
    for (const grandchild of tree.children ?? []) {
        applySubtree(nodeList, child, grandchild, layout);
    }
}

/** 将 AI 返回的树形结构应用到画布（在视口中心新建根节点） */
export function applyAiMindMapTree(
    nodeList: MindMapCanvasNode[],
    response: AiMindMapResponse,
    layout: MindMapLayoutSize,
    viewportCenter: { x: number; y: number }
): MindMapCanvasNode | null {
    const roots = response.nodes ?? [];
    if (!roots.length) return null;

    let lastRoot: MindMapCanvasNode | null = null;
    for (const root of roots) {
        appendStandaloneMindMapNode(
            nodeList,
            viewportCenter,
            makeGuide(root.title),
            layout
        );
        const rootNode = nodeList.find(
            (n) => n.nodeId === maxNodeIdInList(nodeList)
        );
        if (!rootNode) continue;

        lastRoot = rootNode;
        for (const child of root.children ?? []) {
            applySubtree(nodeList, rootNode, child, layout);
        }
    }
    return lastRoot;
}

/** 为选中节点 AI 展开子节点 */
export function applyAiExpandChildren(
    nodeList: MindMapCanvasNode[],
    parent: MindMapCanvasNode,
    response: AiMindMapResponse,
    layout: MindMapLayoutSize
): MindMapCanvasNode[] {
    const root = response.nodes?.[0];
    if (!root?.children?.length) return [];

    const added: MindMapCanvasNode[] = [];
    for (const child of root.children) {
        addChildNodeUnder(nodeList, parent, layout);
        const newNode = nodeList.find(
            (n) => n.nodeId === maxNodeIdInList(nodeList)
        );
        if (!newNode) continue;

        setNodeTitle(newNode, child.title);
        added.push(newNode);
        for (const grandchild of child.children ?? []) {
            applySubtree(nodeList, newNode, grandchild, layout);
        }
    }
    return added;
}

/** 构建脑图上下文摘要，供 AI 对话/展开使用 */
export function buildMindMapContextSummary(
    nodeList: readonly MindMapCanvasNode[]
): string {
    if (!nodeList.length) return '';

    return nodeList
        .map((n) => {
            const title =
                (n.guide as GuidePayload | undefined)?.operationDesc ||
                `节点${n.nodeId}`;
            const parents = (n.prevNodes ?? []).join(',') || '无';
            const children = (n.nextNodes ?? []).join(',') || '无';
            return `- [${n.nodeId}] ${title} (前驱: ${parents}, 后继: ${children})`;
        })
        .join('\n');
}

/** 读取节点标题 */
export function getNodeTitle(node: MindMapCanvasNode): string {
    return (
        (node.guide as GuidePayload | undefined)?.operationDesc ||
        `节点${node.nodeId}`
    );
}
