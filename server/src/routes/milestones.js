/**
 * 项目里程碑 REST API（EVT / DVT / PVT / MP 硬件阶段模板）
 * GET    /api/milestones?projectId=
 * POST   /api/milestones/apply-hardware-template  优先注册，避免被 /:id 拦截
 * GET    /api/milestones/:id
 * POST   /api/milestones
 * PUT    /api/milestones/:id
 * DELETE /api/milestones/:id
 */
import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { db, insertId, changeCount } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendServerError } from '../utils/http.js';

const router = Router();

const phaseTemplates = ['evt', 'dvt', 'pvt', 'mp', 'custom'];
const milestoneStatus = ['planned', 'active', 'achieved', 'delayed', 'cancelled'];

const HARDWARE_PHASE_DEFAULTS = [
  { phase_template: 'evt', name: 'EVT — 工程验证试产', sort_order: 10 },
  { phase_template: 'dvt', name: 'DVT — 设计验证试产', sort_order: 20 },
  { phase_template: 'pvt', name: 'PVT — 制程验证试产', sort_order: 30 },
  { phase_template: 'mp', name: 'MP — 量产导入', sort_order: 40 },
];

router.get(
  '/',
  requireAuth,
  query('projectId').optional().isInt(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      let rows;
      if (req.query.projectId) {
        rows = db
          .prepare(
            `SELECT * FROM plan_milestones WHERE project_id = ? ORDER BY sort_order ASC, id ASC`,
          )
          .all(req.query.projectId);
      } else {
        rows = db
          .prepare(`SELECT * FROM plan_milestones ORDER BY project_id, sort_order ASC, id ASC`)
          .all();
      }
      res.json(rows);
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post(
  '/apply-hardware-template',
  requireAuth,
  body('project_id').isInt(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const projectId = req.body.project_id;
    try {
      const created = [];
      for (const ph of HARDWARE_PHASE_DEFAULTS) {
        const exists = db
          .prepare(
            `SELECT id FROM plan_milestones WHERE project_id = ? AND phase_template = ?`,
          )
          .get(projectId, ph.phase_template);
        if (exists) continue;
        const info = db
          .prepare(
            `INSERT INTO plan_milestones (project_id, name, phase_template, target_date, status, description, sort_order)
             VALUES (?, ?, ?, NULL, 'planned', NULL, ?)`,
          )
          .run(projectId, ph.name, ph.phase_template, ph.sort_order);
        const id = insertId(info);
        created.push(db.prepare(`SELECT * FROM plan_milestones WHERE id = ?`).get(id));
      }
      res.status(201).json({ created, message: `已创建 ${created.length} 条阶段里程碑（已存在的阶段已跳过）` });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.get('/:id', requireAuth, param('id').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const row = db.prepare(`SELECT * FROM plan_milestones WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ message: '里程碑不存在' });
    res.json(row);
  } catch (e) {
    sendServerError(res, e);
  }
});

router.post(
  '/',
  requireAuth,
  body('project_id').isInt(),
  body('name').trim().notEmpty(),
  body('phase_template').optional().isIn(phaseTemplates),
  body('target_date').optional(),
  body('status').optional().isIn(milestoneStatus),
  body('description').optional(),
  body('sort_order').optional().isInt(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const {
      project_id,
      name,
      phase_template,
      target_date,
      status,
      description,
      sort_order,
    } = req.body;
    try {
      const info = db
        .prepare(
          `INSERT INTO plan_milestones (project_id, name, phase_template, target_date, status, description, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          project_id,
          name,
          phase_template || 'custom',
          target_date ?? null,
          status || 'planned',
          description ?? null,
          sort_order ?? 0,
        );
      const row = db
        .prepare(`SELECT * FROM plan_milestones WHERE id = ?`)
        .get(insertId(info));
      res.status(201).json(row);
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
  body('phase_template').optional().isIn(phaseTemplates),
  body('target_date').optional({ nullable: true }),
  body('status').optional().isIn(milestoneStatus),
  body('description').optional({ nullable: true }),
  body('sort_order').optional().isInt(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const id = Number(req.params.id);
    const existing = db.prepare(`SELECT * FROM plan_milestones WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ message: '里程碑不存在' });
    const next = { ...existing, ...req.body };
    try {
      db.prepare(
        `UPDATE plan_milestones SET
          name = ?, phase_template = ?, target_date = ?, status = ?,
          description = ?, sort_order = ?, updated_at = datetime('now')
         WHERE id = ?`,
      ).run(
        next.name,
        next.phase_template,
        next.target_date ?? null,
        next.status,
        next.description ?? null,
        next.sort_order ?? 0,
        id,
      );
      res.json(db.prepare(`SELECT * FROM plan_milestones WHERE id = ?`).get(id));
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.delete('/:id', requireAuth, param('id').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    db.prepare(`UPDATE tasks SET milestone_id = NULL WHERE milestone_id = ?`).run(req.params.id);
    const r = db.prepare(`DELETE FROM plan_milestones WHERE id = ?`).run(req.params.id);
    if (changeCount(r) === 0) return res.status(404).json({ message: '里程碑不存在' });
    res.status(204).send();
  } catch (e) {
    sendServerError(res, e);
  }
});

export default router;
