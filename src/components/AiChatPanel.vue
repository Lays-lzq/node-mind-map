<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { Delete, Promotion, UserFilled } from '@element-plus/icons-vue';
import type { AiChatMessage, AiChatMode } from '@/types/ai';
import { chatWithAi } from '@/api/ai';
import { renderMarkdown } from '@/utils/renderMarkdown';

defineOptions({ name: 'AiChatPanel' });

const props = withDefaults(
    defineProps<{
        mode?: AiChatMode;
        contextSummary?: string;
        emptyTitle?: string;
        emptyHints?: string[];
        placeholder?: string;
    }>(),
    {
        mode: 'general',
        contextSummary: '',
        emptyTitle: '开始对话吧',
        emptyHints: () => [
            '帮我解释一个前端概念',
            '写一段 TypeScript 工具函数',
            '帮我梳理项目思路'
        ],
        placeholder: '输入消息，Enter 发送，Shift+Enter 换行...'
    }
);

const emit = defineEmits<{
    clear: [];
}>();

const input = ref('');
const messages = ref<AiChatMessage[]>([]);
const loading = ref(false);
const listRef = ref<HTMLElement | null>(null);
let abortController: AbortController | null = null;

function scrollToBottom() {
    nextTick(() => {
        if (listRef.value) {
            listRef.value.scrollTop = listRef.value.scrollHeight;
        }
    });
}

function isStreamingMessage(index: number) {
    return (
        loading.value &&
        index === messages.value.length - 1 &&
        messages.value[index]?.role === 'assistant'
    );
}

function isAssistantWaiting(index: number) {
    const msg = messages.value[index];
    return isStreamingMessage(index) && !msg?.content;
}

async function sendMessage(text?: string) {
    const content = (text ?? input.value).trim();
    if (!content || loading.value) return;

    messages.value.push({ role: 'user', content });
    input.value = '';
    scrollToBottom();

    const assistantIndex = messages.value.length;
    messages.value.push({ role: 'assistant', content: '' });
    loading.value = true;
    abortController = new AbortController();

    try {
        await chatWithAi(messages.value.slice(0, -1), {
            contextSummary: props.contextSummary,
            mode: props.mode,
            onDelta: (delta) => {
                const current = messages.value[assistantIndex];
                if (!current) return;
                messages.value[assistantIndex] = {
                    ...current,
                    content: current.content + delta
                };
                scrollToBottom();
            },
            signal: abortController.signal
        });
    } catch (err) {
        const current = messages.value[assistantIndex];
        if (current && (err as Error).name !== 'AbortError') {
            current.content =
                current.content || `出错了：${(err as Error).message}`;
        }
    } finally {
        loading.value = false;
        abortController = null;
        scrollToBottom();
    }
}

function send() {
    void sendMessage();
}

function useHint(hint: string) {
    input.value = hint;
    void sendMessage(hint);
}

function clearChat() {
    if (loading.value) {
        abortController?.abort();
    }
    messages.value = [];
    input.value = '';
    loading.value = false;
    emit('clear');
}

function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
    }
}

defineExpose({ clearChat, messages });
</script>

