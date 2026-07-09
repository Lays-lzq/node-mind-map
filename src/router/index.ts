import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { getAppInstance } from '@/utils/appContext';
import { ensureKonva } from '@/plugins/konva';

const routes: RouteRecordRaw[] = [
    {
        path: '/',
        name: 'Home',
        component: () => import('@/views/home/index.vue'),
        meta: { title: 'L的奇思妙想' }
    },
    {
        path: '/about',
        name: 'About',
        component: () => import('@/views/about/index.vue'),
        meta: { title: '关于我 · L的奇思妙想' }
    },
    {
        path: '/nodeMindMap',
        name: 'NodeMindMap',
        component: () => import('@/views/nodeMindMap/index.vue'),
        meta: { title: '节点脑图' },
        beforeEnter: async () => {
            const app = getAppInstance();
            if (app) await ensureKonva(app);
        }
    },
    {
        path: '/aiAssistant',
        name: 'AiAssistant',
        component: () => import('@/views/aiAssistant/index.vue'),
        meta: { title: 'AI 助手 · L的奇思妙想' }
    }
];

const router = createRouter({
    history: createWebHistory(),
    routes
});

router.afterEach((to) => {
    const title = (to.meta?.title as string) || '节点脑图编辑器';
    document.title = title;

    const bg =
        to.name === 'NodeMindMap'
            ? '#f8f9fc'
            : to.name === 'AiAssistant'
              ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
              : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    document.documentElement.style.background = bg;
    document.body.style.background = bg;
});

export default router;
