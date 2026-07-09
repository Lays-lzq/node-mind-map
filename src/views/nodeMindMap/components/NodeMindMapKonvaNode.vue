<script setup lang="ts">
    import { computed, ref, watch } from 'vue';
    import {
        createEmptyGuidePayload,
        NODE_RECT_FILL
    } from '../ts/medicineGuide';
    import {
        getNodeGuideValidation,
        NODE_GUIDE_VALIDATION_BADGE_FILL,
        MIND_MAP_VALIDATION_BADGE_R,
        mindMapValidationBadgeCenterLocal
    } from '../ts/mindMapNodeGuideValidation';
    import { getMindMapNodeAccentColorByLevel } from '../ts/mindMapNodeAccentColor';

    defineOptions({
        name: 'NodeMindMapKonvaNode'
    });

    interface VideoDictItem {
        key: string;
        title: string;
    }

    const props = withDefaults(
        defineProps<{
            node: Record<string, any>;
            draggable: boolean;
            defaultRectSize: { width: number; height: number };
            showConnectionHandles: boolean;
            wireDragCycleBlocked?: boolean;
            /** 为 false 时不响应命中（抓手/空格平移画布时透传至 Stage） */
            listening?: boolean;
            /** 与侧栏/字典一致，用于节点上展示素材名称 */
            videoDataList?: VideoDictItem[];
            /** 拓扑层级（无入边为 0），决定节点 ID 文案与端口区分色 */
            nodeLevel?: number;
        }>(),
        {
            wireDragCycleBlocked: false,
            listening: true,
            videoDataList: () => [],
            nodeLevel: 0
        }
    );

    const emit = defineEmits<{
        mouseover: [];
        mouseout: [];
        click: [e: unknown];
        dragstart: [e: unknown];
        dragmove: [e: unknown];
        dragend: [e: unknown];
        circleStartOver: [e: unknown];
        circleStartOut: [e: unknown];
        circleEndOver: [e: unknown];
        circleEndOut: [e: unknown];
        circleStartPointerDown: [e: unknown];
        circleEndPointerDown: [e: unknown];
        validationTipShow: [
            payload: { message: string; left: number; top: number }
        ];
        validationTipHide: [];
        /** 节点卡片高度随内容变化，供父级重算连线端口 */
        layoutChange: [];
    }>();

    const NODE_LABEL_PAD = 16;
    const NODE_ID_FONT = 14;
    const NODE_DESC_FONT = 12;
    const NODE_ID_ROW_HEIGHT = NODE_ID_FONT + 10;

    const MATERIAL_TAG_HEIGHT = 22;
    const MATERIAL_TAG_FONT = 12;
    const MATERIAL_TAG_PAD_H = 10;
    const MATERIAL_TAG_GAP = 6;
    const MATERIAL_TAG_ROW_GAP = 6;
    const MATERIAL_TAG_CORNER = 6;
    const MATERIAL_TAG_TEXT_PAD_TOP = 4;
    const MATERIAL_TAG_TEXT_PAD_BOTTOM = 4;
    const GAP_DESC_TO_MATERIAL_ROW = 10;
    const MATERIAL_ROW_BOTTOM_PAD = 8;

    const OP_DESC_LINE_HEIGHT = 1.5;
    const OP_DESC_LINE_HEIGHT_PX = NODE_DESC_FONT * OP_DESC_LINE_HEIGHT;
    const OP_DESC_MAX_LINES = 2;
    const OP_DESC_MAX_HEIGHT_PX = OP_DESC_MAX_LINES * OP_DESC_LINE_HEIGHT_PX;

    type MaterialTagKonvaItem = {
        gx: number;
        gy: number;
        rect: Record<string, unknown>;
        text: Record<string, unknown>;
    };

    type NodeCardLayout = {
        rw: number;
        rh: number;
        idLine: Record<string, unknown>;
        descLine: Record<string, unknown>;
        materialItems: MaterialTagKonvaItem[];
        /** 左右衔接圆心（相对卡片左上角，与 group offset 无关） */
        startPort: { x: number; y: number };
        endPort: { x: number; y: number };
    };

    const getGuideForLabel = (node: Record<string, any>) =>
        node.guide && typeof node.guide === 'object'
            ? node.guide
            : createEmptyGuidePayload();

    const getSortedOperationTypeKeys = (
        node: Record<string, any>
    ): string[] => {
        const g = getGuideForLabel(node);
        const arr = [...(g.operationTypes ?? [])].map(String);
        arr.sort((a, b) => +a - +b);
        return arr;
    };

    function buildVideoTitleMap(list: VideoDictItem[]): Map<string, string> {
        const m = new Map<string, string>();
        for (const v of list)
            m.set(String(v.key), String(v.title ?? v.key).trim());
        return m;
    }

    function materialLabelForKey(
        key: string,
        videoMap: Map<string, string>
    ): string {
        const title = videoMap.get(key);
        return title && title.length ? `${key}.${title}` : key;
    }

    /** 与 Konva 12px 渲染对齐，并留余量避免末字被裁切 */
    const MATERIAL_TAG_CHAR_WIDTH_ZH = 12;
    const MATERIAL_TAG_CHAR_WIDTH_ASCII = 7;
    const MATERIAL_TAG_WIDTH_SLACK = 10;

    function estimateTextWidth(text: string): number {
        let w = 0;
        for (const ch of text) {
            w += /[\u4e00-\u9fff]/.test(ch)
                ? MATERIAL_TAG_CHAR_WIDTH_ZH
                : MATERIAL_TAG_CHAR_WIDTH_ASCII;
        }
        return w;
    }

    function estimateMaterialTagWidth(text: string): number {
        return Math.ceil(
            MATERIAL_TAG_PAD_H * 2 +
                estimateTextWidth(text) +
                MATERIAL_TAG_WIDTH_SLACK
        );
    }

    function measureTagWrapHeight(label: string, tagWidth: number): number {
        const innerW = Math.max(24, tagWidth - MATERIAL_TAG_PAD_H * 2);
        const naturalInnerW = estimateTextWidth(label);
        if (naturalInnerW <= innerW) return MATERIAL_TAG_HEIGHT;
        const lines = estimateDescLines(label, innerW);
        const linePx = MATERIAL_TAG_FONT + 6;
        return Math.max(
            MATERIAL_TAG_HEIGHT,
            lines * linePx +
                MATERIAL_TAG_TEXT_PAD_TOP +
                MATERIAL_TAG_TEXT_PAD_BOTTOM
        );
    }

    function estimateDescLines(text: string, innerWidthPx: number) {
        if (!text.length) return 1;
        const charsPerLine = Math.max(
            6,
            Math.floor(innerWidthPx / MATERIAL_TAG_CHAR_WIDTH_ZH)
        );
        return Math.max(1, Math.ceil(text.length / charsPerLine));
    }

    function estimateOperationDescHeight(text: string, innerWidthPx: number) {
        const lines = estimateDescLines(text, innerWidthPx);
        return Math.max(OP_DESC_LINE_HEIGHT_PX, lines * OP_DESC_LINE_HEIGHT_PX);
    }

    function layoutMaterialTags(
        labels: string[],
        x0: number,
        startY: number,
        innerWidth: number
    ): { items: MaterialTagKonvaItem[]; blockHeight: number } {
        if (!labels.length) return { items: [], blockHeight: 0 };

        const maxRight = x0 + innerWidth;
        const items: MaterialTagKonvaItem[] = [];
        let rowY = startY;
        let cursorX = x0;
        let rowMaxH = MATERIAL_TAG_HEIGHT;

        const finishRow = () => {
            if (cursorX <= x0) return;
            rowY += rowMaxH + MATERIAL_TAG_ROW_GAP;
            cursorX = x0;
            rowMaxH = MATERIAL_TAG_HEIGHT;
        };

        for (const label of labels) {
            const naturalW = estimateMaterialTagWidth(label);
            const tagW = Math.min(naturalW, innerWidth);

            if (cursorX > x0 && cursorX + tagW > maxRight) {
                finishRow();
            }

            const h = measureTagWrapHeight(label, tagW);
            const align: 'left' | 'center' =
                tagW >= innerWidth ? 'left' : 'center';
            items.push(
                buildMaterialTagItem(cursorX, rowY, label, tagW, h, align)
            );
            cursorX += tagW + MATERIAL_TAG_GAP;
            rowMaxH = Math.max(rowMaxH, h);
        }

        const tailH = cursorX > x0 ? rowMaxH : 0;
        const blockHeight = rowY - startY + tailH;
        return { items, blockHeight };
    }

    function buildMaterialTagItem(
        gx: number,
        gy: number,
        label: string,
        w: number,
        h: number,
        align: 'left' | 'center'
    ): MaterialTagKonvaItem {
        const innerH =
            h - MATERIAL_TAG_TEXT_PAD_TOP - MATERIAL_TAG_TEXT_PAD_BOTTOM;
        const textPad = MATERIAL_TAG_PAD_H;
        const textW = w - textPad * 2;
        const needsWrap =
            estimateTextWidth(label) + MATERIAL_TAG_WIDTH_SLACK > textW;
        return {
            gx,
            gy,
            rect: {
                x: 0,
                y: 0,
                width: w,
                height: h,
                fill: '#F4F7FF',
                stroke: '#E4E3F0',
                strokeWidth: 1,
                cornerRadius: MATERIAL_TAG_CORNER,
                listening: false
            },
            text: {
                x: textPad,
                y: MATERIAL_TAG_TEXT_PAD_TOP,
                width: textW,
                height: innerH,
                text: label,
                fontSize: MATERIAL_TAG_FONT,
                align,
                verticalAlign: needsWrap ? 'top' : 'middle',
                wrap: needsWrap ? 'char' : 'none',
                ellipsis: false,
                lineHeight: 1.35,
                fill: '#13141D',
                listening: false
            }
        };
    }

    function computeNodeCardLayout(
        node: Record<string, any>,
        defaultRect: { width: number; height: number },
        videoMap: Map<string, string>
    ): NodeCardLayout {
        const rw = Number(node.rectConf?.width ?? defaultRect.width);
        const pad = NODE_LABEL_PAD;
        const x0 = pad;
        const y0 = pad;
        const iw = rw - pad * 2;
        const metaTop = NODE_ID_ROW_HEIGHT;

        const types = getSortedOperationTypeKeys(node);
        const labels = types.map((id) => materialLabelForKey(id, videoMap));

        const op = (getGuideForLabel(node).operationDesc ?? '').trim();
        const descText = op || '（暂无操作描述）';

        const innerMin = defaultRect.height - pad * 2;
        const materialOnly = layoutMaterialTags(labels, x0, 0, iw);
        const materialBlock =
            labels.length > 0
                ? GAP_DESC_TO_MATERIAL_ROW +
                  materialOnly.blockHeight +
                  MATERIAL_ROW_BOTTOM_PAD
                : 0;

        const maxDesc = Math.max(
            OP_DESC_LINE_HEIGHT_PX,
            innerMin - metaTop - materialBlock
        );
        const wanted = estimateOperationDescHeight(descText, iw);
        const descHeight = Math.min(
            Math.min(wanted, OP_DESC_MAX_HEIGHT_PX),
            maxDesc
        );

        const tagRowY = y0 + metaTop + descHeight + GAP_DESC_TO_MATERIAL_ROW;
        const { items: materialItems, blockHeight } = layoutMaterialTags(
            labels,
            x0,
            tagRowY,
            iw
        );
        const materialTotal =
            labels.length > 0
                ? GAP_DESC_TO_MATERIAL_ROW +
                  blockHeight +
                  MATERIAL_ROW_BOTTOM_PAD
                : 0;

        const contentH = metaTop + descHeight + materialTotal + pad * 2;
        const rh = Math.max(defaultRect.height, contentH);

        return {
            rw,
            rh,
            idLine: {
                x: x0,
                y: y0,
                width: iw,
                text: `节点 ID：${node.nodeId}`,
                fontSize: NODE_ID_FONT,
                fontStyle: 'bold' as const,
                fill: '#13141D',
                listening: false
            },
            descLine: {
                x: x0,
                y: y0 + metaTop,
                width: iw,
                height: descHeight,
                text: descText,
                fontSize: NODE_DESC_FONT,
                lineHeight: OP_DESC_LINE_HEIGHT,
                fill: '#303133',
                wrap: 'char',
                ellipsis: true,
                listening: false
            },
            materialItems,
            startPort: { x: 0, y: rh / 2 },
            endPort: { x: rw, y: rh / 2 }
        };
    }

    const videoTitleMap = computed(() =>
        buildVideoTitleMap(props.videoDataList ?? [])
    );

    const nodeCardLayout = computed(() =>
        computeNodeCardLayout(
            props.node,
            props.defaultRectSize,
            videoTitleMap.value
        )
    );

    /** 同步卡片高度与衔接点，供连线/命中与 Konva offset 一致 */
    watch(
        nodeCardLayout,
        (layout) => {
            const n = props.node;
            if (!n?.rectConf) return;
            const prevRh =
                Number(n.rectConf?.height) || props.defaultRectSize.height;
            const rhChanged = prevRh !== layout.rh;
            if (rhChanged) {
                const prevHalf = Number(n.offset?.y) || prevRh / 2;
                const newHalf = layout.rh / 2;
                n.rectConf.height = layout.rh;
                /** offset 半高与实高不一致时，补偿 node.y，避免卡片整体位移 */
                if (Math.abs(prevHalf - newHalf) > 0.5) {
                    n.y += newHalf - prevHalf;
                }
                emit('layoutChange');
            }
            if (n.offset) {
                n.offset.x = layout.rw / 2;
                n.offset.y = layout.rh / 2;
            }
            if (n.startCircleConf) {
                n.startCircleConf.x = layout.startPort.x;
                n.startCircleConf.y = layout.startPort.y;
                n.startCircleConf.offset = { x: 0, y: 0 };
            }
            if (n.endCircleConf) {
                n.endCircleConf.x = layout.endPort.x;
                n.endCircleConf.y = layout.endPort.y;
                n.endCircleConf.offset = { x: 0, y: 0 };
            }
        },
        { flush: 'post' }
    );

    /** offset 必须与 layout.rh 同帧，否则撑高后 node.y 与几何中心不一致，端口/连线会偏上 */
    const groupConfig = computed(() => {
        const { rw, rh } = nodeCardLayout.value;
        return {
            x: props.node.x,
            y: props.node.y,
            offset: { x: rw / 2, y: rh / 2 },
            draggable: props.draggable && props.listening,
            listening: props.listening
        };
    });

    const guideValidation = computed(() =>
        getNodeGuideValidation(getGuideForLabel(props.node))
    );

    const validationBadgeLayout = computed(() => {
        const { rw } = nodeCardLayout.value;
        return mindMapValidationBadgeCenterLocal(rw);
    });

    const validationBadgeCircleConf = computed(() => {
        const { cx, cy } = validationBadgeLayout.value;
        return {
            x: cx,
            y: cy,
            radius: MIND_MAP_VALIDATION_BADGE_R,
            fill: NODE_GUIDE_VALIDATION_BADGE_FILL,
            stroke: '#fff',
            strokeWidth: 1.5,
            listening: props.listening
        };
    });

    const validationBadgeTextConf = computed(() => {
        const { cx, cy } = validationBadgeLayout.value;
        return {
            x: cx,
            y: cy,
            text: '!',
            fontSize: 12,
            fontStyle: 'bold' as const,
            fill: '#fff',
            align: 'center' as const,
            verticalAlign: 'middle' as const,
            width: MIND_MAP_VALIDATION_BADGE_R * 2,
            height: MIND_MAP_VALIDATION_BADGE_R * 2,
            offsetX: MIND_MAP_VALIDATION_BADGE_R,
            offsetY: MIND_MAP_VALIDATION_BADGE_R,
            listening: false
        };
    });

    function konvaBadgeTipAnchor(target: {
        getStage?: () => { container?: () => HTMLElement };
        getClientRect?: () => {
            x: number;
            y: number;
            width: number;
            height: number;
        };
    }): { left: number; top: number } | null {
        const stage = target.getStage?.();
        const container = stage?.container?.();
        const rect = target.getClientRect?.();
        if (!container || !rect) return null;
        const box = container.getBoundingClientRect();
        return {
            left: box.left + rect.x + rect.width / 2,
            top: box.top + rect.y
        };
    }

    function onValidationBadgeEnter(e: any) {
        e.cancelBubble = true;
        const msg = guideValidation.value.tooltipMessage;
        if (!msg) return;
        const anchor = konvaBadgeTipAnchor(e.target);
        if (!anchor) return;
        emit('validationTipShow', {
            message: msg,
            left: anchor.left,
            top: anchor.top
        });
    }

    function onValidationBadgeLeave(e: any) {
        e.cancelBubble = true;
        emit('validationTipHide');
    }

    const nodeCardRectConf = computed(() => {
        const layout = nodeCardLayout.value;
        const r = props.node.rectConf ?? {};
        const base = {
            ...r,
            width: layout.rw,
            height: layout.rh,
            fill: NODE_RECT_FILL
        };
        if (!props.wireDragCycleBlocked) return base;
        return {
            ...base,
            fill: 'rgba(236, 236, 239, 0.8)',
            stroke: '#BEBEC8'
        };
    });

    const nodeAccentColor = computed(() =>
        props.wireDragCycleBlocked
            ? '#909399'
            : getMindMapNodeAccentColorByLevel(props.nodeLevel ?? 0)
    );

    const nodeIdLineConf = computed(() => {
        const layout = nodeCardLayout.value;
        return {
            ...layout.idLine,
            fill: nodeAccentColor.value
        };
    });

    const nodeDescLineConf = computed(() => {
        const layout = nodeCardLayout.value;
        return {
            ...layout.descLine,
            fill: props.wireDragCycleBlocked ? '#787B86' : '#303133'
        };
    });

    const materialTagItems = computed(() => nodeCardLayout.value.materialItems);

    const nodePortAccentColor = computed(() =>
        props.wireDragCycleBlocked
            ? '#BEBEC8'
            : getMindMapNodeAccentColorByLevel(props.nodeLevel ?? 0)
    );

    const NODE_CIRCLE_BASE = {
        radius: 6,
        scale: { x: 1, y: 1 }
    } as const;

    const hoverStartPort = ref(false);
    const hoverEndPort = ref(false);

    function connectionPortCircleStyle(hovered: boolean) {
        const accent = nodePortAccentColor.value;
        return hovered
            ? {
                  fill: accent,
                  stroke: accent,
                  strokeWidth: 3,
                  scale: { x: 1.12, y: 1.12 }
              }
            : {
                  fill: '#fff',
                  stroke: accent,
                  strokeWidth: 2,
                  scale: { x: 1, y: 1 }
              };
    }

    const startHandleConf = computed(() => {
        if (!props.showConnectionHandles || !props.listening) return null;
        const { startPort } = nodeCardLayout.value;
        return {
            ...NODE_CIRCLE_BASE,
            ...connectionPortCircleStyle(hoverStartPort.value),
            x: startPort.x,
            y: startPort.y,
            offset: { x: 0, y: 0 },
            visible: true,
            listening: true,
            hitStrokeWidth: 14
        };
    });

    const endHandleConf = computed(() => {
        if (!props.showConnectionHandles || !props.listening) return null;
        const { endPort } = nodeCardLayout.value;
        return {
            ...NODE_CIRCLE_BASE,
            ...connectionPortCircleStyle(hoverEndPort.value),
            x: endPort.x,
            y: endPort.y,
            offset: { x: 0, y: 0 },
            visible: true,
            listening: true,
            hitStrokeWidth: 14
        };
    });

    function onStartPortEnter(e: any) {
        e.cancelBubble = true;
        hoverStartPort.value = true;
        emit('circleStartOver', e);
    }

    function onStartPortLeave(e: any) {
        e.cancelBubble = true;
        hoverStartPort.value = false;
        emit('circleStartOut', e);
    }

    function onEndPortEnter(e: any) {
        e.cancelBubble = true;
        hoverEndPort.value = true;
        emit('circleEndOver', e);
    }

    function onEndPortLeave(e: any) {
        e.cancelBubble = true;
        hoverEndPort.value = false;
        emit('circleEndOut', e);
    }

    function swallowHandlePointerBubble(e: any) {
        e.cancelBubble = true;
        e.evt?.stopPropagation?.();
    }
