import type { ApiResponse } from '@/types/api';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export async function request<T>(path: string): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`);
    const body = (await response.json()) as ApiResponse<T>;

    if (body.code !== 0) {
        throw new Error(body.msg || `请求失败: ${body.code}`);
    }

    return body.data;
}
