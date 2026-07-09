<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import SiteHeader from '@/components/SiteHeader.vue';
import SiteFooter from '@/components/SiteFooter.vue';
import { fetchProjects } from '@/api/projects';
import { statusLabel, type Project } from '@/types/projects';
import { resolveProjectIcon } from '@/utils/projectIcons';

const router = useRouter();
const projects = ref<Project[]>([]);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
    try {
        projects.value = await fetchProjects();
    } catch (err) {
        error.value = err instanceof Error ? err.message : '加载项目失败';
    } finally {
        loading.value = false;
    }
});

function openProject(project: Project) {
    if (project.route) {
        router.push(project.route);
        return;
    }
    if (project.externalUrl) {
        window.open(project.externalUrl, '_blank', 'noopener,noreferrer');
    }
}
</script>

<template>
    <div class="home">
        <SiteHeader />

        <main class="home__main">
            <section class="home__hero">
                <div class="home__hero-badge">Personal Portfolio</div>
                <h1 class="home__hero-title">
                    嗨，我是 <span class="home__hero-highlight">L</span>
                </h1>
                <p class="home__hero-subtitle">前端开发者 · 把想法变成可交互的产品</p>
                <p class="home__hero-desc">
                    这里记录我独立开发的小项目与实验性作品。每个项目都是一次对工具、交互与工程化的探索。
                </p>
            </section>

            <section id="projects" class="home__section">
                <div class="home__section-head">
                    <h2 class="home__section-title">项目展示</h2>
                    <p class="home__section-desc">共 {{ projects.length }} 个作品，持续更新中</p>
                </div>

                <p v-if="loading" class="home__state">加载中...</p>
                <p v-else-if="error" class="home__state home__state--error">{{ error }}</p>

                <div v-else class="home__grid">
                    <article
                        v-for="(project, index) in projects"
                        :key="project.id"
                        class="home__card"
                        :style="{ '--card-accent': project.accent, '--card-delay': `${0.08 * index}s` }"
                    >
                        <div class="home__card-top">
                            <div class="home__card-icon">
                                <el-icon
                                    v-if="resolveProjectIcon(project.icon)"
                                    :size="24"
                                    class="home__card-icon-svg"
                                >
                                    <component :is="resolveProjectIcon(project.icon)" />
                                </el-icon>
                                <span v-else>{{ project.icon }}</span>
                            </div>
                            <span
                                class="home__card-status"
                                :class="`home__card-status--${project.status}`"
                            >
                                {{ statusLabel[project.status] }}
                            </span>
                        </div>

                        <h3 class="home__card-title">{{ project.name }}</h3>
                        <p class="home__card-desc">{{ project.description }}</p>

                        <ul class="home__tags">
                            <li v-for="tag in project.tags" :key="tag" class="home__tag">
                                {{ tag }}
                            </li>
                        </ul>

                        <button
                            type="button"
                            class="home__card-btn"
                            :disabled="project.status !== 'live'"
                            @click="openProject(project)"
                        >
                            {{ project.status === 'live' ? '查看项目' : '敬请期待' }}
                        </button>
                    </article>
                </div>
            </section>

            <section id="about" class="home__section home__about">
                <div class="home__about-card">
                    <h2 class="home__about-title">关于这个站点</h2>
                    <p class="home__about-text">
                        「L的奇思妙想」是我的个人作品集合站，用来集中展示自研工具与前端实验项目。
                        你可以在上方卡片中进入具体项目体验，也可以前往「关于我」了解更多背景。
                    </p>
                </div>
            </section>
        </main>

        <SiteFooter />
    </div>
</template>

<style scoped lang="scss">
$ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
$ease-out-soft: cubic-bezier(0.22, 1, 0.36, 1);

@keyframes home-fade-up {
    from {
        opacity: 0;
        transform: translateY(14px);
        filter: blur(3px);
    }

    to {
        opacity: 1;
        transform: translateY(0);
        filter: blur(0);
    }
}

@keyframes home-card-in {
    from {
        opacity: 0;
        transform: translateY(18px) scale(0.98);
    }

    to {
        opacity: 1;
        transform: translateY(0) scale(1);
    }
}