</script>

<template>
    <v-group
        :config="groupConfig"
        @mouseenter="emit('mouseover')"
        @mouseleave="emit('mouseout')"
        @click="(e: any) => emit('click', e)"
        @dragstart="(e: any) => emit('dragstart', e)"
        @dragmove="(e: any) => emit('dragmove', e)"
        @dragend="(e: any) => emit('dragend', e)"
    >
        <v-rect :config="nodeCardRectConf" />
        <v-text :config="nodeIdLineConf" />
        <v-text :config="nodeDescLineConf" />
        <template
            v-for="(tag, ti) in materialTagItems"
            :key="`${node.nodeId}-mat-${ti}`"
        >
            <v-group :config="{ x: tag.gx, y: tag.gy }">
                <v-rect :config="tag.rect" />
                <v-text :config="tag.text" />
            </v-group>
        </template>
        <v-circle
            v-if="startHandleConf"
            :config="startHandleConf"
            @mouseenter="onStartPortEnter"
            @mouseleave="onStartPortLeave"
            @mousedown="(e: any) => emit('circleStartPointerDown', e)"
            @click="swallowHandlePointerBubble"
            @tap="swallowHandlePointerBubble"
        />
        <v-circle
            v-if="endHandleConf"
            :config="endHandleConf"
            @mouseenter="onEndPortEnter"
            @mouseleave="onEndPortLeave"
            @mousedown="(e: any) => emit('circleEndPointerDown', e)"
            @click="swallowHandlePointerBubble"
            @tap="swallowHandlePointerBubble"
        />
        <template v-if="guideValidation.hasError">
            <v-circle
                :config="validationBadgeCircleConf"
                @mouseenter="onValidationBadgeEnter"
                @mouseleave="onValidationBadgeLeave"
            />
            <v-text :config="validationBadgeTextConf" />
        </template>
    </v-group>
</template>
