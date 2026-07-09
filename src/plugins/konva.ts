import type { App } from 'vue';

let installed = false;

export async function ensureKonva(app: App) {
    if (installed) return;
    const VueKonva = (await import('vue-konva')).default;
    app.use(VueKonva);
    installed = true;
}
