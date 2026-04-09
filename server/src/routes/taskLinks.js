/**
 * 任务外部关联预留（会议纪要 meeting、评审 review、邮件 email）
 * GET    /api/task-links?taskId=
 * POST   /api/task-links
 * DELETE /api/task-links/:id
 */
import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { db, insertId, changeCount } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendServerError } from '../utils/http.js';

const router = Router();

const linkTypes = ['meeting', 'review', 'email', 'other'];

router.get(
  '/',
  requireAuth,
  query('taskId').isInt(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const rows = db
        .prepare(
          `SELECT * FROM task_external_links WHERE task_id = ? ORDER BY id DESC`,
        )
        .all(req.query.taskId);
      res.json(rows);
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post(
  '/',
  requireAuth,
  body('task_id').isInt(),
  body('link_type').isIn(linkTypes),
  body('ref_id').optional().trim(),
  body('ref_title').optional().trim(),
  body('note').optional(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { task_id, link_type, ref_id, ref_title, note } = req.body;
    try {
      const task = db.prepare(`SELECT id FROM tasks WHERE id = ?`).get(task_id);
      if (!task) return res.status(404).json({ message: '任务不存在' });
      const info = db
        .prepare(
          `INSERT INTO task_external_links (task_id, link_type, ref_id, ref_title, note)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(task_id, link_type, ref_id ?? null, ref_title ?? null, note ?? null);
      const row = db
        .prepare(`SELECT * FROM task_external_links WHERE id = ?`)
        .get(insertId(info));
      res.status(201).json(row);
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.delete('/:id', requireAuth, param('id').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const r = db.prepare(`DELETE FROM task_external_links WHERE id = ?`).run(req.params.id);
    if (changeCount(r) === 0) return res.status(404).json({ message: '关联不存在' });
    res.status(204).send();
  } catch (e) {
    sendServerError(res, e);
  }
});

export default router;
