/**
 * 任务附件 REST API（本地磁盘存储）：
 * GET    /api/task-attachments?taskId=
 * POST   /api/task-attachments/upload?taskId=   multipart/form-data field: file
 * DELETE /api/task-attachments/:id
 */
import { Router } from 'express';
import { param, query, validationResult } from 'express-validator';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, insertId, changeCount } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendServerError } from '../utils/http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadRoot = path.join(__dirname, '..', '..', 'uploads', 'tasks');
fs.mkdirSync(uploadRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-() ]+/g, '_');
    const name = `${Date.now()}_${Math.random().toString(16).slice(2)}_${safe}`;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

const router = Router();

router.get('/', requireAuth, query('taskId').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const rows = db
      .prepare(
        `SELECT a.*, u.username AS uploader_username, u.full_name AS uploader_full_name
         FROM task_attachments a
         LEFT JOIN users u ON u.id = a.uploader_id
         WHERE a.task_id = ?
         ORDER BY a.id DESC`,
      )
      .all(req.query.taskId);
    res.json(
      rows.map((r) => ({
        ...r,
        url: `/uploads/tasks/${r.storage_path}`,
      })),
    );
  } catch (e) {
    sendServerError(res, e);
  }
});

router.post(
  '/upload',
  requireAuth,
  query('taskId').isInt(),
  upload.single('file'),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const taskId = Number(req.query.taskId);
      const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
      if (!task) return res.status(404).json({ message: '任务不存在' });
      if (!req.file) return res.status(400).json({ message: '未收到文件' });

      const info = db
        .prepare(
          `INSERT INTO task_attachments
           (task_id, uploader_id, file_name, mime_type, file_size, storage_path)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          taskId,
          req.user.id,
          req.file.originalname,
          req.file.mimetype,
          req.file.size,
          req.file.filename,
        );

      const row = db
        .prepare(`SELECT * FROM task_attachments WHERE id = ?`)
        .get(insertId(info));
      res.status(201).json({ ...row, url: `/uploads/tasks/${row.storage_path}` });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.delete('/:id', requireAuth, param('id').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const row = db
      .prepare(`SELECT id, storage_path FROM task_attachments WHERE id = ?`)
      .get(req.params.id);
    if (!row) return res.status(404).json({ message: '附件不存在' });
    const r = db.prepare(`DELETE FROM task_attachments WHERE id = ?`).run(req.params.id);
    if (changeCount(r) === 0) return res.status(404).json({ message: '附件不存在' });
    const fp = path.join(uploadRoot, row.storage_path);
    fs.rmSync(fp, { force: true });
    res.status(204).send();
  } catch (e) {
    sendServerError(res, e);
  }
});

export default router;

