import crypto from 'crypto';
import { config } from '../config.js';
import { fail } from '../utils/response.js';

const { ai: aiConfig } = config;

/** @type {Map<string, number[]>} */
const rateBuckets = new Map();

function clientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket.remoteAddress || 'unknown';
}

function pruneBucket(timestamps, windowMs, now) {
    return timestamps.filter((t) => now - t < windowMs);
}

function hitRateLimit(key, max, windowMs) {
    const now = Date.now();
    const bucket = pruneBucket(rateBuckets.get(key) ?? [], windowMs, now);
    if (bucket.length >= max) {
        rateBuckets.set(key, bucket);
        return true;
    }
    bucket.push(now);
    rateBuckets.set(key, bucket);
    return false;
}

function sign(value) {
    return crypto.createHmac('sha256', aiConfig.signSecret).update(value).digest('hex');
}

export function createAiToken() {
    const expiresAt = Date.now() + aiConfig.tokenTtlMs;
    const nonce = crypto.randomBytes(8).toString('hex');
    const payload = `${expiresAt}:${nonce}`;
    const payloadB64 = Buffer.from(payload).toString('base64url');
    return {
        token: `${payloadB64}.${sign(payload)}`,
        expiresAt
    };
}

export function verifyAiToken(token) {
    if (!token || typeof token !== 'string') return false;
    const [payloadB64, signature] = token.split('.');
    if (!payloadB64 || !signature) return false;

    let payload;
    try {
        payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
    } catch {
        return false;
    }

    const expected = sign(payload);
    if (signature.length !== expected.length) return false;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return false;
    }

    const [expiresAt] = payload.split(':');
    return Date.now() <= Number(expiresAt);
}

function normalizeOrigin(value) {
    if (!value || typeof value !== 'string') return '';
    try {
        const url = new URL(value);
        return `${url.protocol}//${url.host}`;
    } catch {
        return value.replace(/\/+$/, '');
    }
}

function isAllowedOrigin(req) {
    const allowed = aiConfig.allowedOrigins;
    if (allowed.length === 0) return true;

    const origin = normalizeOrigin(req.headers.origin);
    const referer = req.headers.referer ? normalizeOrigin(req.headers.referer) : '';

    if (origin && allowed.includes(origin)) return true;
    if (referer && allowed.some((item) => referer.startsWith(item))) return true;

    // 未配置白名单时不限制；配置后拒绝无来源请求（防 curl 直刷）
    if (!origin && !referer) return allowed.length === 0;
    return false;
}

export function aiOriginGuard(req, res, next) {
    if (isAllowedOrigin(req)) {
        next();
        return;
    }
    fail(res, 403, '来源未授权', 403);
}

export function aiAuthRateLimit(req, res, next) {
    const ip = clientIp(req);
    const key = `auth:${ip}`;
    if (hitRateLimit(key, aiConfig.authRateLimit.max, aiConfig.authRateLimit.windowMs)) {
        fail(res, 429, '请求过于频繁，请稍后再试', 429);
        return;
    }
    next();
}

export function aiTokenGuard(req, res, next) {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
    if (!verifyAiToken(token)) {
        fail(res, 401, '无效或已过期的访问凭证', 401);
        return;
    }
    next();
}

export function aiChatRateLimit(req, res, next) {
    const ip = clientIp(req);
    const key = `chat:${ip}`;
    if (hitRateLimit(key, aiConfig.chatRateLimit.max, aiConfig.chatRateLimit.windowMs)) {
        fail(res, 429, '对话请求过于频繁，请稍后再试', 429);
        return;
    }
    next();
}

export function aiGenerateRateLimit(req, res, next) {
    const ip = clientIp(req);
    const key = `generate:${ip}`;
    if (hitRateLimit(key, aiConfig.generateRateLimit.max, aiConfig.generateRateLimit.windowMs)) {
        fail(res, 429, '生成请求过于频繁，请稍后再试', 429);
        return;
    }
    next();
}

export function validateChatBody(req, res, next) {
    const { messages } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) {
        fail(res, 400, 'messages 不能为空');
        return;
    }
    if (messages.length > aiConfig.maxMessages) {
        fail(res, 400, `消息条数不能超过 ${aiConfig.maxMessages}`);
        return;
    }
    for (const msg of messages) {
        if (typeof msg?.content !== 'string' || !msg.content.trim()) {
            fail(res, 400, '消息内容无效');
            return;
        }
        if (msg.content.length > aiConfig.maxMessageLength) {
            fail(res, 400, `单条消息不能超过 ${aiConfig.maxMessageLength} 字`);
            return;
        }
    }
    next();
}
