import type { ApiResponse } from '@/types/api';
import type { AiChatMessage, AiChatMode, AiMindMapResponse } from '@/types/ai';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
/** 流式对话直连后端，避免 Vite 代理缓冲 SSE */
const CHAT_API_BASE =
    import.meta.env.VITE_CHAT_API_BASE_URL || API_BASE;

async function postJson<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const result = (await response.json()) as ApiResponse<T>;

    if (result.code !== 0) {
        throw new Error(result.msg || `请求失败: ${result.code}`);
    }

    return result.data;
}

export function generateMindMap(topic: string): Promise<AiMindMapResponse> {
    return postJson<AiMindMapResponse>('/ai/generate', { topic });
}

export function expandMindMapNode(
    nodeTitle: string,
    contextSummary: string
): Promise<AiMindMapResponse> {
    return postJson<AiMindMapResponse>('/ai/expand', { nodeTitle, contextSummary });
}

export async function chatWithAi(
    messages: AiChatMessage[],
    options: {
        contextSummary?: string;
        mode?: AiChatMode;
        onDelta: (text: string) => void;
        signal?: AbortSignal;
    }
): Promise<void> {
    const { contextSummary = '', mode = 'general', onDelta, signal } = options;

    const response = await fetch(`${CHAT_API_BASE}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, contextSummary, mode }),
        signal
    });

    if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('无法读取响应流');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') {
                if (payload === '[DONE]') return;
                continue;
            }

            const parsed = JSON.parse(payload) as {
                content?: string;
                error?: string;
            };
            if (parsed.error) {
                throw new Error(parsed.error);
            }
            if (parsed.content) {
                onDelta(parsed.content);
            }
        }
    }
}
