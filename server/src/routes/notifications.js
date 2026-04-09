import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { db, insertId } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendServerError } from '../utils/http.js';
import {
  getDbSmtpConfig,
  getEffectiveSmtpConfig,
  saveSmtpConfig,
} from '../services/integrationSettingsService.js';
import {
  runNotificationScheduler,
  sendManualNotification,
} from '../services/notificationService.js';

const router = Router();

router.get('/smtp/config', requireAuth, (_req, res) => {
  try {
    const dbCfg = getDbSmtpConfig();
    const eff = getEffectiveSmtpConfig();
    res.json({
      source: {
        db: { ...dbCfg, pass: dbCfg.pass ? '***已填写***' : '' },
        effective: { ...eff, pass: eff.pass ? '***已填写***' : '' },
      },
      help: {
        host: 'SMTP 服务器地址，如 smtp.qq.com',
        port: '常见 465（SSL）或 587（TLS）',
        secure: '465 常用 true，587 常用 false',
        user: '邮箱账号',
        pass: '邮箱授权码/应用专用密码',
        from: '发件人邮箱，如 Robot PMS <xx@company.com>',
        wecomWebhook: '企业微信机器人 Webhook（预留）',
        dingtalkWebhook: '钉钉机器人 Webhook（预留）',
      },
    });
  } catch (e) {
    sendServerError(res, e);
  }
});

router.put(
  '/smtp/config',
  requireAuth,
  body('host').optional().isString(),
  body('port').optional().isInt({ min: 1, max: 65535 }),
  body('secure').optional().isBoolean(),
  body('user').optional().isString(),
  body('pass').optional().isString(),
  body('from').optional().isString(),
  body('wecomWebhook').optional().isString(),
  body('dingtalkWebhook').optional().isString(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const saved = saveSmtpConfig(req.body || {});
      res.json({
        message: 'SMTP 配置已保存',
        config: { ...saved, pass: saved.pass ? '***已填写***' : '' },
      });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.delete('/rules/:id', requireAuth, param('id').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const id = Number(req.params.id);
    const ex = db.prepare(`SELECT id FROM notification_rules WHERE id = ?`).get(id);
    if (!ex) return res.status(404).json({ message: '规则不存在' });
    db.prepare(`DELETE FROM notification_rules WHERE id = ?`).run(id);
    res.status(204).send();
  } catch (e) {
    sendServerError(res, e);
  }
});

router.get('/templates', requireAuth, query('enabled').optional().isIn(['0', '1']), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    let sql = `SELECT * FROM notification_templates WHERE 1=1`;
    const args = [];
    if (req.query.enabled) {
      sql += ` AND enabled = ?`;
      args.push(Number(req.query.enabled));
    }
    sql += ` ORDER BY is_builtin DESC, id ASC`;
    res.json(db.prepare(sql).all(...args));
  } catch (e) {
    sendServerError(res, e);
  }
});

