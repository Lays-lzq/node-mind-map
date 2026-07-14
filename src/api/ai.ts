import type { ApiResponse } from '@/types/api';
import type { AiChatMessage, AiChatMode, AiMindMapResponse } from '@/types/ai';
import { aiAuthHeaders, getAiToken, invalidateAiToken, resolveAiApiBase } from '@/utils/aiAuth';

async function readApiError(response: Response): Promise<string> {
    try {
        const result = (await response.json()) as ApiResponse<null>;
        return result.msg || `请求失败: ${response.status}`;
    } catch {
        return `请求失败: ${response.status}`;
    }
}

async function postJson<T>(path: string, body: unknown, retried = false): Promise<T> {
    const token = await getAiToken();
    const response = await fetch(`${resolveAiApiBase()}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...aiAuthHeaders(token)
        },
        credentials: 'include',
        body: JSON.stringify(body)
    });

    if (response.status === 401 && !retried) {
        invalidateAiToken();
        return postJson<T>(path, body, true);
    }

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

    const token = await getAiToken();

    const response = await fetch(`${resolveAiApiBase(true)}/ai/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...aiAuthHeaders(token)
        },
        credentials: 'include',
        body: JSON.stringify({ messages, contextSummary, mode }),
        signal
    });

    if (!response.ok) {
        throw new Error(await readApiError(response));
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
