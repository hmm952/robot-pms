import { db, insertId } from '../db.js';
import { sendMail } from './mailService.js';

function renderTemplate(tpl, vars) {
  let out = String(tpl || '');
  for (const [k, v] of Object.entries(vars || {})) {
    const reg = new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g');
    out = out.replace(reg, String(v ?? ''));
  }
  return out;
}

function projectLink(path) {
  const base = process.env.APP_BASE_URL || 'http://localhost:5173';
  return `${base}${path}`;
}

function dedupeKey({ ruleId, eventType, entityId, dateTag }) {
  return `${ruleId}:${eventType}:${entityId}:${dateTag}`;
}

function splitRecipients(s) {
  return String(s || '')
    .split(/[;,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

async function createAndSendHistory({ projectId, rule, template, toList, vars, dedupe }) {
  if (!toList.length) return { skipped: true, reason: 'no recipients' };
  const existing = db
    .prepare(`SELECT id FROM notification_history WHERE dedupe_key = ?`)
    .get(dedupe);
  if (existing) return { skipped: true, reason: 'duplicated' };

  const subject = renderTemplate(template.subject_template, vars);
  const body = renderTemplate(template.body_template, vars);
  const to = toList.join(',');
  const info = db
    .prepare(
      `INSERT INTO notification_history
      (project_id, rule_id, template_code, channel, to_recipients, subject, body, status, dedupe_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'))`,
    )
    .run(projectId, rule.id, template.code, rule.channel || 'email', to, subject, body, dedupe);
  const hid = insertId(info);
  try {
    if (rule.channel === 'email') {
      const result = await sendMail({ to, subject, text: body });
      if (!result.ok) throw new Error(result.message || '邮件发送失败');
      db.prepare(
        `UPDATE notification_history
         SET status='sent', provider_message_id=?, sent_at=datetime('now')
         WHERE id=?`,
      ).run(result.messageId || null, hid);
    } else {
      // 企业微信/钉钉预留：当前先记录历史，不实际推送
      db.prepare(
        `UPDATE notification_history
         SET status='sent', sent_at=datetime('now'), provider_message_id=?
         WHERE id=?`,
      ).run('reserved-channel', hid);
    }
    return { ok: true };
  } catch (e) {
    db.prepare(
      `UPDATE notification_history
       SET status='failed', error_message=?, sent_at=datetime('now')
       WHERE id=?`,
    ).run(String(e.message || '发送失败'), hid);
    return { ok: false, message: e.message };
  }
}

function getProjectName(projectId) {
  return db.prepare(`SELECT name FROM projects WHERE id = ?`).get(projectId)?.name || `项目#${projectId}`;
}

function collectTaskOverdueEvents(projectId, offsetDays) {
  const rows = db
    .prepare(
      `SELECT t.*, u.email AS assignee_email, u.full_name AS assignee_name
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.project_id = ?
         AND t.status != 'done'
         AND COALESCE(t.end_date, t.due_date) IS NOT NULL
         AND date(COALESCE(t.end_date, t.due_date)) = date('now', ?)`,
    )
    .all(projectId, `-${Math.max(1, Number(offsetDays || 1))} day`);
  return rows.map((r) => ({
    entityId: r.id,
    to: r.assignee_email ? [r.assignee_email] : [],
    vars: {
      project_name: getProjectName(projectId),
      task_title: r.title,
      assignee_name: r.assignee_name || '未指定',
      due_date: r.end_date || r.due_date || '',
      progress: Number(r.progress ?? 0),
      delay_days: Math.max(1, Number(offsetDays || 1)),
      system_link: projectLink(`/tasks/${r.id}`),
    },
  }));
}

function collectReviewReminderEvents(projectId, offsetDays) {
  const rows = db
    .prepare(
      `SELECT r.*, u.email AS lead_email, u.full_name AS lead_name
       FROM reviews r
       LEFT JOIN users u ON u.id = r.lead_reviewer_id
       WHERE r.project_id = ?
         AND r.status IN ('scheduled','in_progress')
         AND r.review_date IS NOT NULL
         AND date(r.review_date) = date('now', ?)`,
    )
    .all(projectId, `+${Math.max(1, Number(offsetDays || 3))} day`);
  return rows.map((r) => ({
    entityId: r.id,
    to: r.lead_email ? [r.lead_email] : [],
    vars: {
      project_name: getProjectName(projectId),
      review_title: r.title,
      review_date: r.review_date || '',
      assignee_name: r.lead_name || '未指定',
      system_link: projectLink(`/reviews/${r.id}`),
    },
  }));
}

function collectPaymentReminderEvents(projectId, offsetDays) {
  const rows = db
    .prepare(
      `SELECT p.*, c.title AS contract_title
       FROM contract_payment_nodes p
       INNER JOIN contracts c ON c.id = p.contract_id
       WHERE c.project_id = ?
         AND p.status = 'pending'
         AND date(p.due_date) = date('now', ?)`,
    )
    .all(projectId, `+${Math.max(1, Number(offsetDays || 7))} day`);
  return rows.map((r) => ({
    entityId: r.id,
    to: [],
    vars: {
      project_name: getProjectName(projectId),
      payment_title: r.title,
      due_date: r.due_date || '',
      amount: r.amount ?? '',
      system_link: projectLink(`/contracts/${r.contract_id}`),
    },
  }));
}

function collectMilestoneWarningEvents(projectId, offsetDays) {
  const rows = db
    .prepare(
      `SELECT * FROM plan_milestones
       WHERE project_id = ?
         AND status NOT IN ('achieved','cancelled')
         AND target_date IS NOT NULL
         AND date(target_date) = date('now', ?)`,
    )
    .all(projectId, `+${Math.max(1, Number(offsetDays || 3))} day`);
  return rows.map((r) => ({
    entityId: r.id,
    to: [],
    vars: {
      project_name: getProjectName(projectId),
      milestone_name: r.name,
      due_date: r.target_date || '',
      delay_days: 0,
      system_link: projectLink('/plan'),
    },
  }));
}

function collectEventsByRule(rule) {
  if (rule.event_type === 'task_overdue')
    return collectTaskOverdueEvents(rule.project_id, rule.offset_days);
  if (rule.event_type === 'review_reminder')
    return collectReviewReminderEvents(rule.project_id, rule.offset_days);
  if (rule.event_type === 'payment_reminder')
    return collectPaymentReminderEvents(rule.project_id, rule.offset_days);
  if (rule.event_type === 'milestone_warning')
    return collectMilestoneWarningEvents(rule.project_id, rule.offset_days);
  return [];
}

function defaultManualRecipients(projectId) {
  const rows = db
    .prepare(
      `SELECT u.email
       FROM project_members pm
       INNER JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ? AND u.email IS NOT NULL AND u.email != ''`,
    )
    .all(projectId);
  return rows.map((r) => r.email).filter(Boolean);
}

export async function runNotificationScheduler() {
  const rules = db
    .prepare(
      `SELECT r.*, t.code, t.subject_template, t.body_template
       FROM notification_rules r
       INNER JOIN notification_templates t ON t.code = r.template_code
       WHERE r.enabled = 1 AND t.enabled = 1`,
    )
    .all();

  for (const rule of rules) {
    const template = {
      code: rule.code,
      subject_template: rule.subject_template,
      body_template: rule.body_template,
    };
    const events = collectEventsByRule(rule);
    for (const e of events) {
      const toList =
        rule.recipient_mode === 'manual'
          ? splitRecipients(rule.manual_recipients)
          : e.to.length
            ? e.to
            : defaultManualRecipients(rule.project_id);
      const key = dedupeKey({
        ruleId: rule.id,
        eventType: rule.event_type,
        entityId: e.entityId,
        dateTag: new Date().toISOString().slice(0, 10),
      });
      await createAndSendHistory({
        projectId: rule.project_id,
        rule,
        template,
        toList,
        vars: e.vars,
        dedupe: key,
      });
    }
  }
}

let started = false;
export function startNotificationJob() {
  if (started) return;
  started = true;
  setInterval(async () => {
    try {
      await runNotificationScheduler();
    } catch {
      // ignore timer errors
    }
  }, 60 * 60 * 1000);
}

export async function sendManualNotification({ projectId, template, recipients, vars, channel = 'email' }) {
  const fakeRule = { id: null, channel, event_type: 'manual', recipient_mode: 'manual' };
  return createAndSendHistory({
    projectId,
    rule: fakeRule,
    template,
    toList: splitRecipients(recipients),
    vars,
    dedupe: `manual:${template.code}:${Date.now()}:${Math.random()}`,
  });
}
