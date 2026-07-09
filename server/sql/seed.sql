USE node_mind_map;

SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE project_tags;
TRUNCATE TABLE projects;
TRUNCATE TABLE project_experience_highlights;
TRUNCATE TABLE project_experience_stack;
TRUNCATE TABLE project_experience;
TRUNCATE TABLE work_experience_highlights;
TRUNCATE TABLE work_experience;
TRUNCATE TABLE skill_items;
TRUNCATE TABLE skill_groups;
TRUNCATE TABLE contacts;
TRUNCATE TABLE profile_summary;
TRUNCATE TABLE profile;
SET FOREIGN_KEY_CHECKS = 1;

INSERT INTO profile (name, nickname, title, location, education, avatar)
VALUES (
  '陆志强',
  'L',
  '前端开发工程师',
  '杭州',
  '浙江传媒学院 · 广播电视工程（电子信息类）',
  '/avatar.png'
);

SET @profile_id = LAST_INSERT_ID();

INSERT INTO profile_summary (profile_id, content, sort_order) VALUES
(@profile_id, '3 年以上前端开发经验，参与过大型项目开发、重构与版本升级工作。', 1),
(@profile_id, '熟悉项目管理与多人协作开发，注重组件化设计与代码规范。', 2),
(@profile_id, '代码风格整洁，对 UI 细节与交互体验有较高审美要求。', 3);

INSERT INTO contacts (profile_id, label, value, href, sort_order) VALUES
(@profile_id, '手机', '18861716623', 'tel:18861716623', 1),
(@profile_id, '邮箱', '1026030834@qq.com', 'mailto:1026030834@qq.com', 2),
(@profile_id, 'GitHub', 'github.com/Lays-lzq', 'https://github.com/Lays-lzq', 3);

INSERT INTO skill_groups (profile_id, category, sort_order) VALUES
(@profile_id, '基础能力', 1),
(@profile_id, '框架与工程', 2),
(@profile_id, '全栈与工具', 3);

SET @skill_basic = (SELECT id FROM skill_groups WHERE profile_id = @profile_id AND category = '基础能力');
SET @skill_framework = (SELECT id FROM skill_groups WHERE profile_id = @profile_id AND category = '框架与工程');
SET @skill_fullstack = (SELECT id FROM skill_groups WHERE profile_id = @profile_id AND category = '全栈与工具');

INSERT INTO skill_items (skill_group_id, content, sort_order) VALUES
(@skill_basic, 'HTML / CSS / JavaScript', 1),
(@skill_basic, 'W3C 标准', 2),
(@skill_basic, 'Echarts 数据可视化', 3),
(@skill_framework, 'Vue.js 全家, 大型项目经验', 1),
(@skill_framework, 'React / Vite / Ant Design', 2),
(@skill_framework, 'Webpack / Less / Sass', 3),
(@skill_fullstack, 'Node.js 简单接口服务', 1),
(@skill_fullstack, 'Uniapp 多端开发', 2),
(@skill_fullstack, 'Cursor AI 辅助编程', 3);

INSERT INTO work_experience (profile_id, company, period, role, department, sort_order) VALUES
(@profile_id, '杭州有数科技有限公司', '2021.11 – 2022.01', '前端开发工程师（实习）', '数字科技部', 1),
(@profile_id, '杭州广电云网络科技有限公司', '2022.04 – 2025.08', '前端开发工程师', '技术开发部', 2),
(@profile_id, '江阴逐日信息技术有限公司', '2025.09 – 2025.11', '前端开发工程师', '信息技术部', 3),
(@profile_id, '牙颜医疗（上海）科技有限公司', '2026.02 – 至今', '前端开发工程师', '技术部', 4);

SET @work1 = (SELECT id FROM work_experience WHERE profile_id = @profile_id AND company = '杭州有数科技有限公司');
SET @work2 = (SELECT id FROM work_experience WHERE profile_id = @profile_id AND company = '杭州广电云网络科技有限公司');
SET @work3 = (SELECT id FROM work_experience WHERE profile_id = @profile_id AND company = '江阴逐日信息技术有限公司');
SET @work4 = (SELECT id FROM work_experience WHERE profile_id = @profile_id AND company = '牙颜医疗（上海）科技有限公司');

INSERT INTO work_experience_highlights (work_experience_id, content, sort_order) VALUES
(@work1, '参与前端业务模块开发与联调', 1),
(@work2, 'iframe 微前端 SaaS 云平台，负责 89+ SPA（ToB）与 7+ SSR（ToC）项目的开发、维护与重构', 1),
(@work2, '高并发直播互动、AI 服务集成、聚合页等多条业务线核心开发', 2),
(@work3, '女装跨境电商业务，负责小程序、一体机终端页面开发与管理后台', 1),
(@work4, '医学智能诊断平台，负责前端开发与维护', 1),
(@work4, '医学、销售、工厂三大业务线开发', 2);

