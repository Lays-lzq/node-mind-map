import OpenAI from 'openai';
import { config } from '../config.js';

let client = null;

function getClient() {
    if (!config.deepseek.apiKey) {
        throw new Error('DEEPSEEK_API_KEY 未配置，请在 server/.env 中设置');
    }
    if (!client) {
        client = new OpenAI({
            apiKey: config.deepseek.apiKey,
            baseURL: config.deepseek.baseURL
        });
    }
    return client;
}

export async function chatCompletion({ messages, jsonMode = false, stream = false }) {
    return getClient().chat.completions.create({
        model: config.deepseek.model,
        messages,
        stream,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
    });
}
