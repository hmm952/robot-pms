# 机器人产品线 · 项目管理系统（Robot PMS）

面向**单一制造业硬件产品（机器人）**的全栈项目框架：React + Tailwind 前端，Node.js + Express + SQLite 后端，内置管理员/普通用户与完整 REST API。界面为简洁企业风，适合制造与研发协同场景。

## 技术栈与版本（固定）

| 部分 | 技术 | 版本 |
|------|------|------|
| 前端 | React | 18.3.1 |
| 前端 | react-router-dom | 6.28.0 |
| 前端 | axios | 1.7.9 |
| 前端 | Vite | 5.4.11 |
| 前端 | Tailwind CSS | 3.4.16 |
| 后端 | Node.js | 建议 **18+** 或 **20 LTS** |
| 后端 | Express | 4.21.2 |
| 后端 | SQLite | 使用 **Node 内置** `node:sqlite`（无需额外数据库安装） |
| 后端 | jsonwebtoken / bcryptjs | 见 `server/package.json` |

> **Node 版本要求**：`>= 22.5.0`（推荐与官网一致的 **24 LTS**）。首次运行若出现 `SQLite is an experimental feature` 提示为正常现象，不影响使用。

## 目录结构

```
robot-pms/
  client/          # 前端（Vite + React + Tailwind）
  server/          # 后端（Express + SQLite）
  README.md
```

## 小白启动步骤（Windows / macOS / Linux 通用）

### 1. 安装 Node.js

