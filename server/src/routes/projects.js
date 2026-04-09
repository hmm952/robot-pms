/**
 * 项目 REST API
 * GET    /api/projects
 * GET    /api/projects/:id
 * POST   /api/projects
 * PUT    /api/projects/:id
 * DELETE /api/projects/:id  — 仅管理员
 */
import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import { db, insertId, changeCount } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { sendServerError } from '../utils/http.js';

const router = Router();

const statusValues = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];

router.get('/', requireAuth, (_req, res) => {
  try {
    const projects = db
      .prepare(
        `SELECT * FROM projects ORDER BY updated_at DESC, id DESC`,
      )
      .all();
    res.json(projects);
  } catch (e) {
    sendServerError(res, e);
  }
});

router.get(
  '/:id',
  requireAuth,
  param('id').isInt(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const p = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(req.params.id);
      if (!p) return res.status(404).json({ message: '项目不存在' });
      res.json(p);
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post(
  '/',
  requireAuth,
  body('name').trim().notEmpty(),
  body('description').optional(),
  body('product_line').optional().trim(),
  body('status').optional().isIn(statusValues),
  body('start_date').optional(),
  body('end_date').optional(),
  body('budget_note').optional(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const {
      name,
      description,
      product_line,
      status,
      start_date,
      end_date,
      budget_note,
    } = req.body;
    try {
      const info = db
        .prepare(
          `INSERT INTO projects (name, description, product_line, status, start_date, end_date, budget_note)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          name,
          description ?? null,
          product_line ?? null,
          status || 'planning',
          start_date ?? null,
          end_date ?? null,
          budget_note ?? null,
        );
      const p = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(insertId(info));
      res.status(201).json(p);
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.put(
  '/:id',
  requireAuth,
  param('id').isInt(),
  body('name').optional().trim().notEmpty(),
  body('description').optional(),
  body('product_line').optional().trim(),
  body('status').optional().isIn(statusValues),
  body('start_date').optional(),
  body('end_date').optional(),
  body('budget_note').optional(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const id = Number(req.params.id);
    const existing = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ message: '项目不存在' });
    const next = { ...existing, ...req.body };
    try {
      db.prepare(
        `UPDATE projects SET
          name = ?, description = ?, product_line = ?, status = ?,
          start_date = ?, end_date = ?, budget_note = ?,
          updated_at = datetime('now')
         WHERE id = ?`,
      ).run(
        next.name,
        next.description ?? null,
        next.product_line ?? null,
        next.status,
        next.start_date ?? null,
        next.end_date ?? null,
        next.budget_note ?? null,
        id,
      );
      res.json(db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id));
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  param('id').isInt(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const id = Number(req.params.id);
    try {
      const r = db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
      if (changeCount(r) === 0) return res.status(404).json({ message: '项目不存在' });
      res.status(204).send();
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

export default router;
