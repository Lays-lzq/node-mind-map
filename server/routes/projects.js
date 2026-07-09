import { Router } from 'express';
import { query } from '../db.js';
import { success } from '../utils/response.js';

const router = Router();

router.get('/', async (_req, res, next) => {
    try {
        const projects = await query(
            'SELECT id, name, description, status, icon, accent, route_name, external_url FROM projects ORDER BY sort_order'
        );

        if (!projects.length) {
            success(res, []);
            return;
        }

        const projectIds = projects.map((project) => project.id);
        const tags = await query(
            `SELECT project_id, tag FROM project_tags WHERE project_id IN (${projectIds.map(() => '?').join(', ')}) ORDER BY sort_order`,
            projectIds
        );

        const tagsByProject = tags.reduce((acc, item) => {
            if (!acc[item.project_id]) acc[item.project_id] = [];
            acc[item.project_id].push(item.tag);
            return acc;
        }, {});

        success(
            res,
            projects.map((project) => ({
                id: project.id,
                name: project.name,
                description: project.description,
                status: project.status,
                icon: project.icon,
                accent: project.accent,
                tags: tagsByProject[project.id] || [],
                ...(project.route_name ? { route: { name: project.route_name } } : {}),
                ...(project.external_url ? { externalUrl: project.external_url } : {})
            }))
        );
    } catch (error) {
        next(error);
    }
});

export default router;
