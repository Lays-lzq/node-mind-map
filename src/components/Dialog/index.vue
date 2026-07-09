<script setup lang="ts" name="Dialog">
    import { type CSSProperties } from 'vue';
    import { CloseBold } from '@element-plus/icons-vue';

    const emits = defineEmits([
        'update:modelValue',
        'confirm',
        'cancel',
        'closed'
    ]);

    const props = defineProps({
        modelValue: {
            type: Boolean,
            default: false,
            required: true
        },
        style: {
            type: Object as PropType<CSSProperties>,
            default: () => ({})
        },
        title: {
            type: String,
            default: ''
        },
        showHeader: {
            type: Boolean,
            default: true
        },
        closeOnClickModal: {
            type: Boolean,
            default: false
        },
        destroyOnClose: {
            type: Boolean,
            default: true
        }
    });

    const value = computed({
        get: () => props.modelValue,
        set: (v: boolean) => emits('update:modelValue', v)
    });

    function close() {
        emits('update:modelValue', false);
    }
</script>
<template>
    <div class="dialog-box">
        <el-dialog
            v-model="value"
            :show-close="false"
            :style="style"
            :close-on-click-modal="closeOnClickModal"
            :close-on-press-escape="false"
            :destroy-on-close="destroyOnClose"
            @closed="() => emits('closed')"
        >
            <div v-if="showHeader" class="dialog-header flex">
                <slot name="header">
                    <span>{{ title }}</span>
                    <el-icon @click="close">
                        <CloseBold />
                    </el-icon>
                </slot>
            </div>
            <div class="dialog-content">
                <slot name="default"></slot>
            </div>
        </el-dialog>
    </div>
</template>
<style lang="scss" scoped>
    $text-color: #111315;
    .dialog-box {
        :deep(.el-dialog) {
            padding: 4px 16px;
            .el-dialog__header {
                display: none;
            }
        }
        .dialog-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            color: $text-color;
            margin-bottom: 15px;
            span {
                font-size: 18px;
                font-weight: 700;
                line-height: 34px;
            }
            i {
                font-size: 18px;
                cursor: pointer;
            }
        }
        .dialog-content {
            font-size: 18px;
            font-weight: 400;
            line-height: 34px;
            text-align: center;
            color: $text-color;
        }
    }
</style>
