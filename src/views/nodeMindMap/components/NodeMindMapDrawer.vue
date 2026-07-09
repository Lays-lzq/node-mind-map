<script setup lang="ts">
import type { UploadFile } from 'element-plus';
import { Delete, Plus, Upload } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { ensureGuideCollectionsFor, toLinkIdStringArray } from '../ts/medicineGuide';
import {
    getNodeGuideValidation,
    NODE_GUIDE_VALIDATION_BADGE_FILL
} from '../ts/mindMapNodeGuideValidation';

const guideValidationColor = NODE_GUIDE_VALIDATION_BADGE_FILL;

defineOptions({
    name: 'NodeMindMapDrawer'
});

interface DrawerVideoItem {
    key: string;
    title: string;
    value: string;
    img?: string;
}

export type { DrawerVideoItem };

const props = defineProps<{
    /** 当前画布节点（与 nodeList 项同一引用） */
    node: Record<string, any> | null;
    videoDataList: DrawerVideoItem[];
}>();

const emit = defineEmits<{
    deleteNode: [nodeId: number];
    blurSave: [];
}>();

function onGuideFieldBlur() {
    if (!props.node?.guide) return;
    emit('blurSave');
}

const drawerTitle = computed(() =>
    props.node ? `节点 ${props.node.nodeId}` : '节点详情'
);

const guideValidation = computed(() =>
    getNodeGuideValidation(props.node?.guide)
);

/** 上一节点 ID（string[]，与工单 prevNodeIDs 一致） */
const displayPrevNodeIDs = computed(() => {
    const ids = props.node
        ? toLinkIdStringArray(props.node.prevNodes ?? props.node.prevNodeIDs)
        : [];
    return ids.length ? ids.join('、') : '无';
});

/** 下一节点 ID（string[]，与工单 nextNodeIDs 一致） */
const displayNextNodeIDs = computed(() => {
    const ids = props.node
        ? toLinkIdStringArray(props.node.nextNodes ?? props.node.nextNodeIDs)
        : [];
    return ids.length ? ids.join('、') : '无';
});

const videoPickVisible = ref(false);
const videoPickSelection = ref<string[]>([]);

const videoDataMap = computed(() => {
    const m = new Map<string, DrawerVideoItem>();
    for (const v of props.videoDataList) m.set(v.key, v);
    return m;
});

function openVideoPicker() {
    if (!props.node) return;
    ensureGuideCollectionsFor(props.node.guide);
    videoPickSelection.value = [...props.node.guide.operationTypes.map(String)];
    videoPickVisible.value = true;
}

function confirmVideoPicker() {
    if (!props.node || !videoPickVisible.value) return;
    // 先快照再关弹窗，避免关闭后二次点击把 operationTypes 写成 []
    const selection = [...videoPickSelection.value].sort((a, b) => +a - +b);
    videoPickVisible.value = false;
    props.node.guide.operationTypes = selection;
}

function handleVideoPickEnterKey(e: KeyboardEvent) {
    if (e.key !== 'Enter' || !videoPickVisible.value) return;
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
    e.preventDefault();
    e.stopPropagation();
    confirmVideoPicker();
}

watch(videoPickVisible, (isOpen) => {
    if (isOpen) {
        document.addEventListener('keydown', handleVideoPickEnterKey);
    } else {
        document.removeEventListener('keydown', handleVideoPickEnterKey);
    }
});

onUnmounted(() => {
    document.removeEventListener('keydown', handleVideoPickEnterKey);
});

function removeOperationType(idx: number) {
    props.node?.guide.operationTypes?.splice(idx, 1);
}

function operationTypeDisplay(key: string) {
    const v = videoDataMap.value.get(String(key));
    return v ? `${v.key}.${v.title}` : key;
}

const drawerImgMime = ['image/png', 'image/jpeg', 'image/jpg'];
/** 目标参考图 / 异常参考图各最多张数 */
const MAX_DIAGRAM_IMAGES = 4;

async function handleDrawerImageUpload(
    file: UploadFile,
    urlField: 'targetDiagramUrl' | 'abnormalDiagramUrl'
) {
    if (!props.node?.guide) return;
    ensureGuideCollectionsFor(props.node.guide);
    const g = props.node.guide;
    const current = g[urlField]?.length ?? 0;
    if (current >= MAX_DIAGRAM_IMAGES) {
        ElMessage.warning(`最多上传 ${MAX_DIAGRAM_IMAGES} 张图片`);
        return;
    }
    const raw = file.raw;
    if (!raw) return;
    if (!drawerImgMime.includes(raw.type)) {
        ElMessage.error('请上传 JPG、PNG 格式图片');
        return;
    }
    if (raw.size > 20 * 1024 * 1024) {
        ElMessage.error('图片不能超过 20MB');
        return;
    }
    g[urlField].push(URL.createObjectURL(raw));
}

