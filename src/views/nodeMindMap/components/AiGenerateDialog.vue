<script setup lang="ts">
import { ref } from 'vue';

defineOptions({ name: 'AiGenerateDialog' });

const visible = defineModel<boolean>({ default: false });

const emit = defineEmits<{
    confirm: [topic: string];
}>();

const topic = ref('');
const loading = ref(false);

function open() {
    topic.value = '';
    visible.value = true;
}

function close() {
    if (loading.value) return;
    visible.value = false;
}

function onConfirm() {
    const value = topic.value.trim();
    if (!value) return;
    emit('confirm', value);
}

defineExpose({ open, close, setLoading: (v: boolean) => { loading.value = v; } });
</script>

<template>
    <el-dialog
        v-model="visible"
        title="AI 生成脑图"
        width="480px"
        :close-on-click-modal="!loading"
        :close-on-press-escape="!loading"
        @close="close"
    >
        <el-input
            v-model="topic"
            type="textarea"
            :rows="4"
            placeholder="输入主题，例如：Vue 3 学习路线、项目管理流程..."
            :disabled="loading"
            @keydown.enter.ctrl="onConfirm"
        />
        <p class="ai-generate-dialog__hint">
            按 Ctrl+Enter 快速生成
        </p>
        <template #footer>
            <el-button :disabled="loading" @click="close">
                取消
            </el-button>
            <el-button
                type="primary"
                :loading="loading"
                :disabled="!topic.trim()"
                @click="onConfirm"
            >
                生成
            </el-button>
        </template>
    </el-dialog>
</template>

<style lang="scss" scoped>
.ai-generate-dialog__hint {
    margin: 8px 0 0;
    font-size: 12px;
    color: #909399;
}
</style>
