<script setup lang="ts" name="NodeMindMapPreviewDialog">
import Dialog from '@/components/Dialog/index.vue';
import Guide from './Guide/guide.vue';
import type { DrawerVideoItem } from './NodeMindMapDrawer.vue';

const props = withDefaults(
    defineProps<{
        nodes?: any[];
        previewLogKey?: number;
        videoDataList?: DrawerVideoItem[];
        previewType?: 'step' | '';
    }>(),
    {
        nodes: () => [],
        previewLogKey: 0,
        videoDataList: () => [],
        previewType: ''
    }
);

const visible = defineModel<boolean>({ required: true });

watch(
    () => visible.value,
    (isVisible) => {
        if (!isVisible) return;
        console.log('[NodeMindMapPreviewDialog] 当前节点信息:', props.nodes);
    }
);
</script>

<template>
    <Dialog
        v-model="visible"
        title="预览"
        :style="{
            width: '1860px',
            height: '80%',
            borderRadius: '8px'
        }"
        :close-on-click-modal="true"
    >
        <div class="node-mind-map-preview-dialog">
            <Guide
                :nodes="nodes"
                :preview-log-key="previewLogKey"
                :video-data-list="videoDataList"
                :preview-type="previewType"
            />
        </div>
    </Dialog>
</template>

<style lang="scss" scoped>
.node-mind-map-preview-dialog {
    display: flex;
    flex: 1;
    min-height: 0;
    border-top: 1px solid #d9dfe9;
}

:deep(.el-dialog) {
    display: flex;
    flex-direction: column;
}

:deep(.el-dialog__body) {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    padding: 0px !important;
}

:deep(.dialog-content) {
    display: flex;
    flex: 1;
    min-height: 0;
}
// :deep(.el-dialog__body) {
    
// }
</style>