function removeDrawerImage(
    idx: number,
    urlField: 'targetDiagramUrl' | 'abnormalDiagramUrl'
) {
    const g = props.node?.guide;
    if (!g?.[urlField]?.[idx]) return;
    g[urlField].splice(idx, 1);
}

function onDrawerTargetUpload(file: UploadFile) {
    handleDrawerImageUpload(file, 'targetDiagramUrl');
}

function onDrawerAbnormalUpload(file: UploadFile) {
    handleDrawerImageUpload(file, 'abnormalDiagramUrl');
}

function handleDeleteNode(nodeId: number) {
  emit('deleteNode', nodeId);
}
</script>

<template>
    <aside class="node-mind-map-side-panel">
        <!-- <div class="node-drawer-header-bar">
            <div class="node-drawer-header-bar__left">
                <h3 class="node-drawer-heading">
                    {{ drawerTitle }}
                </h3>
                <p
                    v-if="node"
                    class="node-drawer-lead"
                >
                    编辑后失焦将自动保存
                </p>
            </div>
        </div> -->

        <div
            v-if="!node"
            class="node-drawer-empty"
        >
            <h4 class="node-drawer-empty__title">节点参数</h4>
            <el-empty description="选择画布上的节点以编辑详情" />
        </div>

        <template v-else>
            <div class="node-drawer-scroll nd-sheet">
                <div class="nd-field">
                    <div class="nd-field-label">
                        当前节点
                    </div>
                    <div class="nd-readonly-row">
                        {{ `节点 ${node.nodeId}` }}
                    </div>
                </div>

                <div class="nd-field">
                    <div class="nd-field-label nd-field-label--muted">
                        上一节点 ID
                    </div>
                    <div class="nd-readonly-row">
                        {{ displayPrevNodeIDs }}
                    </div>
                </div>
                <div class="nd-field">
                    <div class="nd-field-label nd-field-label--muted">
                        下一节点 ID
                    </div>
                    <div class="nd-readonly-row">
                        {{ displayNextNodeIDs }}
                    </div>
                </div>

                <div class="nd-field">
                    <div class="nd-field-label-row nd-field-label-row--inline">
                        <span class="nd-field-required" aria-hidden="true">*</span>
                        <span class="nd-field-label">操作描述</span>
                        <span v-if="guideValidation.operationDescEmpty" class="nd-guide-validation-badge" aria-hidden="true">!</span>
                    </div>
                    <el-input
                        v-model="node.guide.operationDesc"
                        :class="{ 'nd-input--error': guideValidation.operationDescEmpty }"
                        type="textarea"
                        :autosize="{ minRows: 7, maxRows: 14 }"
                        placeholder="请输入"
                        maxlength="1000"
                        show-word-limit
                        @blur="onGuideFieldBlur"
                    />
                    <p
                        v-if="guideValidation.operationDescEmpty"
                        class="nd-field-error"
                    >
                        操作描述不能为空
                    </p>
                </div>

                <div class="nd-field">
                    <div class="nd-field-label-row">
                        <span class="nd-field-label">操作素材编号</span>
                        <el-button
                            type="primary"
                            link
                            class="nd-link-add"
                            @click="openVideoPicker"
                        >
                            <el-icon><Plus /></el-icon>
                            添加
                        </el-button>
                    </div>
                    <div class="nd-mat-list">
                        <template v-if="node.guide.operationTypes?.length">
                            <div
                                v-for="(opKey, mi) in node.guide.operationTypes"
                                :key="'op-' + mi + '-' + opKey"
                                class="nd-mat-row"
                            >
                                <span class="nd-mat-text">{{
                                    operationTypeDisplay(String(opKey))
                                }}</span>
                                <el-button
                                    link
                                    type="danger"
                                    class="nd-mat-del"
                                    @click="removeOperationType(Number(mi))"
                                >
                                    <el-icon><Delete /></el-icon>
                                </el-button>
                            </div>
                        </template>
                        <div
                            v-else
                            class="nd-mat-placeholder"
                        >
                            暂未选择素材，点击右上方添加
                        </div>
                    </div>
                </div>

                <div class="nd-field">
                    <div class="nd-field-label">
                        目标描述
                    </div>
                    <el-input
                        v-model="node.guide.targetDesc"
                        type="textarea"
                        :autosize="{ minRows: 5, maxRows: 12 }"
                        placeholder="请输入"
                        maxlength="1000"
                        show-word-limit
                        @blur="onGuideFieldBlur"
                    />
                </div>

                <div class="nd-field">
                    <div class="nd-field-label">
                        目标参考图
                    </div>
                    <el-upload
                        v-if="
                            (node.guide.targetDiagramUrl?.length ?? 0) <
                            MAX_DIAGRAM_IMAGES
                        "
                        class="nd-uploader"
                        drag
                        :show-file-list="false"
                        :auto-upload="false"
                        accept=".png,.jpg,.jpeg,.PNG,.JPG,.JPEG"
                        :on-change="onDrawerTargetUpload"
                    >
                        <el-icon class="nd-uploader-ico"><Upload /></el-icon>
                        <div class="nd-uploader-title">
                            点击上传图片
                        </div>
                        <div class="nd-uploader-tip">
                            支持 JPG、PNG，单张不超 20MB，最多
                            {{ MAX_DIAGRAM_IMAGES }} 张
                        </div>
                    </el-upload>
                    <p
                        v-else
                        class="nd-uploader-limit"
                    >
                        已达上限（{{ MAX_DIAGRAM_IMAGES }} 张），请删除后再上传
                    </p>
                    <div
                        v-if="node.guide.targetDiagramUrl?.length"
                        class="nd-thumb-strip"
                    >
                        <div
                            v-for="(img, ti) in node.guide.targetDiagramUrl"
                            :key="'t-img-' + ti"
                            class="nd-thumb-cell"
                        >
                            <el-image
                                :src="img"
                                :alt="img"
                                class="nd-thumb-img"
                                fit="cover"
                                :preview-src-list="node.guide.targetDiagramUrl"
                                :initial-index="Number(ti)"
                                :hide-on-click-modal="true"
                            />
                            <button
                                type="button"
                                class="nd-thumb-remove"
                                @click="
                                    removeDrawerImage(
                                        Number(ti),
                                        'targetDiagramUrl'
                                    )
                                "
                            >
                                <el-icon>
                                    <Delete />
                                </el-icon>
                            </button>
                        </div>
                    </div>
                </div>

                <div class="nd-field">
                    <div class="nd-field-label">
                        监控要点
                    </div>
                    <el-input
                        v-model="node.guide.monitoringDesc"
                        type="textarea"
                        :autosize="{ minRows: 7, maxRows: 14 }"
                        placeholder="请输入"
                        maxlength="1000"
                        show-word-limit
                        @blur="onGuideFieldBlur"
                    />
                </div>

                <div class="nd-field">
                    <div class="nd-field-label">
                        监控要点未达成描述
                    </div>
                    <el-input
                        v-model="node.guide.monitorUndoneDesc"
                        type="textarea"
                        :autosize="{ minRows: 7, maxRows: 14 }"
                        placeholder="请输入"
                        maxlength="1000"
                        show-word-limit
                        @blur="onGuideFieldBlur"
                    />
                </div>

                <div class="nd-field">
                    <div class="nd-field-label">
                        异常描述
                    </div>
                    <el-input
                        v-model="node.guide.abnormalDesc"
                        type="textarea"
                        :autosize="{ minRows: 5, maxRows: 12 }"
                        placeholder="请输入"
                        maxlength="1000"
                        show-word-limit
                        @blur="onGuideFieldBlur"
                    />
                </div>

                <div class="nd-field">
                    <div class="nd-field-label">
                        异常参考图
                    </div>
                    <el-upload
                        v-if="
                            (node.guide.abnormalDiagramUrl?.length ?? 0) <
                            MAX_DIAGRAM_IMAGES
                        "
                        class="nd-uploader"
                        drag
                        :show-file-list="false"
                        :auto-upload="false"
                        accept=".png,.jpg,.jpeg,.PNG,.JPG,.JPEG"
                        :on-change="onDrawerAbnormalUpload"
                    >
                        <el-icon class="nd-uploader-ico"><Upload /></el-icon>
                        <div class="nd-uploader-title">
                            点击上传图片
                        </div>
                        <div class="nd-uploader-tip">
                            支持 JPG、PNG，单张不超 20MB，最多
                            {{ MAX_DIAGRAM_IMAGES }} 张
                        </div>
                    </el-upload>
                    <p
                        v-else
                        class="nd-uploader-limit"
                    >
                        已达上限（{{ MAX_DIAGRAM_IMAGES }} 张），请删除后再上传
                    </p>
                    <div
                        v-if="node.guide.abnormalDiagramUrl?.length"
                        class="nd-thumb-strip"
                    >
                        <div
                            v-for="(img, ai) in node.guide.abnormalDiagramUrl"
                            :key="'a-img-' + ai"
                            class="nd-thumb-cell"
                        >
                            <el-image
                                :src="img"
                                :alt="img"
                                class="nd-thumb-img"
                                fit="cover"
                                :preview-src-list="node.guide.abnormalDiagramUrl"
                                :initial-index="Number(ai)"
                                :hide-on-click-modal="true"
                            />
                            <button
                                type="button"
                                class="nd-thumb-remove"
                                @click="
                                    removeDrawerImage(
                                        Number(ai),
                                        'abnormalDiagramUrl'
                                    )
                                "
                            >
                                <el-icon><Delete /></el-icon>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="node-drawer-delete-button">
              <el-button
                class="node-drawer-delete-button-btn"
                type="danger"
                plain
                @click="handleDeleteNode(node.nodeId)"
              >
                删除
              </el-button>
            </div>
        </template>
    </aside>

    <el-dialog
        v-model="videoPickVisible"
        title="选择操作视频"
        width="440px"
        append-to-body
        class="nd-video-dialog-el"
    >
        <div class="nd-video-dialog-body">
            <el-checkbox-group
                v-if="videoDataList.length"
                v-model="videoPickSelection"
            >
                <div
                    v-for="v in videoDataList"
                    :key="v.key"
                    class="nd-video-line"
                >
                    <el-checkbox :label="v.key">
                        {{ v.key }}.{{ v.title }}
                    </el-checkbox>
                </div>
            </el-checkbox-group>
            <el-empty
                v-else
                description="暂无素材数据"
            />
        </div>
        <template #footer>
            <el-button @click="videoPickVisible = false">
                取消
            </el-button>
            <el-button
                type="primary"
                @click="confirmVideoPicker"
            >
                确定
            </el-button>
        </template>
    </el-dialog>
