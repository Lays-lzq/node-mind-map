<script setup lang="ts" name="FocusContent">
import PreviewModal from '@/views/workOrder/components/PreviewModal.vue';

//import { VideoPlay } from '@element-plus/icons-vue';
import VideoPlay from '@/assets/cases/Play.svg';

type ImgType = {
    name: string;
    url: string;
};

interface FocusContentProps {
    content: string;
    type: string;
    width?: number;
    height?: number;
    src?: string;
    cover?: string;
    text?: string;
    img?: ImgType[] | string[];
}

const props = withDefaults(defineProps<FocusContentProps>(), {
    width: 360,
    height: 290,
    src: '',
    cover: '',
    text: '',
    img: (): ImgType[] | string[] => []
});

/**
 * 将带有#和##标记的字符串转换为标题层级结构
 * @param str 输入的字符串，格式为 #主标题##副标题##副标题#主标题##副标题
 * @returns 转换后的层级结构数组
 */
interface DentalItem {
    text: string;
    list?: DentalItem[];
}

function parseDentalText(str: string): DentalItem[] {
    if (!str) return [];
    // 初始化结果数组
    const result: DentalItem[] = [];

    // 按#分割字符串,过滤掉空字符串
    const sections = str.replaceAll('##', '$').split('#').filter(Boolean);

    for (let i = 0; i < sections.length; i++) {
        const sectionArr = sections[i].trim().split('$');
        result.push({
            text: sectionArr[0],
            list: sectionArr.slice(1).map((item) => ({ text: item }))
        });
    }

    return result;
}

const popoverWidth = computed(() => {
    if (props.type === 'video') {
        return props.width + 24;
    }
    if (!props.text?.replace(/\s/g, '').length && !props.img.length) {
        return 20;
    }

    return 760;
});

const splitText = computed(() => {
    if (!props.text) return [];
    return parseDentalText(props.text).map((item) => item.text);
});

function isImgType(item: ImgType | string): item is ImgType {
    return typeof item !== 'string' && 'url' in item;
}
</script>

<template>
    <template v-if="type === 'img'">
        <PreviewModal :width="width" :height="height" :src="src" />
    </template>
    <el-popover v-else :width="popoverWidth" trigger="click">
        <template #reference>
            <span v-if="type === 'video'" class="focus video">
                <img :src="VideoPlay" alt="" />
                <span>{{ props.content }}</span>
            </span>
            <span v-else class="focus tips">{{ props.content }} <i>？</i></span>
        </template>
        <PreviewModal
            v-if="type === 'video'"
            :width="width"
            :height="height"
            :src="src"
            :cover="cover"
            type="video"
        />

        <div v-else class="abnormal">
            <div v-if="img.length" class="row">
                <PreviewModal
                    v-for="item in img"
                    :key="isImgType(item) ? item.name : item"
                    :src="isImgType(item) ? item.url : item"
                    :width="width"
                    :height="height"
                />
            </div>
            <div v-if="splitText.length" class="text">
                <span v-for="item in splitText" :key="item">{{ item }}</span>
            </div>
        </div>
    </el-popover>
</template>

<style scoped lang="scss">
.focus {
    cursor: pointer;
    word-break: keep-all;
    display: inline-flex;
    position: relative;

    &.video {
        color: #165dff;
        padding-left: 12px;
        margin-right: 5px;
        img {
            width: 9px;
            position: absolute;
            left: 0;
            top: 50%;
            margin-top: -5px;
        }
    }

    &.tips {
        color: #6e7891;
        padding-right: 18px;
        i {
            display: block;
            width: 16px;
            height: 16px;
            font-size: 13px;
            line-height: 16px;
            color: #fff;
            background-color: #f73859;
            font-style: normal;
            text-indent: 4.5px;
            border-radius: 50%;
            position: absolute;
            top: 50%;
            right: 0;
            margin-top: -8px;
        }
    }
}

.abnormal {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: #111315;
    font-weight: 400;
    font-size: 16px;
    line-height: 24px;

    .row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        flex-wrap: wrap;
    }

    .text {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        text-align: justify;
        padding: 30px;
        word-break: break-all;
    }
}
</style>