<template>
    <div class="ai-chat-panel">
        <div ref="listRef" class="ai-chat-panel__messages">
            <div class="ai-chat-panel__thread">
                <div v-if="!messages.length" class="ai-chat-panel__empty">
                    <div class="ai-chat-panel__empty-icon">✨</div>
                    <p class="ai-chat-panel__empty-title">{{ emptyTitle }}</p>
                    <p class="ai-chat-panel__empty-desc">点击示例快速开始</p>
                    <div class="ai-chat-panel__hints">
                        <button
                            v-for="hint in emptyHints"
                            :key="hint"
                            type="button"
                            class="ai-chat-panel__hint"
                            @click="useHint(hint)"
                        >
                            {{ hint }}
                        </button>
                    </div>
                </div>

                <div
                    v-for="(msg, i) in messages"
                    :key="i"
                    class="ai-chat-panel__row"
                    :class="`ai-chat-panel__row--${msg.role}`"
                >
                    <div class="ai-chat-panel__side ai-chat-panel__side--left">
                        <div
                            v-if="msg.role === 'assistant'"
                            class="ai-chat-panel__avatar ai-chat-panel__avatar--assistant"
                        >
                            ✨
                        </div>
                    </div>

                    <div class="ai-chat-panel__body">
                        <span class="ai-chat-panel__role">
                            {{ msg.role === 'assistant' ? 'AI 助手' : '你' }}
                        </span>
                        <div
                            v-if="msg.role === 'assistant' && isAssistantWaiting(i)"
                            class="ai-chat-panel__loading"
                            aria-live="polite"
                            aria-label="AI 正在回复"
                        >
                            <span class="ai-chat-panel__loading-dots">
                                <span />
                                <span />
                                <span />
                            </span>
                            <span class="ai-chat-panel__loading-text">思考中</span>
                        </div>
                        <div
                            v-else-if="msg.role === 'assistant'"
                            class="ai-chat-panel__bubble ai-chat-panel__markdown"
                        >
                            <div v-html="renderMarkdown(msg.content)" />
                            <span
                                v-if="isStreamingMessage(i)"
                                class="ai-chat-panel__cursor"
                            />
                        </div>
                        <div
                            v-else
                            class="ai-chat-panel__bubble ai-chat-panel__bubble--user"
                        >
                            {{ msg.content }}
                        </div>
                    </div>

                    <div class="ai-chat-panel__side ai-chat-panel__side--right">
                        <div
                            v-if="msg.role === 'user'"
                            class="ai-chat-panel__avatar ai-chat-panel__avatar--user"
                        >
                            <el-icon><UserFilled /></el-icon>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="ai-chat-panel__composer">
            <div class="ai-chat-panel__thread ai-chat-panel__thread--composer">
                <div class="ai-chat-panel__side ai-chat-panel__side--left" />
                <div class="ai-chat-panel__composer-box">
                    <el-input
                        v-model="input"
                        type="textarea"
                        :autosize="{ minRows: 1, maxRows: 6 }"
                        :placeholder="placeholder"
                        :disabled="loading"
                        resize="none"
                        class="ai-chat-panel__textarea"
                        @keydown="onKeydown"
                    />
                    <div class="ai-chat-panel__composer-bar">
                        <button
                            type="button"
                            class="ai-chat-panel__clear"
                            :disabled="!messages.length || loading"
                            @click="clearChat"
                        >
                            <el-icon><Delete /></el-icon>
                            清空
                        </button>
                        <button
                            type="button"
                            class="ai-chat-panel__send"
                            :disabled="!input.trim() || loading"
                            @click="send"
                        >
                            <el-icon v-if="!loading"><Promotion /></el-icon>
                            <span v-else class="ai-chat-panel__send-loading" />
                            发送
                        </button>
                    </div>
                </div>
                <div class="ai-chat-panel__side ai-chat-panel__side--right" />
            </div>
            <p class="ai-chat-panel__tip">Enter 发送 · Shift+Enter 换行</p>
        </div>
    </div>
</template>

<style lang="scss" scoped>
$accent: #667eea;
$accent-dark: #764ba2;
$ease: cubic-bezier(0.22, 1, 0.36, 1);
$thread-width: 900px;
$side-width: 44px;