</template>

<style lang="scss" scoped>
.node-mind-map-side-panel {
    flex: 0 0 360px;
    width: 360px;
    padding-top: 75px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--el-bg-color);
    border-left: 1px solid #E4E3F0;
    // box-shadow: -4px 0 24px rgba(0, 0, 0, 0.08);
    overflow: hidden;
}

.node-drawer-empty {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    padding: 16px 20px 28px;
    overflow-y: auto;
    :deep(.el-empty) {
        height: 80%;
    }
}

.node-drawer-empty__title {
    margin: 0 0 12px;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.35;
    color: #000000;
}

$nd-field-bg: #f2f2f2;

.node-drawer-header-bar {
    flex-shrink: 0;
    width: 100%;
    padding: 16px 20px 14px;
    background: var(--el-bg-color);
    border-bottom: 1px solid #eee;
}
.node-drawer-header-bar__left {
    min-width: 0;
}
.node-drawer-heading {
    margin: 0 0 4px;
    font-size: 17px;
    font-weight: 700;
    color: var(--el-text-color-primary);
    line-height: 1.35;
}
.node-drawer-lead {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
    color: var(--el-text-color-secondary);
}

.node-drawer-scroll.nd-sheet {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 16px 20px 28px;
    box-sizing: border-box;
}

