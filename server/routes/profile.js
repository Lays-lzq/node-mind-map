import { Router } from 'express';
import { query } from '../db.js';
import { success, fail } from '../utils/response.js';

const router = Router();

router.get('/', async (_req, res, next) => {
    try {
        const [profile] = await query('SELECT * FROM profile ORDER BY id LIMIT 1');

        if (!profile) {
            fail(res, 404, 'Profile not found', 404);
            return;
        }

        const profileId = profile.id;

        const [summary, contacts, skillGroups, skillItems, workList, workHighlights, projectList, projectStacks, projectHighlights] =
            await Promise.all([
                query('SELECT content FROM profile_summary WHERE profile_id = ? ORDER BY sort_order', [profileId]),
                query('SELECT label, value, href FROM contacts WHERE profile_id = ? ORDER BY sort_order', [profileId]),
                query('SELECT id, category FROM skill_groups WHERE profile_id = ? ORDER BY sort_order', [profileId]),
                query(
                    `SELECT si.skill_group_id, si.content
                     FROM skill_items si
                     INNER JOIN skill_groups sg ON sg.id = si.skill_group_id
                     WHERE sg.profile_id = ?
                     ORDER BY si.sort_order`,
                    [profileId]
                ),
                query('SELECT id, company, period, role, department FROM work_experience WHERE profile_id = ? ORDER BY sort_order', [
                    profileId
                ]),
                query(
                    `SELECT weh.work_experience_id, weh.content
                     FROM work_experience_highlights weh
                     INNER JOIN work_experience we ON we.id = weh.work_experience_id
                     WHERE we.profile_id = ?
                     ORDER BY weh.sort_order`,
                    [profileId]
                ),
                query('SELECT id, name, period, description FROM project_experience WHERE profile_id = ? ORDER BY sort_order', [
                    profileId
                ]),
                query(
                    `SELECT pes.project_experience_id, pes.content
                     FROM project_experience_stack pes
                     INNER JOIN project_experience pe ON pe.id = pes.project_experience_id
                     WHERE pe.profile_id = ?
                     ORDER BY pes.sort_order`,
                    [profileId]
                ),
                query(
                    `SELECT peh.project_experience_id, peh.content
                     FROM project_experience_highlights peh
                     INNER JOIN project_experience pe ON pe.id = peh.project_experience_id
                     WHERE pe.profile_id = ?
                     ORDER BY peh.sort_order`,
                    [profileId]
                )
            ]);

        const skillItemsByGroup = skillItems.reduce((acc, item) => {
            if (!acc[item.skill_group_id]) acc[item.skill_group_id] = [];
            acc[item.skill_group_id].push(item.content);
            return acc;
        }, {});

        const workHighlightsById = workHighlights.reduce((acc, item) => {
            if (!acc[item.work_experience_id]) acc[item.work_experience_id] = [];
            acc[item.work_experience_id].push(item.content);
            return acc;
        }, {});

        const projectStacksById = projectStacks.reduce((acc, item) => {
            if (!acc[item.project_experience_id]) acc[item.project_experience_id] = [];
            acc[item.project_experience_id].push(item.content);
            return acc;
        }, {});

        const projectHighlightsById = projectHighlights.reduce((acc, item) => {
            if (!acc[item.project_experience_id]) acc[item.project_experience_id] = [];
            acc[item.project_experience_id].push(item.content);
            return acc;
        }, {});

        success(res, {
            // name: profile.name,
            // nickname: profile.nickname,
            // title: profile.title,
            // location: profile.location,
            // education: profile.education,
            // avatar: profile.avatar,
            summary: summary.map((item) => item.content),
            // contacts: contacts.map(({ label, value, href }) => ({
            //     label,
            //     value,
            //     ...(href ? { href } : {})
            // })),
            skills: skillGroups.map((group) => ({
                category: group.category,
                items: skillItemsByGroup[group.id] || []
            })),
            workExperience: workList.map((job) => ({
                company: job.company,
                period: job.period,
                role: job.role,
                department: job.department,
                highlights: workHighlightsById[job.id] || []
            })),
            projectExperience: projectList.map((project) => ({
                name: project.name,
                period: project.period,
                description: project.description,
                stack: projectStacksById[project.id] || [],
                highlights: projectHighlightsById[project.id] || []
            }))
        });
    } catch (error) {
        next(error);
    }
});

export default router;
