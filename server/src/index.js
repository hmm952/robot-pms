/**
 * 机器人单产品线项目管理系统 — API 入口
 * REST 前缀: /api
 */
import 'dotenv/config';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import { seedIfEmpty } from './seed.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import projectsRoutes from './routes/projects.js';
import tasksRoutes from './routes/tasks.js';
import reviewsRoutes from './routes/reviews.js';
import contractsRoutes from './routes/contracts.js';
import kpiRoutes from './routes/kpi.js';
import competitorsRoutes, { startCompetitorCrawlerJob } from './routes/competitors.js';
import integrationsRoutes from './routes/integrations.js';
import milestonesRoutes from './routes/milestones.js';
import taskLinksRoutes from './routes/taskLinks.js';
import taskCommentsRoutes from './routes/taskComments.js';
import taskAttachmentsRoutes from './routes/taskAttachments.js';
import worklogsRoutes from './routes/worklogs.js';
import workloadsRoutes from './routes/workloads.js';
import meetingsRoutes from './routes/meetings.js';
import notificationsRoutes from './routes/notifications.js';
import { startNotificationJob } from './services/notificationService.js';

seedIfEmpty();
startCompetitorCrawlerJob();
startNotificationJob();

const app = express();
const PORT = Number(process.env.PORT || 3001);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 生产构建的前端产物：robot-pms/client/dist（与 server 同级） */
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
const clientIndexHtml = path.join(clientDist, 'index.html');
const serveClient = fs.existsSync(clientIndexHtml);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'robot-pms-api', ts: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/milestones', milestonesRoutes);
app.use('/api/task-links', taskLinksRoutes);
app.use('/api/task-comments', taskCommentsRoutes);
app.use('/api/task-attachments', taskAttachmentsRoutes);
app.use('/api/worklogs', worklogsRoutes);
app.use('/api/workloads', workloadsRoutes);
app.use('/api/meetings', meetingsRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/contracts', contractsRoutes);
app.use('/api/kpi', kpiRoutes);
app.use('/api/competitors', competitorsRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/notifications', notificationsRoutes);

if (serveClient) {
  app.use(express.static(clientDist, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api')) return next();
    res.sendFile(clientIndexHtml, (err) => (err ? next(err) : undefined));
  });
}

// 404（含未匹配的 /api/*）
app.use((_req, res) => {
  res.status(404).json({ message: '资源不存在' });
});

app.listen(PORT, () => {
  const base = `http://localhost:${PORT}`;
  console.log(`[robot-pms] API 已启动: ${base}`);
  console.log(`[robot-pms] 健康检查: ${base}/health`);
  if (serveClient) {
    console.log(`[robot-pms] 已托管前端静态资源: ${clientDist}`);
  }
});
