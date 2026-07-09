export interface DentalItem {
    text: string;
    list?: DentalItem[];
}

export function parseDentalText(str: string | null | undefined): DentalItem[] {
    if (typeof str !== 'string') return [];

    const trimmed = str.trim();
    if (!trimmed) return [];
    if (!trimmed.includes('#')) return [{ text: trimmed, list: [] }];

    const PLACEHOLDER = '\x00';
    const sections = trimmed
        .replaceAll('##', PLACEHOLDER)
        .split('#')
        .filter(Boolean);

    return sections.map((section) => {
        const [text, ...rest] = section.trim().split(PLACEHOLDER);
        return {
            text,
            list: rest.map((item) => ({ text: item }))
        };
    });
}

export function numberToChinese(num: number): string {
    const chineseNumbers = [
        '零',
        '一',
        '二',
        '三',
        '四',
        '五',
        '六',
        '七',
        '八',
        '九'
    ];
    const units = ['', '十', '百', '千', '万'];

    if (num === 0) return chineseNumbers[0];
    let result = '';
    const numStr = num.toString();
    const length = numStr.length;
    for (let i = 0; i < length; i++) {
        const digit = parseInt(numStr[i]);
        if (digit !== 0) {
            result += chineseNumbers[digit] + units[length - 1 - i];
        } else if (i < length - 1 && parseInt(numStr[i + 1]) !== 0) {
            result += chineseNumbers[0];
        }
    }
    if (result.startsWith('一十')) {
        result = result.slice(1);
    }
    return result;
}
