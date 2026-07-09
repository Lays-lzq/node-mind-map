<script setup lang="ts" name="PreviewModal">
    import { Close } from '@element-plus/icons-vue';
    import PlayFill from '@/assets/svg/PlayFill.svg';
    import Pause from '@/assets/svg/Pause.svg';

    defineProps({
        type: {
            type: String,
            default: 'img'
        },
        src: {
            type: String,
            default: ''
        },
        cover: {
            type: String,
            default: ''
        },
        alt: {
            type: String,
            default: ''
        },
        style: {
            type: Object,
            default: () => ({})
        },
        width: {
            type: Number,
            default: 100
        },
        height: {
            type: Number
        },
        showClose: {
            type: Boolean,
            default: true
        }
    });

    const isShow = ref(false);
    const videoRef = ref<HTMLVideoElement | null>(null);
    const videoStatus = ref<0 | 1>(0); // 0: 暂停 1: 播放

    const showControlsBtn = ref(true);

    let hideBtnTimer: ReturnType<typeof setTimeout> | null = null;

    const videoHandle = () => {
        if (!videoRef.value) return;

        if (videoRef.value.paused) {
            videoRef.value.play();
        } else {
            videoRef.value.pause();
        }
    };

    const onPlay = () => {
        videoStatus.value = 1;
        showControlsBtn.value = true;
        if (hideBtnTimer) clearTimeout(hideBtnTimer);
        hideBtnTimer = setTimeout(() => {
            showControlsBtn.value = false;
        }, 500);
    };

    const onPause = () => {
        videoStatus.value = 0;
        showControlsBtn.value = true;
        if (hideBtnTimer) clearTimeout(hideBtnTimer);
    };

    const onVideoMouseMove = () => {
        if (videoStatus.value === 0 || showControlsBtn.value) return;
        showControlsBtn.value = true;
        if (hideBtnTimer) clearTimeout(hideBtnTimer);
        hideBtnTimer = setTimeout(() => {
            showControlsBtn.value = false;
        }, 2000);
    };

    const onVideoMouseLeave = () => {
        if (videoStatus.value === 0) return;
        if (hideBtnTimer) clearTimeout(hideBtnTimer);
        showControlsBtn.value = false;
    };
</script>

<template>
    <div class="preview">
        <el-image
            v-if="type === 'img'"
            :src="src"
            :alt="alt"
            :style="{
                ...style,
                width: `${width}px`,
                height: height ? `${height}px` : 'auto'
            }"
            fit="cover"
            class="img"
            @click="isShow = true"
        />
        <template v-else-if="type === 'video'">
            <img
                :src="cover"
                :style="{
                    ...style
                }"
                class="video-cover"
            />
            <div class="video-overlap flex" @click="isShow = true">
                <div class="play-btn flex">
                    <img :src="PlayFill" alt="" />
                </div>
            </div>
        </template>
        <transition name="fade">
            <div class="mask" v-if="isShow">
                <el-button
                    v-if="showClose"
                    :icon="Close"
                    size="large"
                    circle
                    class="close"
                    @click="isShow = false"
                />
                <img
                    v-if="type === 'img'"
                    :src="src"
                    :alt="alt"
                    class="modalImg"
                />
                <template v-else-if="type === 'video'">
                    <div
                        class="video-area"
                        style="position: relative; width: 100%; height: 100%"
                        @mousemove="onVideoMouseMove"
                        @mouseleave="onVideoMouseLeave"
                    >
                        <video
                            v-if="isShow"
                            ref="videoRef"
                            :src="src"
                            class="modalVideo"
                            controls
                            @play="onPlay"
                            @pause="onPause"
                        />
                        <transition name="fade">
                            <div
                                v-if="showControlsBtn"
                                class="play-btn video-controls flex"
                                @click.stop="videoHandle"
                            >
                                <img
                                    v-if="videoStatus === 0"
                                    :src="PlayFill"
                                    alt=""
                                />
                                <img v-else :src="Pause" alt="" />
                            </div>
                        </transition>
                    </div>
                </template>
            </div>
        </transition>
    </div>
</template>

<style scoped lang="scss">
    .preview {
        position: relative;
        .video-cover {
            display: block;
            width: 100%;
        }

        .video-overlap,
        .play-btn {
            justify-content: center;
            align-items: center;
        }

        .video-overlap {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(0, 0, 0, 0.2);
            cursor: pointer;
        }

        .play-btn {
            width: 64px;
            height: 64px;
            border-radius: 50%;
            background-color: rgba(0, 0, 0, 0.6);
            img {
                width: 24px;
                height: 24px;
            }
        }
    }

    .img {
        cursor: pointer;
    }

    .mask {
        position: fixed;
        width: 100vw;
        height: 100vh;
        top: 0;
        left: 0;
        z-index: 1000;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;

        .close {
            position: absolute;
            top: 20px;
            right: 20px;
            z-index: 999;
        }

        .modalImg {
            max-width: 100%;
            max-height: 100%;
            width: 100%;
            height: 100%;
            object-fit: contain;
        }

        .modalVideo {
            max-width: 100%;
            max-height: 100%;
            width: 100%;
            height: 100%;
        }

        .video-area {
            position: relative;
            width: 100%;
            height: 100%;
        }

        .video-controls {
            width: 96px;
            height: 96px;
            position: absolute;
            top: 50%;
            left: 50%;
            margin-top: -48px;
            margin-left: -48px;
            transition: opacity 0.3s ease;
            img {
                width: 42px;
                height: 42px;
            }
        }
    }

    .fade-enter-active,
    .fade-leave-active {
        transition: opacity 0.3s;
    }
    .fade-enter-from,
    .fade-leave-to {
        opacity: 0;
    }
    .fade-enter-to,
    .fade-leave-from {
        opacity: 1;
    }
</style>
