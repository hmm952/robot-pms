/**
 * 工时填报 REST API
 * GET  /api/worklogs?projectId=&userId=&from=&to=
 * POST /api/worklogs/upsert  { project_id, work_date, hours, note? }  — 默认当前用户
 */
import { Router } from 'express';
import { body, query, validationResult } from 'express-validator';
import { db, insertId } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendServerError } from '../utils/http.js';

const router = Router();

router.get(
  '/',
  requireAuth,
  query('projectId').optional().isInt(),
  query('userId').optional().isInt(),
  query('from').optional().isString(),
  query('to').optional().isString(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { projectId, userId, from, to } = req.query;
    try {
      let sql = `
        SELECT w.*, u.username, u.full_name
        FROM worklog_entries w
        LEFT JOIN users u ON u.id = w.user_id
        WHERE 1=1
      `;
      const args = [];
      if (projectId) {
        sql += ` AND w.project_id = ?`;
        args.push(projectId);
      }
      if (userId) {
        sql += ` AND w.user_id = ?`;
        args.push(userId);
      }
      if (from) {
        sql += ` AND w.work_date >= ?`;
        args.push(from);
      }
      if (to) {
        sql += ` AND w.work_date <= ?`;
        args.push(to);
      }
      sql += ` ORDER BY w.work_date ASC, w.id ASC`;
      const rows = db.prepare(sql).all(...args);
      res.json(rows);
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post(
  '/upsert',
  requireAuth,
  body('project_id').isInt(),
  body('work_date').isString().isLength({ min: 10, max: 10 }),
  body('hours').isFloat({ min: 0, max: 24 }),
  body('note').optional({ nullable: true }).isString(),
  body('user_id').optional({ nullable: true }).isInt(), // 管理员可代填
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { project_id, work_date, hours, note, user_id } = req.body;
    const uid = req.user.role === 'admin' && user_id ? Number(user_id) : Number(req.user.id);
    try {
      const existing = db
        .prepare(
          `SELECT * FROM worklog_entries WHERE project_id = ? AND user_id = ? AND work_date = ?`,
        )
        .get(project_id, uid, work_date);
      if (existing) {
        db.prepare(
          `UPDATE worklog_entries
           SET hours = ?, note = ?, updated_at = datetime('now')
           WHERE id = ?`,
        ).run(hours, note ?? null, existing.id);
        res.json(db.prepare(`SELECT * FROM worklog_entries WHERE id = ?`).get(existing.id));
        return;
      }
      const info = db
        .prepare(
          `INSERT INTO worklog_entries (project_id, user_id, work_date, hours, note)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(project_id, uid, work_date, hours, note ?? null);
      res.status(201).json(db.prepare(`SELECT * FROM worklog_entries WHERE id = ?`).get(insertId(info)));
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

export default router;

