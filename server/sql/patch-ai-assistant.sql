-- 修复 ai-assistant 项目乱码（需以 utf8mb4 执行）
USE node_mind_map;

UPDATE projects
SET
  name = 'AI 助手',
  description = '基于 DeepSeek 的智能对话助手，支持流式回复，可解答技术问题、梳理思路与辅助创作。',
  icon = '✨'
WHERE id = 'ai-assistant';

DELETE FROM project_tags WHERE project_id = 'ai-assistant';

INSERT INTO project_tags (project_id, tag, sort_order) VALUES
('ai-assistant', 'DeepSeek', 1),
('ai-assistant', 'Vue 3', 2),
('ai-assistant', 'SSE 流式', 3),
('ai-assistant', 'Node.js', 4);