INSERT INTO project_experience (profile_id, name, period, description, sort_order) VALUES
(@profile_id, '广电云 H5 直播互动系统', '2022.04 – 2025.08', 'ToC SSR 高并发直播项目，支持聊天、抽奖、投票等互动，含 ToB 控制台配置。', 1),
(@profile_id, '业务层 AI 服务集成', '2024.02 – 2025.08', '将大模型 AI 能力集成至业务项目，覆盖问答、生成与创作场景。', 2),
(@profile_id, '广电云聚合页', '2023.04 – 2025.08', 'PC / H5 / 微信小程序多端聚合页，B 端可视化拖拽编辑器。', 3),
(@profile_id, '智能数字人 Demo', '2024.08', '中国传媒大学智能教学 ToC 演示，数字人平台实时播报。', 4),
(@profile_id, '服饰面料一体机', '2025.10 – 2025.11', '一体机终端供客户查看面料详情与下单，含管理后台。', 5);

SET @proj1 = (SELECT id FROM project_experience WHERE profile_id = @profile_id AND name = '广电云 H5 直播互动系统');
SET @proj2 = (SELECT id FROM project_experience WHERE profile_id = @profile_id AND name = '业务层 AI 服务集成');
SET @proj3 = (SELECT id FROM project_experience WHERE profile_id = @profile_id AND name = '广电云聚合页');
SET @proj4 = (SELECT id FROM project_experience WHERE profile_id = @profile_id AND name = '智能数字人 Demo');
SET @proj5 = (SELECT id FROM project_experience WHERE profile_id = @profile_id AND name = '服饰面料一体机');

INSERT INTO project_experience_stack (project_experience_id, content, sort_order) VALUES
(@proj1, 'Vue2', 1), (@proj1, 'Nuxt', 2), (@proj1, 'Echarts', 3),
(@proj2, 'Vue2', 1), (@proj2, 'Webpack', 2), (@proj2, 'iView', 3),
(@proj3, 'Uniapp', 1),
(@proj4, 'React', 1), (@proj4, 'Vite', 2), (@proj4, 'Ant Design', 3),
(@proj5, 'Vue3', 1), (@proj5, 'Vite', 2), (@proj5, 'Element Plus', 3), (@proj5, 'Three.js', 4);

INSERT INTO project_experience_highlights (project_experience_id, content, sort_order) VALUES
(@proj1, '优化 Canvas 多机位切换显示，降低卡顿与流量消耗', 1),
(@proj1, '基于 DMS 分布式消息实现实时互动', 2),
(@proj1, '设计动态样式配置系统', 3),
(@proj2, 'AI 直播助手（问答与展示效果）', 1),
(@proj2, 'AI 驱动页面生成（文生页）', 2),
(@proj2, 'AI 视频创作工具', 3),
(@proj3, '一套代码多端适配', 1),
(@proj3, '可视化页面搭建能力', 2),
(@proj4, '数字人实时播报交互', 1),
(@proj4, '教学场景演示落地', 2),
(@proj5, 'Three.js 渲染 3D 面料模型，支持交互查看', 1),
(@proj5, '终端页面与管理后台全栈前端开发', 2);

INSERT INTO projects (id, name, description, status, icon, accent, route_name, external_url, sort_order) VALUES
(
  'ai-assistant',
  'AI 助手',
  '基于 DeepSeek 的智能对话助手，支持流式回复，可解答技术问题、梳理思路与辅助创作。',
  'live',
  '✨',
  '#f59e0b',
  'AiAssistant',
  NULL,
  1
),
(
  'node-mind-map',
  '节点脑图',
  '可视化编辑与管理节点流程，支持 Konva 画布拖拽、对齐吸附、预览与 JSON 导出。',
  'live',
  '🧠',
  '#667eea',
  'NodeMindMap',
  NULL,
  2
);

INSERT INTO project_tags (project_id, tag, sort_order) VALUES
('ai-assistant', 'DeepSeek', 1),
('ai-assistant', 'Vue 3', 2),
('ai-assistant', 'SSE 流式', 3),
('ai-assistant', 'Node.js', 4),
('node-mind-map', 'Vue 3', 1),
('node-mind-map', 'TypeScript', 2),
('node-mind-map', 'Element Plus', 3),
('node-mind-map', 'Konva', 4);
