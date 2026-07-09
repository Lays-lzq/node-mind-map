import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import profileRouter from './routes/profile.js';
import projectsRouter from './routes/projects.js';
import aiRouter from './routes/ai.js';
import { success, fail } from './utils/response.js';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
    success(res, { ok: true });
});

app.use('/api/profile', profileRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/ai', aiRouter);

app.use((err, _req, res, _next) => {
    console.error('[server error]', err);
    fail(res, 500, err.message || 'Internal Server Error', 500);
});

app.listen(config.port, () => {
    console.log(`API server running at http://localhost:${config.port}`);
});
