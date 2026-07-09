# AI 大模型集成设计（DeepSeek + openai SDK）

## 目标

在 node-mind-map 脑图编辑器中集成 DeepSeek 大模型，支持：

- **A. 脑图生成/展开**：输入主题生成整棵脑图；选中节点 AI 展开子节点
- **C. 对话助手**：右侧抽屉，携带当前脑图上下文进行流式对话

## 方案

采用 **方案 2**：后端使用 `openai` SDK，指向 DeepSeek 兼容端点（`https://api.deepseek.com`）。

## 架构

```
前端 (Vue 3)
  ├─ AiGenerateDialog     → POST /api/ai/generate
  ├─ 右键「AI 展开」       → POST /api/ai/expand
  └─ AiChatDrawer         → POST /api/ai/chat (SSE)

后端 (Express)
  ├─ routes/ai.js
  ├─ services/deepseek.js
  └─ prompts/mindmap.js
```

## API

| 端点 | 请求体 | 响应 |
|------|--------|------|
| `POST /api/ai/generate` | `{ topic }` | `{ nodes: [{ title, children }] }` |
| `POST /api/ai/expand` | `{ nodeTitle, contextSummary }` | 同上 |
| `POST /api/ai/chat` | `{ messages, contextSummary }` | SSE 流式 |

## 环境变量

```env
DEEPSEEK_API_KEY=你的密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

## 前端数据流

AI 返回的树形 JSON 通过 `aiMindMapTree.ts` 转换为现有节点格式（`guide.operationDesc` = title），调用 `appendStandaloneMindMapNode` / `addChildNodeUnder` 落盘。
