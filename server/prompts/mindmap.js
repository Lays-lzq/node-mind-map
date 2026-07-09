const MINDMAP_JSON_SCHEMA_HINT = `返回严格 JSON，格式：
{
  "nodes": [
    { "title": "主题", "children": [
      { "title": "子主题", "children": [] }
    ]}
  ]
}`;

export function buildGeneratePrompt(topic) {
    return [
        {
            role: 'system',
            content: `你是脑图助手。根据用户主题生成树形脑图结构。${MINDMAP_JSON_SCHEMA_HINT} 每个 title 简短（2-15字），层级不超过4层，每个节点2-5个子节点。`
        },
        { role: 'user', content: `主题为：${topic}` }
    ];
}

export function buildExpandPrompt(nodeTitle, contextSummary) {
    return [
        {
            role: 'system',
            content: `你是脑图助手。为给定节点展开子节点。${MINDMAP_JSON_SCHEMA_HINT} nodes 数组只含一个根节点，其 children 为要添加的子节点列表。`
        },
        {
            role: 'user',
            content: `当前脑图：\n${contextSummary || '（空）'}\n\n需要展开的节点：${nodeTitle}`
        }
    ];
}

export function buildChatSystemPrompt(contextSummary) {
    return `你是脑图编辑助手。用户正在编辑节点脑图。
当前脑图结构：
${contextSummary || '（空画布）'}

你可以：分析结构、给出优化建议、回答关于脑图的问题。回答简洁，使用中文。`;
}

export function buildGeneralChatSystemPrompt() {
    return `你是 L 的奇思妙想站点中的 AI 助手，友好、专业、简洁。
你可以：回答问题、解释技术概念、提供编程建议、帮用户梳理思路。
回答使用中文，条理清晰，必要时使用列表或分步说明。`;
}
