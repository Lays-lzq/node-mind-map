<script setup lang="ts">
import { ArrowDown, ZoomIn, ZoomOut } from '@element-plus/icons-vue';
import CatchIcon from '@/assets/nodeMap/catch.svg';
import SelectIcon from '@/assets/nodeMap/select.svg';
import { MEDICINE_OPERATE_ADD_NODE_TEMPLATES } from '@/views/workOrder/addNodeTemplates';
import { ENV } from '@/env';

defineOptions({
    name: 'NodeMindMapEditorHeader'
});

defineProps<{
    autoLayoutDisabled: boolean;
    undoDisabled: boolean;
    mindMapZoomPercent: number;
    stickyPanMode: boolean;
}>();

const emit = defineEmits<{
    addInitNode: [];
    addFromTemplate: [index: number];
    printToConsole: [];
    autoLayout: [];
    undo: [];
    zoomAdjust: [direction: -1 | 1];
    resetView: [];
    togglePan: [];
    preview: [];
    export: [];
    aiGenerate: [];
}>();

function onTemplateCommand(cmd: string | number) {
    emit('addFromTemplate', Number(cmd));
}

/** 切换后失焦，避免空格触发 button 原生 click 再次切换 */
function onTogglePanClick(e: MouseEvent) {
    emit('togglePan');
    (e.currentTarget as HTMLButtonElement | null)?.blur();
}
</script>

<template>
    <div class="editor-header">
        <div class="tools">
            <el-button type="primary" @click="emit('addInitNode')">
                新建起始节点
            </el-button>
            <el-dropdown
                trigger="click"
                popper-class="dropdownSelect"
                @command="onTemplateCommand"
            >
                <el-button type="primary" class="el-button-dropdown">
                    添加节点
                    <el-icon class="el-icon--right">
                        <ArrowDown />
                    </el-icon>
                </el-button>
                <template #dropdown>
                    <el-dropdown-menu style="border-radius: 16px">
                        <el-dropdown-item
                            v-for="(item, index) in MEDICINE_OPERATE_ADD_NODE_TEMPLATES"
                            :key="item.name"
                            :command="index"
                        >
                            <span>{{ item.name }}</span>
                        </el-dropdown-item>
                    </el-dropdown-menu>
                </template>
            </el-dropdown>
            <el-button v-if="ENV === 'qa'" @click="emit('printToConsole')">打印到控制台</el-button>
            <el-button
                :disabled="autoLayoutDisabled"
                @click="emit('autoLayout')"
            >
                自动布局
            </el-button>
            <el-button :disabled="undoDisabled" @click="emit('undo')">
                撤销
            </el-button>
            <el-button type="success" @click="emit('aiGenerate')">
                AI 生成
            </el-button>
        </div>
        <div class="tools tools--header-end">
            <div class="vision">
                <div
                    class="node-mm-zoom-bar"
                    role="toolbar"
                    aria-label="画布缩放"
                >
                    <button
                        type="button"
                        class="node-mm-zoom-bar__btn"
                        aria-label="缩小"
                        @click="emit('zoomAdjust', -1)"
                    >
                        <el-icon>
                            <ZoomOut />
                        </el-icon>
                    </button>
                    <button
                        type="button"
                        class="node-mm-zoom-bar__pct"
                        title="重置缩放与位移"
                        @click="emit('resetView')"
                    >
                        {{ mindMapZoomPercent }}%
                    </button>
                    <button
                        type="button"
                        class="node-mm-zoom-bar__btn"
                        aria-label="放大"
                        @click="emit('zoomAdjust', 1)"
                    >
                        <el-icon>
                            <ZoomIn />
                        </el-icon>
                    </button>
                </div>
                <el-tooltip
                    content="选择/抓手工具"
                    placement="bottom"
                >
                    <button
                        type="button"
                        class="node-mm-tool-btn"
                        :class="{ 'node-mm-tool-btn--pan': stickyPanMode }"
                        :aria-label="stickyPanMode ? '抓手' : '选择'"
                        @click="onTogglePanClick"
                        @keydown.space.prevent
                        @keyup.space.prevent
                    >
                        <img
                            v-if="stickyPanMode"
                            :src="CatchIcon"
                            alt=""
                            class="node-mm-tool-btn__icon node-mm-tool-btn__icon--catch"
                        />
                        <img
                            v-else
                            :src="SelectIcon"
                            alt=""
                            class="node-mm-tool-btn__icon node-mm-tool-btn__icon--select"
                        />
                        <span class="node-mm-tool-btn__text">
                            {{ stickyPanMode ? '抓手' : '选择' }}
                        </span>
                    </button>
                </el-tooltip>
            </div>
            <div class="divider"></div>
            <el-button @click="emit('preview')">
                预览
            </el-button>
            <el-button type="primary" @click="emit('export')">
                导出 JSON
            </el-button>
        </div>
    </div>
