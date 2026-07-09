<script setup lang="ts">
import { onMounted, ref } from 'vue';
import SiteHeader from '@/components/SiteHeader.vue';
import SiteFooter from '@/components/SiteFooter.vue';
import { fetchProfile } from '@/api/profile';
import type { Profile } from '@/types/profile';

const profile = ref<Profile | null>(null);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
    try {
        profile.value = await fetchProfile();
    } catch (err) {
        error.value = err instanceof Error ? err.message : '加载个人信息失败';
    } finally {
        loading.value = false;
    }
});
</script>

<template>
    <div class="about">
        <SiteHeader />

        <main class="about__main">
            <p v-if="loading" class="about__state">加载中...</p>
            <p v-else-if="error" class="about__state about__state--error">{{ error }}</p>

            <template v-else-if="profile">
                <section class="about__hero" v-if="profile.avatar">
                    <div class="about__profile-card">
                        <img
                            class="about__avatar"
                            :src="profile.avatar"
                            :alt="profile.name"
                        />
                        <div class="about__profile-info">
                            <h1 class="about__name">{{ profile.name }}</h1>
                            <p class="about__title">{{ profile.title }} · {{ profile.location }}</p>
                            <p class="about__education">{{ profile.education }}</p>
                            <ul class="about__contacts">
                                <li v-for="item in profile.contacts" :key="item.label">
                                    <a
                                        v-if="item.href"
                                        :href="item.href"
                                        class="about__contact-link"
                                        :target="item.href.startsWith('http') ? '_blank' : undefined"
                                        :rel="item.href.startsWith('http') ? 'noopener noreferrer' : undefined"
                                    >
                                        {{ item.label }}：{{ item.value }}
                                    </a>
                                    <span v-else>{{ item.label }}：{{ item.value }}</span>
                                </li>
                            </ul>
                        </div>
                    </div>
                </section>

                <section class="about__section">
                    <h2 class="about__section-title">个人总结</h2>
                    <div class="about__panel">
                        <p v-for="(text, index) in profile.summary" :key="index" class="about__text">
                            {{ text }}
                        </p>
                    </div>
                </section>

                <section class="about__section">
                    <h2 class="about__section-title">技术专长</h2>
                    <div class="about__skills">
                        <div
                            v-for="(group, index) in profile.skills"
                            :key="group.category"
                            class="about__skill-card"
                            :style="{ '--card-delay': `${0.06 * index}s` }"
                        >
                            <h3 class="about__skill-title">{{ group.category }}</h3>
                            <ul class="about__skill-list">
                                <li v-for="item in group.items" :key="item">{{ item }}</li>
                            </ul>
                        </div>
                    </div>
                </section>

                <section class="about__section">
                    <h2 class="about__section-title">工作经历</h2>
                    <div class="about__timeline">
                        <article
                            v-for="(job, index) in profile.workExperience"
                            :key="job.company"
                            class="about__timeline-item"
                            :style="{ '--card-delay': `${0.06 * index}s` }"
                        >
                            <div class="about__timeline-dot" />
                            <div class="about__timeline-card">
                                <div class="about__timeline-head">
                                    <h3 class="about__timeline-title">{{ job.company }}</h3>
                                    <span class="about__timeline-period">{{ job.period }}</span>
                                </div>
                                <p class="about__timeline-role">{{ job.role }} · {{ job.department }}</p>
                                <ul class="about__bullet-list">
                                    <li v-for="item in job.highlights" :key="item">{{ item }}</li>
                                </ul>
                            </div>
                        </article>
                    </div>
                </section>

                <section class="about__section">
                    <h2 class="about__section-title">主要项目经历</h2>
                    <div class="about__projects">
                        <article
                            v-for="(project, index) in profile.projectExperience"
                            :key="project.name"
                            class="about__project-card"
                            :style="{ '--card-delay': `${0.05 * index}s` }"
                        >
                            <div class="about__project-head">
                                <h3 class="about__project-name">{{ project.name }}</h3>
                                <span class="about__project-period">{{ project.period }}</span>
                            </div>
                            <ul class="about__tags">
                                <li v-for="tag in project.stack" :key="tag" class="about__tag">
                                    {{ tag }}
                                </li>
                            </ul>
                            <p class="about__text">{{ project.description }}</p>
                            <ul class="about__bullet-list">
                                <li v-for="item in project.highlights" :key="item">{{ item }}</li>
                            </ul>
                        </article>
                    </div>
                </section>
            </template>
        </main>

        <SiteFooter />
    </div>
</template>

<style scoped lang="scss">
$ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
$ease-out-soft: cubic-bezier(0.22, 1, 0.36, 1);

