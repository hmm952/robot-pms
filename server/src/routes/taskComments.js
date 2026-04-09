/**
 * 任务备注（评论）REST API
 * GET  /api/task-comments?taskId=
 * POST /api/task-comments
 */
import { Router } from 'express';
import { body, query, validationResult } from 'express-validator';
import { db, insertId } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendServerError } from '../utils/http.js';

const router = Router();

router.get('/', requireAuth, query('taskId').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const rows = db
      .prepare(
        `SELECT c.*, u.username AS author_username, u.full_name AS author_full_name
         FROM task_comments c
         LEFT JOIN users u ON u.id = c.author_id
         WHERE c.task_id = ?
         ORDER BY c.id DESC`,
      )
      .all(req.query.taskId);
    res.json(rows);
  } catch (e) {
    sendServerError(res, e);
  }
});

router.post(
  '/',
  requireAuth,
  body('task_id').isInt(),
  body('body').trim().isLength({ min: 1, max: 5000 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { task_id, body: text } = req.body;
    try {
      const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(task_id);
      if (!task) return res.status(404).json({ message: '任务不存在' });
      const info = db
        .prepare(`INSERT INTO task_comments (task_id, author_id, body) VALUES (?, ?, ?)`)
        .run(task_id, req.user.id, text);
      const row = db
        .prepare(
          `SELECT c.*, u.username AS author_username, u.full_name AS author_full_name
           FROM task_comments c
           LEFT JOIN users u ON u.id = c.author_id
           WHERE c.id = ?`,
        )
        .get(insertId(info));
      res.status(201).json(row);
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

export default router;