router.post(
  '/templates',
  requireAuth,
  body('code').trim().notEmpty(),
  body('name').trim().notEmpty(),
  body('category').optional().isString(),
  body('subject_template').trim().notEmpty(),
  body('body_template').trim().notEmpty(),
  body('enabled').optional().isBoolean(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const b = req.body;
      const info = db
        .prepare(
          `INSERT INTO notification_templates
          (code, name, category, subject_template, body_template, is_builtin, enabled, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, datetime('now'))`,
        )
        .run(
          b.code,
          b.name,
          b.category || 'custom',
          b.subject_template,
          b.body_template,
          b.enabled === false ? 0 : 1,
        );
      res.status(201).json(
        db.prepare(`SELECT * FROM notification_templates WHERE id = ?`).get(insertId(info)),
      );
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.put(
  '/templates/:id',
  requireAuth,
  param('id').isInt(),
  body('name').optional().isString(),
  body('subject_template').optional().isString(),
  body('body_template').optional().isString(),
  body('enabled').optional().isBoolean(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const id = Number(req.params.id);
      const ex = db.prepare(`SELECT * FROM notification_templates WHERE id = ?`).get(id);
      if (!ex) return res.status(404).json({ message: '模板不存在' });
      const n = { ...ex, ...req.body };
      db.prepare(
        `UPDATE notification_templates
         SET name=?, subject_template=?, body_template=?, enabled=?, updated_at=datetime('now')
         WHERE id = ?`,
      ).run(
        n.name,
        n.subject_template,
        n.body_template,
        n.enabled === false ? 0 : 1,
        id,
      );
      res.json(db.prepare(`SELECT * FROM notification_templates WHERE id = ?`).get(id));
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.get(
  '/rules',
  requireAuth,
  query('projectId').isInt(),
  query('eventType').optional().isIn([
    'task_overdue',
    'review_reminder',
    'payment_reminder',
    'milestone_warning',
  ]),
  query('enabled').optional().isIn(['0', '1']),
  query('page').optional().isInt({ min: 1 }),
  query('pageSize').optional().isInt({ min: 1, max: 100 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const page = Number(req.query.page || 1);
      const pageSize = Number(req.query.pageSize || 20);
      const offset = (page - 1) * pageSize;
      let where = ` WHERE r.project_id = ? `;
      const args = [req.query.projectId];
      if (req.query.eventType) {
        where += ` AND r.event_type = ?`;
        args.push(req.query.eventType);
      }
      if (req.query.enabled) {
        where += ` AND r.enabled = ?`;
        args.push(Number(req.query.enabled));
      }
      const total = db
        .prepare(
          `SELECT COUNT(*) AS c
           FROM notification_rules r
           ${where}`,
        )
        .get(...args).c;
      const items = db
        .prepare(
          `SELECT r.*, t.name AS template_name
           FROM notification_rules r
           LEFT JOIN notification_templates t ON t.code = r.template_code
           ${where}
           ORDER BY r.id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...args, pageSize, offset);
      res.json({
        items,
        pagination: {
          page,
          pageSize,
          total: Number(total || 0),
          totalPages: Math.max(1, Math.ceil(Number(total || 0) / pageSize)),
        },
      });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post(
  '/rules',
  requireAuth,
  body('project_id').isInt(),
  body('event_type').isIn(['task_overdue', 'review_reminder', 'payment_reminder', 'milestone_warning']),
  body('template_code').isString(),
  body('offset_days').optional().isInt({ min: 0, max: 60 }),
  body('recipient_mode').optional().isIn(['auto', 'manual']),
  body('manual_recipients').optional().isString(),
  body('channel').optional().isIn(['email', 'wecom', 'dingtalk']),
  body('enabled').optional().isBoolean(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const b = req.body;
      const info = db
        .prepare(
          `INSERT INTO notification_rules
          (project_id, event_type, template_code, offset_days, recipient_mode, manual_recipients, channel, enabled, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        )
        .run(
          b.project_id,
          b.event_type,
          b.template_code,
          b.offset_days ?? 1,
          b.recipient_mode || 'auto',
          b.manual_recipients || '',
          b.channel || 'email',
          b.enabled === false ? 0 : 1,
        );
      res.status(201).json(db.prepare(`SELECT * FROM notification_rules WHERE id = ?`).get(insertId(info)));
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.put(
  '/rules/:id',
  requireAuth,
  param('id').isInt(),
  body('event_type').optional().isIn(['task_overdue', 'review_reminder', 'payment_reminder', 'milestone_warning']),
  body('template_code').optional().isString(),
  body('offset_days').optional().isInt({ min: 0, max: 60 }),
  body('recipient_mode').optional().isIn(['auto', 'manual']),
  body('manual_recipients').optional().isString(),
  body('channel').optional().isIn(['email', 'wecom', 'dingtalk']),
  body('enabled').optional().isBoolean(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const id = Number(req.params.id);
      const ex = db.prepare(`SELECT * FROM notification_rules WHERE id = ?`).get(id);
      if (!ex) return res.status(404).json({ message: '规则不存在' });
      const n = { ...ex, ...req.body };
      db.prepare(
        `UPDATE notification_rules
         SET event_type=?, template_code=?, offset_days=?, recipient_mode=?, manual_recipients=?, channel=?, enabled=?, updated_at=datetime('now')
         WHERE id = ?`,
      ).run(
        n.event_type,
        n.template_code,
        n.offset_days ?? 1,
        n.recipient_mode || 'auto',
        n.manual_recipients || '',
        n.channel || 'email',
        n.enabled === false ? 0 : 1,
        id,
      );
      res.json(db.prepare(`SELECT * FROM notification_rules WHERE id = ?`).get(id));
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post('/run', requireAuth, async (_req, res) => {
  try {
    await runNotificationScheduler();
    res.json({ ok: true, message: '自动触发执行完成' });
  } catch (e) {
    sendServerError(res, e);
  }
});

router.post(
  '/send',
  requireAuth,
  body('project_id').isInt(),
  body('template_code').isString(),
  body('recipients').trim().notEmpty(),
  body('variables').optional().isObject(),
  body('channel').optional().isIn(['email', 'wecom', 'dingtalk']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const tpl = db
        .prepare(`SELECT * FROM notification_templates WHERE code = ?`)
        .get(req.body.template_code);
      if (!tpl) return res.status(404).json({ message: '模板不存在' });
      const r = await sendManualNotification({
        projectId: Number(req.body.project_id),
        template: tpl,
        recipients: req.body.recipients,
        vars: req.body.variables || {},
        channel: req.body.channel || 'email',
      });
      res.json(r);
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.get(
  '/history',
  requireAuth,
  query('projectId').optional().isInt(),
  query('eventType').optional().isIn([
    'task_overdue',
    'review_reminder',
    'payment_reminder',
    'milestone_warning',
  ]),
  query('status').optional().isIn(['pending', 'sent', 'failed']),
  query('page').optional().isInt({ min: 1 }),
  query('pageSize').optional().isInt({ min: 1, max: 100 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const page = Number(req.query.page || 1);
      const pageSize = Number(req.query.pageSize || 20);
      const offset = (page - 1) * pageSize;
      let where = ` WHERE 1=1 `;
      const args = [];
      if (req.query.projectId) {
        where += ` AND h.project_id = ?`;
        args.push(req.query.projectId);
      }
      if (req.query.eventType) {
        where += ` AND r.event_type = ?`;
        args.push(req.query.eventType);
      }
      if (req.query.status) {
        where += ` AND h.status = ?`;
        args.push(req.query.status);
      }
      const total = db
        .prepare(
          `SELECT COUNT(*) AS c
           FROM notification_history h
           LEFT JOIN notification_rules r ON r.id = h.rule_id
           ${where}`,
        )
        .get(...args).c;
      const items = db
        .prepare(
          `SELECT h.*, r.event_type
           FROM notification_history h
           LEFT JOIN notification_rules r ON r.id = h.rule_id
           ${where}
           ORDER BY h.id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...args, pageSize, offset);
      res.json({
        items,
        pagination: {
          page,
          pageSize,
          total: Number(total || 0),
          totalPages: Math.max(1, Math.ceil(Number(total || 0) / pageSize)),
        },
      });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.put(
  '/history/:id/reply',
  requireAuth,
  param('id').isInt(),
  body('reply_status').isIn(['unknown', 'replied', 'no_reply']),
  body('reply_note').optional().isString(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const id = Number(req.params.id);
      const ex = db.prepare(`SELECT id FROM notification_history WHERE id = ?`).get(id);
      if (!ex) return res.status(404).json({ message: '记录不存在' });
      db.prepare(
        `UPDATE notification_history
         SET reply_status=?, reply_note=?
         WHERE id = ?`,
      ).run(req.body.reply_status, req.body.reply_note || '', id);
      res.json(db.prepare(`SELECT * FROM notification_history WHERE id = ?`).get(id));
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

export default router;
