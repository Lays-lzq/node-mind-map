/**
 * 正交折线 → Konva SVG path，以及由折线末段推导 Arrow 端点。
 */

/** 正交折线 → Konva SVG path（拐角用圆弧或 Q，末段保留直线供箭头对齐） */
export function generateRoundedPath(points: number[], radius: number): string {
    if (points.length < 4) {
        if (points.length === 4) {
            return `M ${points[0]} ${points[1]} L ${points[2]} ${points[3]}`;
        }
        return '';
    }

    let path = `M ${points[0]} ${points[1]}`;

    for (let i = 2; i < points.length - 2; i += 2) {
        const x0 = points[i - 2];
        const y0 = points[i - 1];
        const x1 = points[i];
        const y1 = points[i + 1];
        const x2 = points[i + 2];
        const y2 = points[i + 3];

        const dx1 = x1 - x0;
        const dy1 = y1 - y0;
        const dx2 = x2 - x1;
        const dy2 = y2 - y1;

        const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
        const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

        if (len1 === 0 || len2 === 0) {
            path += ` L ${x1} ${y1}`;
            continue;
        }

        const nx1 = dx1 / len1;
        const ny1 = dy1 / len1;
        const nx2 = dx2 / len2;
        const ny2 = dy2 / len2;
        const dotu = nx1 * nx2 + ny1 * ny2;
        const crossu = nx1 * ny2 - ny1 * nx2;

        /** 近似共线拐点：圆角 Q 会穿出「反向鼓包」，直接削角 */
        if (Math.abs(crossu) <= 0.08) {
            path += ` L ${x1} ${y1}`;
            continue;
        }

        const actualRadius = Math.min(radius, len1 / 2, len2 / 2);
        if (actualRadius < 0.75) {
            path += ` L ${x1} ${y1}`;
            continue;
        }

        const t1 = actualRadius / len1;
        const t2 = actualRadius / len2;

        const startX = x1 - dx1 * t1;
        const startY = y1 - dy1 * t1;
        const endX = x1 + dx2 * t2;
        const endY = y1 + dy2 * t2;

        path += ` L ${startX} ${startY}`;
        /** 正交拐角：用圆弧代替 Q(control=顶点)，避免一侧鼓起像「圆角反了」 */
        const almostOrtho =
            Math.abs(dotu) <= 0.08 && Math.abs(crossu) >= 0.92;
        if (almostOrtho) {
            const sweep = crossu > 0 ? 1 : 0;
            path += ` A ${actualRadius} ${actualRadius} 0 0 ${sweep} ${endX} ${endY}`;
        } else {
            path += ` Q ${x1} ${y1} ${endX} ${endY}`;
        }
    }

    path += ` L ${points[points.length - 2]} ${points[points.length - 1]}`;

    return path;
}

/**
 * Konva Arrow：`points` 为 [杆尾 x,y, 箭头端 x,y]，方向须与末段一致。
 * 不能用 path 字符串里「最后 4 个数字」：圆角后用 `Q …` 再接 `L`，末段只有 2 个数，
 * 正则抓到的末 4 个会落在二次贝塞尔参数上，箭头会扭向错误切向。
 */
export function arrowPointsFromPolylineEnd(linePts: number[]): number[] {
    if (linePts.length < 4) return [];
    const n = linePts.length;
    let x2 = linePts[n - 2]!;
    let y2 = linePts[n - 1]!;
    for (let j = n - 4; j >= 0; j -= 2) {
        const x1 = linePts[j]!;
        const y1 = linePts[j + 1]!;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy);
        if (len < 4) continue;
        const stem = Math.min(14, len * 0.45);
        return [
            x2 - (dx / len) * stem,
            y2 - (dy / len) * stem,
            x2,
            y2
        ];
    }
    return [];
}
