import { Router } from 'express';
import { success, fail } from '../utils/response.js';
import { chatCompletion } from '../services/deepseek.js';
import {
    buildGeneratePrompt,
    buildExpandPrompt,
    buildChatSystemPrompt,
    buildGeneralChatSystemPrompt
} from '../prompts/mindmap.js';

const router = Router();

function parseMindMapJson(content) {
    const parsed = JSON.parse(content);
    if (!parsed?.nodes || !Array.isArray(parsed.nodes)) {
        throw new Error('AI 返回格式无效');
    }
    return parsed;
}

router.post('/generate', async (req, res, next) => {
    try {
        const { topic } = req.body ?? {};
        if (!topic?.trim()) {
            fail(res, 400, 'topic 不能为空');
            return;
        }

        const completion = await chatCompletion({
            messages: buildGeneratePrompt(topic.trim()),
            jsonMode: true
        });
        const content = completion.choices[0]?.message?.content;
        success(res, parseMindMapJson(content));
    } catch (err) {
        next(err);
    }
});

router.post('/expand', async (req, res, next) => {
    try {
        const { nodeTitle, contextSummary } = req.body ?? {};
        if (!nodeTitle?.trim()) {
            fail(res, 400, 'nodeTitle 不能为空');
            return;
        }

        const completion = await chatCompletion({
            messages: buildExpandPrompt(nodeTitle.trim(), contextSummary || ''),
            jsonMode: true
        });
        const content = completion.choices[0]?.message?.content;
        success(res, parseMindMapJson(content));
    } catch (err) {
        next(err);
    }
});

router.post('/chat', async (req, res, next) => {
    try {
        const { messages, contextSummary, mode = 'general' } = req.body ?? {};
        if (!Array.isArray(messages) || messages.length === 0) {
            fail(res, 400, 'messages 不能为空');
            return;
        }

        const systemContent =
            mode === 'mindmap'
                ? buildChatSystemPrompt(contextSummary || '')
                : buildGeneralChatSystemPrompt();

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        const stream = await chatCompletion({
            messages: [{ role: 'system', content: systemContent }, ...messages],
            stream: true
        });

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
                res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
            }
        }
        res.write('data: [DONE]\n\n');
        res.end();
    } catch (err) {
        if (!res.headersSent) {
            next(err);
        } else {
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
        }
    }
});

export default router;