从 [https://nodejs.org](https://nodejs.org) 安装 **LTS** 版本，安装完成后在终端执行：

```bash
node -v
npm -v
```

### 2. 配置后端环境变量

```bash
cd server
copy .env.example .env
```

（macOS/Linux 使用 `cp .env.example .env`）

按需编辑 `server/.env`：至少将 `JWT_SECRET` 改为一串长随机字符。

### 3. 安装依赖并启动后端

```bash
cd server
npm install
npm run dev
```

看到控制台输出 `[robot-pms] API 已启动: http://localhost:3001` 即成功。

**首次启动**会在 `server/data/robot_pms.db` 创建 SQLite 数据库，并自动写入演示数据与默认管理员：

- 用户名：`admin`
- 密码：`admin123`

生产环境请立即修改密码，并可通过 `POST /api/auth/register`（需管理员 Token）创建普通用户。

### 4. 安装依赖并启动前端（新开一个终端）

```bash
cd client
npm install
npm run dev
```

浏览器访问终端里提示的地址（一般为 **http://localhost:5173**）。前端已将 `/api` 代理到 `http://localhost:3001`，无需额外配置 CORS。

### 5. 登录验证

使用 `admin` / `admin123` 登录，左侧可切换六个模块：**项目总览、任务管理、评审管理、合同管理、人力与 KPI、竞品分析**。顶部下拉框可切换当前项目（示例已预置一个机器人研发项目）。

## 线上部署（单服务：Express 托管前端 dist）

构建出 `client/dist` 且其中存在 `index.html` 时，**仅启动 `server`** 即可在同一端口提供前端页面与 `/api`，适合 [Render](https://render.com) 等免费 Web Service（简历里一条链接即可）。

### 本地验证生产形态

```bash
cd client && npm ci && npm run build
cd ../server && npm ci && npm start
```

浏览器访问 `http://localhost:3001`（或 `.env` / 平台注入的 `PORT`）。前端开发仍推荐使用 `client` 的 `npm run dev` + 代理，无需每次构建。

### Render 示例配置

将 **Root Directory** 设为仓库内的 `robot-pms`（若整仓就是本项目则留空根目录）。

| 项 | 值 |
|----|-----|
| **Build Command** | `cd client && npm ci && npm run build && cd ../server && npm ci` |
| **Start Command** | `cd server && npm start` |
| **Environment** | `JWT_SECRET` 设为长随机串；`NODE_VERSION` 建议 **22** 或 **24**（与 `server/package.json` 的 `engines` 一致）。`PORT` 由平台注入，勿写死。 |

说明：免费实例磁盘多为**临时**的，SQLite 演示数据可能在休眠或重装后丢失；冷启动后首次访问可能较慢。

## 权限说明

| 角色 | 说明 |
|------|------|
| `admin` | 可访问用户列表 `GET /api/users`、可 `POST /api/auth/register` 创建用户、可删除项目 `DELETE /api/projects/:id` |
| `user` | 可读写各业务资源（项目 CRUD 中删除项目仅限管理员） |

## API 一览（前缀 `/api`）

| 模块 | 路径 | 说明 |
|------|------|------|
| 认证 | `POST /auth/login`, `GET /auth/me`, `POST /auth/register` | JWT 7 天有效期 |
| 用户 | `GET /users` | 仅管理员 |
| 项目 | `/projects` | 标准 CRUD |
| 任务 | `/tasks` | 支持 `?projectId=` |
| 评审 | `/reviews` | 支持 `?projectId=` |
| 合同 | `/contracts` | 支持 `?projectId=` |
| KPI | `/kpi` | 支持 `?projectId=`、`?userId=` |
| 竞品 | `/competitors` | 支持 `?projectId=` |
| 集成 | `GET /integrations/status`, `POST /integrations/rag/query` | RAG/SMTP 状态与占位检索 |

各路由文件内均有 **中文模块注释** 与方法级说明，可直接作为接口文档入口阅读。

## 竞品模块：URL 短码字典（筛选/分页/草稿记忆）

为支持“刷新不丢状态”，`client/src/pages/CompetitorsPage.jsx` 使用了 URL 参数短码。团队排障或联调时可直接对照下表：

| 短码 | 含义 |
|------|------|
| `cid` | `competitorId`（竞品筛选） |
| `src` | `sourceType`（来源筛选：website/media/patent） |
| `sd` | `startDate`（开始日期） |
| `ed` | `endDate`（结束日期） |
| `sp` | snapshots 页码 |
| `sps` | snapshots 每页条数 |
| `lp` | crawl logs 页码 |
| `lps` | crawl logs 每页条数 |
| `cfh` | 爬虫配置 `frequency_hours` 草稿 |
| `cen` | 爬虫配置 `enabled` 草稿（`1/0`） |
| `cws` | 爬虫配置 `source_websites` 草稿（换行拼接） |
| `cmd` | 爬虫配置 `source_media` 草稿（换行拼接） |
| `cpt` | 爬虫配置 `source_patents` 草稿（换行拼接） |
| `iws` | “官网来源输入框”临时草稿 |
| `imd` | “媒体来源输入框”临时草稿 |
| `ipt` | “专利来源输入框”临时草稿 |

## 通知运营台：URL 短码字典（筛选/分页记忆）

为支持“刷新不丢状态”，`client/src/pages/NotificationCenterPage.jsx` 使用了 URL 参数短码。团队排障或联调时可直接对照下表：

| 短码 | 含义 |
|------|------|
| `re` | `rules.eventType`（规则事件类型筛选） |
| `ren` | `rules.enabled`（规则启停状态筛选） |
| `rp` | rules 页码 |
| `rps` | rules 每页条数 |
| `he` | `history.eventType`（历史事件类型筛选） |
| `hs` | `history.status`（历史发送状态筛选） |
| `hp` | history 页码 |
| `hps` | history 每页条数 |

### 如何快速构造复现链接（通知运营台）

下面给出 3 条可直接替换参数的 URL 模板，适合测试提单时快速定位“筛选 + 分页”场景。

> 假设前端地址为 `http://localhost:5173`，通知页面路由为 `/settings/notify`。

1. **复现“规则列表：事件=任务逾期 + 启用 + 第2页”**

```text
http://localhost:5173/settings/notify?re=task_overdue&ren=1&rp=2&rps=10
```

2. **复现“历史列表：事件=付款提醒 + 状态=failed + 第3页”**

```text
http://localhost:5173/settings/notify?he=payment_reminder&hs=failed&hp=3&hps=10
```

3. **复现“规则与历史同时带条件（联合场景）”**

```text
http://localhost:5173/settings/notify?re=review_reminder&ren=0&rp=1&rps=20&he=review_reminder&hs=sent&hp=2&hps=20
```

常见可替换值：
- `re` / `he`：`task_overdue`、`review_reminder`、`payment_reminder`、`milestone_warning`
- `ren`：`1`（启用）/ `0`（停用）
- `hs`：`pending` / `sent` / `failed`
- `rp`、`hp`：页码（从 `1` 开始）
- `rps`、`hps`：每页条数（如 `10`、`20`）

## 科大讯飞 RAG 与 SMTP（预留）

- **环境变量示例**：见 `server/.env.example`（`IFLYTEK_RAG_*`、`SMTP_*`）。
- **读取配置**：`server/src/config/integrations.js`
- **RAG 调用占位**：`server/src/services/ragClient.js`（实现 HTTP 请求与响应解析）
- **邮件占位**：`server/src/services/mailService.js`（建议后续 `npm install nodemailer` 后补全发送逻辑）

## 许可证

示例框架代码可按需在自有项目中修改与使用。