.nd-field {
    margin-bottom: 20px;

    &:last-child {
        margin-bottom: 0;
    }

    &--error .nd-field-label {
        color: v-bind(guideValidationColor);
    }
}

.nd-field-error {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.4;
    color: v-bind(guideValidationColor);
}


.nd-field-required {
    color: #ff4d4f;
    font-size: 14px;
    line-height: 1.35;
}

.nd-field-label {
    margin-bottom: 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    line-height: 1.35;
}

.nd-field-label--muted {
    font-weight: 500;
    color: var(--el-text-color-secondary);
}

.nd-field-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;

    .nd-field-label {
        margin-bottom: 0;
    }

    &--inline {
        justify-content: flex-start;
        gap: 6px;
    }
}

.nd-guide-validation-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: v-bind(guideValidationColor);
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    border: 1.5px solid #fff;
    cursor: default;
    flex-shrink: 0;
}

.nd-link-add.el-button {
    padding: 0;
    height: auto;
    font-weight: 500;
    font-size: 14px;

    &, &:hover {
        color: #4080ff;
    }
}

.nd-readonly-row {
    padding: 10px 12px;
    border-radius: 6px;
    background: $nd-field-bg;
    font-size: 14px;
    line-height: 1.55;
    color: var(--el-text-color-placeholder);
    word-break: break-all;
}