</template>

<style lang="scss" scoped>
.editor-header {
    z-index: 1000;
    position: absolute;
    width: 100%;
    padding: 16px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    pointer-events: none;
    background-color: #fff;
    border-bottom: 1px solid #e4e3f0;
    .editor-title {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: var(--el-text-color-primary);
        pointer-events: none;
    }
    :deep(.el-button) {
        pointer-events: auto;
    }
}
:deep(.el-button) {
  margin: 0;
}
:deep(.el-button--primary) {
  background: #1A55E9;
}
:deep(.el-button--large) {
  padding: 10px 34px !important;
}
:deep(.el-button--primary:active) {
  background: #1A55E9;
}
:deep(.el-button--primary:focus) {
  background: #1A55E9;
}
:deep(.el-button--primary:focus-visible) {
  background: #1A55E9;
}
.el-button-dropdown {
  padding: 10px 24px !important;
}
.tools {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: center;
}
.tools--header-end {
    flex-wrap: nowrap;
}
.vision {
    display: inline-flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 10px;
    pointer-events: auto;
}
.node-mm-zoom-bar {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid rgb(228 227 240 / 0.95);
    background: linear-gradient(to bottom, #f9fafc 0%, #eef1f6 100%);
    box-shadow:
        0 0 0 0.5px rgb(255 255 255 / 0.9) inset,
        0 1px 2px rgb(15 23 42 / 0.04);
}
.node-mm-zoom-bar__btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    margin: 0;
    padding: 0;
    border: none;
    border-radius: 10px;
    background: transparent;
    cursor: pointer;
    color: rgb(61 69 89);
    &:hover {
        background: rgb(14 19 32 / 0.06);
    }
    &:focus-visible {
        outline: 2px solid rgb(26 85 233 / 0.45);
        outline-offset: 1px;
    }
}
.node-mm-zoom-bar__pct {
    min-width: 48px;
    margin: 0;
    padding: 0 6px;
    border: none;
    border-radius: 8px;
    background: transparent;
    font-weight: 600;
    font-size: 14px;
    line-height: 32px;
    color: rgb(26 31 46);
    cursor: pointer;
    &:hover {
        color: #1a55e9;
        background: rgb(26 85 233 / 0.06);
    }
    &:focus-visible {
        outline: 2px solid rgb(26 85 233 / 0.45);
        outline-offset: 1px;
    }
}
.node-mm-tool-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 40px;
    padding: 0 14px;
    margin: 0;
    border-radius: 999px;
    border: 1px solid rgb(228 227 240 / 0.95);
    background: linear-gradient(to bottom, #fefefe 0%, #f4f5f8 100%);
    box-shadow: 0 1px 2px rgb(15 23 42 / 0.04);
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    color: rgb(61 69 89);
    &:hover {
        border-color: rgb(26 85 233 / 0.35);
        // color: #1a55e9;
    }
    &:focus-visible {
        outline: 2px solid rgb(26 85 233 / 0.45);
        outline-offset: 1px;
    }
    &--pan {
        border-color: #1a55e9;
        background: rgb(26 85 233 / 0.09);
        // color: #1a55e9;
    }
}
.node-mm-tool-btn__icon {
    display: block;
    pointer-events: none;
    &--select {
        width: 14px;
        height: 14px;
    }
    &--catch {
        width: 14px;
        height: 14px;
    }
}
.node-mm-tool-btn__text {
    line-height: 1;
}
.divider {
    width: 1px;
    height: 40px;
    margin: 0 15px;
    background-color: #e4e3f0;
}
</style>