@keyframes about-fade-up {
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

@keyframes about-card-in {
    from {
        opacity: 0;
        transform: translateY(16px) scale(0.98);
    }

    to {
        opacity: 1;
        transform: translateY(0) scale(1);
    }
}

.about {
    width: 100%;
    height: 100%;
    overflow-x: hidden;
    overflow-y: auto;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #fff;

    &__main {
        max-width: 900px;
        margin: 0 auto;
        padding: 40px 24px 24px;
    }

    &__state {
        margin: 0 0 24px;
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

    &__hero {
        margin-bottom: 40px;
        animation: about-fade-up 0.95s $ease-out-expo both;
    }

    &__profile-card {
        display: flex;
        gap: 28px;
        align-items: center;
        padding: 32px;
        background: rgba(255, 255, 255, 0.95);
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
        color: #303133;
    }

    &__avatar {
        flex-shrink: 0;
        width: 120px;
        height: 120px;
        object-fit: cover;
        border-radius: 16px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    }

    &__profile-info {
        flex: 1;
        min-width: 0;
    }

    &__name {
        margin: 0 0 6px;
        font-size: 28px;
        font-weight: 700;
        color: #303133;
    }

    &__title {
        margin: 0 0 4px;
        font-size: 16px;
        font-weight: 500;
        color: #667eea;
    }

    &__education {
        margin: 0 0 16px;
        font-size: 14px;
        color: #606266;
    }

    &__contacts {
        margin: 0;
        padding: 0;
        list-style: none;

        li + li {
            margin-top: 6px;
        }
    }

    &__contact-link {
        font-size: 14px;
        color: #606266;
        text-decoration: none;
        transition: color 0.2s $ease-out-soft;

        &:hover {
            color: #667eea;
        }
    }

    &__section {
        margin-bottom: 40px;
    }

    &__section-title {
        margin: 0 0 16px;
        font-size: 22px;
        font-weight: 600;
        animation: about-fade-up 0.85s $ease-out-expo 0.08s both;
    }

    &__panel {
        padding: 24px 28px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 16px;
        backdrop-filter: blur(8px);
        animation: about-card-in 0.9s $ease-out-expo 0.12s both;
    }

    &__text {
        margin: 0;
        font-size: 14px;
        line-height: 1.75;
        color: #606266;

        & + & {
            margin-top: 10px;
        }
    }

    &__panel &__text {
        color: rgba(255, 255, 255, 0.85);
    }

    &__skills {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 16px;
    }

    &__skill-card {
        padding: 20px 24px;
        background: rgba(255, 255, 255, 0.95);
        border-radius: 14px;
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.1);
        color: #303133;
        animation: about-card-in 0.85s $ease-out-expo var(--card-delay, 0s) both;
    }

    &__skill-title {
        margin: 0 0 12px;
        font-size: 15px;
        font-weight: 600;
        color: #667eea;
    }

    &__skill-list {
        margin: 0;
        padding: 0;
        list-style: none;

        li {
            position: relative;
            padding-left: 14px;
            font-size: 13px;
            line-height: 1.65;
            color: #606266;

            &::before {
                content: '';
                position: absolute;
                left: 0;
                top: 9px;
                width: 5px;
                height: 5px;
                border-radius: 50%;
                background: #667eea;
            }

            & + li {
                margin-top: 6px;
            }
        }
    }

    &__timeline {
        position: relative;
        padding-left: 20px;

        &::before {
            content: '';
            position: absolute;
            left: 5px;
            top: 8px;
            bottom: 8px;
            width: 2px;
            background: rgba(255, 255, 255, 0.25);
        }
    }

    &__timeline-item {
        position: relative;
        padding-left: 24px;
        animation: about-card-in 0.85s $ease-out-expo var(--card-delay, 0s) both;

        & + & {
            margin-top: 20px;
        }
    }

    &__timeline-dot {
        position: absolute;
        left: -20px;
        top: 18px;
        width: 12px;
        height: 12px;
        background: #ffe066;
        border: 2px solid rgba(255, 255, 255, 0.6);
        border-radius: 50%;
        box-shadow: 0 0 0 3px rgba(255, 224, 102, 0.25);
    }

    &__timeline-card {
        padding: 22px 26px;
        background: rgba(255, 255, 255, 0.95);
        border-radius: 14px;
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.1);
        color: #303133;
    }

    &__timeline-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 6px;
    }

    &__timeline-title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: #303133;
    }

    &__timeline-period {
        flex-shrink: 0;
        font-size: 12px;
        color: #909399;
        white-space: nowrap;
    }

    &__timeline-role {
        margin: 0 0 12px;
        font-size: 13px;
        color: #667eea;
    }

    &__projects {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    &__project-card {
        padding: 24px 28px;
        background: rgba(255, 255, 255, 0.95);
        border-radius: 14px;
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.1);
        color: #303133;
        animation: about-card-in 0.85s $ease-out-expo var(--card-delay, 0s) both;
    }

    &__project-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
    }

    &__project-name {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: #303133;
    }

    &__project-period {
        flex-shrink: 0;
        font-size: 12px;
        color: #909399;
        white-space: nowrap;
    }

    &__tags {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 0 0 12px;
        padding: 0;
        list-style: none;
    }

    &__tag {
        padding: 3px 10px;
        font-size: 12px;
        color: #667eea;
        background: rgba(102, 126, 234, 0.1);
        border-radius: 6px;
    }

    &__bullet-list {
        margin: 12px 0 0;
        padding: 0;
        list-style: none;

        li {
            position: relative;
            padding-left: 14px;
            font-size: 13px;
            line-height: 1.65;
            color: #606266;

            &::before {
                content: '';
                position: absolute;
                left: 0;
                top: 9px;
                width: 5px;
                height: 5px;
                border-radius: 50%;
                background: #667eea;
            }

            & + li {
                margin-top: 6px;
            }
        }
    }
}

@media (max-width: 640px) {
    .about {
        &__main {
            padding-top: 28px;
        }

        &__profile-card {
            flex-direction: column;
            text-align: center;
            padding: 24px;
        }

        &__avatar {
            width: 100px;
            height: 100px;
        }

        &__timeline-head,
        &__project-head {
            flex-direction: column;
            gap: 4px;
        }
    }
}

@media (prefers-reduced-motion: reduce) {
    .about__hero,
    .about__section-title,
    .about__panel,
    .about__skill-card,
    .about__timeline-item,
    .about__project-card {
        animation: none;
        opacity: 1;
        transform: none;
        filter: none;
    }
}
</style>
