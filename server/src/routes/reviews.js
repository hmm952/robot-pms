/**
 * 硬件产品全阶段评审管理模块 REST API
 * 覆盖：
 *  - EVT/DVT/PVT/MP 阶段评审模板（评审流程步骤 steps_json）
 *  - 新建评审、专家分配、专家在线打分与意见提交
 *  - 评审问题（Issue）闭环：状态流转 + 转为任务（同步 WBS 待办）
 *  - 自动生成评审报告 + PDF 导出
 *  - 评审结果同步到目标里程碑，并更新任务进度（done/in_progress/blocked + progress）
 */
import { Router } from 'express';
import {
  body,
  param,
  query,
  validationResult,
} from 'express-validator';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';

import { db, insertId, changeCount } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { sendServerError } from '../utils/http.js';
import { rollupAncestorProgress } from '../services/planTaskService.js';

const router = Router();

const reviewTypes = ['design', 'process', 'safety', 'quality', 'milestone', 'other'];
const verdictValues = ['passed', 'conditional', 'rejected', 'cancelled'];
const phaseTemplates = ['evt', 'dvt', 'pvt', 'mp', 'custom'];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadRoot = path.join(__dirname, '..', '..', 'uploads', 'reviews');
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

function toNumberOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseWorkflowSteps(stepsJson) {
  if (!stepsJson) return null;
  try {
    const parsed = JSON.parse(stepsJson);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getFirstWorkflowKey(stepsJson, fallbackKey = 'experts_reviewing') {
  const steps = parseWorkflowSteps(stepsJson);
  return steps?.[0]?.key || fallbackKey;
}

function getNextWorkflowKey(
  stepsJson,
  currentKey,
  fallbackKey = 'issue_tracking',
) {
  const steps = parseWorkflowSteps(stepsJson);
  if (!steps || steps.length === 0) return fallbackKey;
  const idx = steps.findIndex((s) => String(s?.key) === String(currentKey));
  if (idx >= 0 && steps[idx + 1]?.key) return steps[idx + 1].key;
  return fallbackKey;
}

function generateReportText(review, experts, issues, report) {
  const milestoneLine = review.target_milestone_id
    ? `目标里程碑 ID：${review.target_milestone_id}`
    : '目标里程碑：未关联';
  const header = [
    `评审报告：${review.title}`,
    `评审类型：${review.review_type}`,
    `阶段模板：${review.template_phase || 'custom'}`,
    milestoneLine,
    `评审时间：${review.review_date || '待定'}`,
    `评审结论：${review.conclusion || '—'}`,
    '---',
  ];

  const expertLines = [
    '专家评分与意见：',
    ...experts.map((e) => {
      const score = e.score != null ? `${Number(e.score)}`
        : '—';
      return `- ${e.full_name || e.username}：评分 ${score}，意见：${e.opinion || '—'}`;
    }),
    '---',
  ];

  const issueLines = [
    '问题闭环：',
    ...issues.map((i) => {
      const sev = i.severity;
      return `- [${i.status}] ${i.title}（${sev}）${i.converted_task_id ? `→ 已转任务 #${i.converted_task_id}` : ''}`;
    }),
    '---',
  ];

  const body = report?.report_text
    ? report.report_text
    : '（报告由系统根据专家评分与问题闭环自动生成）';
  return [...header, ...expertLines, ...issueLines, `系统说明：${body}`].join('\n');
}

function calcReviewProgress(reviewId) {
  const total = db
    .prepare(
      `SELECT COUNT(*) AS c FROM review_experts WHERE review_id = ? AND required = 1`,
    )
    .get(reviewId).c;
  const submitted = db
    .prepare(
      `SELECT COUNT(*) AS c FROM review_experts WHERE review_id = ? AND required = 1 AND status = 'submitted'`,
    )
    .get(reviewId).c;
  const progress_percent = total === 0 ? 0 : Math.round((submitted * 100) / total);
  const issues_open = db
    .prepare(
      `SELECT COUNT(*) AS c FROM review_issues WHERE review_id = ? AND status IN ('open','in_progress')`,
    )
    .get(reviewId).c;
  return {
    required_experts_total: total,
    required_experts_submitted: submitted,
    progress_percent,
    issues_open_count: issues_open,
  };
}

function isAllowedToClose(review, user) {
  if (user.role === 'admin') return true;
  return user.id === review.lead_reviewer_id;
}

function updateMilestoneAndTasksOnVerdict(reviewId, verdict) {
  const review = db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(reviewId);
  if (!review) return;
  const milestoneId = review.target_milestone_id;
  if (!milestoneId) return;

  let milestoneStatus = 'planned';
  let taskStatus = 'todo';
  let progress = 0;
  if (verdict === 'passed') {
    milestoneStatus = 'achieved';
    taskStatus = 'done';
    progress = 100;
  } else if (verdict === 'conditional') {
    milestoneStatus = 'achieved';
    taskStatus = 'in_progress';
    progress = 60;
  } else if (verdict === 'rejected') {
    milestoneStatus = 'delayed';
    taskStatus = 'blocked';
    progress = 25;
  } else if (verdict === 'cancelled') {
    milestoneStatus = 'cancelled';
    taskStatus = 'todo';
    progress = 0;
  }

  db.prepare(
    `UPDATE plan_milestones SET status = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(milestoneStatus, milestoneId);

  // 更新该里程碑下所有任务的状态/进度
  const updatedTasks = db
    .prepare(
      `SELECT id FROM tasks WHERE project_id = ? AND milestone_id = ?`,
    )
    .all(review.project_id, milestoneId);

  db.prepare(
    `UPDATE tasks
     SET status = ?, progress = ?, updated_at = datetime('now')
     WHERE project_id = ? AND milestone_id = ?`,
  ).run(taskStatus, progress, review.project_id, milestoneId);

  // 递归滚动更新父节点 progress（用于甘特/计划模块）
  for (const t of updatedTasks) {
    try {
      rollupAncestorProgress(t.id);
    } catch {
      // ignore
    }
  }
}

function getOrCreateReport(reviewId) {
  return db.prepare(`SELECT * FROM review_reports WHERE review_id = ?`).get(reviewId);
}

function generateAndSaveReport(reviewId) {
  const review = db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(reviewId);
  if (!review) return null;

  const experts = db
    .prepare(
      `SELECT re.*, u.username, u.full_name,
              s.score, s.opinion, s.updated_at AS submitted_at
       FROM review_experts re
       LEFT JOIN users u ON u.id = re.user_id
       LEFT JOIN review_expert_submissions s ON s.review_expert_id = re.id
       WHERE re.review_id = ?
       ORDER BY re.required DESC, re.id ASC`,
    )
    .all(reviewId);

  const issues = db
    .prepare(
      `SELECT i.*, t.title AS converted_task_title
       FROM review_issues i
       LEFT JOIN tasks t ON t.id = i.converted_task_id
       WHERE i.review_id = ?
       ORDER BY i.status, i.severity DESC, i.id DESC`,
    )
    .all(reviewId);

  const existingReport = getOrCreateReport(reviewId);
  const reportText = generateReportText(review, experts, issues, existingReport);

  const dataJson = {
    review_id: reviewId,
    template_phase: review.template_phase || null,
    verdict: review.status,
    generated_at: new Date().toISOString(),
    experts: experts.map((e) => ({
      user_id: e.user_id,
      username: e.username,
      required: e.required,
      status: e.status,
      score: e.score,
      opinion: e.opinion,
    })),
    issues: issues.map((i) => ({
      id: i.id,
      title: i.title,
      severity: i.severity,
      status: i.status,
      converted_task_id: i.converted_task_id,
    })),
  };

  if (existingReport) {
    db.prepare(
      `UPDATE review_reports
       SET report_text = ?, report_data_json = ?, generated_at = datetime('now')
       WHERE review_id = ?`,
    ).run(reportText, JSON.stringify(dataJson), reviewId);
  } else {
    db.prepare(
      `INSERT INTO review_reports (review_id, report_text, report_data_json)
       VALUES (?, ?, ?)`,
    ).run(reviewId, reportText, JSON.stringify(dataJson));
  }
  return db
    .prepare(`SELECT * FROM review_reports WHERE review_id = ?`)
    .get(reviewId);
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

router.get('/templates', requireAuth, (_req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT phase_template, name, steps_json FROM review_templates ORDER BY phase_template`,
      )
      .all();
    res.json(rows);
  } catch (e) {
    sendServerError(res, e);
  }
});

