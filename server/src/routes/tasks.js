/**
 * 任务 REST API（支持 WBS 父节点、里程碑、起止日、进度；?plan=1 返回甘特用扩展字段）
 * GET    /api/tasks?projectId=&plan=1
 * GET    /api/tasks/:id
 * POST   /api/tasks
 * PUT    /api/tasks/:id
 * DELETE /api/tasks/:id  — 级联删除子任务
 */
import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { db, insertId } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendServerError } from '../utils/http.js';
import {
  enrichPlanTasks,
  deleteTaskWithDescendants,
  rollupAncestorProgress,
} from '../services/planTaskService.js';

const router = Router();

const taskStatus = ['todo', 'in_progress', 'blocked', 'done'];
const priorityValues = ['low', 'medium', 'high', 'critical'];

function validateParentAndMilestone(projectId, parentId, milestoneId) {
  if (parentId) {
    const p = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(parentId);
    if (!p) return '父任务不存在';
    if (p.project_id !== projectId) return '父任务必须与当前任务属于同一项目';
  }
  if (milestoneId) {
    const m = db.prepare('SELECT project_id FROM plan_milestones WHERE id = ?').get(milestoneId);
    if (!m) return '里程碑不存在';
    if (m.project_id !== projectId) return '里程碑必须与当前任务属于同一项目';
  }
  return null;
}

/** 新父节点是否落在当前任务子树中（会形成环） */
function parentWouldCreateCycle(taskId, newParentId) {
  if (!newParentId) return false;
  if (Number(newParentId) === Number(taskId)) return true;
  let cur = Number(newParentId);
  const seen = new Set();
  while (cur) {
    if (cur === Number(taskId)) return true;
    if (seen.has(cur)) break;
    seen.add(cur);
    const row = db.prepare('SELECT parent_id FROM tasks WHERE id = ?').get(cur);
    cur = row?.parent_id != null ? Number(row.parent_id) : null;
  }
  return false;
}

function selectTasksForProject(projectId) {
  return db
    .prepare(
      `SELECT t.*, u.username AS assignee_name,
              m.name AS milestone_name, m.phase_template AS milestone_phase
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assignee_id
       LEFT JOIN plan_milestones m ON m.id = t.milestone_id
       WHERE t.project_id = ?
       ORDER BY t.parent_id IS NOT NULL, t.parent_id, t.sort_order ASC, t.id ASC`,
    )
    .all(projectId);
}