.ai-chat-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: #f7f8fc;

    &__thread {
        width: 100%;
        max-width: $thread-width;
        margin: 0 auto;

        &--composer {
            display: grid;
            grid-template-columns: $side-width 1fr $side-width;
            gap: 12px;
            align-items: end;
        }
    }

    &__messages {
        flex: 1;
        overflow-y: auto;
        padding: 28px 20px 16px;
        min-height: 0;
        scroll-behavior: smooth;

        &::-webkit-scrollbar {
            width: 6px;
        }

        &::-webkit-scrollbar-thumb {
            background: #dcdfe6;
            border-radius: 3px;
        }
    }

    &__empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        margin: 10vh auto 0;
        text-align: center;
    }

    &__empty-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 64px;
        height: 64px;
        margin-bottom: 16px;
        font-size: 28px;
        background: #fff;
        border-radius: 18px;
        box-shadow: 0 4px 20px rgb(102 126 234 / 0.15);
    }

    &__empty-title {
        margin: 0 0 6px;
        font-size: 22px;
        font-weight: 600;
        color: #303133;
    }

    &__empty-desc {
        margin: 0 0 20px;
        font-size: 14px;
        color: #909399;
    }

    &__hints {
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: 100%;
    }

    &__hint {
        padding: 12px 16px;
        font-size: 13px;
        line-height: 1.5;
        text-align: left;
        color: #606266;
        background: #fff;
        border: 1px solid #ebeef5;
        border-radius: 12px;
        cursor: pointer;
        transition:
            border-color 0.2s $ease,
            box-shadow 0.2s $ease,
            transform 0.2s $ease;

        &:hover {
            border-color: rgb(102 126 234 / 0.35);
            box-shadow: 0 4px 16px rgb(102 126 234 / 0.1);
            transform: translateY(-1px);
        }
    }

    &__row {
        display: grid;
        grid-template-columns: $side-width 1fr $side-width;
        gap: 12px;
        margin-bottom: 24px;
        animation: msg-in 0.35s $ease both;
    }

    &__side {
        display: flex;
        flex-shrink: 0;
        width: $side-width;

        &--left {
            justify-content: flex-end;
        }

        &--right {
            justify-content: flex-start;
        }
    }

    &__body {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
    }

    &__row--user {
        .ai-chat-panel__body {
            align-items: flex-end;
        }

        .ai-chat-panel__role {
            text-align: right;
        }
    }

    &__avatar {
        display: flex;
        flex-shrink: 0;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        font-size: 16px;
        border-radius: 10px;

        &--assistant {
            background: #fff;
            box-shadow: 0 2px 8px rgb(0 0 0 / 0.06);
        }

        &--user {
            color: #fff;
            background: linear-gradient(135deg, $accent 0%, $accent-dark 100%);
        }
    }

    &__role {
        font-size: 12px;
        font-weight: 500;
        color: #909399;
    }

    &__bubble {
        width: 100%;
        padding: 12px 16px;
        font-size: 14px;
        line-height: 1.7;
        word-break: break-word;

        &--user {
            width: auto;
            max-width: 100%;
            color: #fff;
            white-space: pre-wrap;
            background: linear-gradient(135deg, $accent 0%, $accent-dark 100%);
            border-radius: 16px 16px 4px 16px;
            box-shadow: 0 4px 14px rgb(102 126 234 / 0.28);
        }
    }

    &__markdown {
        background: #fff;
        border: 1px solid #ebeef5;
        border-radius: 4px 16px 16px 16px;
        box-shadow: 0 2px 12px rgb(0 0 0 / 0.04);
        white-space: normal;

        :deep(p) {
            margin: 0 0 0.75em;

            &:last-child {
                margin-bottom: 0;
            }
        }

        :deep(h1),
        :deep(h2),
        :deep(h3),
        :deep(h4) {
            margin: 1em 0 0.5em;
            font-weight: 600;
            line-height: 1.4;
            color: #303133;

            &:first-child {
                margin-top: 0;
            }
        }

        :deep(h1) { font-size: 1.2em; }
        :deep(h2) { font-size: 1.1em; }
        :deep(h3) { font-size: 1.02em; }

        :deep(ul),
        :deep(ol) {
            margin: 0.5em 0;
            padding-left: 1.4em;
        }

        :deep(li) {
            margin: 0.3em 0;
        }

        :deep(blockquote) {
            margin: 0.75em 0;
            padding: 0.5em 0.85em;
            border-left: 3px solid $accent;
            color: #606266;
            background: rgb(102 126 234 / 0.05);
            border-radius: 0 8px 8px 0;
        }

        :deep(code) {
            padding: 0.15em 0.45em;
            font-size: 0.88em;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            color: #c678dd;
            background: #f3f4f6;
            border-radius: 4px;
        }

        :deep(pre) {
            margin: 0.75em 0;
            padding: 14px 16px;
            overflow-x: auto;
            background: #1e1e2e;
            border-radius: 10px;

            code {
                padding: 0;
                color: #cdd6f4;
                background: transparent;
            }
        }

        :deep(a) {
            color: $accent;
            text-decoration: none;

            &:hover {
                text-decoration: underline;
            }
        }

        :deep(table) {
            width: 100%;
            margin: 0.75em 0;
            border-collapse: collapse;
            font-size: 13px;
        }

        :deep(th),
        :deep(td) {
            padding: 8px 12px;
            border: 1px solid #ebeef5;
        }

        :deep(th) {
            background: #f5f7fa;
            font-weight: 600;
        }

        :deep(hr) {
            margin: 1em 0;
            border: none;
            border-top: 1px solid #ebeef5;
        }

        :deep(strong) {
            color: #303133;
        }
    }

    &__loading {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: #fff;
        border: 1px solid #ebeef5;
        border-radius: 12px;
        box-shadow: 0 2px 10px rgb(0 0 0 / 0.04);
    }

    &__loading-dots {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 16px;

        span {
            width: 7px;
            height: 7px;
            background: $accent;
            border-radius: 50%;
            opacity: 0.35;
            animation: ai-dot-bounce 1.2s infinite ease-in-out both;

            &:nth-child(1) {
                animation-delay: 0s;
            }

            &:nth-child(2) {
                animation-delay: 0.15s;
            }

            &:nth-child(3) {
                animation-delay: 0.3s;
            }
        }
    }

    &__loading-text {
        font-size: 13px;
        color: #909399;
    }

    &__cursor {
        display: inline-block;
        width: 2px;
        height: 1em;
        margin-left: 2px;
        background: $accent;
        animation: blink 1s infinite;
        vertical-align: text-bottom;
    }

    &__composer {
        flex-shrink: 0;
        padding: 12px 20px 10px;
        background: linear-gradient(to top, #f7f8fc 70%, transparent);
    }

    &__composer-box {
        min-width: 0;
        padding: 12px 14px 10px;
        background: #fff;
        border: 1px solid #e4e7ed;
        border-radius: 16px;
        box-shadow: 0 4px 24px rgb(0 0 0 / 0.06);
        transition: border-color 0.2s $ease, box-shadow 0.2s $ease;

        &:focus-within {
            border-color: rgb(102 126 234 / 0.45);
            box-shadow: 0 4px 24px rgb(102 126 234 / 0.12);
        }
    }

    &__textarea {
        :deep(.el-textarea__inner) {
            padding: 0;
            font-size: 14px;
            line-height: 1.6;
            background: transparent;
            border: none;
            box-shadow: none !important;

            &::placeholder {
                color: #c0c4cc;
            }
        }
    }

    &__composer-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid #f2f3f5;
    }

    &__clear {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 6px 10px;
        font-size: 13px;
        color: #909399;
        background: transparent;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: color 0.2s, background 0.2s;

        &:hover:not(:disabled) {
            color: #606266;
            background: #f5f7fa;
        }

        &:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
    }

    &__send {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 18px;
        font-size: 13px;
        font-weight: 500;
        color: #fff;
        background: linear-gradient(135deg, $accent 0%, $accent-dark 100%);
        border: none;
        border-radius: 10px;
        cursor: pointer;
        transition:
            opacity 0.2s $ease,
            transform 0.2s $ease,
            box-shadow 0.2s $ease;
        box-shadow: 0 4px 12px rgb(102 126 234 / 0.3);

        &:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 6px 16px rgb(102 126 234 / 0.38);
        }

        &:active:not(:disabled) {
            transform: translateY(0);
        }

        &:disabled {
            opacity: 0.45;
            cursor: not-allowed;
            box-shadow: none;
        }
    }

    &__send-loading {
        display: inline-block;
        width: 14px;
        height: 14px;
        border: 2px solid rgb(255 255 255 / 0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
    }

    &__tip {
        max-width: $thread-width;
        margin: 8px auto 0;
        font-size: 12px;
        text-align: center;
        color: #c0c4cc;
    }
}

@keyframes msg-in {
    from {
        opacity: 0;
        transform: translateY(8px);
    }

    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes ai-dot-bounce {
    0%, 80%, 100% {
        opacity: 0.35;
        transform: translateY(0) scale(0.92);
    }

    40% {
        opacity: 1;
        transform: translateY(-3px) scale(1);
    }
}

@keyframes blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

@media (max-width: 840px) {
    .ai-chat-panel {
        &__thread {
            max-width: 100%;
        }

        &__messages {
            padding: 16px 12px 12px;
        }

        &__row {
            grid-template-columns: 36px 1fr 36px;
            gap: 8px;
            margin-bottom: 18px;
        }

        &__side {
            width: 36px;
        }

        &__avatar {
            width: 32px;
            height: 32px;
            font-size: 14px;
        }

        &__thread--composer {
            grid-template-columns: 36px 1fr 36px;
            gap: 8px;
        }

        &__composer {
            padding: 10px 12px 14px;
        }
    }
}
</style>
