<script setup lang="ts">
import { useRouter } from 'vue-router';
import { ArrowLeft } from '@element-plus/icons-vue';
import AiChatPanel from '@/components/AiChatPanel.vue';

defineOptions({ name: 'AiAssistant' });

const router = useRouter();

function goHome() {
    router.push('/');
}
</script>

<template>
    <div class="ai-assistant">
        <header class="ai-assistant__header">
            <button type="button" class="ai-assistant__back" @click="goHome">
                <el-icon><ArrowLeft /></el-icon>
                返回首页
            </button>
            <div class="ai-assistant__brand">
                <span class="ai-assistant__icon">✨</span>
                <div>
                    <h1 class="ai-assistant__title">AI 助手</h1>
                    <p class="ai-assistant__subtitle">基于 DeepSeek · 流式对话</p>
                </div>
            </div>
            <div class="ai-assistant__header-spacer" />
        </header>

        <main class="ai-assistant__main">
            <div class="ai-assistant__card">
                <AiChatPanel
                    mode="general"
                    empty-title="有什么可以帮你的？"
                    :empty-hints="[
                        'Vue 3 组合式 API 和选项式 API 有什么区别？',
                        '帮我写一个防抖函数',
                        '如何设计一个可扩展的前端项目结构？'
                    ]"
                />
            </div>
        </main>
    </div>
</template>

<style scoped lang="scss">
$ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);

@keyframes ai-page-in {
    from {
        opacity: 0;
    }

    to {
        opacity: 1;
    }
}

@keyframes ai-header-in {
    from {
        opacity: 0;
        transform: translateY(-14px);
        filter: blur(4px);
    }

    to {
        opacity: 1;
        transform: translateY(0);
        filter: blur(0);
    }
}

@keyframes ai-card-in {
    from {
        opacity: 0;
        transform: translateY(24px) scale(0.98);
        filter: blur(6px);
    }

    to {
        opacity: 1;
        transform: translateY(0) scale(1);
        filter: blur(0);
    }
}

.ai-assistant {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: linear-gradient(145deg, #667eea 0%, #764ba2 50%, #6b5b95 100%);
    color: #303133;
    animation: ai-page-in 0.45s $ease-out-expo both;

    &__header {
        display: flex;
        align-items: center;
        gap: 20px;
        padding: 16px 28px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(16px);
        background: rgba(255, 255, 255, 0.06);
        animation: ai-header-in 0.7s $ease-out-expo 0.06s both;
    }

    &__header-spacer {
        flex: 1;
    }

    &__back {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        font-size: 13px;
        color: #fff;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 10px;
        cursor: pointer;
        transition: background 0.2s;

        &:hover {
            background: rgba(255, 255, 255, 0.18);
        }
    }

    &__brand {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    &__icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 42px;
        height: 42px;
        font-size: 20px;
        background: rgba(255, 255, 255, 0.95);
        border-radius: 12px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    }

    &__title {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: #fff;
    }

    &__subtitle {
        margin: 2px 0 0;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.7);
    }

    &__main {
        flex: 1;
        min-height: 0;
        padding: 20px 24px 24px;
        display: flex;
        justify-content: center;
    }

    &__card {
        width: 100%;
        max-width: 1400px;
        background: #f7f8fc;
        border-radius: 20px;
        box-shadow:
            0 20px 60px rgba(0, 0, 0, 0.18),
            0 0 0 1px rgba(255, 255, 255, 0.08) inset;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        min-height: 0;
        animation: ai-card-in 0.85s $ease-out-expo 0.14s both;
    }
}

@media (prefers-reduced-motion: reduce) {
    .ai-assistant {
        animation: none;

        &__header,
        &__card {
            animation: none;
            opacity: 1;
            transform: none;
            filter: none;
        }
    }
}

@media (max-width: 640px) {
    .ai-assistant {
        &__header {
            padding: 14px 16px;
        }

        &__main {
            padding: 10px 10px 14px;
        }

        &__card {
            border-radius: 16px;
        }
    }
}
</style>
