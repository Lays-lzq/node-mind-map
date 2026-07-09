# node-mind-map

个人作品集站点 + 节点脑图编辑器。前端 Vue 3，后端 Express + MySQL。

## 技术栈

- 前端：Vue 3 + TypeScript + Vite + Element Plus + Konva
- 后端：Node.js + Express + MySQL

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp server/.env.example server/.env
```

使用 Docker 时，`server/.env` 保持默认即可（密码为 `root`）。

### 3. 启动 MySQL（Docker）

需要先安装并启动 [Docker Desktop](https://www.docker.com/products/docker-desktop/)。

```bash
# 拉取镜像（可选，db:up 也会自动拉取）
npm run db:pull

# 启动 MySQL 容器
npm run db:up

# 等待 MySQL 就绪并初始化数据库（建表 + 导入数据）
npm run db:setup
```

也可以分步执行：

```bash
npm run db:up
npm run db:init
```

常用命令：

```bash
npm run db:down    # 停止并移除容器
docker compose ps # 查看容器状态
```

需要同时启动后端 API 和前端：

```bash
# 终端 1：后端 API（默认 http://localhost:3000）
npm run dev:server

# 终端 2：前端（默认 http://localhost:8100）
npm run dev
```

## API 接口

统一响应格式：

```json
{
  "code": 0,
  "data": {},
  "msg": "success"
}
```

- `code: 0` 表示成功，非 0 表示失败
- `data` 为业务数据
- `msg` 为提示信息（含错误说明）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/profile` | 获取个人信息（About 页） |
| GET | `/api/projects` | 获取项目列表（首页） |
| POST | `/api/ai/generate` | AI 生成脑图（需配置 DeepSeek） |
| POST | `/api/ai/expand` | AI 展开节点子节点 |
| POST | `/api/ai/chat` | AI 对话助手（SSE 流式） |

## 目录结构

```
server/
  index.js              # Express 入口
  db.js                 # MySQL 连接池
  routes/               # API 路由
  sql/
    schema.sql          # 建表语句
    seed.sql            # 初始数据
  scripts/init-db.js    # 数据库初始化脚本

src/
  api/                  # 前端 API 请求
  types/                # TypeScript 类型
  views/
    home/               # 首页
    about/              # 关于我
    nodeMindMap/        # 节点脑图
```

## 修改数据

数据存储在 MySQL 中，可以直接用 SQL 或 MySQL 客户端修改，例如：

```sql
USE node_mind_map;

-- 修改个人总结
UPDATE profile_summary SET content = '新的总结内容' WHERE id = 1;

-- 新增首页项目
INSERT INTO projects (id, name, description, status, icon, accent, sort_order)
VALUES ('my-project', '我的项目', '项目描述', 'live', '🚀', '#667eea', 2);
```

修改后刷新页面即可看到更新。

## 构建

```bash
npm run build
npm run preview
```

生产环境需单独部署后端 API，并将 `VITE_API_BASE_URL` 指向实际 API 地址。

## 脑图编辑器

节点脑图路由：`/nodeMindMap`

### AI 助手（DeepSeek）

1. 在 [DeepSeek 开放平台](https://platform.deepseek.com/) 获取 API Key
2. 配置 `server/.env`：

```env
DEEPSEEK_API_KEY=sk-你的密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

3. 重启后端 `npm run dev:server`

功能：
- **AI 助手**（独立项目 `/aiAssistant`）：首页进入，通用智能对话
- **AI 生成**（脑图内）：工具栏按钮，输入主题自动生成脑图
- **AI 展开**（脑图内）：节点右键菜单，为选中节点展开子节点

## Docker 镜像拉取失败

若出现 `context deadline exceeded` 或 `failed to resolve reference docker.io/library/mysql`，说明 Docker Hub 访问超时（国内常见）。

项目已默认改用国内镜像源，请重新执行：

```bash
npm run db:pull
npm run db:setup
```

若仍失败，编辑项目根目录 `.env`，替换 `MYSQL_IMAGE`：

```env
# 方案 1：DaoCloud（默认）
MYSQL_IMAGE=docker.m.daocloud.io/library/mysql:8.0

# 方案 2：1ms.run
MYSQL_IMAGE=docker.1ms.run/library/mysql:8.0

# 方案 3：官方源（需配置 Docker 镜像加速）
MYSQL_IMAGE=mysql:8.0
```

也可在 Docker Desktop → Settings → Docker Engine 中添加镜像加速：

```json
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://docker.1ms.run"
  ]
}
```

保存后重启 Docker Desktop，再执行 `npm run db:setup`。