router.get('/', requireAuth, query('projectId').optional().isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    let rows;
    if (req.query.projectId) {
      rows = db
        .prepare(
          `SELECT r.*, tm.name AS target_milestone_name, tm.phase_template AS target_milestone_phase
           FROM reviews r
           LEFT JOIN plan_milestones tm ON tm.id = r.target_milestone_id
           WHERE r.project_id = ?
           ORDER BY r.review_date IS NULL, r.review_date, r.id DESC`,
        )
        .all(req.query.projectId);
    } else {
      rows = db.prepare(`SELECT * FROM reviews ORDER BY updated_at DESC`).all();
    }

    const out = rows.map((r) => {
      const p = calcReviewProgress(r.id);
      return { ...r, ...p };
    });
    res.json(out);
  } catch (e) {
    sendServerError(res, e);
  }
});

router.get('/:id', requireAuth, param('id').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const reviewId = Number(req.params.id);

  try {
    const review = db
      .prepare(
        `SELECT r.*, tm.name AS target_milestone_name, tm.phase_template AS target_milestone_phase
         FROM reviews r
         LEFT JOIN plan_milestones tm ON tm.id = r.target_milestone_id
         WHERE r.id = ?`,
      )
      .get(reviewId);
    if (!review) return res.status(404).json({ message: '评审不存在' });

    const experts = db
      .prepare(
        `SELECT re.*, u.username, u.full_name,
                s.score, s.opinion, s.updated_at AS submitted_at
         FROM review_experts re
         LEFT JOIN users u ON u.id = re.user_id
         LEFT JOIN review_expert_submissions s ON s.review_expert_id = re.id
         WHERE re.review_id = ?
         ORDER BY re.required DESC, re.id ASC`,
      )
      .all(reviewId);

    const issues = db
      .prepare(
        `SELECT i.*, t.title AS converted_task_title
         FROM review_issues i
         LEFT JOIN tasks t ON t.id = i.converted_task_id
         WHERE i.review_id = ?
         ORDER BY i.status, i.severity DESC, i.id DESC`,
      )
      .all(reviewId);

    const attachments = db
      .prepare(
        `SELECT a.*, u.username AS uploader_username, u.full_name AS uploader_full_name
         FROM review_attachments a
         LEFT JOIN users u ON u.id = a.uploader_id
         WHERE a.review_id = ?
         ORDER BY a.id DESC`,
      )
      .all(reviewId)
      .map((a) => ({ ...a, url: `/uploads/reviews/${a.storage_path}` }));

    const report = db.prepare(`SELECT * FROM review_reports WHERE review_id = ?`).get(reviewId) || null;

    res.json({ review, experts, issues, attachments, report });
  } catch (e) {
    sendServerError(res, e);
  }
});

