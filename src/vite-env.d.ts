/// <reference types="vite/client" />

declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
    export default component;
}

declare module '*.svg' {
    const src: string;
    export default src;
}

declare module '*.png' {
    const src: string;
    export default src;
}

interface ImportMetaEnv {
    readonly VITE_PORT: string;
    readonly VITE_API_BASE_URL: string;
    readonly VITE_CHAT_API_BASE_URL?: string;
    readonly VITE_API_PROXY_TARGET?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
