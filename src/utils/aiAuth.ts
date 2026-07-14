const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const CHAT_API_BASE = import.meta.env.VITE_CHAT_API_BASE_URL || API_BASE;

let cachedToken = '';
let tokenExpiresAt = 0;
let pending: Promise<string> | null = null;

function clearAiToken() {
    cachedToken = '';
    tokenExpiresAt = 0;
}

async function fetchAiToken(): Promise<string> {
    const response = await fetch(`${API_BASE}/ai/auth`, {
        method: 'GET',
        credentials: 'include'
    });
    const result = (await response.json()) as {
        code: number;
        data?: { token: string; expiresAt: number };
        msg?: string;
    };

    if (result.code !== 0 || !result.data?.token) {
        throw new Error(result.msg || '获取访问凭证失败');
    }

    cachedToken = result.data.token;
    tokenExpiresAt = result.data.expiresAt;
    return cachedToken;
}

export async function getAiToken(): Promise<string> {
    const refreshBefore = 30_000;
    if (cachedToken && Date.now() < tokenExpiresAt - refreshBefore) {
        return cachedToken;
    }

    if (!pending) {
        pending = fetchAiToken().finally(() => {
            pending = null;
        });
    }

    return pending;
}

export function invalidateAiToken() {
    clearAiToken();
}

export function aiAuthHeaders(token: string): HeadersInit {
    return {
        Authorization: `Bearer ${token}`
    };
}

export function resolveAiApiBase(forChat = false): string {
    return forChat ? CHAT_API_BASE : API_BASE;
}