router.post(
  '/',
  requireAuth,
  body('project_id').isInt(),
  body('title').trim().notEmpty(),
  body('review_type').optional().isIn(reviewTypes),
  body('template_phase').optional().isIn(phaseTemplates),
  body('target_milestone_id').optional({ nullable: true }).isInt(),
  body('review_date').optional({ nullable: true }),
  body('description').optional(),
  body('experts').isArray({ min: 1 }),
  body('experts.*').isInt(),
  body('steps_json').optional().isString(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const {
      project_id,
      title,
      review_type,
      template_phase,
      target_milestone_id,
      review_date,
      description,
      experts,
      steps_json,
    } = req.body;

    try {
      const phase = template_phase || 'custom';
      const tmpl = steps_json
        ? null
        : db
            .prepare(
              `SELECT * FROM review_templates WHERE phase_template = ? ORDER BY id DESC`,
            )
            .get(phase);

      const steps = steps_json ? steps_json : tmpl?.steps_json || JSON.stringify([]);
      const workflowState = getFirstWorkflowKey(steps);

      const info = db.prepare(
        `INSERT INTO reviews
         (project_id, title, review_type, status, lead_reviewer_id, review_date, conclusion,
          template_phase, workflow_state, target_milestone_id, workflow_steps_json, created_by_id)
         VALUES (?, ?, ?, 'in_progress', ?, ?, NULL, ?, ?, ?, ?, ?)`,
      ).run(
        project_id,
        title,
        review_type || 'design',
        req.user.id,
        review_date ?? null,
        phase,
        workflowState,
        target_milestone_id ?? null,
        steps,
        req.user.id,
      );

      const reviewId = insertId(info);

      for (const uid of experts) {
        db.prepare(
          `INSERT INTO review_experts (review_id, user_id, required, status)
           VALUES (?, ?, 1, 'invited')`,
        ).run(reviewId, uid);
      }

      res.status(201).json({ id: reviewId });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post(
  '/:id/experts/:expertUserId/submit',
  requireAuth,
  param('id').isInt(),
  param('expertUserId').isInt(),
  body('score').optional().isFloat({ min: 0, max: 100 }),
  body('opinion').optional().trim().isLength({ min: 0, max: 5000 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const reviewId = Number(req.params.id);
    const expertUserId = Number(req.params.expertUserId);
    const { score, opinion } = req.body;

    try {
      const review = db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(reviewId);
      if (!review) return res.status(404).json({ message: '评审不存在' });

      // 权限：本人或管理员
      if (req.user.role !== 'admin' && req.user.id !== expertUserId) {
        return res.status(403).json({ message: '无权提交该专家内容' });
      }

      const expert = db.prepare(
        `SELECT * FROM review_experts WHERE review_id = ? AND user_id = ?`,
      ).get(reviewId, expertUserId);
      if (!expert) return res.status(404).json({ message: '专家未分配' });

      const submission = db
        .prepare(
          `SELECT * FROM review_expert_submissions WHERE review_expert_id = ?`,
        )
        .get(expert.id);

      if (submission) {
        db.prepare(
          `UPDATE review_expert_submissions
           SET score = ?, opinion = ?, updated_at = datetime('now')
           WHERE review_expert_id = ?`,
        ).run(score ?? null, opinion ?? null, expert.id);
      } else {
        db.prepare(
          `INSERT INTO review_expert_submissions (review_expert_id, score, opinion)
           VALUES (?, ?, ?)`,
        ).run(expert.id, score ?? null, opinion ?? null);
      }

      db.prepare(
        `UPDATE review_experts
         SET status = 'submitted', updated_at = datetime('now')
         WHERE id = ?`,
      ).run(expert.id);

      // 所有必填专家提交完成后：进入问题闭环步骤
      const total = db
        .prepare(
          `SELECT COUNT(*) AS c FROM review_experts WHERE review_id = ? AND required = 1`,
        )
        .get(reviewId).c;
      const submitted = db
        .prepare(
          `SELECT COUNT(*) AS c FROM review_experts WHERE review_id = ? AND required = 1 AND status = 'submitted'`,
        )
        .get(reviewId).c;
      if (total > 0 && submitted === total) {
        const nextKey = getNextWorkflowKey(review.workflow_steps_json, review.workflow_state, 'issue_tracking');
        db.prepare(
          `UPDATE reviews SET workflow_state = ?, updated_at = datetime('now')
           WHERE id = ?`,
        ).run(nextKey, reviewId);
      }

      const updated = db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(reviewId);
      res.json({ ...updated, ...calcReviewProgress(reviewId) });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post(
  '/:id/issues',
  requireAuth,
  param('id').isInt(),
  body('title').trim().notEmpty(),
  body('description').optional(),
  body('severity').optional().isIn(['low', 'medium', 'high']),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const reviewId = Number(req.params.id);
    const { title, description, severity } = req.body;

    try {
      const review = db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(reviewId);
      if (!review) return res.status(404).json({ message: '评审不存在' });

      const expert = db
        .prepare(
          `SELECT * FROM review_experts WHERE review_id = ? AND user_id = ?`,
        )
        .get(reviewId, req.user.id);
      if (!expert && req.user.role !== 'admin') {
        return res.status(403).json({ message: '仅分配的评审专家可创建问题' });
      }

      const info = db.prepare(
        `INSERT INTO review_issues
         (review_id, creator_user_id, title, description, severity, status)
         VALUES (?, ?, ?, ?, ?, 'open')`,
      ).run(reviewId, req.user.id, title, description ?? null, severity || 'medium');

      const issueId = insertId(info);
      const row = db.prepare(`SELECT * FROM review_issues WHERE id = ?`).get(issueId);
      res.status(201).json(row);
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.put(
  '/:id/issues/:issueId',
  requireAuth,
  param('id').isInt(),
  param('issueId').isInt(),
  body('status').optional().isIn(['open', 'in_progress', 'closed', 'converted']),
  body('title').optional().trim().notEmpty(),
  body('description').optional(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const reviewId = Number(req.params.id);
    const issueId = Number(req.params.issueId);
    const { status, title, description } = req.body;
    try {
      const existing = db
        .prepare(`SELECT * FROM review_issues WHERE id = ? AND review_id = ?`)
        .get(issueId, reviewId);
      if (!existing) return res.status(404).json({ message: '评审问题不存在' });

      if (req.user.role !== 'admin' && req.user.id !== existing.creator_user_id) {
        return res.status(403).json({ message: '无权修改该问题' });
      }

      db.prepare(
        `UPDATE review_issues
         SET status = ?, title = ?, description = ?, updated_at = datetime('now')
         WHERE id = ?`,
      ).run(
        status ?? existing.status,
        title ?? existing.title,
        description ?? existing.description ?? null,
        issueId,
      );
      res.json(db.prepare(`SELECT * FROM review_issues WHERE id = ?`).get(issueId));
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post(
  '/:id/issues/:issueId/convert-to-task',
  requireAuth,
  param('id').isInt(),
  param('issueId').isInt(),
  body('task_title').optional().trim(),
  body('due_date').optional({ nullable: true }).isString(),
  body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
  body('assignee_id').optional({ nullable: true }).isInt(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const reviewId = Number(req.params.id);
    const issueId = Number(req.params.issueId);
    const { task_title, due_date, priority, assignee_id } = req.body;

    try {
      const review = db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(reviewId);
      if (!review) return res.status(404).json({ message: '评审不存在' });

      const issue = db
        .prepare(`SELECT * FROM review_issues WHERE id = ? AND review_id = ?`)
        .get(issueId, reviewId);
      if (!issue) return res.status(404).json({ message: '评审问题不存在' });
      if (issue.converted_task_id) {
        return res.status(409).json({ message: '该问题已转为任务' });
      }

      // 任何登录用户可转任务（后续可按权限收紧）

      const mappedPriority =
        priority ||
        (issue.severity === 'high'
          ? 'critical'
          : issue.severity === 'medium'
            ? 'high'
            : 'medium');

      const info = db
        .prepare(
          `INSERT INTO tasks
           (project_id, title, description, status, priority, assignee_id, reporter_id,
            due_date, milestone_id, progress, sort_order)
           VALUES (?, ?, ?, 'todo', ?, ?, ?, ?, ?, 0, 0)`,
        )
        .run(
          review.project_id,
          task_title || `[评审问题] ${issue.title}`,
          issue.description ?? null,
          mappedPriority,
          assignee_id ?? null,
          req.user.id,
          due_date ?? null,
          review.target_milestone_id ?? null,
        );
      const taskId = insertId(info);

      // 兜底：转换任务的核心是写入 tasks；后续更新 review_issue / 外部链接可能因历史数据触发异常
      // 这里拆分为独立 try/catch，避免接口整体失败影响用户主流程。
      try {
        db.prepare(
          `UPDATE review_issues
           SET status = 'converted', converted_task_id = ?, updated_at = datetime('now')
           WHERE id = ?`,
        ).run(taskId, issueId);
      } catch {
        // ignore
      }

      try {
        db.prepare(
          `INSERT INTO task_external_links (task_id, link_type, ref_id, ref_title, note)
           VALUES (?, 'review', ?, ?, 'auto-converted')`,
        ).run(taskId, String(reviewId), issue.title, `来自评审 #${reviewId}`);
      } catch {
        // ignore
      }

      // 复用 tasks.js 的查询形状，避免 node:sqlite 在部分字段上返回时触发异常
      let row = null;
      try {
        row = db
          .prepare(
            `SELECT t.*, u.username AS assignee_name,
                    m.name AS milestone_name, m.phase_template AS milestone_phase
             FROM tasks t
             LEFT JOIN users u ON u.id = t.assignee_id
             LEFT JOIN plan_milestones m ON m.id = t.milestone_id
             WHERE t.id = ?`,
          )
          .get(taskId);
      } catch {
        // ignore
      }
      res.status(201).json(row || { id: taskId });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post(
  '/:id/attachments/upload',
  requireAuth,
  param('id').isInt(),
  upload.single('file'),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const reviewId = Number(req.params.id);
      const review = db.prepare(`SELECT id FROM reviews WHERE id = ?`).get(reviewId);
      if (!review) return res.status(404).json({ message: '评审不存在' });
      if (!req.file) return res.status(400).json({ message: '未收到文件' });

      const info = db.prepare(
        `INSERT INTO review_attachments
         (review_id, uploader_id, file_name, mime_type, file_size, storage_path)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        reviewId,
        req.user.id,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        req.file.filename,
      );
      const attachmentId = insertId(info);
      const row = db
        .prepare(
          `SELECT * FROM review_attachments WHERE id = ?`,
        )
        .get(attachmentId);
      res.status(201).json({ ...row, url: `/uploads/reviews/${row.storage_path}` });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post(
  '/:id/report/generate',
  requireAuth,
  param('id').isInt(),
  (req, res) => {
    const reviewId = Number(req.params.id);
    try {
      const report = generateAndSaveReport(reviewId);
      if (!report) return res.status(404).json({ message: '评审不存在' });
      const cur = db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(reviewId);
      const nextKey = getNextWorkflowKey(cur?.workflow_steps_json, cur?.workflow_state, 'report_ready');
      db.prepare(
        `UPDATE reviews SET workflow_state = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(nextKey, reviewId);
      res.json(report);
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.get(
  '/:id/report/pdf',
  requireAuth,
  param('id').isInt(),
  (req, res) => {
    const reviewId = Number(req.params.id);
    try {
      const report = generateAndSaveReport(reviewId) || null;
      if (!report) return res.status(404).json({ message: '评审不存在' });
      const review = db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(reviewId);

      const doc = new PDFDocument({ size: 'A4', margin: 36 });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=review_${reviewId}_report.pdf`,
      );

      safePdfFont(doc);

      doc.fontSize(16).text(`评审报告：${review?.title || reviewId}`);
      doc.moveDown();
      doc.fontSize(11).text(`阶段模板：${review?.template_phase || 'custom'}`);
      doc.text(`评审类型：${review?.review_type || '—'}`);
      doc.text(`评审时间：${review?.review_date || '—'}`);
      doc.text(`结论：${review?.conclusion || review?.status || '—'}`);
      doc.moveDown(0.5);
      doc.fontSize(10).text('--- 报告正文 ---');
      doc.moveDown(0.5);
      doc.fontSize(10).text(report.report_text || '');
      doc.end();
      doc.pipe(res);
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.put(
  '/:id/close',
  requireAuth,
  param('id').isInt(),
  body('verdict').isIn(verdictValues),
  body('conclusion').optional().trim(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const reviewId = Number(req.params.id);
    const { verdict, conclusion } = req.body;
    try {
      const review = db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(reviewId);
      if (!review) return res.status(404).json({ message: '评审不存在' });

      if (!isAllowedToClose(review, req.user)) {
        return res.status(403).json({ message: '无权归档该评审' });
      }

      db.prepare(
        `UPDATE reviews
         SET status = ?, conclusion = ?, workflow_state = 'closed', updated_at = datetime('now')
         WHERE id = ?`,
      ).run(verdict, conclusion ?? null, reviewId);

      // 同步里程碑 + 更新任务进度
      updateMilestoneAndTasksOnVerdict(reviewId, verdict);

      const report = generateAndSaveReport(reviewId);
      const after = db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(reviewId);
      const nextKey = getNextWorkflowKey(after?.workflow_steps_json, after?.workflow_state, 'report_ready');
      db.prepare(
        `UPDATE reviews SET workflow_state = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(nextKey, reviewId);

      res.json({ ...db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(reviewId), report });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.delete('/:id', requireAuth, param('id').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const r = db.prepare(`DELETE FROM reviews WHERE id = ?`).run(req.params.id);
    if (changeCount(r) === 0) return res.status(404).json({ message: '评审不存在' });
    res.status(204).send();
  } catch (e) {
    sendServerError(res, e);
  }
});

export default router;