router.get(
  '/',
  requireAuth,
  query('projectId').optional().isInt(),
  query('status').optional().isIn(taskStatus),
  query('assigneeId').optional().isInt(),
  query('priority').optional().isIn(priorityValues),
  query('q').optional().trim(),
  query('plan').optional().isIn(['0', '1']),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { projectId, plan, status, assigneeId, priority, q } = req.query;
    try {
      let rows;
      if (projectId) {
        rows = selectTasksForProject(projectId);
      } else {
        rows = db
          .prepare(
            `SELECT t.*, u.username AS assignee_name,
                    m.name AS milestone_name, m.phase_template AS milestone_phase
             FROM tasks t
             LEFT JOIN users u ON u.id = t.assignee_id
             LEFT JOIN plan_milestones m ON m.id = t.milestone_id
             ORDER BY t.updated_at DESC`,
          )
          .all();
      }
      if (plan === '1') rows = enrichPlanTasks(rows);
      // 筛选（待办列表）
      if (status) rows = rows.filter((t) => t.status === status);
      if (assigneeId) rows = rows.filter((t) => Number(t.assignee_id || 0) === Number(assigneeId));
      if (priority) rows = rows.filter((t) => t.priority === priority);
      if (q) {
        const kw = String(q).toLowerCase();
        rows = rows.filter((t) => String(t.title || '').toLowerCase().includes(kw));
      }

      // 到期提醒/预警：返回计算字段（不依赖邮件）
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      rows = rows.map((t) => {
        const due = t.end_date || t.due_date || null;
        let due_in_days = null;
        let warning_level = 'none'; // none | due_soon | overdue | escalated
        if (due) {
          const d = new Date(`${due}T12:00:00`);
          due_in_days = Math.ceil((d.getTime() - today.getTime()) / (24 * 3600 * 1000));
          const rdb = Number(t.reminder_days_before ?? 3);
          if (t.status !== 'done' && d < today) warning_level = 'overdue';
          if (t.status !== 'done' && due_in_days != null && due_in_days <= rdb && due_in_days >= 0)
            warning_level = 'due_soon';
          const esc = Number(t.escalation_level ?? 0);
          if (t.status !== 'done' && d < today && esc >= 1) warning_level = 'escalated';
        }
        return { ...t, due_in_days, warning_level };
      });
      res.json(rows);
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

/**
 * 预留：其他模块同步创建任务（如会议纪要 Action Items）
 * POST /api/tasks/sync-create
 * body: { project_id, title, source_type, source_ref_id, source_title, assignee_id?, due_date? }
 */
router.post(
  '/sync-create',
  requireAuth,
  body('project_id').isInt(),
  body('title').trim().notEmpty(),
  body('source_type').optional().isIn(['meeting', 'review', 'email', 'other']),
  body('source_ref_id').optional().trim(),
  body('source_title').optional().trim(),
  body('assignee_id').optional({ nullable: true }).isInt(),
  body('due_date').optional({ nullable: true }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { project_id, title, source_type, source_ref_id, source_title, assignee_id, due_date } =
      req.body;
    try {
      const info = db
        .prepare(
          `INSERT INTO tasks (project_id, title, status, priority, assignee_id, reporter_id, due_date, progress)
           VALUES (?, ?, 'todo', 'medium', ?, ?, ?, 0)`,
        )
        .run(project_id, title, assignee_id ?? null, req.user.id, due_date ?? null);
      const newId = insertId(info);
      if (source_type) {
        db.prepare(
          `INSERT INTO task_external_links (task_id, link_type, ref_id, ref_title, note)
           VALUES (?, ?, ?, ?, 'auto-sync')`,
        ).run(newId, source_type, source_ref_id ?? null, source_title ?? null);
      }
      res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(newId));
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.get('/:id', requireAuth, param('id').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const row = db
      .prepare(
        `SELECT t.*, u.username AS assignee_name,
                m.name AS milestone_name, m.phase_template AS milestone_phase
         FROM tasks t
         LEFT JOIN users u ON u.id = t.assignee_id
         LEFT JOIN plan_milestones m ON m.id = t.milestone_id
         WHERE t.id = ?`,
      )
      .get(req.params.id);
    if (!row) return res.status(404).json({ message: '任务不存在' });
    res.json(row);
  } catch (e) {
    sendServerError(res, e);
  }
});

router.post(
  '/',
  requireAuth,
  body('project_id').isInt(),
  body('title').trim().notEmpty(),
  body('description').optional(),
  body('status').optional().isIn(taskStatus),
  body('priority').optional().isIn(priorityValues),
  body('assignee_id').optional().isInt(),
  body('reporter_id').optional().isInt(),
  body('due_date').optional(),
  body('parent_id').optional({ nullable: true }).isInt(),
  body('milestone_id').optional({ nullable: true }).isInt(),
  body('start_date').optional({ nullable: true }),
  body('end_date').optional({ nullable: true }),
  body('progress').optional().isFloat({ min: 0, max: 100 }),
  body('sort_order').optional().isInt(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const {
      project_id,
      title,
      description,
      status,
      priority,
      assignee_id,
      reporter_id,
      due_date,
      parent_id,
      milestone_id,
      start_date,
      end_date,
      progress,
      sort_order,
    } = req.body;
    const err = validateParentAndMilestone(
      project_id,
      parent_id ?? null,
      milestone_id ?? null,
    );
    if (err) return res.status(400).json({ message: err });
    const end = end_date ?? due_date ?? null;
    const due = due_date ?? end;
    try {
      const info = db
        .prepare(
          `INSERT INTO tasks (
            project_id, title, description, status, priority,
            assignee_id, reporter_id, due_date, parent_id, milestone_id,
            start_date, end_date, progress, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          project_id,
          title,
          description ?? null,
          status || 'todo',
          priority || 'medium',
          assignee_id ?? null,
          reporter_id ?? req.user.id,
          due ?? null,
          parent_id ?? null,
          milestone_id ?? null,
          start_date ?? null,
          end ?? null,
          progress ?? 0,
          sort_order ?? 0,
        );
      const newId = insertId(info);
      rollupAncestorProgress(newId);
      const row = db
        .prepare(
          `SELECT t.*, u.username AS assignee_name,
                  m.name AS milestone_name, m.phase_template AS milestone_phase
           FROM tasks t
           LEFT JOIN users u ON u.id = t.assignee_id
           LEFT JOIN plan_milestones m ON m.id = t.milestone_id
           WHERE t.id = ?`,
        )
        .get(newId);
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
  body('title').optional().trim().notEmpty(),
  body('description').optional({ nullable: true }),
  body('status').optional().isIn(taskStatus),
  body('priority').optional().isIn(priorityValues),
  body('assignee_id').optional({ nullable: true }).isInt(),
  body('reporter_id').optional({ nullable: true }).isInt(),
  body('due_date').optional({ nullable: true }),
  body('parent_id').optional({ nullable: true }).isInt(),
  body('milestone_id').optional({ nullable: true }).isInt(),
  body('start_date').optional({ nullable: true }),
  body('end_date').optional({ nullable: true }),
  body('progress').optional().isFloat({ min: 0, max: 100 }),
  body('sort_order').optional().isInt(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const id = Number(req.params.id);
    const existing = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ message: '任务不存在' });
    const next = { ...existing, ...req.body };
    if (next.parent_id !== null && next.parent_id !== undefined) {
      const pid = Number(next.parent_id);
      if (parentWouldCreateCycle(id, pid)) {
        return res.status(400).json({ message: '无效的父任务（不能为自身或子任务）' });
      }
    }
    const err = validateParentAndMilestone(
      existing.project_id,
      next.parent_id ?? null,
      next.milestone_id ?? null,
    );
    if (err) return res.status(400).json({ message: err });

    const end = next.end_date ?? next.due_date ?? null;
    const due = next.due_date ?? end;
    try {
      db.prepare(
        `UPDATE tasks SET
          title = ?, description = ?, status = ?, priority = ?,
          assignee_id = ?, reporter_id = ?, due_date = ?,
          parent_id = ?, milestone_id = ?, start_date = ?, end_date = ?,
          progress = ?, sort_order = ?,
          updated_at = datetime('now')
         WHERE id = ?`,
      ).run(
        next.title,
        next.description ?? null,
        next.status,
        next.priority,
        next.assignee_id ?? null,
        next.reporter_id ?? null,
        due ?? null,
        next.parent_id ?? null,
        next.milestone_id ?? null,
        next.start_date ?? null,
        end ?? null,
        next.progress ?? 0,
        next.sort_order ?? 0,
        id,
      );
      rollupAncestorProgress(id);
      const row = db
        .prepare(
          `SELECT t.*, u.username AS assignee_name,
                  m.name AS milestone_name, m.phase_template AS milestone_phase
           FROM tasks t
           LEFT JOIN users u ON u.id = t.assignee_id
           LEFT JOIN plan_milestones m ON m.id = t.milestone_id
           WHERE t.id = ?`,
        )
        .get(id);
      res.json(row);
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.delete('/:id', requireAuth, param('id').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const existing = db.prepare(`SELECT id FROM tasks WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ message: '任务不存在' });
    deleteTaskWithDescendants(Number(req.params.id));
    res.status(204).send();
  } catch (e) {
    sendServerError(res, e);
  }
});

export default router;
