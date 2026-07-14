import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, '.env') });

export const config = {
    port: Number(process.env.SERVER_PORT || 3000),
    deepseek: {
        apiKey: process.env.DEEPSEEK_API_KEY || '',
        baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat'
    },
    ai: {
        signSecret: process.env.AI_SIGN_SECRET || 'dev-ai-sign-secret-change-me',
        allowedOrigins: (process.env.AI_ALLOWED_ORIGINS || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        tokenTtlMs: Number(process.env.AI_TOKEN_TTL_MS || 5 * 60 * 1000),
        maxMessages: Number(process.env.AI_MAX_MESSAGES || 30),
        maxMessageLength: Number(process.env.AI_MAX_MESSAGE_LENGTH || 2000),
        authRateLimit: {
            windowMs: Number(process.env.AI_AUTH_RATE_WINDOW_MS || 60_000),
            max: Number(process.env.AI_AUTH_RATE_MAX || 10)
        },
        chatRateLimit: {
            windowMs: Number(process.env.AI_CHAT_RATE_WINDOW_MS || 10 * 60_000),
            max: Number(process.env.AI_CHAT_RATE_MAX || 100)
        },
        generateRateLimit: {
            windowMs: Number(process.env.AI_GENERATE_RATE_WINDOW_MS || 10 * 60_000),
            max: Number(process.env.AI_GENERATE_RATE_MAX || 10)
        }
    },
    db: {
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'node_mind_map'
    }
};
