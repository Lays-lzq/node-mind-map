<script setup lang="ts" name="StyledConfirmDialog">
    import { onUnmounted, watch } from 'vue';
    import Dialog from '@/components/Dialog/index.vue';

    withDefaults(
        defineProps<{
            /** 主操作按钮：`submit` 蓝色，`danger` 红色 */
            primaryVariant?: 'submit' | 'danger';
            confirmText?: string;
            cancelText?: string;
        }>(),
        {
            primaryVariant: 'danger',
            confirmText: '确定',
            cancelText: '取消'
        }
    );

    const visible = defineModel<boolean>({ required: true });

    const emit = defineEmits<{
        confirm: [];
        cancel: [];
    }>();

    function onConfirm() {
        emit('confirm');
    }

    function onCancel() {
        visible.value = false;
        emit('cancel');
    }

    function handleEnterKey(e: KeyboardEvent) {
        if (e.key !== 'Enter' || !visible.value) return;
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
        e.preventDefault();
        onConfirm();
    }

    watch(visible, (isOpen) => {
        if (isOpen) {
            document.addEventListener('keydown', handleEnterKey);
        } else {
            document.removeEventListener('keydown', handleEnterKey);
        }
    });

    onUnmounted(() => {
        document.removeEventListener('keydown', handleEnterKey);
    });
</script>

<template>
    <Dialog
        v-model="visible"
        :style="{
            width: '420px',
            borderRadius: '8px'
        }"
        :showHeader="false"
    >
        <div class="styled-confirm-dialog">
            <slot />
            <el-divider />
            <div class="actionContent" style="margin: 0">
                <el-button :class="['btnItem', primaryVariant]" @click="onConfirm">
                    {{ confirmText }}
                </el-button>
                <el-button class="btnItem cancel" @click="onCancel">
                    {{ cancelText }}
                </el-button>
            </div>
        </div>
    </Dialog>
</template>

<style lang="scss" scoped>
    .styled-confirm-dialog {
        color: #111315;
        font-weight: 400;
        font-size: 18px;
        line-height: 34px;

        .actionContent {
            display: flex;
            align-items: center;
            gap: 10px;

            .btnItem {
                flex: 1;
                border-radius: 8px;

                &.submit {
                    background: #1c6ba4;
                    color: #fff;
                }
                &.cancel {
                    background: none;
                    color: #1c6ba4;
                    border: 2px solid #d9dfe9;
                }
                &.danger {
                    background: #f73859;
                    color: #fff;
                }
            }
        }
    }
</style>
