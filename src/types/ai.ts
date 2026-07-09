export interface AiMindMapNode {
    title: string;
    children?: AiMindMapNode[];
}

export interface AiMindMapResponse {
    nodes: AiMindMapNode[];
}

export interface AiChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export type AiChatMode = 'general' | 'mindmap';
