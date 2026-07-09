import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.use({
    breaks: true,
    gfm: true
});

export function renderMarkdown(source: string): string {
    if (!source) return '';
    const html = marked.parse(source, { async: false }) as string;
    return DOMPurify.sanitize(html);
}