.nd-el {
    width: 100%;

    :deep(.el-input__wrapper) {
        background-color: $nd-field-bg !important;
        border: none !important;
        box-shadow: none !important;
        border-radius: 6px;
        padding: 10px 12px;
        min-height: 40px;
    }

    :deep(.el-input__wrapper.is-focus) {
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06) inset !important;
    }

    :deep(.el-input.is-disabled .el-input__wrapper) {
        opacity: 1;
        cursor: default;
    }

    :deep(.el-textarea__inner) {
        background-color: $nd-field-bg !important;
        border: none !important;
        box-shadow: none !important;
        border-radius: 6px;
        padding: 10px 12px;
        resize: vertical;
        line-height: 1.55;
    }

    :deep(.el-textarea .el-input__count) {
        background: transparent;
        color: var(--el-text-color-placeholder);
        font-size: 12px;
    }

    :deep(.el-textarea__inner:focus) {
        outline: none;
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06) inset !important;
    }
}

.nd-mat-list {
    margin-top: 0;
    border-radius: 6px;
    background: $nd-field-bg;
    padding: 4px 10px;
    min-height: 48px;
    box-sizing: border-box;
}

.nd-mat-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 2px;

    &:not(:last-child) {
        border-bottom: 1px solid rgba(0, 0, 0, 0.06);
    }
}

.nd-mat-text {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    color: var(--el-text-color-primary);
    word-break: break-all;
}

.nd-mat-del.el-button.is-link {
    flex-shrink: 0;
    padding: 4px;

    &, &:hover {
        color: #ff4d4f;
    }
}

.nd-mat-placeholder {
    padding: 10px 2px;
    font-size: 13px;
    line-height: 1.45;
    color: var(--el-text-color-placeholder);
}

.nd-uploader {
    width: 100%;

    :deep(.el-upload) {
        width: 100%;
    }

    :deep(.el-upload-dragger) {
        width: 100%;
        padding: 28px 16px;
        border: 1px dashed #c9c9c9;
        background: #fafafa;
        border-radius: 6px;
        transition:
            border-color 0.15s ease,
            background 0.15s ease;
    }

    :deep(.el-upload-dragger:hover) {
        border-color: #4080ff;
        background: #f5f8ff;
    }
}

.nd-uploader-ico {
    margin-bottom: 8px;
    font-size: 36px;
    color: var(--el-text-color-secondary);
}

.nd-uploader-title {
    margin-bottom: 4px;
    font-size: 14px;
    color: var(--el-text-color-primary);
}


.nd-uploader-limit {
    margin: 0 0 12px;
    padding: 10px 12px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--el-text-color-secondary);
    background: var(--el-fill-color-light);
    border-radius: 8px;
}

.nd-uploader-tip {
    font-size: 12px;
    line-height: 1.45;
    color: var(--el-text-color-secondary);
}

.nd-thumb-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 14px;
}

.nd-thumb-cell {
    position: relative;
    flex: 0 0 auto;
    width: 96px;
    height: 96px;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid rgba(0, 0, 0, 0.06);
    background: var(--el-fill-color-blank);
}

.nd-thumb-img {
    display: block;
    width: 100%;
    height: 100%;
    cursor: zoom-in;

    :deep(.el-image__inner) {
        width: 100%;
        height: 100%;
    }
}

.nd-thumb-remove {
    position: absolute;
    top: 4px;
    right: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.45);
    color: #fff;
    cursor: pointer;
    transition: background 0.15s ease;

    &:hover {
        background: rgba(0, 0, 0, 0.62);
    }

    .el-icon {
        font-size: 16px;
    }
}

.nd-video-dialog-body {
    max-height: 52vh;
    overflow-y: auto;
}

.nd-video-line {
    padding: 6px 0;
    border-bottom: 1px solid var(--el-border-color-lighter);

    &:last-child {
        border-bottom: none;
    }
}
.node-drawer-delete-button {
    flex-shrink: 0;
    padding: 16px 20px 14px;
    border-top: 1px solid #eee;
    text-align: center;
    .node-drawer-delete-button-btn {
      width: 100%;
    }
}
.nd-input--error :deep(.el-textarea__inner),
.nd-input--error :deep(.el-textarea__inner:focus) {
    box-shadow: 0 0 0 1px v-bind(guideValidationColor) inset;
}
</style>