.home {
    position: relative;
    width: 100%;
    height: 100%;
    overflow-x: hidden;
    overflow-y: auto;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #fff;

    &__main {
        max-width: 1080px;
        margin: 0 auto;
        padding: 48px 24px 32px;
    }

    &__hero {
        text-align: center;
        padding: 32px 0 56px;
        animation: home-fade-up 0.95s $ease-out-expo 0.08s both;
    }

    &__hero-badge {
        display: inline-block;
        margin-bottom: 20px;
        padding: 6px 14px;
        font-size: 12px;
        font-weight: 500;
        letter-spacing: 1px;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.9);
        background: rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 999px;
    }

    &__hero-title {
        margin: 0 0 12px;
        font-size: clamp(32px, 5vw, 48px);
        font-weight: 700;
        line-height: 1.2;
        letter-spacing: 1px;
    }

    &__hero-highlight {
        color: #ffe066;
        text-shadow: 0 2px 12px rgba(255, 224, 102, 0.35);
    }

    &__hero-subtitle {
        margin: 0 0 16px;
        font-size: 18px;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.92);
    }

    &__hero-desc {
        max-width: 560px;
        margin: 0 auto;
        font-size: 15px;
        line-height: 1.7;
        color: rgba(255, 255, 255, 0.78);
    }

    &__section {
        margin-bottom: 48px;
    }

    &__section-head {
        margin-bottom: 24px;
        animation: home-fade-up 0.85s $ease-out-expo 0.16s both;
    }

    &__section-title {
        margin: 0 0 6px;
        font-size: 24px;
        font-weight: 600;
    }

    &__section-desc {
        margin: 0;
        font-size: 14px;
        color: rgba(255, 255, 255, 0.72);
    }

    &__state {
        margin: 0;
        padding: 24px;
        text-align: center;
        font-size: 14px;
        color: rgba(255, 255, 255, 0.82);
        background: rgba(255, 255, 255, 0.1);
        border-radius: 12px;

        &--error {
            color: #ffd6d6;
        }
    }

    &__grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 20px;
    }

    &__card {
        display: flex;
        flex-direction: column;
        padding: 28px;
        background: rgba(255, 255, 255, 0.95);
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
        color: #303133;
        animation: home-card-in 0.9s $ease-out-expo var(--card-delay, 0s) both;
        transition: transform 0.25s $ease-out-soft, box-shadow 0.25s $ease-out-soft;

        &:hover {
            transform: translateY(-4px);
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.16);
        }
    }

    &__card-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
    }

    &__card-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 48px;
        height: 48px;
        font-size: 24px;
        color: var(--card-accent, #667eea);
        background: color-mix(in srgb, var(--card-accent, #667eea) 12%, white);
        border-radius: 12px;
    }

    &__card-icon-svg {
        color: inherit;
    }

    &__card-status {
        padding: 4px 10px;
        font-size: 12px;
        font-weight: 500;
        border-radius: 999px;

        &--live {
            color: #389e0d;
            background: #f6ffed;
        }

        &--wip {
            color: #d48806;
            background: #fffbe6;
        }

        &--archived {
            color: #8c8c8c;
            background: #f5f5f5;
        }
    }

    &__card-title {
        margin: 0 0 10px;
        font-size: 20px;
        font-weight: 600;
        color: #303133;
    }

    &__card-desc {
        flex: 1;
        margin: 0 0 16px;
        font-size: 14px;
        line-height: 1.65;
        color: #606266;
    }

    &__tags {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 0 0 20px;
        padding: 0;
        list-style: none;
    }

    &__tag {
        padding: 4px 10px;
        font-size: 12px;
        color: var(--card-accent, #667eea);
        background: color-mix(in srgb, var(--card-accent, #667eea) 10%, white);
        border-radius: 6px;
    }

    &__card-btn {
        width: 100%;
        padding: 11px 20px;
        font-size: 14px;
        font-weight: 500;
        line-height: 1;
        color: #fff;
        background: var(--card-accent, #667eea);
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: opacity 0.2s $ease-out-soft, transform 0.2s $ease-out-soft;

        &:hover:not(:disabled) {
            opacity: 0.9;
        }

        &:active:not(:disabled) {
            transform: scale(0.98);
        }

        &:disabled {
            color: #909399;
            background: #f0f2f5;
            cursor: not-allowed;
        }
    }

    &__about-card {
        padding: 32px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 16px;
        backdrop-filter: blur(8px);
        animation: home-fade-up 0.85s $ease-out-expo 0.24s both;
    }

    &__about-title {
        margin: 0 0 12px;
        font-size: 20px;
        font-weight: 600;
    }

    &__about-text {
        margin: 0;
        font-size: 14px;
        line-height: 1.7;
        color: rgba(255, 255, 255, 0.82);

        code {
            padding: 2px 6px;
            font-size: 13px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            background: rgba(0, 0, 0, 0.15);
            border-radius: 4px;
        }
    }

    &__footer {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
        gap: 8px;
        padding: 24px;
        font-size: 13px;
        color: rgba(255, 255, 255, 0.65);
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    }

    &__footer-dot {
        opacity: 0.5;
    }
}

@media (max-width: 640px) {
    .home {
        &__main {
            padding-top: 32px;
        }

        &__hero {
            padding-bottom: 40px;
        }
    }
}

@media (prefers-reduced-motion: reduce) {
    .home__hero,
    .home__section-head,
    .home__card,
    .home__about-card {
        animation: none;
        opacity: 1;
        transform: none;
        filter: none;
    }

    .home__card:hover {
        transform: none;
    }
}
</style>
