// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function deepClone<T = any>(obj: T): T {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
        return obj.map((item) => deepClone(item)) as T;
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj as object)) {
        result[key] = deepClone((obj as Record<string, unknown>)[key]);
    }
    return result as T;
}
