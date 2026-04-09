/**
 * KPI / 人力绩效 REST API（按项目+人员+指标+年月维度）
 */
import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import { db, insertId, changeCount } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendServerError } from '../utils/http.js';

const router = Router();

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate(); // month 1-12
}

function ymd(y, m, d) {
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

function safePdfFont(doc) {
  const candidates = [
    'C:\\\\Windows\\\\Fonts\\\\msyh.ttc',
    'C:\\\\Windows\\\\Fonts\\\\msyhbd.ttc',
    'C:\\\\Windows\\\\Fonts\\\\simhei.ttf',
    'C:\\\\Windows\\\\Fonts\\\\simsun.ttc',
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        doc.registerFont('CN', p);
        doc.font('CN');
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

function clampPct(v) {
  if (v == null || Number.isNaN(Number(v))) return null;
  return Math.max(0, Math.min(100, Number(v)));
}

function upsertKpiRecord({ project_id, user_id, metric_name, metric_unit, period_year, period_month, target_value, actual_value, score, comment }) {
  const existing = db
    .prepare(
      `SELECT id FROM kpi_records WHERE project_id = ? AND user_id IS ? AND metric_name = ? AND period_year = ? AND period_month = ?`,
    )
    .get(project_id, user_id ?? null, metric_name, period_year, period_month);
  if (existing?.id) {
    db.prepare(
      `UPDATE kpi_records SET
        metric_unit = ?, target_value = ?, actual_value = ?, score = ?, comment = ?,
        updated_at = datetime('now')
       WHERE id = ?`,
    ).run(metric_unit ?? null, target_value ?? null, actual_value ?? null, score ?? null, comment ?? null, existing.id);
    return db.prepare(`SELECT * FROM kpi_records WHERE id = ?`).get(existing.id);
  }
  const info = db
    .prepare(
      `INSERT INTO kpi_records (project_id, user_id, metric_name, metric_unit, period_year, period_month, target_value, actual_value, score, comment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(project_id, user_id ?? null, metric_name, metric_unit ?? null, period_year, period_month, target_value ?? null, actual_value ?? null, score ?? null, comment ?? null);
  return db.prepare(`SELECT * FROM kpi_records WHERE id = ?`).get(insertId(info));
}

router.get('/metric-defs', requireAuth, (_req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT * FROM kpi_metric_defs WHERE enabled = 1 ORDER BY id ASC`,
      )
      .all();
    res.json(rows);
  } catch (e) {
    sendServerError(res, e);
  }
});

/**
 * 一键核算：从任务/评审/里程碑/评审问题中自动提取指标，写入 kpi_records，并生成 kpi_reports 汇总
 * POST /api/kpi/auto-calc
 * body: { project_id, period_year, period_month, user_id? }
 */
router.post(
  '/auto-calc',
  requireAuth,
  body('project_id').isInt(),
  body('period_year').isInt({ min: 2000, max: 2100 }),
  body('period_month').isInt({ min: 1, max: 12 }),
  body('user_id').optional({ nullable: true }).isInt(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const project_id = Number(req.body.project_id);
    const period_year = Number(req.body.period_year);
    const period_month = Number(req.body.period_month);
    const user_id = req.body.user_id == null ? null : Number(req.body.user_id);
    const from = ymd(period_year, period_month, 1);
    const to = ymd(period_year, period_month, daysInMonth(period_year, period_month));

    try {
      const defs = db.prepare(`SELECT * FROM kpi_metric_defs WHERE enabled = 1`).all();
      const metrics = [];

      // 1) 任务完成率：当月到期（end_date/due_date 落在当月）的任务完成占比
      {
        let sql = `
          SELECT t.status, COUNT(*) AS c
          FROM tasks t
          WHERE t.project_id = ?
            AND COALESCE(t.end_date, t.due_date) IS NOT NULL
            AND COALESCE(t.end_date, t.due_date) >= ?
            AND COALESCE(t.end_date, t.due_date) <= ?
        `;
        const args = [project_id, from, to];
        if (user_id) {
          sql += ` AND t.assignee_id = ?`;
          args.push(user_id);
        }
        sql += ` GROUP BY t.status`;
        const rows = db.prepare(sql).all(...args);
        const total = rows.reduce((s, r) => s + Number(r.c || 0), 0);
        const done = rows.find((r) => r.status === 'done')?.c ? Number(rows.find((r) => r.status === 'done').c) : 0;
        const actual_value = total > 0 ? clampPct((done * 100) / total) : null;
        const metric_name = defs.find((d) => d.metric_key === 'task_completion_rate')?.name || '任务完成率';
        const rec = upsertKpiRecord({
          project_id,
          user_id,
          metric_name,
          metric_unit: '%',
          period_year,
          period_month,
          target_value: 90,
          actual_value,
          score: actual_value,
          comment: `自动核算：当月到期任务 ${done}/${total}`,
        });
        metrics.push({ metric_key: 'task_completion_rate', ...rec, numerator: done, denominator: total });
      }

      // 2) 评审通过率：当月评审（review_date 落在当月）通过或有条件通过占比（按项目）
      {
        const rows = db
          .prepare(
            `SELECT status, COUNT(*) AS c
             FROM reviews
             WHERE project_id = ? AND review_date IS NOT NULL AND review_date >= ? AND review_date <= ?
             GROUP BY status`,
          )
          .all(project_id, from, to);
        const totalAll = rows.reduce((s, r) => s + Number(r.c || 0), 0);
        const cancelled = rows.find((r) => r.status === 'cancelled')?.c ? Number(rows.find((r) => r.status === 'cancelled').c) : 0;
        const total = Math.max(0, totalAll - cancelled);
        const passed = (rows.find((r) => r.status === 'passed')?.c ? Number(rows.find((r) => r.status === 'passed').c) : 0)
          + (rows.find((r) => r.status === 'conditional')?.c ? Number(rows.find((r) => r.status === 'conditional').c) : 0);
        const actual_value = total > 0 ? clampPct((passed * 100) / total) : null;
        const metric_name = defs.find((d) => d.metric_key === 'review_pass_rate')?.name || '评审通过率';
        const rec = upsertKpiRecord({
          project_id,
          user_id: null,
          metric_name,
          metric_unit: '%',
          period_year,
          period_month,
          target_value: 95,
          actual_value,
          score: actual_value,
          comment: `自动核算：当月评审通过 ${passed}/${total}（剔除取消 ${cancelled}）`,
        });
        metrics.push({ metric_key: 'review_pass_rate', ...rec, numerator: passed, denominator: total });
      }

      // 3) 进度达成率：当月目标里程碑（target_date 落在当月）已达成占比
      {
        const rows = db
          .prepare(
            `SELECT status, COUNT(*) AS c
             FROM plan_milestones
             WHERE project_id = ? AND target_date IS NOT NULL AND target_date >= ? AND target_date <= ?
             GROUP BY status`,
          )
          .all(project_id, from, to);
        const total = rows.reduce((s, r) => s + Number(r.c || 0), 0);
        const achieved = rows.find((r) => r.status === 'achieved')?.c ? Number(rows.find((r) => r.status === 'achieved').c) : 0;
        const actual_value = total > 0 ? clampPct((achieved * 100) / total) : null;
        const metric_name = defs.find((d) => d.metric_key === 'schedule_achievement_rate')?.name || '进度达成率';
        const rec = upsertKpiRecord({
          project_id,
          user_id: null,
          metric_name,
          metric_unit: '%',
          period_year,
          period_month,
          target_value: 90,
          actual_value,
          score: actual_value,
          comment: `自动核算：当月目标里程碑达成 ${achieved}/${total}`,
        });
        metrics.push({ metric_key: 'schedule_achievement_rate', ...rec, numerator: achieved, denominator: total });
      }

      // 4) 缺陷闭环率：当月评审（review_date 落在当月）关联的 review_issues 已闭环占比
      {
        const rows = db
          .prepare(
            `SELECT i.status, COUNT(*) AS c
             FROM review_issues i
             INNER JOIN reviews r ON r.id = i.review_id
             WHERE r.project_id = ?
               AND r.review_date IS NOT NULL AND r.review_date >= ? AND r.review_date <= ?
             GROUP BY i.status`,
          )
          .all(project_id, from, to);
        const total = rows.reduce((s, r) => s + Number(r.c || 0), 0);
        const closed = (rows.find((r) => r.status === 'closed')?.c ? Number(rows.find((r) => r.status === 'closed').c) : 0)
          + (rows.find((r) => r.status === 'converted')?.c ? Number(rows.find((r) => r.status === 'converted').c) : 0);
        const actual_value = total > 0 ? clampPct((closed * 100) / total) : null;
        const metric_name = defs.find((d) => d.metric_key === 'defect_closure_rate')?.name || '缺陷闭环率';
        const rec = upsertKpiRecord({
          project_id,
          user_id: null,
          metric_name,
          metric_unit: '%',
          period_year,
          period_month,
          target_value: 95,
          actual_value,
          score: actual_value,
          comment: `自动核算：当月评审问题闭环 ${closed}/${total}`,
        });
        metrics.push({ metric_key: 'defect_closure_rate', ...rec, numerator: closed, denominator: total });
      }

      // 汇总得分：对 enabled 指标按 weight 加权平均（缺失指标跳过）
      const enabledDefs = defs.filter((d) => Number(d.enabled) === 1);
      let wSum = 0;
      let scoreSum = 0;
      for (const d of enabledDefs) {
        const m = metrics.find((x) => x.metric_key === d.metric_key);
        const val = m?.actual_value;
        if (val == null) continue;
        const w = Number(d.weight ?? 1);
        wSum += w;
        scoreSum += w * Number(val);
      }
      const totalScore = wSum > 0 ? Math.round((scoreSum * 10) / wSum) / 10 : null;

      const summary = {
        project_id,
        period_year,
        period_month,
        from,
        to,
        computed_for_user_id: user_id,
        total_score: totalScore,
        metrics: metrics.map((m) => ({
          metric_key: m.metric_key,
          metric_name: m.metric_name,
          unit: m.metric_unit,
          target_value: m.target_value,
          actual_value: m.actual_value,
          score: m.score,
          numerator: m.numerator,
          denominator: m.denominator,
          comment: m.comment,
        })),
      };

      // 报告仅保存项目级（user_id=null）版本
      if (!user_id) {
        const existing = db
          .prepare(
            `SELECT id FROM kpi_reports WHERE project_id = ? AND period_year = ? AND period_month = ?`,
          )
          .get(project_id, period_year, period_month);
        if (existing?.id) {
          db.prepare(
            `UPDATE kpi_reports
             SET summary_json = ?, generated_by_id = ?, created_at = datetime('now')
             WHERE id = ?`,
          ).run(JSON.stringify(summary), req.user.id, existing.id);
        } else {
          db.prepare(
            `INSERT INTO kpi_reports (project_id, period_year, period_month, generated_by_id, summary_json)
             VALUES (?, ?, ?, ?, ?)`,
          ).run(project_id, period_year, period_month, req.user.id, JSON.stringify(summary));
        }
      }

      res.json(summary);
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.get(
  '/report',
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
    try {
      const row = db
        .prepare(
          `SELECT * FROM kpi_reports WHERE project_id = ? AND period_year = ? AND period_month = ?`,
        )
        .get(projectId, year, month);
      if (!row) return res.status(404).json({ message: 'KPI 报告不存在，请先一键核算生成' });
      res.json({ ...row, summary: JSON.parse(row.summary_json) });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.get(
  '/report/pdf',
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
    try {
      const row = db
        .prepare(
          `SELECT * FROM kpi_reports WHERE project_id = ? AND period_year = ? AND period_month = ?`,
        )
        .get(projectId, year, month);
      if (!row) return res.status(404).json({ message: 'KPI 报告不存在，请先一键核算生成' });
      const summary = JSON.parse(row.summary_json);
      const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId);

      const doc = new PDFDocument({ size: 'A4', margin: 36 });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=kpi_${projectId}_${year}-${String(month).padStart(2, '0')}.pdf`);
      safePdfFont(doc);
      doc.pipe(res);

      doc.fontSize(16).text(`KPI 考核报告（${year}-${String(month).padStart(2, '0')}）`);
      doc.moveDown(0.5);
      doc.fontSize(11).text(`项目：${project?.name || projectId}`);
      doc.text(`周期：${summary.from} ~ ${summary.to}`);
      doc.text(`总分：${summary.total_score ?? '—'}`);
      doc.moveDown(0.5);
      doc.fontSize(10).text('指标明细：');
      doc.moveDown(0.3);
      for (const m of summary.metrics || []) {
        doc.fontSize(10).text(`- ${m.metric_name}：${m.actual_value ?? '—'}${m.unit || ''}（目标 ${m.target_value ?? '—'}${m.unit || ''}）`);
        if (m.comment) doc.fontSize(9).fillColor('#555').text(`  说明：${m.comment}`).fillColor('#000');
      }
      doc.end();
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.get(
  '/',
  requireAuth,
  query('projectId').optional().isInt(),
  query('userId').optional().isInt(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { projectId, userId } = req.query;
    try {
      let sql = `
        SELECT k.*, u.username, u.full_name
        FROM kpi_records k
        LEFT JOIN users u ON u.id = k.user_id
        WHERE 1=1
      `;
      const args = [];
      if (projectId) {
        sql += ` AND k.project_id = ?`;
        args.push(projectId);
      }
      if (userId) {
        sql += ` AND k.user_id = ?`;
        args.push(userId);
      }
      sql += ` ORDER BY k.period_year DESC, k.period_month DESC, k.id DESC`;
      const rows = db.prepare(sql).all(...args);
      res.json(rows);
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
        `SELECT k.*, u.username FROM kpi_records k LEFT JOIN users u ON u.id = k.user_id WHERE k.id = ?`,
      )
      .get(req.params.id);
    if (!row) return res.status(404).json({ message: 'KPI 记录不存在' });
    res.json(row);
  } catch (e) {
    sendServerError(res, e);
  }
});

router.post(
  '/',
  requireAuth,
  body('project_id').isInt(),
  body('metric_name').trim().notEmpty(),
  body('period_year').isInt({ min: 2000, max: 2100 }),
  body('period_month').isInt({ min: 1, max: 12 }),
  body('user_id').optional().isInt(),
  body('metric_unit').optional().trim(),
  body('target_value').optional().isFloat(),
  body('actual_value').optional().isFloat(),
  body('score').optional().isFloat(),
  body('comment').optional(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const {
      project_id,
      user_id,
      metric_name,
      metric_unit,
      period_year,
      period_month,
      target_value,
      actual_value,
      score,
      comment,
    } = req.body;
    try {
      const info = db
        .prepare(
          `INSERT INTO kpi_records (project_id, user_id, metric_name, metric_unit, period_year, period_month, target_value, actual_value, score, comment)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          project_id,
          user_id ?? null,
          metric_name,
          metric_unit ?? null,
          period_year,
          period_month,
          target_value ?? null,
          actual_value ?? null,
          score ?? null,
          comment ?? null,
        );
      const row = db.prepare(`SELECT * FROM kpi_records WHERE id = ?`).get(insertId(info));
      res.status(201).json(row);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return res.status(409).json({ message: '同一项目/人员/指标/年月已存在记录' });
      }
      sendServerError(res, e);
    }
  },
);

router.put(
  '/:id',
  requireAuth,
  param('id').isInt(),
  body('metric_name').optional().trim().notEmpty(),
  body('metric_unit').optional({ nullable: true }).trim(),
  body('period_year').optional().isInt({ min: 2000, max: 2100 }),
  body('period_month').optional().isInt({ min: 1, max: 12 }),
  body('user_id').optional({ nullable: true }).isInt(),
  body('target_value').optional({ nullable: true }).isFloat(),
  body('actual_value').optional({ nullable: true }).isFloat(),
  body('score').optional({ nullable: true }).isFloat(),
  body('comment').optional({ nullable: true }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const id = Number(req.params.id);
    const existing = db.prepare(`SELECT * FROM kpi_records WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ message: 'KPI 记录不存在' });
    const next = { ...existing, ...req.body };
    try {
      db.prepare(
        `UPDATE kpi_records SET
          user_id = ?, metric_name = ?, metric_unit = ?, period_year = ?, period_month = ?,
          target_value = ?, actual_value = ?, score = ?, comment = ?,
          updated_at = datetime('now')
         WHERE id = ?`,
      ).run(
        next.user_id ?? null,
        next.metric_name,
        next.metric_unit ?? null,
        next.period_year,
        next.period_month,
        next.target_value ?? null,
        next.actual_value ?? null,
        next.score ?? null,
        next.comment ?? null,
        id,
      );
      res.json(db.prepare(`SELECT * FROM kpi_records WHERE id = ?`).get(id));
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return res.status(409).json({ message: '更新后与唯一约束冲突' });
      }
      sendServerError(res, e);
    }
  },
);

router.delete('/:id', requireAuth, param('id').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const r = db.prepare(`DELETE FROM kpi_records WHERE id = ?`).run(req.params.id);
    if (changeCount(r) === 0) return res.status(404).json({ message: 'KPI 记录不存在' });
    res.status(204).send();
  } catch (e) {
    sendServerError(res, e);
  }
});

export default router;
