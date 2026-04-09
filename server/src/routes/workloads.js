/**
 * 人力负载看板 REST API
 * GET /api/workloads/summary?projectId=&year=&month=
 * GET /api/workloads/tasks?projectId=&userId=
 * POST /api/workloads/reassign  { task_id, assignee_id }  — 资源调度（复用 tasks 字段）
 */
import { Router } from 'express';
import { body, query, validationResult } from 'express-validator';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendServerError } from '../utils/http.js';

const router = Router();

function ymd(y, m, d) {
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate(); // month: 1-12
}

function countWorkdays(year, month) {
  const n = daysInMonth(year, month);
  let c = 0;
  for (let d = 1; d <= n; d += 1) {
    const dt = new Date(year, month - 1, d);
    const wd = dt.getDay(); // 0 Sun .. 6 Sat
    if (wd !== 0 && wd !== 6) c += 1;
  }
  return c;
}

router.get(
  '/summary',
  requireAuth,
  query('projectId').isInt(),
  query('year').isInt({ min: 2000, max: 2100 }),
  query('month').isInt({ min: 1, max: 12 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const projectId = Number(req.query.projectId);
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const from = ymd(year, month, 1);
    const to = ymd(year, month, daysInMonth(year, month));
    const workdays = countWorkdays(year, month);
    try {
      // 项目成员（含部门/产能）
      const members = db
        .prepare(
          `SELECT u.id AS user_id, u.username, u.full_name,
                  d.name AS department_name,
                  ud.capacity_hours_per_day
           FROM project_members pm
           LEFT JOIN users u ON u.id = pm.user_id
           LEFT JOIN user_departments ud ON ud.user_id = u.id
           LEFT JOIN departments d ON d.id = ud.department_id
           WHERE pm.project_id = ?
           ORDER BY u.id`,
        )
        .all(projectId);

      const totals = db
        .prepare(
          `SELECT user_id, SUM(hours) AS total_hours
           FROM worklog_entries
           WHERE project_id = ? AND work_date >= ? AND work_date <= ?
           GROUP BY user_id`,
        )
        .all(projectId, from, to);
      const totalMap = new Map(totals.map((r) => [Number(r.user_id), Number(r.total_hours || 0)]));

      const out = members.map((m) => {
        const capDay = Number(m.capacity_hours_per_day ?? 8);
        const capacity_hours = Math.round(workdays * capDay * 10) / 10;
        const total_hours = Math.round((totalMap.get(Number(m.user_id)) || 0) * 10) / 10;
        const load_pct = capacity_hours > 0 ? Math.round((total_hours * 1000) / capacity_hours) / 10 : 0;
        const warning = load_pct >= 80;
        return {
          user_id: m.user_id,
          username: m.username,
          full_name: m.full_name,
          department_name: m.department_name || '未分配部门',
          capacity_hours_per_day: capDay,
          workdays,
          total_hours,
          capacity_hours,
          load_pct,
          warning,
        };
      });

      // 部门汇总
      const deptAgg = {};
      for (const r of out) {
        const k = r.department_name || '未分配部门';
        if (!deptAgg[k]) deptAgg[k] = { department_name: k, total_hours: 0, capacity_hours: 0 };
        deptAgg[k].total_hours += r.total_hours;
        deptAgg[k].capacity_hours += r.capacity_hours;
      }
      const departments = Object.values(deptAgg).map((d) => ({
        ...d,
        total_hours: Math.round(d.total_hours * 10) / 10,
        capacity_hours: Math.round(d.capacity_hours * 10) / 10,
        load_pct: d.capacity_hours > 0 ? Math.round((d.total_hours * 1000) / d.capacity_hours) / 10 : 0,
        warning: d.capacity_hours > 0 ? d.total_hours / d.capacity_hours >= 0.8 : false,
      }));

      res.json({ from, to, workdays, people: out, departments });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.get(
  '/tasks',
  requireAuth,
  query('projectId').isInt(),
  query('userId').isInt(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const projectId = Number(req.query.projectId);
    const userId = Number(req.query.userId);
    try {
      const rows = db
        .prepare(
          `SELECT t.*, m.name AS milestone_name, m.phase_template AS milestone_phase
           FROM tasks t
           LEFT JOIN plan_milestones m ON m.id = t.milestone_id
           WHERE t.project_id = ? AND t.assignee_id = ?
           ORDER BY t.status, t.priority DESC, t.due_date IS NULL, t.due_date, t.id DESC`,
        )
        .all(projectId, userId);
      const summary = {
        todo: rows.filter((t) => t.status === 'todo').length,
        in_progress: rows.filter((t) => t.status === 'in_progress').length,
        blocked: rows.filter((t) => t.status === 'blocked').length,
        done: rows.filter((t) => t.status === 'done').length,
        total: rows.length,
      };
      res.json({ summary, tasks: rows });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post(
  '/reassign',
  requireAuth,
  body('task_id').isInt(),
  body('assignee_id').optional({ nullable: true }).isInt(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const taskId = Number(req.body.task_id);
    const assigneeId = req.body.assignee_id == null ? null : Number(req.body.assignee_id);
    try {
      const existing = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId);
      if (!existing) return res.status(404).json({ message: '任务不存在' });
      db.prepare(
        `UPDATE tasks SET assignee_id = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(assigneeId, taskId);
      res.json(db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId));
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

export default router;

